import "server-only";

import type { ReportAgentProgress } from "../ai/progress";

import { and, eq, inArray } from "drizzle-orm";
import { jobSources } from "./sources";

import { JOB_MATCH_PROMPT_VERSION } from "@/lib/ai/job-match";
import { getOrCreateSearchProfile } from "@/lib/ai/search-profile";
import { resolveAiProvider, type AiProviderName } from "@/lib/ai/provider";
import { cvDocuments, db, jobMatches, jobPostings } from "@/lib/db";

import { mapWithConcurrency } from "./concurrency";
import { defaultSearchPreferences, applySearchPreferences, jobMeetsPreferences, type SearchPreferences } from "./preferences";
import { MAX_SCREENING_JOBS } from "../ai/job-screening";
import { screenJobsCached, scoreJobMatchCached } from "./cached-ai";
import { rankJobsForCv } from "./embed";
import { diversifyEmployers, screeningPool } from "./diversity";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function matchJobs(
  cvDocumentId: string,
  options: { provider?: AiProviderName; jobPostingIds?: string[]; onProgress?: ReportAgentProgress; preferences?: SearchPreferences; maxCandidates?: number; excludeIds?: string[]; suitableNeeded?: number } = {},
) {
  const [document] = await db
    .select({
      extractedText: cvDocuments.extractedText,
      extractionStatus: cvDocuments.extractionStatus,
      extractionError: cvDocuments.extractionError,
    })
    .from(cvDocuments)
    .where(eq(cvDocuments.id, cvDocumentId))
    .limit(1);
  if (!document) throw new Error("CV document not found.");
  if (document.extractionStatus !== "ok" || !document.extractedText) {
    throw new Error(
      document.extractionError ||
        "Job matching is unavailable because CV text extraction did not succeed.",
    );
  }

  const provider = await resolveAiProvider(options.provider);
  const { profile } = await getOrCreateSearchProfile({
    targetRole: options.preferences?.targetRole,
    cvDocumentId,
    cvText: document.extractedText,
    provider,
  });
  const preferences = options.preferences ?? defaultSearchPreferences;
  const effectiveProfile = applySearchPreferences(profile, preferences);
  const excluded = new Set(options.excludeIds ?? []);
  const available = options.jobPostingIds?.length === 0 ? [] : await db.select().from(jobPostings).where(
    and(inArray(jobPostings.source, jobSources().map(source => source.name)), options.jobPostingIds ? inArray(jobPostings.id, options.jobPostingIds) : undefined),
  ).orderBy(jobPostings.id);
  const screenCandidates = screeningPool(available.filter((job) => !excluded.has(job.id) && jobMeetsPreferences(job, preferences)), MAX_SCREENING_JOBS);
  const screening = await screenJobsCached(screenCandidates, document.extractedText, effectiveProfile, preferences, provider, async (progress) => {
    await options.onProgress?.({ phase: "screening", screening: progress,
      message: progress.stage === "titles" ? `LLM checking career and seniority from titles: ${progress.screened}/${progress.total}.`
        : progress.screened === 0 && progress.total ? `LLM screening ${progress.total} jobs in batches before detailed scoring.`
        : `LLM screened ${progress.screened}/${progress.total}: ${progress.relevant} relevant, ${progress.uncertain} uncertain, ${progress.irrelevant} irrelevant.${progress.cached ? ` ${progress.cached} reused from cache.` : ""}` });
  });
  const decisions = new Map(screening.decisions.map((decision) => [decision.jobPostingId, decision.classification]));
  const eligibleIds = screening.decisions.filter((decision) => decision.classification !== "irrelevant").map((decision) => decision.jobPostingId);
  // Rejected jobs never reach the embedding model or the detailed scoring agent.
  const ranking = await rankJobsForCv(cvDocumentId, effectiveProfile, eligibleIds, preferences);
  const topN = Math.min(positiveInteger(process.env.JOB_MATCH_TOP_N, 20), 100);
  const limit = Math.min(topN, options.maxCandidates ?? topN);
  const relevant = ranking.ranked.filter(({ job }) => decisions.get(job.id) === "relevant");
  const uncertain = ranking.ranked.filter(({ job }) => decisions.get(job.id) === "uncertain");
  const candidates = diversifyEmployers([...relevant, ...uncertain], ({ job }) => job.company, 3).slice(0, limit);
  const concurrency = Math.min(
    positiveInteger(process.env.JOB_MATCH_CONCURRENCY, 1),
    4,
  );

  let scored = 0;
  let failed = 0;
  let cachedScores = 0;
  await options.onProgress?.({ phase: "scoring", message: `Shortlist ready. Scoring ${candidates.length} jobs using ${ranking.degraded ? "keyword" : "semantic"} ranking.`, scored, failed, total: candidates.length });
  const scoreCandidate = async ({ job, similarity }: (typeof candidates)[number]) => {
      await options.onProgress?.({ phase: "scoring", message: `Scoring ${job.title} at ${job.company}.`, jobPostingId: job.id, scored, failed, total: candidates.length });
      const result = await scoreJobMatchCached(document.extractedText!, job, provider, preferences);
      if (!result.ok) {
        failed += 1;
        await options.onProgress?.({ phase: "scoring", message: `Could not score ${job.title}: ${result.message}`, jobPostingId: job.id, scored, failed, total: candidates.length });
        return {
          ok: false as const,
          jobPostingId: job.id,
          title: job.title,
          company: job.company,
          similarity,
          error: result.message,
        };
      }

      const createdAt = new Date();
      await db
        .insert(jobMatches)
        .values({
          jobPostingId: job.id,
          cvDocumentId,
          similarity,
          score: result.match.score,
          matched: result.match.matched,
          missing: result.match.missing,
          rationale: result.match.rationale,
          assessment: result.match.assessment,
          suitable: result.match.suitable,
          provider: result.providerName,
          model: result.model,
          promptVersion: JOB_MATCH_PROMPT_VERSION,
          createdAt,
        })
        .onConflictDoUpdate({
          target: [jobMatches.jobPostingId, jobMatches.cvDocumentId],
          set: {
            similarity,
            score: result.match.score,
            matched: result.match.matched,
            missing: result.match.missing,
            rationale: result.match.rationale,
          assessment: result.match.assessment,
          suitable: result.match.suitable,
            provider: result.providerName,
            model: result.model,
            promptVersion: JOB_MATCH_PROMPT_VERSION,
            createdAt,
          },
        });
      scored += 1;
      if (result.cached) cachedScores += 1;
      await options.onProgress?.({ phase: "scoring", message: `${result.cached ? "Reused verified score for" : "Scored"} ${job.title}: ${result.match.score}/100.`, jobPostingId: job.id, scored, failed, total: candidates.length, ...(cachedScores ? { cached: cachedScores } : {}),
        jobResult: { jobPostingId: job.id, title: job.title, company: job.company, location: job.location, source: job.source,
          url: job.url, description: job.description ?? "", suitable: result.match.suitable, assessment: result.match.assessment,
          score: result.match.score, similarity, missing: result.match.missing, rationale: result.match.rationale, status: "pending" } });
      return {
        ok: true as const,
        jobPostingId: job.id,
        title: job.title,
        company: job.company,
        similarity,
        ...result.match,
      };
    };
  const results: Awaited<ReturnType<typeof scoreCandidate>>[] = [];
  const target = options.suitableNeeded ?? 3;
  for (const classification of ["relevant", "uncertain"] as const) {
    const group = candidates.filter(({ job }) => decisions.get(job.id) === classification);
    for (let index = 0; index < group.length; index += 5) {
      if (results.filter((result) => result.ok && result.suitable).length >= target) break;
      if (classification === "uncertain" && index === 0 && group.length) {
        await options.onProgress?.({ phase: "scoring", message: "Not enough verified relevant matches yet. Checking the LLM's uncertain candidates.", scored, failed, total: candidates.length });
      }
      results.push(...await mapWithConcurrency(group.slice(index, index + 5), concurrency, scoreCandidate));
    }
  }
  await options.onProgress?.({ phase: "scoring", message: `Detailed scoring complete: ${scored} scored, ${failed} failed. ${screening.irrelevant} irrelevant jobs skipped by the LLM.${cachedScores ? ` ${cachedScores} verified scores reused.` : ""}`, scored, failed, total: results.length, ...(cachedScores ? { cached: cachedScores } : {}) });

  return {
    screening,
    cachedScores,
    processedIds: [...screening.decisions.filter((item) => item.classification === "irrelevant").map((item) => item.jobPostingId), ...results.map((item) => item.jobPostingId)],
    degraded: ranking.degraded,
    ranking: ranking.degraded ? ("keyword" as const) : ("embedding" as const),
    embedded: ranking.embedded,
    considered: results.length,
    scored: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results,
  };
}
