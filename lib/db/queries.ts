import "server-only";

import { and, asc, desc, eq, isNull, sql, or } from "drizzle-orm";

import { cvContentSchema, type CvContent } from "@/lib/cv/content";
import { documentForRewrite } from "@/lib/cv/saved-document";

import {
  type Application,
  type ApplicationLanguage,
  type ApplicationReference,
  type ApplicationSkill,
  applicationLanguages,
  applicationReferences,
  applications,
  applicationSkills,
  type CvDocument,
  cvDocuments,
  type CvReview,
  cvReviews,
  type CvRewrite,
  cvRewrites,
  db,
  type EducationEntry,
  educationEntries,
  type WorkExperience,
  workExperiences,
} from "./index";

export type CvReviewSuggestion = {
  section: string;
  issue: string;
  suggestion: string;
};

export type LatestCompletedCvReview = Pick<
  CvReview,
  "id" | "provider" | "model" | "createdAt"
> & {
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: CvReviewSuggestion[];
  completedAt: Date;
};

export type LatestCompletedCvRewrite = Pick<
  CvRewrite,
  "id" | "provider" | "model" | "createdAt"
> & {
  content: CvContent;
  experienceCount: number;
  projectCount: number;
  educationCount: number;
  completedAt: Date;
  /** Set once the rewrite was saved as a CV document; the pipeline preselects it when it is the current one. */
  saved: { documentId: string; isPipelineCv: boolean } | null;
};

export type LatestCvDocumentWithReview = Pick<
  CvDocument,
  | "id"
  | "originalFilename"
  | "byteSize"
  | "extractionStatus"
  | "extractionError"
> & {
  textPreview: string;
  review: LatestCompletedCvReview | null;
  rewrite: LatestCompletedCvRewrite | null;
};

function isCvReviewSuggestions(value: unknown): value is CvReviewSuggestion[] {
  return (
    Array.isArray(value) &&
    value.every(
      (suggestion) =>
        typeof suggestion === "object" &&
        suggestion !== null &&
        "section" in suggestion &&
        typeof suggestion.section === "string" &&
        "issue" in suggestion &&
        typeof suggestion.issue === "string" &&
        "suggestion" in suggestion &&
        typeof suggestion.suggestion === "string",
    )
  );
}

export async function getLatestCvDocumentWithReview(documentId?: string, uploadsOnly = false): Promise<LatestCvDocumentWithReview | null> {
  const [document] = await db
    .select({
      id: cvDocuments.id,
      originalFilename: cvDocuments.originalFilename,
      byteSize: cvDocuments.byteSize,
      extractionStatus: cvDocuments.extractionStatus,
      extractionError: cvDocuments.extractionError,
      extractedText: cvDocuments.extractedText,
      sourceRewriteId: cvDocuments.sourceRewriteId,
    })
    .from(cvDocuments)
    .where(documentId ? eq(cvDocuments.id, documentId) : uploadsOnly ? isNull(cvDocuments.applicationId) : undefined)
    .orderBy(desc(cvDocuments.createdAt))
    .limit(1);

  if (!document) return null;

  const [review] = await db
    .select({
      id: cvReviews.id,
      provider: cvReviews.provider,
      model: cvReviews.model,
      overallScore: cvReviews.overallScore,
      summary: cvReviews.summary,
      strengths: cvReviews.strengths,
      weaknesses: cvReviews.weaknesses,
      suggestions: cvReviews.suggestions,
      createdAt: cvReviews.createdAt,
      completedAt: cvReviews.completedAt,
    })
    .from(cvReviews)
    .where(
      and(
        eq(cvReviews.cvDocumentId, document.id),
        eq(cvReviews.status, "completed"),
      ),
    )
    .orderBy(desc(cvReviews.createdAt))
    .limit(1);

  let completedReview: LatestCompletedCvReview | null = null;
  if (review) {
    if (
      review.overallScore === null ||
      review.summary === null ||
      review.strengths === null ||
      review.weaknesses === null ||
      !isCvReviewSuggestions(review.suggestions)
    ) {
      throw new Error(`Completed CV review ${review.id} has incomplete feedback.`);
    }

    completedReview = {
      ...review,
      overallScore: review.overallScore,
      summary: review.summary,
      strengths: review.strengths,
      weaknesses: review.weaknesses,
      suggestions: review.suggestions,
      completedAt: review.completedAt ?? review.createdAt,
    };
  }

  const [rewrite] = await db
    .select({
      id: cvRewrites.id,
      provider: cvRewrites.provider,
      model: cvRewrites.model,
      content: cvRewrites.content,
      createdAt: cvRewrites.createdAt,
      completedAt: cvRewrites.completedAt,
    })
    .from(cvRewrites)
    .where(
      and(
        or(eq(cvRewrites.cvDocumentId, document.id), document.sourceRewriteId ? eq(cvRewrites.id, document.sourceRewriteId) : undefined),
        eq(cvRewrites.status, "completed"),
        isNull(cvRewrites.jobPostingId),
      ),
    )
    .orderBy(desc(cvRewrites.createdAt))
    .limit(1);

  let completedRewrite: LatestCompletedCvRewrite | null = null;
  if (rewrite) {
    const parsedContent = cvContentSchema.safeParse(rewrite.content);
    if (!parsedContent.success) {
      throw new Error(`Completed CV rewrite ${rewrite.id} has invalid content.`);
    }

    const saved = await documentForRewrite(rewrite.id);
    completedRewrite = {
      id: rewrite.id,
      provider: rewrite.provider,
      model: rewrite.model,
      content: parsedContent.data,
      createdAt: rewrite.createdAt,
      experienceCount: parsedContent.data.experience.length,
      projectCount: parsedContent.data.projects.length,
      educationCount: parsedContent.data.education.length,
      completedAt: rewrite.completedAt ?? rewrite.createdAt,
      saved: saved ? { documentId: saved.document.id, isPipelineCv: saved.isPipelineCv } : null,
    };
  }

  return {
    id: document.id,
    originalFilename: document.originalFilename,
    byteSize: document.byteSize,
    extractionStatus: document.extractionStatus,
    extractionError: document.extractionError,
    textPreview: document.extractedText?.slice(0, 300) ?? "",
    review: completedReview,
    rewrite: completedRewrite,
  };
}

export type LatestApplication = Application & {
  education: EducationEntry[];
  experience: WorkExperience[];
  skills: ApplicationSkill[];
  languages: ApplicationLanguage[];
  references: ApplicationReference[];
  cvDocument: Pick<
    CvDocument,
    "id" | "originalFilename" | "byteSize" | "extractionStatus"
  > | null;
};

export async function getSelectedApplication(): Promise<LatestApplication | null> {
  const [row] = await db.select({ id: applications.id }).from(applications).where(isNull(applications.archivedAt))
    .orderBy(sql`${applications.selectedAt} desc nulls last`, desc(applications.createdAt)).limit(1);
  return row ? getApplication(row.id) : null;
}

// Older callers also mean the selected profile, never the last profile edited.
export const getLatestApplication = getSelectedApplication;

export async function listProfiles(includeArchived = false) {
  return db.select({
    id: applications.id, name: applications.name, targetRole: applications.targetRole,
    cvStatus: applications.cvStatus, cvError: applications.cvError, cvDocumentId: applications.cvDocumentId,
    cvReviewId: applications.cvReviewId, overallScore: cvReviews.overallScore,
    updatedAt: applications.updatedAt, selectedAt: applications.selectedAt, archivedAt: applications.archivedAt,
  }).from(applications).leftJoin(cvReviews, eq(cvReviews.id, applications.cvReviewId))
    .where(includeArchived ? undefined : isNull(applications.archivedAt))
    .orderBy(sql`${applications.selectedAt} desc nulls last`, desc(applications.createdAt));
}

export async function getApplication(id: string): Promise<LatestApplication | null> {
  const [application] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.id, id), isNull(applications.archivedAt)))
    .limit(1);

  if (!application) return null;

  const [education, experience, skills, languages, references, linkedCvs] =
    await Promise.all([
      db
        .select()
        .from(educationEntries)
        .where(eq(educationEntries.applicationId, application.id))
        .orderBy(asc(educationEntries.sortOrder)),
      db
        .select()
        .from(workExperiences)
        .where(eq(workExperiences.applicationId, application.id))
        .orderBy(asc(workExperiences.sortOrder)),
      db
        .select()
        .from(applicationSkills)
        .where(eq(applicationSkills.applicationId, application.id))
        .orderBy(asc(applicationSkills.sortOrder)),
      db
        .select()
        .from(applicationLanguages)
        .where(eq(applicationLanguages.applicationId, application.id))
        .orderBy(asc(applicationLanguages.sortOrder)),
      db
        .select()
        .from(applicationReferences)
        .where(eq(applicationReferences.applicationId, application.id))
        .orderBy(asc(applicationReferences.sortOrder)),
      db
        .select({
          id: cvDocuments.id,
          originalFilename: cvDocuments.originalFilename,
          byteSize: cvDocuments.byteSize,
          extractionStatus: cvDocuments.extractionStatus,
        })
        .from(cvDocuments)
        .where(application.cvDocumentId ? eq(cvDocuments.id, application.cvDocumentId) : eq(cvDocuments.applicationId, application.id))
        .orderBy(desc(cvDocuments.createdAt))
        .limit(1),
    ]);

  return {
    ...application,
    education,
    experience,
    skills,
    languages,
    references,
    cvDocument: linkedCvs[0] ?? null,
  };
}
