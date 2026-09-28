import "server-only";

import { createHash } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import type { SearchProfile } from "@/lib/ai/search-profile";
import { cvDocuments, db, jobPostings, type JobPosting } from "@/lib/db";

import { mapWithConcurrency } from "./concurrency";
import { rankingSimilarity } from "./similarity";

const cvEmbeddingCache = new Map<string, number[]>();

export { embeddingConfig } from "../ai/embeddings";
import { embeddingConfig, requestEmbeddings, resolveEmbeddingConfig, type EmbeddingConfig } from "../ai/embeddings";
import { hasEvidence } from "../ai/evidence";
import { defaultSearchPreferences, jobMeetsPreferences, type SearchPreferences } from "./preferences";

function jobText(job: Pick<JobPosting, "title" | "company" | "description">, config: EmbeddingConfig = embeddingConfig()) {
  return `${job.title}\n${job.company}\n${job.description ?? ""}`.slice(
    0,
    config.maxChars,
  );
}

export { cosineSimilarity } from "./similarity";

function keywordSimilarity(job: JobPosting, profile: SearchProfile) {
  const haystack = `${job.title} ${job.company} ${job.description ?? ""}`
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}+#.]+/gu, " ");
  const terms = [...new Set([...profile.skills, ...profile.keywords])]
    .map((term) => term.toLocaleLowerCase("en-US").trim())
    .filter(Boolean);
  if (!terms.length) return 0;
  return terms.filter((term) => hasEvidence(haystack, term)).length / terms.length;
}

function cvCacheKey(cvText: string, model: string) {
  const contentHash = createHash("sha256").update(cvText).digest("hex");
  return `${model}:${contentHash}`;
}

async function embedJobs(jobs: JobPosting[], config: EmbeddingConfig) {
  const pending = jobs.filter(
    (job) => !job.embedding || job.embeddingModel !== config.model,
  );
  const batches: JobPosting[][] = [];
  for (let index = 0; index < pending.length; index += config.batchSize) {
    batches.push(pending.slice(index, index + config.batchSize));
  }

  await mapWithConcurrency(batches, config.concurrency, async (batch) => {
    const vectors = await requestEmbeddings(batch.map((job) => jobText(job, config)), config);
    await Promise.all(
      batch.map((job, index) =>
        db
          .update(jobPostings)
          .set({
            embedding: vectors[index],
            embeddingModel: config.model,
            embeddedAt: new Date(),
          })
          .where(eq(jobPostings.id, job.id)),
      ),
    );
    batch.forEach((job, index) => {
      job.embedding = vectors[index];
      job.embeddingModel = config.model;
    });
  });
  return pending.length;
}

export type RankedJob = { job: JobPosting; similarity: number };

/** The target role's vector (cached like the CV's). Null if it cannot be embedded; ranking then uses the CV alone. */
async function targetRoleVector(targetRole: string, config: EmbeddingConfig) {
  const key = cvCacheKey(`target-role:${targetRole}`, `${config.provider}:${config.baseUrl}:${config.model}`);
  const cached = cvEmbeddingCache.get(key);
  if (cached) return cached;
  try {
    const [vector] = await requestEmbeddings([targetRole], config);
    if (!vector) return null;
    if (cvEmbeddingCache.size >= 100) cvEmbeddingCache.delete(cvEmbeddingCache.keys().next().value!);
    cvEmbeddingCache.set(key, vector);
    return vector;
  } catch (error) {
    console.warn(`Target role could not be embedded; ranking by CV only: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

export async function rankJobsForCv(
  cvDocumentId: string,
  profile: SearchProfile,
  jobPostingIds?: string[],
  preferences: SearchPreferences = defaultSearchPreferences,
) {
  const [document] = await db
    .select({ extractedText: cvDocuments.extractedText })
    .from(cvDocuments)
    .where(eq(cvDocuments.id, cvDocumentId))
    .limit(1);
  if (!document?.extractedText) {
    throw new Error("The CV has no extracted text to rank against.");
  }
  const jobs = jobPostingIds?.length === 0
    ? []
    : (await db.select().from(jobPostings).where(
        jobPostingIds ? inArray(jobPostings.id, jobPostingIds) : undefined,
      )).filter((job) => jobMeetsPreferences(job, preferences));
  if (!jobs.length) {
    return { ranked: [] as RankedJob[], degraded: false, embedded: 0 };
  }

  const config = await resolveEmbeddingConfig();
  try {
    const cacheKey = cvCacheKey(document.extractedText, `${config.provider}:${config.baseUrl}:${config.model}:${config.maxChars}`);
    const cachedCvEmbedding = cvEmbeddingCache.get(cacheKey);
    let createdCvEmbedding: number[] | undefined;
    if (!cachedCvEmbedding) {
      const [createdEmbedding] = await requestEmbeddings([
        document.extractedText.slice(0, config.maxChars),
      ], config);
      if (!createdEmbedding) {
        throw new Error("Embedding server returned no CV vector.");
      }
      createdCvEmbedding = createdEmbedding;
      if (cvEmbeddingCache.size >= 100) cvEmbeddingCache.delete(cvEmbeddingCache.keys().next().value!);
      cvEmbeddingCache.set(cacheKey, createdEmbedding);
    }
    const cvVector = cachedCvEmbedding ?? createdCvEmbedding;
    if (!cvVector) throw new Error("CV embedding was not cached.");
    const embedded = await embedJobs(jobs, config);
    if (jobs.some((job) => job.embedding?.length !== cvVector.length)) throw new Error("Embedding dimensions do not match; re-embed the jobs with the current model.");
    const targetVector = preferences.targetRole ? await targetRoleVector(preferences.targetRole, config) : null;
    return {
      ranked: jobs
        .map((job) => ({
          job,
          similarity: rankingSimilarity(job.embedding ?? [], cvVector, targetVector),
        }))
        .sort((left, right) => right.similarity - left.similarity),
      degraded: false,
      embedded,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn(`Embedding ranking unavailable; using keyword overlap: ${message}`);
    return {
      ranked: jobs
        .map((job) => ({ job, similarity: keywordSimilarity(job, profile) }))
        .sort((left, right) => right.similarity - left.similarity),
      degraded: true,
      embedded: 0,
    };
  }
}
