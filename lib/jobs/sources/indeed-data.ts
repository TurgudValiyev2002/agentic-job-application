import { z } from "zod";
import { jobAgeOptions, type JobAgeDays, type JobSearchSpec } from "../preferences";
import type { NormalizedJob } from "../types";
import { stripHtml } from "../html";
import { indeedLocationTarget, internationalSearchCountries } from "../locations";
import { searchTitlesFor } from "../title-localization";

/** Default posting-age window offered on the Pipeline page; the user can change it per run. */
export function defaultJobMaxAgeDays(value = process.env.JOB_MAX_AGE_DAYS): JobAgeDays {
  const days = Number(value ?? 14);
  return (jobAgeOptions as readonly number[]).includes(days) ? days as JobAgeDays : 14;
}

/** Country site, e.g. https://www.indeed.com or https://de.indeed.com. Never an arbitrary host. */
export function indeedBaseUrl(value = process.env.INDEED_BASE_URL) {
  const base = (value ?? "").trim() || "https://www.indeed.com";
  if (!/^https:\/\/(?:[a-z]{2}|www)\.indeed\.com$/.test(base)) throw new Error("INDEED_BASE_URL must be an Indeed country site such as https://de.indeed.com.");
  return base;
}

export function isIndeedHost(hostname: string) {
  return /^(?:[a-z]{2}|www|secure|smartapply|apply|profile|myaccount|myjobs|onboarding)\.indeed\.com$/.test(hostname) || hostname === "indeed.com";
}

/** Canonical public posting URL on the posting's own country site; tracking parameters are dropped. */
export function indeedJobUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base ?? indeedBaseUrl());
    const jk = url.searchParams.get("jk");
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/^(?:[a-z]{2}|www)\.indeed\.com$/.test(url.hostname)) return null;
    if (!/^\/(?:viewjob|rc\/clk|pagead\/clk)\/?$/.test(url.pathname) || !jk || !/^[0-9a-f]{16}$/i.test(jk)) return null;
    return `https://${url.hostname}/viewjob?jk=${jk.toLowerCase()}`;
  } catch { return null; }
}

export function indeedJobKey(url: string) {
  return indeedJobUrl(url)?.match(/jk=([0-9a-f]{16})$/)?.[1] ?? null;
}

/** Search pages read per round; each carries about fifteen listings. Overridable with INDEED_MAX_SEARCH_PAGES (10 to 80). */
export function indeedSearchPageCap(value = process.env.INDEED_MAX_SEARCH_PAGES) {
  const configured = Number(value ?? 48);
  return Number.isSafeInteger(configured) && configured >= 10 && configured <= 80 ? configured : 48;
}

export type IndeedSearchPlan = { urls: string[]; titles: string[]; queries: number; pagesPerQuery: number; localized: boolean; page: number };

/**
 * Explicit settings select locations; otherwise search a fixed international set, independent of CV/account geography.
 * Every profile title is searched, with its local-language form in non-English markets, up to three result pages each,
 * sorted by relevance within Indeed's own posting-age filter. The page cap bounds the round: with many markets the
 * search falls back to two titles and then to English only, so one round never exceeds the cap by more than a page set.
 */
export function planIndeedSearches(profile: JobSearchSpec, round: number, base = indeedBaseUrl(), cap = indeedSearchPageCap()): IndeedSearchPlan {
  const pool = [...new Set(profile.titles.map((title) => title.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 6);
  if (!pool.length) throw new Error("The search profile has no job titles for Indeed.");
  const locations = profile.locations.length ? [...new Set(profile.locations)] : internationalSearchCountries;
  const targets = locations.map((location) => indeedLocationTarget(location, base));
  const queriesFor = (titles: string[], localized: boolean) => titles.flatMap((title) => targets.flatMap((target) =>
    (localized ? searchTitlesFor(title, target.countryCode) : [title]).map((query) => ({ query, target }))));
  // Prefer breadth of titles over local-language forms: four English titles beat two titles with translations.
  const full = pool.slice(0, 4);
  const attempts: Array<{ count: number; localized: boolean }> = [{ count: full.length, localized: true }, { count: full.length, localized: false }, { count: 2, localized: true }, { count: 2, localized: false }];
  const chosen = attempts.find((attempt) => queriesFor(pool.slice(0, attempt.count), attempt.localized).length <= cap) ?? attempts[attempts.length - 1];
  const count = Math.min(chosen.count, pool.length);
  // When not every title fits a round, later rounds rotate through the pool before turning the page, so a five-title
  // profile is searched title by title rather than paging the same two forever.
  const shed = count < pool.length;
  const offset = shed ? (Math.max(0, Math.floor(round)) * count) % pool.length : 0;
  const titles = Array.from({ length: count }, (_, index) => pool[(offset + index) % pool.length]);
  const queries = queriesFor(titles, chosen.localized);
  const pagesPerQuery = Math.max(1, Math.min(3, Math.floor(cap / queries.length)));
  const pageSet = shed ? Math.floor((Math.max(0, Math.floor(round)) * count) / pool.length) : Math.max(0, Math.floor(round));
  const urls = Array.from({ length: pagesPerQuery }, (_, pageIndex) => queries.map(({ query, target }) => {
    const url = new URL("/jobs", target.base);
    url.searchParams.set("q", query);
    // Always send a location: omitting it lets Indeed reuse account/cookie/IP city defaults.
    url.searchParams.set("l", target.location);
    // Indeed's remote filter attribute; the existing preference check still verifies remote eligibility.
    if (profile.remotePreference === "remote") url.searchParams.set("sc", "0kf:attr(DSQF7);");
    // Indeed's own age filter, so old listings never reach the result pages we read; relevance order within it.
    if (profile.maxAgeDays) url.searchParams.set("fromage", String(profile.maxAgeDays));
    const page = pageSet * pagesPerQuery + pageIndex;
    if (page > 0) url.searchParams.set("start", String(page * 10));
    return url.href;
  })).flat();
  return { urls, titles, queries: queries.length, pagesPerQuery, localized: chosen.localized, page: pageSet * pagesPerQuery + 1 };
}

/** The round's search URLs, page by page across every query so a slow first query cannot consume the budget. */
export function indeedSearchUrls(profile: JobSearchSpec, round: number, base = indeedBaseUrl()) {
  return planIndeedSearches(profile, round, base).urls;
}

export const jobCardSchema = z.object({
  jobkey: z.string().regex(/^[0-9a-f]{16}$/i),
  title: z.string().trim().min(1),
  company: z.string().trim().min(1),
  formattedLocation: z.string().optional(),
  remoteLocation: z.boolean().optional(),
  pubDate: z.number().optional(),
  indeedApplyable: z.boolean().optional(),
  expired: z.boolean().optional(),
}).passthrough();
export type IndeedJobCard = z.infer<typeof jobCardSchema> & { searchOrigin?: string };

/** Keep the country from discovery; never silently send a foreign posting to the sign-in country's board. */
export function indeedCardUrl(card: IndeedJobCard) {
  const url = indeedJobUrl(`/viewjob?jk=${card.jobkey}`, card.searchOrigin ?? indeedBaseUrl());
  if (!url) throw new Error("Invalid Indeed posting origin.");
  return url;
}

export const searchPageSchema = z.object({ cards: z.array(jobCardSchema), loggedIn: z.boolean(), empty: z.boolean() });
export type IndeedSearchPage = z.infer<typeof searchPageSchema>;

export const jobPageSchema = z.object({ scripts: z.array(z.string()), loggedIn: z.boolean(), indeedApply: z.boolean(), expired: z.boolean() });
export type IndeedJobPage = z.infer<typeof jobPageSchema>;

const postingSchema = z.object({
  "@type": z.union([z.literal("JobPosting"), z.array(z.string()).refine((types) => types.includes("JobPosting"))]),
  title: z.string().trim().min(1), description: z.string().trim().min(1),
  hiringOrganization: z.object({ name: z.string().trim().min(1) }),
  datePosted: z.string().optional(), validThrough: z.string().optional(),
  jobLocation: z.unknown().optional(), jobLocationType: z.string().optional(),
  applicantLocationRequirements: z.unknown().optional(),
  directApply: z.boolean().optional(),
  employmentType: z.unknown().optional(),
}).passthrough();

function locationNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(locationNames);
  if (!value || typeof value !== "object") return typeof value === "string" ? [value] : [];
  const item = value as Record<string, unknown>;
  if (item.address) return locationNames(item.address);
  return [item.addressLocality, item.addressRegion, item.addressCountry, item.name].flatMap((part) =>
    typeof part === "string" ? [part] : part && typeof part === "object" ? locationNames(part) : []);
}

function objects(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(objects);
  if (!value || typeof value !== "object") return [];
  const graph = (value as Record<string, unknown>)["@graph"];
  return [value, ...(graph ? objects(graph) : [])];
}

/** Builds the job from the posting page's JSON-LD; the search card only supplies fallbacks and the apply flag. */
export function normalizeIndeedPosting(url: string, page: Pick<IndeedJobPage, "scripts" | "indeedApply">, card?: IndeedJobCard | null, now = Date.now()): NormalizedJob | null {
  const canonical = indeedJobUrl(url);
  if (!canonical) return null;
  for (const script of page.scripts) {
    let data: unknown;
    try { data = JSON.parse(script); } catch { continue; }
    for (const entry of objects(data)) {
      const parsed = postingSchema.safeParse(entry);
      if (!parsed.success) continue;
      const job = parsed.data;
      if (job.validThrough && Date.parse(job.validThrough) < now) continue;
      const description = stripHtml(job.description.replace(/\\n/g, "\n"));
      const title = stripHtml(job.title), company = stripHtml(job.hiringOrganization.name);
      if (!description || !title || !company) continue;
      const locations = [...new Set(locationNames(job.jobLocation).filter(Boolean))];
      const eligibility = [...new Set(locationNames(job.applicantLocationRequirements).filter(Boolean))];
      const remote = job.jobLocationType === "TELECOMMUTE" || Boolean(card?.remoteLocation);
      const named = locations.join(", ") || card?.formattedLocation?.trim() || "";
      const location = [named, ...(remote ? [`Remote${eligibility.length ? ` (hires in ${eligibility.join(", ")})` : ""}`] : [])].filter(Boolean).join(" · ") || null;
      const date = job.datePosted ? new Date(job.datePosted) : card?.pubDate ? new Date(card.pubDate) : null;
      // Schema.org directApply also covers external employer flows. Only the
      // current posting's Indeed-specific button confirms our supported adapter.
      const indeedApply = page.indeedApply;
      return { source: "indeed", externalId: canonical.match(/jk=([0-9a-f]{16})$/)![1], url: canonical,
        title, company, description, location, remote,
        postedAt: date && Number.isFinite(date.getTime()) ? date : null,
        raw: { ...job, indeedApply, card: card ?? null } };
    }
  }
  return null;
}

export const VERIFICATION_MESSAGE = "Indeed requires a browser verification. Complete it in the visible browser window, or wait and retry.";

/** Sign-in, bot challenge and block pages must fail loudly, never become empty results. */
export function indeedPageProblem(url: string, title: string, bodyStart: string): string | null {
  let host: string;
  try { host = new URL(url).hostname; } catch { return "Indeed navigated to an unreadable address."; }
  if (host === "secure.indeed.com" || host === "onboarding.indeed.com") return "Indeed asks for a sign-in to read this page. Sign in to Indeed on the Pipeline page, then run the search again.";
  const text = `${title}\n${bodyStart}`;
  if (/request blocked|you have been blocked|blocked - indeed/i.test(text)) return "Indeed blocked this browser session. Wait a while before searching again.";
  // Ordinary application forms include a "protected by reCAPTCHA" footer. Only actual
  // challenge titles/instructions should block preparation.
  // "Ray ID" appears only on Cloudflare challenge and error pages, in every locale.
  if (/captcha|just a moment|security check/i.test(title) || /\bray id\b/i.test(bodyStart) ||
    /additional verification required|zusätzliche verifizierung|verify (?:you are|you're) human|verify that you are human|(?:complete|solve|enter) (?:the |this |a )?(?:re)?captcha|captcha (?:verification|challenge)|i(?:'m| am) not a robot|ich bin kein roboter/i.test(bodyStart)) return VERIFICATION_MESSAGE;
  return null;
}
