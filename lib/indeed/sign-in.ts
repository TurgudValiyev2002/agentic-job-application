import "server-only";
import { indeedBaseUrl } from "../jobs/sources/indeed-data";
import { createSavedIndeedContext, indeedChromium, isIndeedSignedIn, launchIndeedBrowser, launchIndeedSignInProfile, readSignedInFlag } from "./browser";
import { loadIndeedSession, maskEmail, recordIndeedVerification, refreshIndeedSession, saveIndeedSession } from "./session";

export type SignInProgress = { active: boolean; startedAt: string | null; message: string | null };
const SIGN_IN_TIMEOUT_MS = 6 * 60_000;

// Share progress across Next route bundles and development module reloads.
type SignInRuntime = { current: { startedAt: number; promise: Promise<void> } | null; lastMessage: string | null };
const localProcess = globalThis as typeof globalThis & { orchIndeedSignIn?: SignInRuntime };
const runtime = localProcess.orchIndeedSignIn ??= { current: null, lastMessage: null };

export function signInProgress(): SignInProgress & { patched: boolean } {
  return { active: Boolean(runtime.current), startedAt: runtime.current ? new Date(runtime.current.startedAt).toISOString() : null, message: runtime.lastMessage, patched: indeedChromium().patched };
}

/**
 * Opens a visible browser at Indeed's sign-in page and waits for the person to finish there (email one-time code,
 * passkey, or Google/Apple). Only the resulting Indeed cookies are saved; nothing is typed by the app.
 */
export function startIndeedSignIn() {
  if (runtime.current) return { started: false, message: "A sign-in window is already open on this computer. Finish or close it first." };
  const startedAt = Date.now();
  runtime.lastMessage = null;
  runtime.current = { startedAt, promise: runSignIn().then(() => { runtime.lastMessage = "Indeed sign-in saved. It will be used for job search and applications until you replace it."; })
    .catch(() => { runtime.lastMessage = "Indeed sign-in did not complete. The window may have closed, timed out, or still require verification. Please try again."; })
    .finally(() => { runtime.current = null; }) };
  return { started: true, message: "A browser window opened on this computer. Sign in to Indeed there; this page updates when it is saved." };
}

function hostname(url: string) { try { return new URL(url).hostname; } catch { return ""; } }

async function runSignIn() {
  const base = indeedBaseUrl();
  // The person drives this window, so navigation is not restricted; only Indeed cookies are kept afterwards.
  const { context, cleanup } = await launchIndeedSignInProfile();
  try {
    const page = context.pages()[0] ?? await context.newPage();
    const landing = `${base}/jobs?q=engineer`;
    await page.goto(`https://secure.indeed.com/auth?continue=${encodeURIComponent(landing)}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    let emailHint: string | null = null;
    let revisited = false;
    const deadline = Date.now() + SIGN_IN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new Error("The sign-in window was closed before Indeed confirmed the sign-in.");
      const host = hostname(page.url());
      if (host === "secure.indeed.com") {
        const typed = await page.locator('input[type="email"], input[name="__email"]').first().inputValue({ timeout: 500 }).catch(() => "");
        if (typed.includes("@")) emailHint = maskEmail(typed);
      } else if (/^(?:[a-z]{2}|www)\.indeed\.com$/.test(host)) {
        if (await readSignedInFlag(page)) {
          await saveIndeedSession(await context.storageState(), emailHint);
          return;
        }
        // A landing page without the sign-in flag (for example the home page) is checked once via a search page.
        if (!revisited) { revisited = true; await page.goto(landing, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {}); continue; }
      }
      await page.waitForTimeout(1500).catch(() => {});
    }
    throw new Error("Indeed did not confirm a sign-in within six minutes. Start the sign-in again.");
  } finally { await context.close().catch(() => {}); await cleanup(); }
}

/** Verifies the saved session in a fresh visible browser and refreshes rotated cookies. Never applies to anything. */
export async function checkSavedIndeedSession() {
  if (runtime.current) return { ok: false, message: "Finish the open sign-in window first." };
  if (!(await loadIndeedSession())) return { ok: false, message: "Sign in to Indeed first." };
  const browser = await launchIndeedBrowser();
  try {
    const { context, session } = await createSavedIndeedContext(browser, "read");
    const result = await isIndeedSignedIn(context);
    if (session) {
      await recordIndeedVerification(session.version, result.ok && result.signedIn);
      if (result.ok && result.signedIn) { try { await refreshIndeedSession(session.version, await context.storageState()); } catch { /* Verification already recorded. */ } }
    }
    return { ok: result.ok && result.signedIn, message: result.message };
  } finally { await browser.close().catch(() => {}); }
}
