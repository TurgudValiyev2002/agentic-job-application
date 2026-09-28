import "server-only";
import { z } from "zod";
import { aiCacheKey, readAiCache, writeAiCache } from "../ai/result-cache";
import { JOB_SCREENING_PROMPT_VERSION, screeningProgress, screenJobs, type ScreeningJob, type ScreeningProgress, type ScreeningDecision } from "../ai/job-screening";
import { JOB_MATCH_PROMPT_VERSION, scoreJobMatch } from "../ai/job-match";
import { assessRequirements, jobAssessmentSchema } from "./assessment";
import type { ActiveAiProvider } from "../ai/provider";
import type { SearchProfile } from "../ai/search-profile";
import type { SearchPreferences } from "./preferences";

const decisionSchema = z.object({ classification: z.enum(["relevant", "uncertain", "irrelevant"]), reason: z.string().min(1).max(180) }).strict();
export async function screenJobsCached(jobs: ScreeningJob[], cvText: string, profile: SearchProfile, preferences: SearchPreferences, provider: ActiveAiProvider, report?: (progress: ScreeningProgress) => Promise<void>) {
  const keys = new Map(jobs.map(job => [job.id, aiCacheKey("screening", { cvText, profile, preferences,
    job: { title: job.title, company: job.company, location: job.location, description: job.description } }, provider, JOB_SCREENING_PROMPT_VERSION)]));
  const cached = (await Promise.all(jobs.map(async job => {
    const value = await readAiCache(keys.get(job.id)!, decisionSchema);
    return value ? { ...value, jobPostingId: job.id, title: job.title } : null;
  }))).filter((item): item is ScreeningDecision => item !== null);
  const hitIds = new Set(cached.map(item => item.jobPostingId));
  const pending = jobs.filter(job => !hitIds.has(job.id));
  const fresh = await screenJobs(pending, profile, preferences, provider, async progress => {
    await report?.({ ...screeningProgress([...cached, ...progress.decisions], jobs.length), stage: progress.stage, cached: cached.length });
  });
  // Only completed screening decisions are cached; failed/partial model batches never become hits.
  await Promise.all(fresh.decisions.map(({ jobPostingId, classification, reason }) => writeAiCache(keys.get(jobPostingId)!, { classification, reason })));
  return { ...screeningProgress([...cached, ...fresh.decisions], jobs.length), cached: cached.length };
}

export async function scoreJobMatchCached(cvText: string, job: { title: string; company: string; description: string | null }, provider: ActiveAiProvider, preferences: SearchPreferences) {
  const input = { cvText, preferences, job: { title: job.title, company: job.company, description: job.description } };
  const key = aiCacheKey("assessment", input, provider, JOB_MATCH_PROMPT_VERSION);
  const cached = await readAiCache(key, jobAssessmentSchema);
  if (cached) {
    try {
      const match = assessRequirements(cached, cvText, `${job.title}\n${job.company}\n${job.description ?? ""}`);
      return { ok: true as const, match: { ...match, assessment: { ...cached, preferences } }, providerName: provider.providerName, model: provider.model, cached: true };
    } catch { /* Cached evidence must still verify against the exact current sources. */ }
  }
  const result = await scoreJobMatch(cvText, job, provider, preferences);
  if (result.ok) {
    const { roleFit, requirements } = result.match.assessment;
    await writeAiCache(key, { roleFit, requirements });
  }
  return { ...result, cached: false };
}
