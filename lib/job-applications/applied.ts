import "server-only";

import { eq, inArray } from "drizzle-orm";

import { db, jobApplications, jobPostings } from "@/lib/db";
import { indeedJobKey } from "../jobs/sources/indeed-data";
import { appliedStatuses } from "./types";

/** Jobs an application already exists for, keyed both ways discovery meets them. */
export type AppliedJobs = {
  jobPostingIds: Set<string>;
  /** Indeed job keys, so a listing is skipped before its posting page is even opened. */
  indeedKeys: Set<string>;
};

/** Jobs with an application submitted or in progress; discovery never spends browser or model time on them again. */
export async function loadAppliedJobs(): Promise<AppliedJobs> {
  const rows = await db.select({ jobPostingId: jobApplications.jobPostingId, url: jobApplications.url, source: jobPostings.source, externalId: jobPostings.externalId })
    .from(jobApplications).innerJoin(jobPostings, eq(jobPostings.id, jobApplications.jobPostingId))
    .where(inArray(jobApplications.status, appliedStatuses));
  const applied: AppliedJobs = { jobPostingIds: new Set(), indeedKeys: new Set() };
  for (const row of rows) {
    applied.jobPostingIds.add(row.jobPostingId);
    const key = indeedJobKey(row.url) ?? (row.source === "indeed" ? row.externalId.toLowerCase() : null);
    if (key) applied.indeedKeys.add(key);
  }
  return applied;
}
