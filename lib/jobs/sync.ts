import "server-only";

import { applySearchPreferences, defaultSearchPreferences, type SearchPreferences } from "./preferences";
import type { SearchPlan } from "./search-plan";
import type { ReportAgentProgress } from "../ai/progress";

import { createHash } from "node:crypto";

import { eq, inArray } from "drizzle-orm";

import { getOrCreateSearchProfile } from "@/lib/ai/search-profile";
import { loadAppliedJobs } from "@/lib/job-applications/applied";
import { resolveAiProvider, type AiProviderName } from "@/lib/ai/provider";
import { cvDocuments, db, jobPostings } from "@/lib/db";

import { jobSources } from "./sources";
import type { NormalizedJob } from "./types";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeFingerprintPart(value: string | null) {
  return (value ?? "")
    .toLocaleLowerCase("en-US")
    .normalize("NFKD")
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

export function jobFingerprint(job: Pick<NormalizedJob, "company" | "title" | "location">) {
  return sha256(
    [job.company, job.title, job.location]
      .map(normalizeFingerprintPart)
      .join("|"),
  );
}

export function jobContentHash(description: string | null) {
  return sha256(description ?? "");
}

export async function syncJobs(
  cvDocumentId: string,
  options: { provider?: AiProviderName; refreshProfile?: boolean; onProgress?: ReportAgentProgress; preferences?: SearchPreferences; plan?: SearchPlan;
    /** Automatic runs: postings without Indeed Apply are still stored but never screened, scored or selected. */
    indeedApplyOnly?: boolean;
    /** Titles searched before the CV-derived ones when the run sets no explicit roles (a profile's target role). */
    leadTitles?: string[] } = {},
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
        "Job search is unavailable because CV text extraction did not succeed.",
    );
  }

  const provider = await resolveAiProvider(options.provider);
  const profileResult = await getOrCreateSearchProfile({
    targetRole: options.preferences?.targetRole,
    cvDocumentId,
    cvText: document.extractedText,
    provider,
    refresh: options.refreshProfile,
  });

  const preferences = options.preferences ?? defaultSearchPreferences;
  const spec = applySearchPreferences(profileResult.profile, preferences);
  const lead = preferences.titles.length ? [] : (options.leadTitles ?? []).map((title) => title.trim()).filter(Boolean);
  const candidates = [...lead, ...spec.titles];
  const titles = [...new Set(candidates.map((title) => title.toLowerCase()))].map((lower) => candidates.find((title) => title.toLowerCase() === lower)!);
  const searchSpec = { ...spec, titles, ...(options.indeedApplyOnly ? { indeedApplyOnly: true } : {}) };
  profileResult.profile = searchSpec;
  await options.onProgress?.({ phase: "searching", message: `Search profile ready: ${profileResult.profile.titles.join(", ")}.` });
  const availableSources = jobSources().filter((source) => source.available());
  const warnings: string[] = [];
  let failedSources = 0;
  if (!availableSources.length) throw new Error("No job sources are configured.");
  const fetchedBySource = new Map<string, number>();
  const batches = await Promise.all(
    availableSources.map(async (source) => {
      try {
        return await source.search(searchSpec, options.onProgress ? async (update) => {
          if (update.fetched !== undefined) fetchedBySource.set(source.name, update.fetched);
          await options.onProgress!({ ...update, fetched: [...fetchedBySource.values()].reduce((a, b) => a + b, 0) });
        } : undefined, options.plan, provider);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        failedSources += 1;
        warnings.push(`${source.name}: ${message}`);
        console.warn(`${source.name} search failed and was skipped: ${message}`);
        return [];
      }
    }),
  );
  if (failedSources === availableSources.length) throw new Error(`Job search failed: ${warnings.join("; ")}`);
  const fetchedJobs = batches.flat();
  const deduped = new Map<string, NormalizedJob>();
  for (const job of fetchedJobs) deduped.set(jobFingerprint(job), job);

  await options.onProgress?.({ phase: "searching", message: `Removing duplicates and saving ${deduped.size} unique jobs.`, fetched: fetchedJobs.length });
  const fingerprints = [...deduped.keys()];
  const existing = fingerprints.length
    ? await db
        .select({
          fingerprint: jobPostings.fingerprint,
          contentHash: jobPostings.contentHash,
          embedding: jobPostings.embedding,
          embeddingModel: jobPostings.embeddingModel,
          embeddedAt: jobPostings.embeddedAt,
        })
        .from(jobPostings)
        .where(inArray(jobPostings.fingerprint, fingerprints))
    : [];
  const existingByFingerprint = new Map(
    existing.map((row) => [row.fingerprint, row]),
  );

  // Jobs already applied to are still stored (their listing may have changed) but never
  // go on to screening or scoring, whichever source or cached page surfaced them.
  const applied = await loadAppliedJobs();
  const jobPostingIds: string[] = [];
  let alreadyApplied = 0, companySite = 0;
  for (const [fingerprint, job] of deduped) {
    const prior = existingByFingerprint.get(fingerprint);
    const contentHash = jobContentHash(job.description);
    const contentChanged = prior?.contentHash !== contentHash;
    const values = {
      source: job.source,
      externalId: job.externalId,
      fingerprint,
      company: job.company,
      title: job.title,
      location: job.location,
      remote: job.remote,
      url: job.url,
      description: job.description,
      postedAt: job.postedAt,
      raw: job.raw,
      contentHash,
      embedding: contentChanged ? null : (prior?.embedding ?? null),
      embeddingModel: contentChanged ? null : (prior?.embeddingModel ?? null),
      embeddedAt: contentChanged ? null : (prior?.embeddedAt ?? null),
      updatedAt: new Date(),
    };
    const [stored] = await db
      .insert(jobPostings)
      .values(values)
      .onConflictDoUpdate({
        target: jobPostings.fingerprint,
        set: {
          source: values.source,
          externalId: values.externalId,
          company: values.company,
          title: values.title,
          location: values.location,
          remote: values.remote,
          url: values.url,
          description: values.description,
          postedAt: values.postedAt,
          raw: values.raw,
          contentHash: values.contentHash,
          embedding: values.embedding,
          embeddingModel: values.embeddingModel,
          embeddedAt: values.embeddedAt,
          updatedAt: values.updatedAt,
        },
      }).returning({ id: jobPostings.id });
    if (applied.jobPostingIds.has(stored.id)) { alreadyApplied++; continue; }
    // Whichever source or cached page surfaced it, a company-site posting cannot be applied to automatically.
    if (options.indeedApplyOnly && (job.raw as { indeedApply?: unknown }).indeedApply === false) { companySite++; continue; }
    jobPostingIds.push(stored.id);
  }
  if (alreadyApplied) await options.onProgress?.({ phase: "searching", message: `Skipped ${alreadyApplied} job${alreadyApplied === 1 ? "" : "s"} you already applied to.` });
  if (companySite) await options.onProgress?.({ phase: "searching", message: `Skipped ${companySite} job${companySite === 1 ? "" : "s"} without Indeed Apply; automatic runs only consider postings the browser worker can apply to.` });

  return {
    fetched: fetchedJobs.length,
    jobPostingIds,
    alreadyApplied,
    companySite,
    warnings,
    inserted: fingerprints.filter((item) => !existingByFingerprint.has(item)).length,
    updated: fingerprints.filter((item) => existingByFingerprint.has(item)).length,
    skipped: fetchedJobs.length - deduped.size,
    profile: profileResult.profile,
    profileCached: profileResult.cached,
  };
}
