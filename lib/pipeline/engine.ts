import { MIN_MATCH_SCORE } from "../jobs/assessment";
import { MAX_SEARCH_ROUNDS, MAX_PIPELINE_SCORES, type SearchPlan } from "../jobs/search-plan";
import type { PipelineInput, PipelineJob, PipelineState, PipelineStatus } from "./types";
import type { ReportAgentProgress } from "../ai/progress";
import { maxMatchesSchema } from "./options";

export type PipelineDependencies = {
  find: (input: PipelineInput, report: ReportAgentProgress, plan?: SearchPlan) => Promise<NonNullable<PipelineState["search"]>>;
  rank: (input: PipelineInput, ids: string[], report: ReportAgentProgress, budget?: { remaining: number; excludeIds: string[]; suitableNeeded?: number }) => Promise<{
    summary: NonNullable<PipelineState["matching"]>;
    jobs: PipelineJob[];
    assessedIds?: string[];
  }>;
  refine?: (input: PipelineInput, state: PipelineState) => Promise<SearchPlan | null>;
  tailor: (input: PipelineInput, job: PipelineJob, report: ReportAgentProgress) => Promise<string | { rewriteId: string; tailoring?: PipelineJob["tailoring"] }>;
  apply?: (input: PipelineInput, job: PipelineJob) => Promise<string>;
  checkpoint: (state: PipelineState) => Promise<void>;
};

/** The requested number of suitable matches; automatic runs require supported application forms. */
type Activity = NonNullable<PipelineState["activity"]>[number];
const MAX_ACTIVITY = 120;

/**
 * Adds an activity line. A counter update ("Read 12 full job postings") replaces the line it updates instead of
 * piling up, so repeated progress ticks cannot push the run's early milestones out of the capped log.
 */
export function appendActivity(activity: Activity[], entry: Activity) {
  const last = activity.at(-1);
  const template = (message: string) => message.replace(/\d+/g, "#");
  const updatesLast = last && last.stage === entry.stage && template(last.message) === template(entry.message);
  return [...(updatesLast ? activity.slice(0, -1) : activity), entry].slice(-MAX_ACTIVITY);
}

export function selectTopJobs(jobs: PipelineJob[], options: { autoApply?: boolean; maxMatches?: number } = {}) {
  const maxMatches = maxMatchesSchema.parse(options.maxMatches);
  const ranked = jobs.filter((job) => job.score >= MIN_MATCH_SCORE && job.suitable === true && !(options.autoApply && job.indeedApply === false)).sort((a, b) =>
    b.score - a.score || b.similarity - a.similarity || a.jobPostingId.localeCompare(b.jobPostingId),
  );
  return ranked.filter((job, index) =>
    ranked.findIndex((candidate) => candidate.jobPostingId === job.jobPostingId) === index,
  ).slice(0, maxMatches);
}

// Application dispatch is enabled only by the persisted choice made when starting this run.
export async function executePipeline(
  input: PipelineInput,
  previous: PipelineState,
  dependencies: PipelineDependencies,
): Promise<{ status: PipelineStatus; state: PipelineState }> {
  const state = structuredClone(previous);
  const maxMatches = maxMatchesSchema.parse(state.maxMatches ?? input.maxMatches);
  state.maxMatches = maxMatches;
  state.startedAt ??= new Date().toISOString();
  // Scoring runs concurrently. Serialize progress writes so a slower database
  // update cannot overwrite a later count or activity entry.
  let pendingWrite = Promise.resolve();
  const report: ReportAgentProgress = (update) => {
    pendingWrite = pendingWrite.then(async () => {
      const at = new Date().toISOString();
      const { jobResult, ...live } = update;
      state.live = { ...live, at };
      if (jobResult && update.phase === "scoring" && state.search?.jobPostingIds.includes(jobResult.jobPostingId)) {
        state.rankedJobs = [...(state.rankedJobs ?? []).filter(job => job.jobPostingId !== jobResult.jobPostingId), jobResult];
        state.jobs = selectTopJobs(state.rankedJobs, { autoApply: state.autoApply, maxMatches });
      }
      if (update.screening) state.screening = update.screening;
      if (update.fetched !== undefined) state.fetched = update.fetched;
      if (update.scored !== undefined && update.failed !== undefined && update.total !== undefined) {
        state.scoring = { scored: update.scored, failed: update.failed, total: update.total, ...(update.cached !== undefined ? { cached: update.cached } : {}) };
      }
      state.activity = appendActivity(state.activity ?? [], { at, stage: state.stage, message: update.message });
      await dependencies.checkpoint(structuredClone(state));
    });
    return pendingWrite;
  };
  // A retried run that already has its shortlist resumes at tailoring instead of searching again.
  const shortlisted = state.stage === "tailoring" || state.stage === "applying";
  while (!shortlisted) {
    if (!state.search) {
      state.stage = "finding";
      await report({ phase: "profiling", message: `Search attempt ${(state.searchRound ?? 0) + 1} of ${MAX_SEARCH_ROUNDS}. Reading your CV and preferences.` });
      try {
        state.search = await dependencies.find(input, report, state.searchPlan);
      } catch (error) {
        if (!(state.searchRound ?? 0)) throw error;
        state.warnings.push(`Refined search failed: ${error instanceof Error ? error.message : "source unavailable"}. Keeping earlier results.`);
        break;
      }
      state.warnings.push(...state.search.warnings);
      await report({ phase: "searching", message: `Found ${state.search.jobPostingIds.length} unique jobs.`, fetched: state.search.fetched });
    }
    if (!state.matching) {
      state.stage = "ranking";
      await report({ phase: "shortlisting", message: "Checking preferences and comparing job requirements with CV evidence." });
      const remaining = MAX_PIPELINE_SCORES - (state.consideredTotal ?? 0);
      const ranked = state.search.jobPostingIds.length && remaining > 0
        ? await dependencies.rank(input, state.search.jobPostingIds, report, { remaining, excludeIds: state.assessedIds ?? [], suitableNeeded: Math.max(0, maxMatches - state.jobs.length) })
        : { summary: { considered: 0, scored: 0, failed: 0, ranking: "embedding" }, jobs: [], assessedIds: [] };
      const currentIds = new Set(state.search.jobPostingIds);
      state.rankedJobs = [...new Map([...(state.rankedJobs ?? []), ...ranked.jobs.filter((job) => currentIds.has(job.jobPostingId))].map(job => [job.jobPostingId, job])).values()];
      state.jobs = selectTopJobs(state.rankedJobs, { autoApply: state.autoApply, maxMatches });
      state.matching = ranked.summary;
      state.consideredTotal = (state.consideredTotal ?? 0) + ranked.summary.considered;
      state.assessedIds = [...new Set([...(state.assessedIds ?? []), ...(ranked.assessedIds ?? ranked.jobs.map((job) => job.jobPostingId))])];
      if (ranked.summary.failed) state.warnings.push(`${ranked.summary.failed} job scores failed; only verified scores can be selected.`);
      if (ranked.summary.ranking === "keyword") state.warnings.push("Embeddings were unavailable. Keyword ranking was used to shortlist jobs before AI scoring.");
      await report({ phase: "scoring", message: `${state.jobs.length} suitable matches found so far.`, ...ranked.summary, total: ranked.summary.considered });
    }
    if (state.jobs.length >= maxMatches || (state.searchRound ?? 0) + 1 >= MAX_SEARCH_ROUNDS ||
      (state.consideredTotal ?? 0) >= MAX_PIPELINE_SCORES || !dependencies.refine) break;
    // Persist every completed round before asking the agent for a bounded plan.
    let plan: SearchPlan | null;
    try { plan = await dependencies.refine(input, state); }
    catch (error) {
      state.warnings.push(`Search refinement unavailable: ${error instanceof Error ? error.message : "model error"}. Keeping earlier results.`);
      break;
    }
    if (!plan) break;
    state.searchRound = (state.searchRound ?? 0) + 1;
    state.searchPlan = { ...plan, round: state.searchRound };
    state.previousPlans = [...(state.previousPlans ?? []), plan.strategy];
    delete state.search;
    delete state.matching;
    delete state.screening;
    delete state.scoring;
    state.stage = "finding";
    await report({ phase: "searching", message: `Refining search: ${plan.reason}` });
  }
  if (!state.jobs.length) {
    if ((state.consideredTotal ?? 0) > 0 && !state.rankedJobs?.length) throw new Error("None of the found jobs could be scored. Start a new run to retry.");
    state.warnings.push("No suitable jobs met your preferences and the evidence threshold. No CVs were generated.");
    state.stage = "done";
    await report({ phase: "scoring", message: "Search complete. No suitable matches found." });
    return { status: "completed", state };
  }
  const shortfall = `Only ${state.jobs.length} of ${maxMatches} requested suitable matches were found within the search budget; tailoring these matches.`;
  if (state.jobs.length < maxMatches && !state.warnings.includes(shortfall)) state.warnings.push(shortfall);
  state.stage = "tailoring";
  await dependencies.checkpoint(state);
  // Sequential generation avoids overloading a local model and checkpoints each
  // result, so a restarted worker can keep completed CVs.
  for (const job of state.jobs) {
    if (job.status === "completed" || job.status === "failed") continue;
    job.status = "running";
    await report({ phase: "rewriting", message: `Tailoring CV ${state.jobs.indexOf(job) + 1} of ${state.jobs.length}: ${job.title}.`, jobPostingId: job.jobPostingId });
    try {
      const tailored = await dependencies.tailor(input, job, (update) => report({ ...update, jobPostingId: job.jobPostingId }));
      job.rewriteId = typeof tailored === "string" ? tailored : tailored.rewriteId;
      if (typeof tailored !== "string" && tailored.tailoring) job.tailoring = tailored.tailoring;
      job.status = "completed";
      delete job.error;
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "CV tailoring failed.";
    }
    await report({ phase: "saving", message: job.status === "completed" ? `${job.tailoring === "profile" ? "Profile CV used" : "Tailored CV ready"}: ${job.title}.` : `Tailoring failed for ${job.title}: ${job.error}`, jobPostingId: job.jobPostingId });
  }
  if (state.autoApply) {
    state.stage = "applying";
    for (const job of state.jobs.slice(0, maxMatches)) {
      if (job.status !== "completed" || !job.rewriteId || job.applicationId || job.applicationError) continue;
      // Company-site postings cannot be applied to by the browser worker; say so instead of opening a browser that fails.
      if (job.indeedApply === false) {
        job.applicationError = "This posting sends applicants to the company's own website; Indeed Apply is not offered. Apply on the company site manually.";
        await report({ phase: "saving", message: `Application needs attention: ${job.title}: ${job.applicationError}`, jobPostingId: job.jobPostingId });
        continue;
      }
      await report({ phase: "saving", message: `Queuing a draft on Indeed: ${job.title}.`, jobPostingId: job.jobPostingId });
      try {
        if (!dependencies.apply) throw new Error("Automatic applications are unavailable in this worker.");
        job.applicationId = await dependencies.apply(input, job);
      } catch (error) { job.applicationError = error instanceof Error ? error.message : "Could not queue application."; }
      await report({ phase: "saving", message: job.applicationError ? `Application needs attention: ${job.title}: ${job.applicationError}` : `Draft queued: ${job.title}. Follow it in Applications.`, jobPostingId: job.jobPostingId });
    }
  }
  state.stage = "done";
  const successes = state.jobs.filter((job) => job.status === "completed").length;
  await report({ phase: "saving", message: `Pipeline finished. ${successes} of ${state.jobs.length} tailored CVs ready.${state.autoApply ? ` ${state.jobs.filter(job => job.applicationId).length} drafts queued on Indeed; you submit them yourself.` : ""}` });
  return {
    status: successes === state.jobs.length && !state.jobs.some(job => job.applicationError) ? "completed" : successes ? "partial" : "failed",
    state,
  };
}

/** Whether a finished attempt should go back to the queue: the run failed, or at least one tailored CV did. */
export function needsRetry(result: { status: PipelineStatus; state: PipelineState }) {
  return result.status === "failed" || result.state.jobs.some((job) => job.status === "failed");
}

/**
 * Rewinds a failed attempt to the stage that failed, keeping everything finished before it. Tailoring and
 * applying keep the shortlist and completed CVs and retry only the failed jobs; a search round that ranked but
 * produced nothing usable is searched again from scratch (its jobs were already marked as assessed).
 */
export function prepareRetry(previous: PipelineState): PipelineState {
  const state = structuredClone(previous);
  delete state.live;
  if (state.jobs.length && (state.stage === "tailoring" || state.stage === "applying" || state.stage === "done")) {
    state.stage = "tailoring";
    for (const job of state.jobs) {
      if (job.status === "failed" || job.status === "running") { job.status = "pending"; delete job.error; }
    }
    return state;
  }
  if (state.matching) {
    for (const key of ["search", "matching", "screening", "scoring", "rankedJobs", "assessedIds", "consideredTotal", "searchRound", "searchPlan", "previousPlans", "fetched"] as const) delete state[key];
    state.jobs = [];
    state.warnings = [];
  }
  state.stage = "finding";
  return state;
}
