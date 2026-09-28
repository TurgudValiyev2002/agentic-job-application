import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";
import type { ZodType } from "zod";
import { INDEED_APPLY_SELECTOR, awaitVerification, createSavedIndeedContext, launchIndeedBrowser, pageProblem, readIndeedPostingState, readSignedInFlag, verificationWaitMs, type VerificationWait } from "../../indeed/browser";
import type { JobSource, NormalizedJob } from "../types";
import { mapWithConcurrency } from "../concurrency";
import { indeedBaseUrl, indeedCardUrl, indeedJobUrl, planIndeedSearches, jobPageSchema, normalizeIndeedPosting, searchPageSchema, type IndeedJobCard, type IndeedJobPage, type IndeedSearchPage } from "./indeed-data";

const CACHE_MS = 60 * 60 * 1000;

async function cached<T>(key: string, schema: ZodType<T>, produce: () => Promise<T>): Promise<T> {
  const directory = process.env.JOB_SOURCE_CACHE_DIR ?? path.join(process.cwd(), ".cache", "job-sources");
  const filename = path.join(directory, `indeed-${createHash("sha256").update(key).digest("hex")}.json`);
  try {
    const stored = JSON.parse(await readFile(filename, "utf8"));
    const age = Date.now() - stored.fetchedAt;
    if (typeof stored.fetchedAt === "number" && age >= 0 && age < CACHE_MS) return schema.parse(stored.page);
  } catch { /* Fetch missing, expired or invalid public data. */ }
  const page = await produce();
  try {
    await mkdir(directory, { recursive: true });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ fetchedAt: Date.now(), page }));
    await rename(temporary, filename);
  } catch { console.warn("Indeed page cache could not be saved."); }
  return page;
}

function assertSearchUrl(url: string) {
  const target = new URL(url);
  if (target.username || target.password || target.origin !== indeedBaseUrl(target.origin) || target.pathname !== "/jobs") throw new Error("Invalid Indeed search URL.");
  return target;
}

// The bot-check wait lives in lib/indeed/browser so the application worker shares it; discovery re-exports it.
export { verificationWaitMs, type VerificationWait };

/** Reads one public search page: the embedded job-card model, with anchor job keys as a fallback. */
export async function readIndeedSearchPage(context: BrowserContext, url: string, timeout = 20_000, verification: VerificationWait = { waitMs: 0 }): Promise<IndeedSearchPage> {
  const target = assertSearchUrl(url);
  // v3: the job-card model is read from the bundled inline script when the signed-in layout exposes no global.
  return cached(`search-v3:${target.href}`, searchPageSchema, async () => {
    const page = await context.newPage();
    try {
      const response = await page.goto(target.href, { waitUntil: "domcontentloaded", timeout });
      const problem = await awaitVerification(page, await pageProblem(page), verification);
      if (problem) throw new Error(problem);
      // The original response can be the 403 challenge even after verification navigates to the results.
      if (!response?.ok()) {
        await page.waitForSelector("[data-jk], #mosaic-provider-jobcards, .jobsearch-NoResult-messageContainer", { state: "attached", timeout: 8_000 }).catch(() => {});
        if (!await page.locator("[data-jk], #mosaic-provider-jobcards, .jobsearch-NoResult-messageContainer").count()) throw new Error(`Indeed returned HTTP ${response?.status() ?? "unknown"}.`);
      }
      const arrived = new URL(page.url());
      if (arrived.origin !== target.origin || arrived.pathname !== target.pathname ||
        (target.searchParams.has("l") && arrived.searchParams.get("l") !== target.searchParams.get("l"))) throw new Error("Indeed redirected the requested search location; it was not treated as a match.");
      await page.waitForFunction(() => Boolean(document.querySelector("[data-jk], #mosaic-provider-jobcards, .jobsearch-NoResult-messageContainer")), {}, { timeout: 8_000 }).catch(() => {});
      const data = await page.evaluate(() => {
        type CardsModel = { results?: unknown[]; loggedIn?: unknown };
        const w = window as unknown as { mosaic?: { providerData?: Record<string, { metaData?: { mosaicProviderJobCardsModel?: CardsModel } }> } };
        let model: CardsModel | undefined = w.mosaic?.providerData?.["mosaic-provider-jobcards"]?.metaData?.mosaicProviderJobCardsModel;
        if (!model) {
          // The signed-in layout keeps the same model as JSON text inside a bundled inline script: cut out the balanced object.
          // Destructured so the TypeScript loader used by tests does not inject a name helper into browser code.
          const [balanced] = [(text: string, from: number) => {
            let depth = 0, inString = false;
            for (let index = from; index < text.length; index++) {
              const char = text[index];
              if (inString) { if (char === "\\") index++; else if (char === '"') inString = false; continue; }
              if (char === '"') inString = true;
              else if (char === "{") depth++;
              else if (char === "}" && --depth === 0) return text.slice(from, index + 1);
            }
            return null;
          }];
          for (const script of document.querySelectorAll("script:not([src])")) {
            const text = script.textContent ?? "";
            const at = text.indexOf('"mosaicProviderJobCardsModel":');
            if (at < 0) continue;
            const start = text.indexOf("{", at);
            const json = start >= 0 ? balanced(text, start) : null;
            if (!json) continue;
            try { model = JSON.parse(json) as CardsModel; break; } catch { /* Try the next script. */ }
          }
        }
        const anchors = [...document.querySelectorAll<HTMLElement>("[data-jk]")].map((element) => ({
          jobkey: element.getAttribute("data-jk") ?? "", title: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "",
          company: element.closest("li, .job_seen_beacon")?.querySelector('[data-testid="company-name"]')?.textContent?.trim() ?? "",
        }));
        return { results: model?.results ?? anchors, fromModel: Boolean(model?.results), loggedIn: typeof model?.loggedIn === "boolean" ? model.loggedIn : null, body: document.body.innerText.slice(0, 3000) };
      });
      if (!data.fromModel && data.results.length) console.warn(`Indeed search page ${target.href}: job-card model not found; fell back to result links without apply flags or dates.`);
      const loggedIn = data.loggedIn ?? await readSignedInFlag(page);
      const cards = data.results.map((card) => searchPageSchema.shape.cards.element.safeParse(card)).flatMap((parsed) => parsed.success ? [parsed.data] : []);
      const empty = /we didn't find any results|keine ergebnisse|no results|did not match any jobs|keine passenden jobs/i.test(data.body);
      if (!cards.length && !empty) throw new Error("Indeed returned no readable job list. The page layout may have changed or a verification is pending.");
      return { cards, loggedIn, empty };
    } finally { await page.close(); }
  });
}

/** Reads one posting page: JSON-LD JobPosting plus Indeed's apply-button state. */
export async function readIndeedJobPage(context: BrowserContext, url: string, timeout = 20_000, verification: VerificationWait = { waitMs: 0 }): Promise<IndeedJobPage> {
  const canonical = indeedJobUrl(url);
  if (!canonical) throw new Error("Invalid Indeed posting URL.");
  // v4: the apply flag comes from the page's view-job model (global or bundled inline script), which survives the client-rendered header.
  return cached(`posting-v4:${canonical}`, jobPageSchema, async () => {
    const page = await context.newPage();
    try {
      const response = await page.goto(canonical, { waitUntil: "domcontentloaded", timeout });
      const problem = await awaitVerification(page, await pageProblem(page), verification);
      if (problem) throw new Error(problem);
      if (!response?.ok()) {
        // A cleared challenge navigates to the posting on its own; the response from goto was the
        // challenge page, so judge by the posting content once that navigation has landed.
        await page.waitForFunction(() => Boolean(document.querySelector('script[type="application/ld+json"]')), {}, { timeout: 10_000 }).catch(() => {});
        if (!(await page.locator('script[type="application/ld+json"]').count())) throw new Error(`Indeed returned HTTP ${response?.status() ?? "unknown"}.`);
      }
      if (indeedJobUrl(page.url()) !== canonical) throw new Error("Indeed redirected the requested posting; it was not treated as a match.");
      const state = await readIndeedPostingState(page);
      const data = await page.evaluate((applySelector) => ({
        scripts: [...document.querySelectorAll('script[type="application/ld+json"]')].map((script) => script.textContent ?? ""),
        // The apply header is rendered client-side, so the DOM only proves presence, never absence.
        applyButton: Boolean(document.querySelector(applySelector)),
      }), INDEED_APPLY_SELECTOR);
      const result = { scripts: data.scripts, loggedIn: state.loggedIn ?? await readSignedInFlag(page), indeedApply: state.indeedApply ?? data.applyButton, expired: state.expired };
      if (!normalizeIndeedPosting(canonical, result)) throw new Error("Indeed returned no readable job data. The posting may have expired or changed.");
      return result;
    } finally { await page.close(); }
  });
}

/**
 * Interleaves the result lists, then drops duplicates, postings older than the window, ones already applied to
 * and, for automatic runs, cards Indeed marks as company-site applications, all before a posting page is spent.
 * A card with no apply flag is kept so its page can decide.
 */
export function selectIndeedCards(lists: IndeedJobCard[][], options: { maxAgeDays?: number | null; appliedKeys: ReadonlySet<string>; indeedApplyOnly?: boolean; now?: number }) {
  const seen = new Set<string>();
  // Indeed's age filter is applied in the search URL; the card date catches anything that slips through (for example a cached page).
  const oldest = options.maxAgeDays ? (options.now ?? Date.now()) - options.maxAgeDays * 86_400_000 : 0;
  let stale = 0, alreadyApplied = 0, companySite = 0;
  const cards = Array.from({ length: Math.max(0, ...lists.map((list) => list.length)) }, (_, i) => lists.flatMap((list) => list[i] ? [list[i]] : [])).flat()
    .filter((card) => { const key = card.jobkey.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; })
    .filter((card) => { if (card.pubDate && card.pubDate < oldest) { stale++; return false; } return true; })
    .filter((card) => { if (options.appliedKeys.has(card.jobkey.toLowerCase())) { alreadyApplied++; return false; } return true; })
    .filter((card) => { if (options.indeedApplyOnly && card.indeedApplyable === false) { companySite++; return false; } return true; });
  return { cards, stale, alreadyApplied, companySite };
}

export const indeedSource: JobSource = {
  name: "indeed", available: () => true,
  async search(profile, onProgress, plan) {
    const round = plan?.round ?? 0;
    await onProgress?.({ phase: "searching", message: "Opening Indeed job search in a visible browser window.", fetched: 0 });
    const browser = await launchIndeedBrowser();
    try {
      const { context, session } = await createSavedIndeedContext(browser, "read");
      const plan = planIndeedSearches(profile, round);
      // The budget grows with the plan: a base plus a few seconds per search page, bounded so a run cannot stall for long.
      let deadline = Date.now() + Math.min(6 * 60_000, 60_000 + plan.urls.length * 4_000);
      const remaining = () => Math.max(1, Math.min(20_000, deadline - Date.now()));
      // Time spent waiting for browser verification is not search time.
      let verificationAnnounced = false;
      const verification: VerificationWait = { onWaiting: async () => {
        if (verificationAnnounced) return;
        verificationAnnounced = true;
        deadline += verificationWaitMs();
        await onProgress?.({ phase: "searching", message: `Indeed browser verification detected. Trying a visible Cloudflare checkbox automatically and waiting up to ${Math.round(verificationWaitMs() / 60_000)} minutes for clearance.` });
      }, onCloudflareClick: async () => {
        await onProgress?.({ phase: "searching", message: "Attempted the Cloudflare checkbox. Waiting for Indeed to clear verification." });
      } };
      let lastReadError: string | null = null;
      const urls = plan.urls;
      await onProgress?.({ phase: "searching", message: profile.locations.length
        ? `Using only the run's location settings: ${profile.locations.join("; ")}.`
        : `No location restriction selected. Searching ${[...new Set(urls.map(url => new URL(url).searchParams.get("l")))].join("; ")}. CV and account locations are not used.` });
      await onProgress?.({ phase: "searching", message: `Planned ${urls.length} Indeed search pages: ${plan.titles.join(", ")}${plan.localized ? " (with local-language forms)" : ""} × ${plan.queries / plan.titles.length} market quer${plan.queries / plan.titles.length === 1 ? "y" : "ies"} × ${plan.pagesPerQuery} page${plan.pagesPerQuery === 1 ? "" : "s"} from page ${plan.page}, relevance order within ${profile.maxAgeDays ? `the last ${profile.maxAgeDays} days` : "any posting age"}.` });
      let errors = 0, signedIn: boolean | null = null;
      let searchesRead = 0, searchesAttempted = 0;
      const lists = await mapWithConcurrency(urls, 3, async (url): Promise<IndeedJobCard[]> => {
        if (Date.now() >= deadline) return [];
        searchesAttempted++;
        const query = new URL(url).searchParams;
        await onProgress?.({ phase: "searching", message: `Searching Indeed · ${new URL(url).hostname} · ${query.get("q")} · ${query.get("l")} · page ${Math.floor(Number(query.get("start") ?? 0) / 10) + 1}.` });
        try {
          const page = await readIndeedSearchPage(context, url, remaining(), verification);
          signedIn = page.loggedIn;
          searchesRead++;
          return page.cards.filter((card) => !card.expired).map(card => ({ ...card, searchOrigin: new URL(url).origin }));
        } catch (error) {
          errors++;
          await onProgress?.({ phase: "searching", message: `Indeed search page skipped: ${error instanceof Error ? error.message : "page unavailable"}` });
          return [];
        }
      });
      await onProgress?.({ phase: "searching", message: `Read ${searchesRead}/${urls.length} planned Indeed searches.${searchesAttempted < urls.length ? ` ${urls.length - searchesAttempted} searches were not reached within the time limit.` : ""}` });
      if (!searchesRead) throw new Error("Indeed search pages could not be read.");
      // Interleave title/location searches so the first query cannot consume the whole budget.
      const maxAgeDays = profile.maxAgeDays;
      // Postings already applied to are dropped by job key here, before a browser page is spent on them.
      // Imported lazily like the session store, so the page readers stay usable without a database.
      const applied = await (await import("../../job-applications/applied")).loadAppliedJobs();
      const { cards, stale, alreadyApplied, companySite } = selectIndeedCards(lists, { maxAgeDays, appliedKeys: applied.indeedKeys, indeedApplyOnly: profile.indeedApplyOnly });
      if (stale) await onProgress?.({ phase: "searching", message: `Skipped ${stale} Indeed posting${stale === 1 ? "" : "s"} older than ${maxAgeDays} days.` });
      if (alreadyApplied) await onProgress?.({ phase: "searching", message: `Skipped ${alreadyApplied} Indeed posting${alreadyApplied === 1 ? "" : "s"} you already applied to.` });
      if (companySite) await onProgress?.({ phase: "searching", message: `Skipped ${companySite} Indeed posting${companySite === 1 ? "" : "s"} that send applicants to the company site; automatic runs only consider Indeed Apply.` });
      const configured = Number(process.env.INDEED_MAX_JOBS ?? 80);
      const limit = Number.isSafeInteger(configured) && configured > 0 ? Math.min(120, configured) : 80;
      if (cards.length > limit) await onProgress?.({ phase: "searching", message: `${cards.length} listings remain after filtering; reading the first ${limit} this round (INDEED_MAX_JOBS).` });
      let fetched = 0, skippedAfterRead = 0;
      const details = await mapWithConcurrency(cards.slice(0, limit), 3, async (card) => {
        if (Date.now() >= deadline) return null;
        const url = indeedCardUrl(card);
        try {
          const page = await readIndeedJobPage(context, url, remaining(), verification);
          if (page.expired) return null;
          // The posting page is authoritative; a card that promised Indeed Apply can still turn out to be a company-site posting.
          if (profile.indeedApplyOnly && !page.indeedApply) { skippedAfterRead++; return null; }
          const job = normalizeIndeedPosting(url, page, card);
          if (job) {
            fetched++;
            await onProgress?.({ phase: "searching", message: `Read ${fetched} full job postings from Indeed.`, fetched });
          }
          return job;
        } catch (error) { errors++; lastReadError = error instanceof Error ? error.message : "page unavailable"; return null; }
      });
      const jobs = details.filter((job): job is NormalizedJob => Boolean(job));
      if (skippedAfterRead) await onProgress?.({ phase: "searching", message: `Skipped ${skippedAfterRead} more Indeed posting${skippedAfterRead === 1 ? "" : "s"} whose page turned out to send applicants to the company site.` });
      if (cards.length && !jobs.length && skippedAfterRead === details.filter((job) => job === null).length && skippedAfterRead) throw new Error("Every Indeed posting read in this round sends applicants to the company site; no Indeed Apply postings to consider.");
      if (cards.length && !jobs.length) throw new Error(`Indeed listings were found, but their full descriptions could not be read${lastReadError ? `: ${lastReadError}` : ""} No incomplete postings were scored.`);
      if (session && signedIn) {
        try { const state = await context.storageState(); await (await import("../../indeed/session")).refreshIndeedSession(session.version, state); } catch { /* Rotated cookies are a bonus; a closed browser must not fail the search. */ }
      }
      const applyable = jobs.filter((job) => (job.raw as { indeedApply?: boolean }).indeedApply).length;
      await onProgress?.({ phase: "searching", message: `Retrieved ${jobs.length} full postings from Indeed (${applyable} with Indeed Apply).${errors ? ` ${errors} pages could not be read.` : ""}${Date.now() >= deadline ? " Search time limit reached." : ""}${signedIn === false ? " Sign in to Indeed to read later result pages." : ""}`, fetched: jobs.length });
      return jobs;
    } finally { await browser.close(); }
  },
};
