import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db, cvRewrites, cvDocuments, applications, applicantProfiles, jobApplications, jobPostings, applicationWorkers } from "../db";
import { CV_REWRITE_PROMPT_VERSION } from "../ai/cv-rewrite";
import { cvContentSchema } from "../cv/content";
import { activeStatuses, applicantProfileSchema, missingRequired, reviewStatuses, type ApplicantProfile, type ApplicationView } from "./types";
import { resolveApplicationUrl } from "./urls";
import { applicationKind, canonicalApplicationUrl } from "./adapter";
import { indeedJobKey } from "../jobs/sources/indeed-data";

export class ApplicationError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export async function rewriteContext(id: string) {
  const [row] = await db.select({ rewrite: cvRewrites, document: cvDocuments, job: jobPostings })
    .from(cvRewrites).innerJoin(cvDocuments, eq(cvDocuments.id, cvRewrites.cvDocumentId))
    .innerJoin(jobPostings, eq(jobPostings.id, cvRewrites.jobPostingId)).where(eq(cvRewrites.id, id)).limit(1);
  if (!row || row.rewrite.status !== "completed" || !row.rewrite.latex || !cvContentSchema.safeParse(row.rewrite.content).success) throw new ApplicationError("A completed tailored CV is required.", 404);
  return row;
}
export async function workerActive() {
  const [row] = await db.select({ id: applicationWorkers.id }).from(applicationWorkers).where(gt(applicationWorkers.lastSeenAt, sql`now() - interval '45 seconds'`)).limit(1);
  return Boolean(row);
}
export async function bootstrap(rewriteId: string) {
  const { rewrite, document, job } = await rewriteContext(rewriteId);
  const [saved] = await db.select().from(applicantProfiles).where(eq(applicantProfiles.cvDocumentId, document.id)).limit(1);
  const [intake] = document.applicationId ? await db.select().from(applications).where(eq(applications.id, document.applicationId)).limit(1) : [];
  const content = cvContentSchema.parse(rewrite.content);
  const contact = (pattern: RegExp) => content.contactLine.find((item) => pattern.test(item.url ?? item.text));
  const profile: ApplicantProfile = (!document.applicationId ? saved?.profile : undefined) ?? {
    name: intake ? `${intake.firstName} ${intake.lastName}` : content.name,
    email: intake?.email ?? content.contactLine.map((item) => item.text).join(" ").match(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i)?.[0] ?? "",
    phone: intake?.phone ?? "", location: [intake?.city, intake?.country].filter(Boolean).join(", "),
    currentCompany: intake?.currentEmployer ?? "", linkedin: intake ? intake.linkedinUrl ?? "" : contact(/linkedin\.com/i)?.url ?? "",
    github: intake ? intake.githubUrl ?? "" : contact(/github\.com/i)?.url ?? "", portfolio: intake?.portfolioUrl ?? intake?.websiteUrl ?? "",
  };
  const existing = await db.select({ id: jobApplications.id }).from(jobApplications).where(and(eq(jobApplications.cvDocumentId, document.id), eq(jobApplications.jobPostingId, job.id))).orderBy(desc(jobApplications.createdAt)).limit(1);
  return { rewriteId, profile, jobTitle: job.title, company: job.company, postingUrl: job.url,
    applicationUrl: resolveApplicationUrl(job.url), existingId: existing[0]?.id ?? null, workerActive: await workerActive(),
    eligible: rewrite.promptVersion === CV_REWRITE_PROMPT_VERSION };
}
export async function enqueueApplication(rewriteId: string, rawProfile: ApplicantProfile, rawUrl: string, autoApply = false) {
  const { rewrite, document, job } = await rewriteContext(rewriteId);
  if (rewrite.promptVersion !== CV_REWRITE_PROMPT_VERSION) throw new ApplicationError("Re-tailor this CV first so it passes the current evidence audit.");
  const profile = applicantProfileSchema.parse(rawProfile);
  const url = canonicalApplicationUrl(rawUrl);
  if (!url) throw new ApplicationError("Use an Indeed posting URL (…/viewjob?jk=…) or a Lever job URL (jobs.lever.co or jobs.eu.lever.co).", 400);
  const postingKey = indeedJobKey(url);
  if (postingKey && postingKey !== indeedJobKey(job.url)) throw new ApplicationError("The Indeed posting must match the job this CV was tailored for.", 400);
  // Indeed job keys identify the posting across country domains.
  const dedupeKey = createHash("sha256").update(`${profile.email.toLowerCase()}\n${postingKey ? `indeed:${postingKey}` : url}`).digest("hex");
  return db.transaction(async (tx) => {
    // Include rows written before country-independent keys were introduced.
    const [priorIndeed] = postingKey ? await tx.select().from(jobApplications).where(and(
      sql`lower(${jobApplications.profile}->>'email') = ${profile.email.toLowerCase()}`,
      sql`lower(substring(${jobApplications.url} from '[?&]jk=([0-9a-fA-F]{16})')) = ${postingKey}`,
    )).orderBy(sql`case when ${jobApplications.status} in ('submitted', 'uncertain', 'submitting', 'submit_requested', 'draft_saved', 'draft_unconfirmed', 'saving_draft', 'save_requested') then 0 else 1 end`, jobApplications.createdAt).limit(1).for("update") : [];
    const [created] = priorIndeed ? [] : await tx.insert(jobApplications).values({ rewriteId, cvDocumentId: document.id, jobPostingId: job.id, dedupeKey, profile, url, autoApply }).onConflictDoNothing().returning();
    await tx.insert(applicantProfiles).values({ cvDocumentId: document.id, profile }).onConflictDoUpdate({ target: applicantProfiles.cvDocumentId, set: { profile, updatedAt: new Date() } });
    if (created) return created.id;
    const [existing] = priorIndeed ? [priorIndeed] : await tx.select().from(jobApplications).where(eq(jobApplications.dedupeKey, dedupeKey)).for("update");
    if (!existing) throw new ApplicationError("Could not queue this application.");
    // Retrying a failed PREPARATION is safe (nothing was submitted). Submission uncertainty is never retried, and an
    // automatic run never restarts an application the person cancelled: only a manual preparation may revive that.
    const retryable = existing.status === "failed" || (!autoApply && existing.status === "cancelled");
    if (retryable) {
      await tx.update(jobApplications).set({ status: "queued", autoApply, answerEvidence: [], rewriteId, cvDocumentId: document.id, jobPostingId: job.id, profile, snapshot: null, answers: null, message: null, confirmation: null, workerId: null, heartbeatAt: null, revision: existing.revision + 1, updatedAt: new Date() }).where(eq(jobApplications.id, existing.id));
    }
    return existing.id;
  });
}
export async function expireSessions() {
  await db.update(jobApplications).set({ status: "draft_unconfirmed", message: "The browser worker stopped while saving an Indeed draft. Check My jobs before retrying; saving was not confirmed.", updatedAt: new Date() })
    .where(and(inArray(jobApplications.status, ["save_requested", "saving_draft"]), lt(jobApplications.heartbeatAt, sql`now() - interval '60 seconds'`)));
  await db.update(jobApplications).set({ status: "uncertain", message: "The browser worker stopped during submission. Check the employer confirmation before taking any further action. Automatic retry is disabled.", updatedAt: new Date() })
    .where(and(inArray(jobApplications.status, ["submitting", "submit_requested"]), lt(jobApplications.heartbeatAt, sql`now() - interval '60 seconds'`)));
  await db.update(jobApplications).set({ status: "failed", message: "The browser session ended. Prepare the application again to continue.", updatedAt: new Date() })
    .where(and(inArray(jobApplications.status, activeStatuses.filter((status) => !["submitting", "submit_requested"].includes(status))), lt(jobApplications.heartbeatAt, sql`now() - interval '60 seconds'`)));
}
export async function applicationView(id: string): Promise<ApplicationView | null> {
  await expireSessions();
  const [row] = await db.select({ run: jobApplications, company: jobPostings.company, jobTitle: jobPostings.title, profileName: applications.name })
    .from(jobApplications).innerJoin(jobPostings, eq(jobApplications.jobPostingId, jobPostings.id))
    .leftJoin(cvDocuments, eq(cvDocuments.id, jobApplications.cvDocumentId)).leftJoin(applications, eq(applications.id, cvDocuments.applicationId))
    .where(eq(jobApplications.id, id)).limit(1);
  if (!row) return null;
  const { run } = row;
  return { autoApply: run.autoApply, answerEvidence: run.answerEvidence, id: run.id, rewriteId: run.rewriteId, company: row.company, jobTitle: row.jobTitle, url: run.url, status: run.status, profile: run.profile, snapshot: run.snapshot, revision: run.revision, message: run.message, confirmation: run.confirmation, workerActive: await workerActive(),
    profileName: row.profileName ?? null, createdAt: run.createdAt.toISOString(), updatedAt: run.updatedAt.toISOString() };
}
export async function listApplications() {
  const ids = await db.select({ id: jobApplications.id }).from(jobApplications).orderBy(desc(jobApplications.createdAt)).limit(30);
  return Promise.all(ids.map(({ id }) => applicationView(id)));
}
export async function commandApplication(id: string, action: "update" | "submit" | "cancel" | "save_draft", revision: number, answers: Record<string, string> = {}) {
  await expireSessions();
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(jobApplications).where(eq(jobApplications.id, id)).for("update");
    if (!run) throw new ApplicationError("Application not found.", 404);
    if (action === "cancel") {
      if (!["queued", "preparing", ...reviewStatuses].includes(run.status)) throw new ApplicationError("This application can no longer be cancelled here.");
      await tx.update(jobApplications).set({ status: "cancelled", message: "Application preparation cancelled.", updatedAt: new Date() }).where(eq(jobApplications.id, id));
      return;
    }
    if (!reviewStatuses.includes(run.status) || !run.snapshot || run.revision !== revision) throw new ApplicationError("The application changed. Refresh and review it before continuing.");
    if (!run.heartbeatAt || Date.now() - run.heartbeatAt.getTime() > 45_000) throw new ApplicationError("The browser worker is offline.");
    if (action === "save_draft") {
      if (applicationKind(run.url) !== "indeed") throw new ApplicationError("Saving application drafts is supported only on Indeed.");
      if (Object.keys(answers).length) throw new ApplicationError("Save the edited answers before saving the Indeed draft.");
      await tx.update(jobApplications).set({ status: "save_requested", answers: null, message: "Saving the unfinished application on Indeed…", updatedAt: new Date() }).where(eq(jobApplications.id, id));
      return;
    }
    if (action === "submit" && (missingRequired(run.snapshot.fields).length || !run.snapshot.resume)) throw new ApplicationError("Complete all required fields and upload the CV before submitting.");
    if (action === "submit" && (run.snapshot.readyToSubmit === false || run.snapshot.notice)) throw new ApplicationError("Finish the employer's review step and resolve any notices before submitting.");
    const allowed = new Map(run.snapshot.fields.map((field) => [field.id, field]));
    for (const [key, value] of Object.entries(answers)) {
      const field = allowed.get(key);
      if (!field || field.type === "file" || (field.options.length && !field.options.some((option) => option.value === value) && value !== "") || (field.type === "checkbox" && !["true", "false"].includes(value))) throw new ApplicationError("An answer does not match the current application form.", 400);
    }
    await tx.update(jobApplications).set({ status: action === "submit" ? "submit_requested" : "update_requested", answers: action === "update" ? answers : null, message: null, updatedAt: new Date() }).where(eq(jobApplications.id, id));
  });
}
export async function claimApplication(workerId: string) {
  await expireSessions();
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(jobApplications).where(eq(jobApplications.status, "queued")).orderBy(jobApplications.createdAt).limit(1).for("update", { skipLocked: true });
    if (!run) return null;
    const [claimed] = await tx.update(jobApplications).set({ status: "preparing", workerId, heartbeatAt: new Date(), updatedAt: new Date() }).where(eq(jobApplications.id, run.id)).returning();
    return claimed;
  });
}
