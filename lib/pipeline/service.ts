import "server-only";
import { bootstrap, enqueueApplication } from "../job-applications/store";
import { indeedJobUrl } from "../jobs/sources/indeed-data";

import { and, desc, eq, inArray } from "drizzle-orm";
import { applications, cvDocuments, cvReviews, cvRewrites, db, jobPostings } from "@/lib/db";
import { resolveAiProvider } from "@/lib/ai/provider";
import { resolveRewriteProvider } from "@/lib/ai/cv-rewrite-request";
import { cvReviewSchema } from "@/lib/ai/cv-review";
import { runStoredCvRewrite } from "@/lib/ai/run-cv-rewrite";
import { CV_REWRITE_PROMPT_VERSION } from "@/lib/ai/cv-rewrite";
import { cvContentSchema } from "@/lib/cv/content";
import { renderCvToLatex } from "@/lib/latex/render-cv";
import { tailorWithEscalation, type TailorAttempt } from "./tailoring";
import { syncJobs } from "@/lib/jobs/sync";
import { matchJobs } from "@/lib/jobs/match";
import { loadCachedSearchProfile } from "../ai/search-profile";
import { refineJobSearch } from "../ai/search-refinement";
import { defaultSearchPreferences, type SearchPreferences } from "../jobs/preferences";
import { DEFAULT_MAX_MATCHES } from "./options";
import { executePipeline, needsRetry, type PipelineDependencies } from "./engine";
import { profileTargetRole, searchTitlesFromTargetRole } from "./target-role";
import { claimPipelineRun, renewPipelineLease, retryOrFailPipeline, savePipelineState } from "./store";
import type { PipelineInput } from "./types";

const NO_INDEED_APPLY_MESSAGE = "This posting sends applicants to the company's own website; Indeed Apply is not offered. Apply on the company site manually.";

const reviewSchema = cvReviewSchema.pick({ summary: true, weaknesses: true, suggestions: true });

export const pipelineAgents: Omit<PipelineDependencies, "checkpoint"> = {
  async apply(_input, job) {
    if (!job.rewriteId || !indeedJobUrl(job.url)) throw new Error("Automatic applications require a completed CV and an Indeed posting.");
    // The stored posting is authoritative: a run planned before the apply flag existed must not open a browser for a company-site posting.
    const [posting] = await db.select({ raw: jobPostings.raw }).from(jobPostings).where(eq(jobPostings.id, job.jobPostingId)).limit(1);
    if ((posting?.raw as { indeedApply?: boolean } | undefined)?.indeedApply === false) throw new Error(NO_INDEED_APPLY_MESSAGE);
    const setup = await bootstrap(job.rewriteId);
    return enqueueApplication(job.rewriteId, setup.profile, job.url, true);
  },
  async find(input, report, plan) {
    // A profile's target role is the first search title, so an "AI researcher" profile is not searched as the backend engineer its history reads as.
    const leadTitles = input.profileId ? await profileLeadTitles(input.profileId) : [];
    const result = await syncJobs(input.cvDocumentId, { provider: input.provider, onProgress: report, preferences: input.preferences, plan, indeedApplyOnly: input.autoApply === true, leadTitles });
    return { jobPostingIds: result.jobPostingIds, fetched: result.fetched, warnings: result.warnings };
  },
  async rank(input, jobPostingIds, report, budget) {
    const result = await matchJobs(input.cvDocumentId, { provider: input.provider, jobPostingIds, onProgress: report, preferences: input.preferences, maxCandidates: budget?.remaining, excludeIds: budget?.excludeIds, suitableNeeded: budget?.suitableNeeded });
    const jobs = jobPostingIds.length ? await db.select().from(jobPostings).where(inArray(jobPostings.id, jobPostingIds)) : [];
    const byId = new Map(jobs.map((job) => [job.id, job]));
    return {
      assessedIds: result.processedIds,
      summary: { considered: result.considered, scored: result.scored, failed: result.failed, ranking: result.ranking },
      jobs: result.results.flatMap((match) => {
        const job = byId.get(match.jobPostingId);
        return match.ok && job ? [{
          jobPostingId: job.id, title: job.title, company: job.company, location: job.location, source: job.source,
          ...(typeof (job.raw as { indeedApply?: unknown }).indeedApply === "boolean" ? { indeedApply: (job.raw as { indeedApply: boolean }).indeedApply } : {}),
          suitable: match.suitable, assessment: match.assessment, url: job.url, description: job.description ?? "", score: match.score, similarity: match.similarity,
          missing: match.missing, rationale: match.rationale, status: "pending" as const,
        }] : [];
      }),
    };
  },
  async refine(input, state) {
    const preferences = input.preferences ?? defaultSearchPreferences;
    const provider = await resolveAiProvider(input.provider);
    const profile = await loadCachedSearchProfile(input.cvDocumentId, provider);
    return refineJobSearch(provider, {
      profile,
      screening: state.screening,
      lastSearch: state.search ? { fetched: state.search.fetched, unique: state.search.jobPostingIds.length, plan: state.searchPlan } : undefined,
      preferences, round: (state.searchRound ?? 0) + 1,
      suitable: state.jobs.length, targetMatches: state.maxMatches ?? DEFAULT_MAX_MATCHES, previousPlans: state.previousPlans ?? [],
      missing: (state.rankedJobs ?? []).flatMap((job) => job.missing).slice(0, 25),
      considered: state.consideredTotal ?? 0,
    });
  },
  async tailor(input, job, report) {
    const [[document], [review]] = await Promise.all([
      db.select().from(cvDocuments).where(eq(cvDocuments.id, input.cvDocumentId)).limit(1),
      db.select().from(cvReviews).where(and(eq(cvReviews.cvDocumentId, input.cvDocumentId), eq(cvReviews.status, "completed")))
        .orderBy(desc(cvReviews.createdAt)).limit(1),
    ]);
    if (!document?.extractedText || document.extractionStatus !== "ok") throw new Error("The run's uploaded CV is no longer readable.");
    const parsedReview = review ? reviewSchema.safeParse({ summary: review.summary, weaknesses: review.weaknesses, suggestions: review.suggestions }) : null;
    const provider = await resolveAiProvider(input.provider);
    const attempt = (lenient: boolean) => async (): Promise<TailorAttempt> => {
      const stored = await runStoredCvRewrite({
        cvDocumentId: input.cvDocumentId, cvReviewId: parsedReview?.success && review ? review.id : null,
        cvText: document.extractedText!, review: parsedReview?.success ? parsedReview.data : null,
        jobPostingId: job.jobPostingId, provider, onProgress: report, lenient,
        jobContext: { title: job.title, company: job.company, location: job.location, description: job.description, missing: job.missing },
      });
      // Only a rejected draft escalates; outages and timeouts are left to the run's own retries.
      if (stored.result.ok) {
        const removed = (stored.result.rawResponse as { removed?: unknown[] } | undefined)?.removed?.length ?? 0;
        return { ok: true, rewriteId: stored.rewriteId, removed };
      }
      return { ok: false, rejected: stored.result.kind === "invalid_response", message: stored.result.message };
    };
    return tailorWithEscalation(job, {
      strict: attempt(false), lenient: attempt(true),
      profile: () => profileCvForJob(input.cvDocumentId, job.jobPostingId),
      onEscalate: (next, reason) => report({ phase: "repairing", message: next === "lenient"
        ? `The checks rejected the CV (${reason}) Trying again, removing anything that cannot be verified.`
        : `The CV was rejected again (${reason}) Using the profile's reviewed CV for this job.` }),
    });
  },
};

/**
 * The last tailoring fallback: the profile's own reviewed CV, saved as this job's CV so it can be downloaded and
 * applied with. Null when the run's CV was an uploaded file rather than one generated from a profile.
 */
async function profileCvForJob(cvDocumentId: string, jobPostingId: string) {
  const [source] = await db.select({ content: cvRewrites.content }).from(cvDocuments)
    .innerJoin(cvRewrites, eq(cvRewrites.id, cvDocuments.sourceRewriteId))
    .where(and(eq(cvDocuments.id, cvDocumentId), eq(cvRewrites.status, "completed"))).limit(1);
  const content = cvContentSchema.safeParse(source?.content);
  if (!content.success) return null;
  const [row] = await db.insert(cvRewrites).values({
    cvDocumentId, jobPostingId, status: "completed", provider: "profile", model: "profile CV", promptVersion: CV_REWRITE_PROMPT_VERSION,
    content: content.data, latex: renderCvToLatex(content.data), rawResponse: { fallback: "profile CV used after two rejected tailoring attempts" }, completedAt: new Date(),
  }).returning({ id: cvRewrites.id });
  return row.id;
}

/** Every profile has a role to aim at: its target role, else the desired position in its Details. */
async function runTargetRole(profileId: string) {
  const [profile] = await db.select({ targetRole: applications.targetRole, desiredPosition: applications.desiredPosition }).from(applications).where(eq(applications.id, profileId)).limit(1);
  return profile ? profileTargetRole(profile) : null;
}

async function profileLeadTitles(profileId: string) {
  return searchTitlesFromTargetRole(await runTargetRole(profileId));
}

/** The profile's role, folded into the run's preferences for this execution only; the stored run state is untouched. */
async function preferencesForRun(preferences: SearchPreferences, profileId: string | undefined): Promise<SearchPreferences> {
  const targetRole = profileId ? await runTargetRole(profileId) : null;
  return targetRole ? { ...preferences, targetRole } : preferences;
}

export async function processNextPipeline(agents = pipelineAgents) {
  const run = await claimPipelineRun();
  if (!run || !run.leaseOwner) return false;
  const owner = run.leaseOwner;
  let state = run.state;
  let lostLease = false;
  const timer = setInterval(() => {
    void renewPipelineLease(run.id, owner).then((owned) => { if (!owned) lostLease = true; })
      .catch(() => { lostLease = true; });
  }, 20_000);
  try {
    const selected = await resolveRewriteProvider(run.provider as PipelineInput["provider"]);
    if (!selected.ok) throw new Error(selected.message);
    if (selected.provider.model !== run.model) throw new Error(`The configured model changed from ${run.model}. Start a new run with the current model.`);
    const result = await executePipeline({
      id: run.id, cvDocumentId: run.cvDocumentId, provider: selected.provider.providerName, model: run.model, preferences: await preferencesForRun(run.state.preferences ?? defaultSearchPreferences, run.state.profileId),
      autoApply: run.state.autoApply === true,
      maxMatches: run.state.maxMatches,
      ...(run.state.profileId ? { profileId: run.state.profileId } : {}),
    }, state, {
      ...agents,
      checkpoint: async (next) => {
        if (lostLease) throw new Error("The worker lost ownership of this run.");
        await savePipelineState(run.id, owner, next);
        state = structuredClone(next);
      },
    });
    if (needsRetry(result)) {
      const failed = result.state.jobs.filter((job) => job.status === "failed").length;
      const reason = result.status === "failed" && !failed ? "The run failed." : `${failed} of ${result.state.jobs.length} tailored CVs failed.`;
      await retryOrFailPipeline(run, owner, result.state, reason, { status: result.status, ...(result.status === "failed" ? { error: reason } : {}) });
    } else {
      await savePipelineState(run.id, owner, result.state, { status: result.status });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Pipeline failed.";
    // Whatever failed, the run goes back to the queue and resumes at the failed stage until its retries run out.
    await retryOrFailPipeline(run, owner, state, `Attempt failed: ${message}`, { status: "failed", error: message })
      .catch(() => { /* A new worker may already own this run. */ });
  } finally {
    clearInterval(timer);
  }
  return true;
}
