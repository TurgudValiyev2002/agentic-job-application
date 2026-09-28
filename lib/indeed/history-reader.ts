import "server-only";
import type { Browser } from "playwright";
import { launchIndeedBrowser, pageProblem, readSignedInFlag } from "./browser";
import { parseIndeedHistory } from "./history-data";
import { indeedBaseUrl } from "../jobs/sources/indeed-data";

/** Reading history must not update application statuses, save jobs, or submit forms. */
export function historyRequestAllowed(method: string, address: string, navigation: boolean) {
  try {
    const url = new URL(address);
    return ["GET", "HEAD"].includes(method) && url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (/(^|\.)indeed\.com$/.test(url.hostname) || (!navigation && url.hostname === "d3fw5vlhllyvee.cloudfront.net"));
  } catch { return false; }
}

export async function readIndeedHistory(state: object, launch: () => Promise<Browser> = launchIndeedBrowser) {
  const browser = await launch();
  const deadline = Date.now() + 90_000;
  const timeout = setTimeout(() => { void browser.close().catch(() => {}); }, 90_000);
  try {
    const context = await browser.newContext({ storageState: state as never, serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", route => historyRequestAllowed(route.request().method(), route.request().url(), route.request().isNavigationRequest()) ? route.continue() : route.abort());
    const page = await context.newPage();
    const captured = new Map<string, Promise<{ data: unknown; since: number | null }>>();
    page.on("response", response => {
      const url = new URL(response.url());
      if (url.origin !== "https://myjobs.indeed.com" || response.request().method() !== "GET") return;
      const key = url.pathname === "/api/v1/appStatusJobs" ? url.searchParams.get("type") : url.pathname === "/api/v1/interviews" ? "INTERVIEWS" : null;
      if (!key || !["POST_APPLY", "SAVED", "ARCHIVED", "INTERVIEWS"].includes(key)) return;
      const result = response.json().then(data => ({ data: response.ok() ? data : null, since: Number(url.searchParams.get("applyUpdateStartTime")) || null })).catch(() => ({ data: null, since: null }));
      captured.set(key, result);
    });
    const co = new URL(indeedBaseUrl()).hostname.split(".")[0].toUpperCase();
    const response = await page.goto(`https://myjobs.indeed.com/?hl=en${co.length === 2 ? `&co=${co}` : ""}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const problem = await pageProblem(page);
    if (problem) throw new Error(problem);
    if (!response?.ok()) throw new Error("Indeed application history could not be loaded.");
    await page.getByTestId("APPLIED").waitFor({ timeout: 20_000 }).catch(async () => { throw new Error(await pageProblem(page) ?? "Indeed's application history layout could not be read. Try signing in again."); });
    if (!await readSignedInFlag(page)) throw new Error("Sign in to Indeed again before syncing application history.");
    const read = async (key: string) => {
      while (!captured.has(key) && Date.now() < deadline) await page.waitForTimeout(100);
      const result = captured.get(key);
      if (!result) throw new Error("Indeed did not return complete application history. Try syncing again.");
      return result;
    };
    const saved = await read("SAVED");
    await page.getByTestId("APPLIED").click();
    const applied = await read("POST_APPLY");
    await page.getByTestId("ARCHIVED").click();
    const archived = await read("ARCHIVED");
    const interviews = await read("INTERVIEWS");
    try { return parseIndeedHistory({ saved: saved.data, applied: applied.data, archived: archived.data, interviews: interviews.data, since: applied.since }); }
    catch { throw new Error("Indeed returned application data in an unexpected format. The previous sync has been kept."); }
  } finally { clearTimeout(timeout); await browser.close().catch(() => {}); }
}
