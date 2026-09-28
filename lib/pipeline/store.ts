import "server-only";
import { expireSessions } from "../job-applications/store";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, lt, lte, or, sql, isNull } from "drizzle-orm";
import { applications, cvDocuments, cvRewrites, db, pipelineRuns, pipelineWorkers, jobApplications } from "@/lib/db";
import { cvContentSchema } from "@/lib/cv/content";
import type { ActiveAiProvider } from "@/lib/ai/provider";
import { defaultSearchPreferences, searchPreferencesSchema, sameSearchPreferences, type SearchPreferences } from "../jobs/preferences";
import { initialPipelineState, type PipelineRunView, type PipelineState, type PipelineStatus } from "./types";
import { DEFAULT_MAX_MATCHES, maxMatchesSchema, maxPipelineRetries, retryDelayMinutes } from "./options";
import { prepareRetry } from "./engine";

export class PipelineRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function enqueuePipeline(cvDocumentId: string, provider: ActiveAiProvider, requestId: string, preferences: SearchPreferences = defaultSearchPreferences, autoApply = false, maxMatches = DEFAULT_MAX_MATCHES, profileId?: string, options: { scheduled?: boolean } = {}) {
  maxMatches = maxMatchesSchema.parse(maxMatches);
  preferences = searchPreferencesSchema.parse(preferences);
  const samePreferences = (state: PipelineState) => state.profileId === profileId && sameSearchPreferences(state.preferences, preferences) && Boolean(state.autoApply) === autoApply && (state.maxMatches ?? DEFAULT_MAX_MATCHES) === maxMatches;
  const [document] = await db.select().from(cvDocuments).where(eq(cvDocuments.id, cvDocumentId)).limit(1);
  if (!document) throw new PipelineRequestError("CV document not found.", 404);
  if (document.extractionStatus !== "ok" || !document.extractedText?.trim()) {
    throw new PipelineRequestError(document.extractionError || "Upload a CV with readable text before starting the pipeline.", 409);
  }
  const [existingRequest] = await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, requestId)).limit(1);
  if (existingRequest) {
    if (existingRequest.cvDocumentId !== cvDocumentId || existingRequest.provider !== provider.providerName || existingRequest.model !== provider.model || !samePreferences(existingRequest.state)) {
      throw new PipelineRequestError("This request ID was already used for a different CV, model or search preferences.", 409);
    }
    return existingRequest;
  }
  const [profile] = profileId ? await db.select().from(applications).where(and(eq(applications.id, profileId), isNull(applications.archivedAt))).limit(1) : [];
  if (profileId && (!profile || profile.cvStatus !== "ready" || profile.cvDocumentId !== cvDocumentId)) throw new PipelineRequestError("Choose a ready profile with its current CV.", 409);
  const [created] = await db.insert(pipelineRuns).values({
    id: requestId, cvDocumentId, provider: provider.providerName, model: provider.model,
    state: { ...initialPipelineState(), preferences, autoApply, maxMatches, ...(profile ? { profileId: profile.id, profileName: profile.name } : {}), ...(options.scheduled ? { scheduled: true } : {}) },
  }).onConflictDoNothing().returning();
  if (created) return created;
  // Concurrent clicks or a retried HTTP request share one active run.
  const [active] = await db.select().from(pipelineRuns).where(and(
    eq(pipelineRuns.cvDocumentId, cvDocumentId),
    eq(pipelineRuns.provider, provider.providerName),
    eq(pipelineRuns.model, provider.model),
    or(eq(pipelineRuns.id, requestId), inArray(pipelineRuns.status, ["queued", "running"])),
  )).limit(1);
  if (!active) throw new PipelineRequestError("Could not queue this request. Please retry.", 409);
  if (!samePreferences(active.state)) throw new PipelineRequestError("A run with different preferences is already active for this CV and model. Wait for it to finish before starting another.", 409);
  return active;
}

/**
 * Sends a failed attempt back to the queue after a backoff, or fails the run for good once its retries are
 * used up. `owner` guards against a worker that already lost the run; the claim path passes none because it
 * holds the row lock.
 */
export async function retryOrFailPipeline(
  run: { id: string; retries: number; state: PipelineState },
  owner: string | null,
  state: PipelineState,
  reason: string,
  final: { status: PipelineStatus; error?: string } = { status: "failed", error: reason },
  executor: Pick<typeof db, "update"> = db,
) {
  const limit = maxPipelineRetries();
  const ownership = owner ? and(eq(pipelineRuns.id, run.id), eq(pipelineRuns.leaseOwner, owner), eq(pipelineRuns.status, "running")) : eq(pipelineRuns.id, run.id);
  const at = new Date();
  if (run.retries >= limit) {
    const suffix = limit ? ` Gave up after ${limit} ${limit === 1 ? "retry" : "retries"}.` : "";
    const next = { ...state, activity: [...(state.activity ?? []), { at: at.toISOString(), stage: state.stage, message: `${reason}${suffix}` }].slice(-120) };
    await executor.update(pipelineRuns).set({
      state: next, status: final.status, error: final.error ? `${final.error}${suffix}` : null, retryAt: null,
      leaseOwner: null, leaseExpiresAt: null, completedAt: at, updatedAt: at,
    }).where(ownership);
    return "final" as const;
  }
  const retry = run.retries + 1;
  const minutes = retryDelayMinutes(retry);
  const retried = prepareRetry(state);
  retried.activity = [...(retried.activity ?? []), { at: at.toISOString(), stage: retried.stage, message: `${reason} Retry ${retry} of ${limit} in ${minutes} min.` }].slice(-120);
  await executor.update(pipelineRuns).set({
    state: retried, status: "queued", error: final.error ?? reason, retries: retry, attempts: 0,
    retryAt: sql`now() + make_interval(mins => ${minutes})`, leaseOwner: null, leaseExpiresAt: null, updatedAt: at,
  }).where(ownership);
  return "retry" as const;
}

export async function claimPipelineRun() {
  return db.transaction(async (tx) => {
    const [next] = await tx.select().from(pipelineRuns).where(or(
      and(eq(pipelineRuns.status, "queued"), or(isNull(pipelineRuns.retryAt), lte(pipelineRuns.retryAt, sql`now()`))),
      and(eq(pipelineRuns.status, "running"), lt(pipelineRuns.leaseExpiresAt, sql`now()`)),
    )).orderBy(pipelineRuns.createdAt).limit(1).for("update", { skipLocked: true });
    if (!next) return null;
    if (next.attempts >= 3) {
      // A worker died with this run three times in a row; treat it like any other failed attempt.
      await retryOrFailPipeline(next, null, next.state, "The worker was interrupted repeatedly.", undefined, tx);
      return null;
    }
    const [claimed] = await tx.update(pipelineRuns).set({
      status: "running", leaseOwner: randomUUID(),
      leaseExpiresAt: sql`now() + interval '2 minutes'`,
      attempts: next.attempts + 1, updatedAt: new Date(), error: null, retryAt: null,
    }).where(eq(pipelineRuns.id, next.id)).returning();
    return claimed;
  });
}

export async function heartbeatWorker(id: string) {
  await db.insert(pipelineWorkers).values({ id }).onConflictDoUpdate({
    target: pipelineWorkers.id, set: { lastSeenAt: new Date() },
  });
}

export async function renewPipelineLease(id: string, owner: string) {
  const rows = await db.update(pipelineRuns).set({ leaseExpiresAt: sql`now() + interval '2 minutes'` })
    .where(and(eq(pipelineRuns.id, id), eq(pipelineRuns.leaseOwner, owner), eq(pipelineRuns.status, "running")))
    .returning({ id: pipelineRuns.id });
  return rows.length > 0;
}

export async function savePipelineState(id: string, owner: string, state: PipelineState, final?: { status: PipelineStatus; error?: string }) {
  const rows = await db.update(pipelineRuns).set({
    state, updatedAt: new Date(),
    ...(final ? { status: final.status, error: final.error ?? null, completedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } : {}),
  }).where(and(eq(pipelineRuns.id, id), eq(pipelineRuns.leaseOwner, owner), eq(pipelineRuns.status, "running")))
    .returning({ id: pipelineRuns.id });
  if (!rows.length) throw new Error("This pipeline run is owned by another worker.");
}

export async function getPipelineRun(id: string): Promise<PipelineRunView | null> {
  const [run] = await db.select({ run: pipelineRuns, filename: cvDocuments.originalFilename })
    .from(pipelineRuns).innerJoin(cvDocuments, eq(cvDocuments.id, pipelineRuns.cvDocumentId))
    .where(eq(pipelineRuns.id, id)).limit(1);
  if (!run) return null;
  const [worker] = await db.select({ id: pipelineWorkers.id }).from(pipelineWorkers)
    .where(gt(pipelineWorkers.lastSeenAt, sql`now() - interval '45 seconds'`)).limit(1);
  const rewriteIds = run.run.state.jobs.filter((job) => job.status === "completed" && job.rewriteId).map((job) => job.rewriteId!);
  const rewrites = rewriteIds.length ? await db.select({ id: cvRewrites.id, content: cvRewrites.content })
    .from(cvRewrites).where(and(inArray(cvRewrites.id, rewriteIds), eq(cvRewrites.cvDocumentId, run.run.cvDocumentId), eq(cvRewrites.status, "completed"))) : [];
  const applicationIds = run.run.state.jobs.flatMap(job => job.applicationId ? [job.applicationId] : []);
  if (applicationIds.length) await expireSessions();
  const activity = applicationIds.length ? await db.select({ id: jobApplications.id, status: jobApplications.status, message: jobApplications.message }).from(jobApplications).where(inArray(jobApplications.id, applicationIds)) : [];
  const state = { ...run.run.state, jobs: run.run.state.jobs.map(job => {
    const application = activity.find(item => item.id === job.applicationId);
    return application ? { ...job, applicationStatus: application.status, applicationMessage: application.message } : job;
  }) };
  return {
    id: run.run.id, cvDocumentId: run.run.cvDocumentId,
    provider: run.run.provider as PipelineRunView["provider"], model: run.run.model,
    filename: run.filename, status: run.run.status, state,
    error: run.run.error, createdAt: run.run.createdAt.toISOString(), updatedAt: run.run.updatedAt.toISOString(),
    retries: run.run.retries, maxRetries: maxPipelineRetries(), retryAt: run.run.retryAt?.toISOString() ?? null,
    workerActive: Boolean(worker),
    results: rewrites.flatMap((rewrite) => {
      const parsed = cvContentSchema.safeParse(rewrite.content);
      return parsed.success ? [{ rewriteId: rewrite.id, content: parsed.data }] : [];
    }),
  };
}

export async function recentPipelineRuns() {
  const rows = await db.select({ id: pipelineRuns.id }).from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(10);
  return (await Promise.all(rows.map((row) => getPipelineRun(row.id)))).filter((run): run is PipelineRunView => run !== null);
}

/** Ends a run that is waiting for its next retry. A running attempt is left alone. */
export async function stopRetrying(id: string) {
  const rows = await db.update(pipelineRuns).set({
    status: "failed", error: sql`coalesce(${pipelineRuns.error}, 'Failed.') || ' Retrying stopped by you.'`,
    retryAt: null, completedAt: new Date(), updatedAt: new Date(),
  }).where(and(eq(pipelineRuns.id, id), eq(pipelineRuns.status, "queued"), gt(pipelineRuns.retries, 0))).returning({ id: pipelineRuns.id });
  return rows.length > 0;
}
