import { z } from "zod";

const statusSchema = z.object({ status: z.string(), timestamp: z.number() }).nullable();
const jobSchema = z.object({
  jobKey: z.string().min(1), jobTitle: z.string().min(1), company: z.object({ name: z.string().nullish() }),
  location: z.string().nullish(), jobUrl: z.string().nullish(), applyTime: z.number().nullish(), withdrawn: z.boolean().optional(),
  statuses: z.object({ userJobStatus: statusSchema, candidateStatus: statusSchema.optional(), selfReportedStatus: statusSchema.optional() }),
});
const jobsResponse = z.object({ success: z.literal(true), body: z.object({ appStatusJobs: z.array(jobSchema).max(5000) }) });
const interviewsResponse = z.object({ success: z.literal(true), body: z.object({ interviews: z.array(z.object({ status: z.string(), timeSlots: z.array(z.unknown()).nullish() })).max(5000) }) });
const applicationStatuses = new Set(["APPLIED", "VIEWED", "REVIEWED", "CONTACTING", "PHONE_SCREENED", "INTERVIEW", "OFFER", "HIRED", "REJECTED", "NOT_INTERESTED"]);
export const historySnapshotSchema = z.object({
  syncedAt: z.iso.datetime(), since: z.iso.datetime().nullable(),
  counts: z.object({ applied: z.number().int().nonnegative(), saved: z.number().int().nonnegative(), interviews: z.number().int().nonnegative(), archived: z.number().int().nonnegative() }),
  applications: z.array(z.object({ id: z.string(), title: z.string(), company: z.string(), location: z.string(), url: z.string().nullable(),
    status: z.string(), statusSource: z.enum(["indeed", "self_reported"]), appliedAt: z.iso.datetime().nullable(), updatedAt: z.iso.datetime().nullable(), archived: z.boolean() })),
});
export type IndeedHistorySnapshot = z.infer<typeof historySnapshotSchema>;
export type IndeedHistoryView = { saved: boolean; emailHint: string | null; snapshot: IndeedHistorySnapshot | null };

function iso(timestamp: number | null | undefined) {
  return timestamp && timestamp > 0 && Number.isFinite(timestamp) && !Number.isNaN(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : null;
}
function postingUrl(value: string | null | undefined) {
  try { const u = new URL(value ?? ""); return u.protocol === "https:" && !u.username && !u.password && !u.port && /^(?:[a-z]{2}|www)\.indeed\.com$/.test(u.hostname) ? u.href : null; } catch { return null; }
}
/** Mirrors My Jobs' candidate/self-reported status precedence; drafts and saved jobs are not applications. */
function displayStatus(job: z.infer<typeof jobSchema>) {
  const candidate = job.statuses.candidateStatus, self = job.statuses.selfReportedStatus;
  let chosen = candidate, source: "indeed" | "self_reported" = "indeed";
  if (self && (!candidate || self.status === "NOT_INTERESTED" || (self.status !== "APPLIED" && (["VIEWED", "CONTACTING"].includes(candidate.status) || self.timestamp >= candidate.timestamp)))) {
    chosen = self; source = "self_reported";
  }
  return chosen ? { ...chosen, source } : null;
}
export function parseIndeedHistory(data: { applied: unknown; saved: unknown; archived: unknown; interviews: unknown; since: number | null }, now = new Date()): IndeedHistorySnapshot {
  const applied = jobsResponse.parse(data.applied).body.appStatusJobs;
  const saved = jobsResponse.parse(data.saved).body.appStatusJobs;
  const archived = jobsResponse.parse(data.archived).body.appStatusJobs;
  const interviews = interviewsResponse.parse(data.interviews).body.interviews.filter(item => Boolean(item.timeSlots?.length) || ["EMP_INVITE", "JS_CANCEL", "EMP_CANCEL"].includes(item.status));
  const rows = new Map<string, IndeedHistorySnapshot["applications"][number]>();
  for (const [jobs, isArchived] of [[archived, true], [applied, false]] as const) {
    for (const job of jobs) {
      if (job.statuses.userJobStatus?.status !== (isArchived ? "ARCHIVED" : "POST_APPLY")) continue;
      const status = displayStatus(job);
      if (!status || !applicationStatuses.has(status.status)) continue;
      // My Jobs identifies entries by their job key. Active entries take precedence over archived duplicates.
      rows.set(job.jobKey, { id: job.jobKey, title: job.jobTitle, company: job.company.name || "Company not provided", location: job.location ?? "",
        url: postingUrl(job.jobUrl), status: job.withdrawn ? "WITHDRAWN" : status.status, statusSource: status.source,
        appliedAt: iso(job.applyTime), updatedAt: iso(status.timestamp), archived: isArchived });
    }
  }
  const applications = [...rows.values()].sort((a, b) => (b.appliedAt ?? b.updatedAt ?? "").localeCompare(a.appliedAt ?? a.updatedAt ?? ""));
  return historySnapshotSchema.parse({ syncedAt: now.toISOString(), since: iso(data.since), applications,
    counts: { applied: applications.filter(job => !job.archived).length, archived: applications.filter(job => job.archived).length,
      saved: new Set(saved.filter(job => job.statuses.userJobStatus?.status === "SAVED").map(job => job.jobKey)).size, interviews: interviews.length } });
}
