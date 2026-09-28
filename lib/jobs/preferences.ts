import { z } from "zod";
import type { SearchProfile } from "../ai/search-profile";
import { matchesJobLocation } from "./locations";

const terms = z.array(z.string().trim().min(1).max(100)).max(5);
/** Posting-age windows Indeed's own filter accepts; 0 means any time. */
export const jobAgeOptions = [1, 3, 7, 14, 0] as const;
export type JobAgeDays = (typeof jobAgeOptions)[number];
export const jobAgeLabels: Record<JobAgeDays, string> = { 1: "Last 24 hours", 3: "Last 3 days", 7: "Last 7 days", 14: "Last 14 days", 0: "Any time" };

export const workArrangementOptions = ["remote", "hybrid", "onsite"] as const;
export type WorkArrangement = (typeof workArrangementOptions)[number];
export const workArrangementLabels: Record<WorkArrangement, string> = { remote: "Remote", hybrid: "Hybrid", onsite: "On-site" };
export const seniorityOptions = ["intern", "junior", "mid", "senior", "lead"] as const;
export type SeniorityLevel = (typeof seniorityOptions)[number];
export const seniorityLabels: Record<SeniorityLevel, string> = { intern: "Intern", junior: "Junior", mid: "Mid-level", senior: "Senior", lead: "Lead" };

export const searchPreferencesSchema = z.object({
  titles: terms.default([]),
  locations: terms.default([]),
  // Single values from runs saved before multi-select; the arrays below take precedence when non-empty.
  remotePreference: z.enum(["any", "remote", "hybrid", "onsite"]).default("any"),
  seniority: z.enum(["any", "intern", "junior", "mid", "senior", "lead"]).default("any"),
  /** Acceptable arrangements; empty means any. A job matches when it fits at least one. */
  workArrangements: z.array(z.enum(workArrangementOptions)).max(3).default([]),
  /** Acceptable levels; empty means the level the CV supports. Any listed level is acceptable. */
  seniorities: z.array(z.enum(seniorityOptions)).max(5).default([]),
  // Runs saved before this setting existed searched without an age limit.
  maxAgeDays: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14), z.literal(0)]).default(0),
  /**
   * The CV profile's target role, set by the pipeline at run time (never saved with the run): the screener and the
   * assessor treat postings in this role family as the applicant's own career, not a change of profession.
   */
  targetRole: z.string().trim().min(1).max(120).optional(),
}).strict();
export type SearchPreferences = z.infer<typeof searchPreferencesSchema>;
export const defaultSearchPreferences: SearchPreferences = { titles: [], locations: [], remotePreference: "any", seniority: "any", workArrangements: [], seniorities: [], maxAgeDays: 14 };

/** The arrangements a run accepts: the multi-select, else the legacy single value; empty means any. */
export function acceptedArrangements(preferences: Partial<Pick<SearchPreferences, "remotePreference" | "workArrangements">>): WorkArrangement[] {
  // Runs saved before the multi-select carry no array at all.
  if (preferences.workArrangements?.length) return [...new Set(preferences.workArrangements)];
  return !preferences.remotePreference || preferences.remotePreference === "any" ? [] : [preferences.remotePreference];
}
/** The levels a run accepts: the multi-select, else the legacy single value; empty means the CV's own level. */
export function acceptedSeniorities(preferences: Partial<Pick<SearchPreferences, "seniority" | "seniorities">>): SeniorityLevel[] {
  if (preferences.seniorities?.length) return [...new Set(preferences.seniorities)];
  return !preferences.seniority || preferences.seniority === "any" ? [] : [preferences.seniority];
}

/** Search input for job sources: the CV-derived profile plus the settings the sources apply themselves. */
export type JobSearchSpec = SearchProfile & { maxAgeDays: JobAgeDays;
  /** Every acceptable level when several were chosen; `seniority` carries the first for sources with a single level filter. */
  seniorities?: SeniorityLevel[];
  /** Automatic runs only want postings the browser worker can apply to: sources skip company-site postings early. */
  indeedApplyOnly?: boolean };

export function sameSearchPreferences(left: SearchPreferences | undefined, right: SearchPreferences | undefined) {
  return JSON.stringify(searchPreferencesSchema.parse(left ?? defaultSearchPreferences)) ===
    JSON.stringify(searchPreferencesSchema.parse(right ?? defaultSearchPreferences));
}

export function applySearchPreferences(profile: SearchProfile, preferences: SearchPreferences): JobSearchSpec {
  const arrangements = acceptedArrangements(preferences);
  const seniorities = acceptedSeniorities(preferences);
  return { ...profile,
    titles: preferences.titles.length ? preferences.titles : profile.titles,
    // Education/employment history is never a location preference.
    locations: preferences.locations,
    // Sources only understand one arrangement (Indeed's remote filter); several accepted arrangements search unfiltered.
    remotePreference: arrangements.length === 1 ? arrangements[0] : "any",
    // Sources with a level filter get the first accepted level; screening sees the whole list.
    seniority: seniorities[0] ?? profile.seniority,
    seniorities,
    maxAgeDays: preferences.maxAgeDays,
  };
}

/** Whether a job's arrangement fits one of the accepted ones. Remote is the source flag; hybrid is named in the text; on-site is neither. */
export function jobArrangementAccepted(job: { remote: boolean }, text: string, arrangements: WorkArrangement[]) {
  if (!arrangements.length) return true;
  const hybrid = /\bhybrid\b/.test(text);
  return arrangements.some((arrangement) => arrangement === "remote" ? job.remote : arrangement === "hybrid" ? hybrid : !job.remote && !hybrid);
}

export function jobMeetsPreferences(job: { location: string | null; remote: boolean; description: string | null }, preferences: SearchPreferences) {
  const text = `${job.location ?? ""} ${job.description ?? ""}`.toLowerCase();
  if (!jobArrangementAccepted(job, text, acceptedArrangements(preferences))) return false;
  // A generic "remote" tag does not establish eligibility in a selected country.
  return !preferences.locations.length || preferences.locations.some((location) =>
    matchesJobLocation(job.location ?? "", location));
}
