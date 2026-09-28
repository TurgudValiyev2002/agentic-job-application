import "server-only";

import type { ReportAgentProgress } from "./progress";

import { eq } from "drizzle-orm";

import { applicantProfiles, applications, cvDocuments, cvRewrites, db } from "@/lib/db";
import { applySavedContactDetails } from "@/lib/cv/contact-details";
import { renderCvToLatex } from "@/lib/latex/render-cv";
import {
  CV_REWRITE_PROMPT_VERSION,
  rewriteCv,
  type CvRewriteJobContext,
  type CvRewriteReviewInput,
} from "./cv-rewrite";
import type { ActiveAiProvider } from "./provider";

export async function runStoredCvRewrite({
  cvDocumentId,
  cvReviewId,
  jobPostingId,
  cvText,
  review,
  provider,
  jobContext,
  onProgress,
  targetRole,
  lenient = false,
}: {
  cvDocumentId: string;
  cvReviewId: string | null;
  targetRole?: string;
  jobPostingId?: string;
  cvText: string;
  review: CvRewriteReviewInput | null;
  provider: ActiveAiProvider;
  jobContext?: CvRewriteJobContext;
  onProgress?: ReportAgentProgress;
  /** Remove what cannot be verified instead of failing (the pipeline's second tailoring try). */
  lenient?: boolean;
}) {
  const [rewriteRow] = await db
    .insert(cvRewrites)
    .values({
      cvDocumentId,
      cvReviewId,
      ...(jobPostingId ? { jobPostingId } : {}),
      status: "running",
      provider: provider.providerName,
      model: provider.model,
      promptVersion: CV_REWRITE_PROMPT_VERSION,
    })
    .returning({ id: cvRewrites.id });

  const result = await rewriteCv(cvText, review, provider, jobContext, onProgress, targetRole, { lenient });
  const completedAt = new Date();

  if (!result.ok) {
    await db
      .update(cvRewrites)
      .set({
        status: "failed",
        errorMessage: result.message,
        ...("rawResponse" in result && result.rawResponse ? { rawResponse: result.rawResponse } : {}),
        durationMs: result.durationMs,
        completedAt,
      })
      .where(eq(cvRewrites.id, rewriteRow.id));

    return { rewriteId: rewriteRow.id, result, completedAt } as const;
  }

  await onProgress?.({ phase: "saving", message: "Validation passed. Preparing the CV preview and downloads." });
  // The saved contact details win over whatever the source CV carried, after the model output has been validated.
  const content = applySavedContactDetails(result.rewrite, await savedContactDetails(cvDocumentId));
  const latex = renderCvToLatex(content);
  await db
    .update(cvRewrites)
    .set({
      status: "completed",
      content,
      latex,
      rawResponse: result.rawResponse,
      durationMs: result.durationMs,
      completedAt,
    })
    .where(eq(cvRewrites.id, rewriteRow.id));

  return { rewriteId: rewriteRow.id, result: { ...result, rewrite: content }, completedAt } as const;
}

/** Linked Details are authoritative, including deliberately cleared contact fields. */
async function savedContactDetails(cvDocumentId: string): Promise<{ email?: string | null; phone?: string | null }> {
  const [document] = await db.select({ applicationId: cvDocuments.applicationId }).from(cvDocuments).where(eq(cvDocuments.id, cvDocumentId)).limit(1);
  if (document?.applicationId) {
    const [intake] = await db.select({ email: applications.email, phone: applications.phone }).from(applications).where(eq(applications.id, document.applicationId)).limit(1);
    return intake ?? {};
  }
  const [saved] = await db.select({ profile: applicantProfiles.profile }).from(applicantProfiles).where(eq(applicantProfiles.cvDocumentId, cvDocumentId)).limit(1);
  return saved?.profile ?? {};
}
