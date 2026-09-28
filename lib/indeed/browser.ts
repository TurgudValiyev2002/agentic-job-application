import "server-only";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { type Browser, type BrowserContext, type BrowserType, type Page } from "playwright";
import { chromium as patchedChromium } from "patchright";
import { VERIFICATION_MESSAGE, indeedBaseUrl, indeedPageProblem, isIndeedHost } from "../jobs/sources/indeed-data";

// Current posting pages render a SmartApply anchor (data-testid viewjob-indeed-apply) instead of the legacy button ID.
export const INDEED_APPLY_SELECTOR = '#indeedApplyButton, a[data-testid="viewjob-indeed-apply"], a[href^="https://smartapply.indeed.com/"]';
/** The "continue to application" control of a posting that sends applicants to the employer's own site. */
export const INDEED_EXTERNAL_APPLY_SELECTOR = '[data-testid="viewjob-apply"], #applyButtonLinkContainer a, #viewJobButtonLinkContainer a';

/** The declared Patchright dependency implements the Playwright browser API. */
export function indeedChromium(): { chromium: BrowserType; patched: boolean } {
  return { chromium: patchedChromium as unknown as BrowserType, patched: true };
}

/** Real Google Chrome when installed (closest to a normal visitor), otherwise Playwright's Chromium. */
async function launchWithBestChannel<T>(launch: (channel: "chrome" | undefined) => Promise<T>) {
  try { return await launch("chrome"); } catch { return launch(undefined); }
}

/**
 * Indeed answers headless Chromium with an immediate 403 "Request Blocked" (verified with both the bundled
 * Chromium and the Chrome channel), so every Indeed browser is a visible window on the computer running the
 * app or worker. Windows are closed as soon as the work is done.
 */
export function launchIndeedBrowser(options: { headless?: boolean } = {}) {
  const { chromium } = indeedChromium();
  return launchWithBestChannel((channel) => chromium.launch({ headless: options.headless ?? false, channel, args: ["--window-size=1200,900"] }));
}

/** The sign-in runs in a persistent profile so Cloudflare sees a stable browser and the person can retry a challenge. */
export async function launchIndeedSignInProfile() {
  const { chromium } = indeedChromium();
  // Stable within one sign-in, fresh between accounts. Never retain Google/Apple
  // login cookies or silently reconnect the previously removed Indeed account.
  const userDataDir = await mkdtemp(path.join(tmpdir(), "orch-indeed-signin-"));
  const cleanup = () => rm(userDataDir, { recursive: true, force: true });
  try {
    const context = await launchWithBestChannel((channel) => chromium.launchPersistentContext(userDataDir, { headless: false, channel, viewport: null, acceptDownloads: false, serviceWorkers: "block" }));
    return { context, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

/**
 * Requests that belong to a bot check rather than to Indeed's application, so never a
 * mutation of the account: Cloudflare's challenge platform, and the Google reCAPTCHA
 * Enterprise widget that Indeed's own "Security Check" page embeds.
 */
export function isChallengeRequest(url: URL) {
  if (url.protocol !== "https:") return false;
  if (url.hostname === "challenges.cloudflare.com" || url.hostname.endsWith(".challenges.cloudflare.com") || url.hostname === "www.recaptcha.net") return true;
  if ((url.hostname === "www.google.com" || url.hostname === "www.gstatic.com") && url.pathname.startsWith("/recaptcha/")) return true;
  // Indeed's own "Security Check" page is served from Cloudflare Pages and fetches its translations there.
  if (url.hostname === "indeed-static-pages.pages.dev") return true;
  return isIndeedHost(url.hostname) && url.pathname.startsWith("/cdn-cgi/challenge-platform/");
}

/** Any Indeed-owned host a page may talk to (statics, S3, telemetry), broader than the navigation allow-list. */
function isIndeedOwnedHost(hostname: string) {
  return hostname === "indeed.com" || hostname.endsWith(".indeed.com");
}

/** Cloudflare's interstitial and Turnstile widgets, recognised by structure because their text follows the browser locale. */
const CLOUDFLARE_MARKERS = '#challenge-running, #challenge-stage, #challenge-error-text, #challenge-form, #turnstile-wrapper, .cf-turnstile, [id^="cf-chl-widget"], iframe[src*="challenges.cloudflare.com"]';
/** Indeed's own "Security Check" page embeds a reCAPTCHA widget; ordinary pages only carry its invisible badge. */
const CHALLENGE_MARKERS = `${CLOUDFLARE_MARKERS}, iframe[src*="/recaptcha/"], #verificationMessage, #spinnerTitle`;
/** The Indeed Apply form is protected by an invisible reCAPTCHA, so its iframe alone is not a challenge there. */
export const APPLY_FORM_CHALLENGE_MARKERS = `${CLOUDFLARE_MARKERS}, #verificationMessage, #spinnerTitle`;

export type IndeedContextMode = "read" | "apply";

/** The request policy behind every Indeed browser context, kept pure so it can be tested without a browser. */
export function indeedRequestAllowed(mode: IndeedContextMode, request: { url: string; method: string; resourceType: string; navigation: boolean }) {
  const url = new URL(request.url);
  // A bot check loads its widget from a third-party host and submits the answer with a POST.
  // Blocking either leaves the person staring at "performing additional verification" forever.
  if (isChallengeRequest(url)) return true;
  if (["image", "font", "media"].includes(request.resourceType)) return false;
  // Discovery never leaves Indeed. It also never signs in, fills a form, uploads a CV or clicks
  // Apply; its only interaction is with a visible Cloudflare checkbox. We cannot block request
  // methods: Indeed's pages post a bot-signal beacon to t.indeed.com, and a browser whose beacons
  // fail is challenged by Cloudflare and then fails the challenge as well (verified 2026-09-17).
  if (mode === "read" && !isIndeedOwnedHost(url.hostname)) return false;
  // Applications stay on Indeed; embedded third-party analytics are not needed to apply.
  if (mode === "apply" && request.navigation && !isIndeedHost(url.hostname)) return false;
  return true;
}

/** `read` stays on Indeed, allowing verification clicks; `apply` also lets the Indeed Apply form save and submit. */
export async function createIndeedContext(browser: Browser, mode: IndeedContextMode, storageState?: object | null) {
  const context = await browser.newContext({ acceptDownloads: false, serviceWorkers: "block", viewport: { width: 1200, height: 860 }, ...(storageState ? { storageState: storageState as never } : {}) });
  await context.route("**/*", (route) => {
    const request = route.request();
    return indeedRequestAllowed(mode, { url: request.url(), method: request.method(), resourceType: request.resourceType(), navigation: request.isNavigationRequest() })
      ? route.continue() : route.abort();
  });
  // Real Chrome cannot open the tab that storageState() needs once every page is closed; keep one blank tab alive.
  await context.newPage();
  return context;
}

/** Opens a context authenticated with the saved session when one exists. Returns the session version for refreshes. */
export async function createSavedIndeedContext(browser: Browser, mode: IndeedContextMode) {
  // Loaded lazily so discovery code can be imported without a database connection.
  const { loadIndeedSession } = await import("./session");
  const session = await loadIndeedSession();
  return { context: await createIndeedContext(browser, mode, session?.state ?? null), session };
}

export async function pageProblem(page: Page, markers = CHALLENGE_MARKERS) {
  const title = await page.title().catch(() => "");
  const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
  const problem = indeedPageProblem(page.url(), title, body.slice(0, 1500));
  if (problem) return problem;
  const challenge = await page.evaluate((selector) => Boolean(document.querySelector(selector)), markers).catch(() => false);
  return challenge ? VERIFICATION_MESSAGE : null;
}

export type VerificationWait = {
  waitMs?: number;
  /** Called once when the verification wait starts. */
  onWaiting?: () => void | Promise<void>;
  onCloudflareClick?: () => void | Promise<void>;
  pollMs?: number;
  /** Background tabs re-load on this interval to pick up clearance from another tab. */
  reloadMs?: number;
};

export function verificationWaitMs() {
  const configured = Number(process.env.INDEED_VERIFICATION_WAIT_MS ?? 120_000);
  return Number.isSafeInteger(configured) && configured >= 0 ? configured : 120_000;
}

export const VERIFICATION_TIMEOUT_MESSAGE = "Indeed's browser verification was not completed in time. Complete it in the visible browser window and try again.";

/** Only operate the visible checkbox inside Cloudflare's own HTTPS widget, never an application control or reCAPTCHA. */
async function clickCloudflareCheckbox(page: Page, timeout: number): Promise<boolean> {
  for (const frame of page.frames()) {
    if (!frame.parentFrame()) continue;
    let url: URL;
    try { url = new URL(frame.url()); } catch { continue; }
    if (url.protocol !== "https:" || (url.hostname !== "challenges.cloudflare.com" && !url.hostname.endsWith(".challenges.cloudflare.com"))) continue;
    const checkboxes = frame.getByRole("checkbox");
    for (let index = 0; index < await checkboxes.count().catch(() => 0); index++) {
      const checkbox = checkboxes.nth(index);
      try {
        if (!await checkbox.isVisible() || !await checkbox.isEnabled() || await checkbox.isChecked()) continue;
      } catch { continue; /* The widget may still be attaching or navigating. */ }
      // Once attempted, do not repeat this click even if navigation destroys the frame or the widget rejects it.
      try {
        await checkbox.click({ timeout, noWaitAfter: true });
      } catch { /* Clearance is determined by pageProblem, never by click success. */ }
      return true;
    }
  }
  return false;
}

/**
 * Try a visible Cloudflare checkbox once, then wait for verified clearance. Other
 * challenges remain available in the browser for manual completion until timeout.
 */
export async function awaitVerification(page: Page, problem: string | null, wait: VerificationWait, markers = CHALLENGE_MARKERS) {
  if (problem !== VERIFICATION_MESSAGE) return problem;
  const { waitMs = verificationWaitMs(), pollMs = 2_000, reloadMs = 15_000 } = wait;
  if (waitMs <= 0) return problem;
  await wait.onWaiting?.();
  const deadline = Date.now() + waitMs;
  let lastReload = Date.now();
  let clicked = false;
  while (Date.now() < deadline) {
    if (!clicked && await clickCloudflareCheckbox(page, Math.max(1, Math.min(2_000, deadline - Date.now())))) {
      clicked = true;
      lastReload = Date.now();
      await wait.onCloudflareClick?.();
    }
    await page.waitForTimeout(Math.min(pollMs, Math.max(1, deadline - Date.now())));
    const current = await pageProblem(page, markers);
    if (current !== VERIFICATION_MESSAGE) return current;
    if (Date.now() - lastReload >= reloadMs) {
      lastReload = Date.now();
      await page.reload({ waitUntil: "domcontentloaded", timeout: Math.max(1, deadline - Date.now()) }).catch(() => {});
    }
  }
  return VERIFICATION_TIMEOUT_MESSAGE;
}

/**
 * The state a posting page embeds server-side. Since 2026-09 the view-job model lives under
 * `_initialData.viewJobClientSideModel`; older pages kept the same keys at the top level.
 * `indeedApply` is null when the page exposes no apply model at all, so callers fall back to the DOM.
 */
export async function readIndeedPostingState(page: Page): Promise<{ loggedIn: boolean | null; indeedApply: boolean | null; expired: boolean }> {
  return page.evaluate(() => {
    type Model = { loggedIn?: unknown; isLoggedIn?: unknown; indeedApplyButtonContainer?: unknown; jobInfoWrapperModel?: { jobInfoModel?: { showExpiredHeader?: unknown } }; viewJobClientSideModel?: Model };
    const w = window as unknown as { _initialData?: Model };
    const models = [w._initialData?.viewJobClientSideModel, w._initialData].filter((model): model is Model => Boolean(model));
    const loggedIn = models.map((model) => (typeof model.loggedIn === "boolean" ? model.loggedIn : typeof model.isLoggedIn === "boolean" ? model.isLoggedIn : null)).find((flag) => flag !== null) ?? null;
    const applyModel = models.find((model) => "indeedApplyButtonContainer" in model);
    let indeedApply = applyModel ? Boolean(applyModel.indeedApplyButtonContainer) : null;
    let expired = models.some((model) => model.jobInfoWrapperModel?.jobInfoModel?.showExpiredHeader === true);
    if (indeedApply === null) {
      // The signed-in page variant exposes no global at all: the same view-job model is JSON text inside a bundled inline script.
      const inline = [...document.querySelectorAll("script:not([src])")].map((script) => script.textContent ?? "").filter((text) => text.includes("indeedApplyButtonContainer"));
      const applyMatch = inline.map((text) => text.match(/"indeedApplyButtonContainer"\s*:\s*(null|\{)/)).find(Boolean);
      if (applyMatch) indeedApply = applyMatch[1] === "{";
      if (!expired) expired = inline.some((text) => /"showExpiredHeader"\s*:\s*true/.test(text));
    }
    expired ||= /this job has expired|diese stelle ist abgelaufen/i.test(document.body.innerText.slice(0, 2000));
    return { loggedIn, indeedApply, expired };
  }).catch(() => ({ loggedIn: null, indeedApply: null, expired: false }));
}

/** Indeed embeds the sign-in state in its search and posting pages; the header link is the fallback. */
export async function readSignedInFlag(page: Page) {
  return page.evaluate(() => {
    type Model = { loggedIn?: unknown; isLoggedIn?: unknown; viewJobClientSideModel?: Model };
    const w = window as unknown as { _initialData?: Model; mosaic?: { providerData?: Record<string, { metaData?: { mosaicProviderJobCardsModel?: { loggedIn?: unknown } } }> } };
    const flags = [w._initialData?.viewJobClientSideModel?.loggedIn, w._initialData?.loggedIn, w._initialData?.isLoggedIn, w.mosaic?.providerData?.["mosaic-provider-jobcards"]?.metaData?.mosaicProviderJobCardsModel?.loggedIn];
    const known = flags.find((flag) => typeof flag === "boolean");
    if (typeof known === "boolean") return known;
    return !document.querySelector('a[href*="secure.indeed.com/auth"]') && Boolean(document.querySelector('[data-gnav-element-name="AccountMenu"], [aria-label*="account" i]'));
  }).catch(() => false);
}

/** Loads one lightweight search page to learn whether the context is signed in. Never applies to anything. */
export async function isIndeedSignedIn(context: BrowserContext, base = indeedBaseUrl()) {
  const page = await context.newPage();
  try {
    await page.goto(`${base}/jobs?q=engineer`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const problem = await pageProblem(page);
    if (problem) return { ok: false, signedIn: false, message: problem };
    const signedIn = await readSignedInFlag(page);
    return { ok: true, signedIn, message: signedIn ? "Indeed session verified. No applications submitted." : "Indeed no longer recognises the saved session. Sign in again." };
  } catch {
    return { ok: false, signedIn: false, message: "Could not reach Indeed to check the session. The site may be unavailable or the browser was closed." };
  } finally { await page.close().catch(() => {}); }
}
