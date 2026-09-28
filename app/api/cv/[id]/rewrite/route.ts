import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { cvReviewSchema } from "@/lib/ai/cv-review";
import {
  parseRewriteRequest,
  resolveRewriteProvider,
  rewriteFailureStatus,
} from "@/lib/ai/cv-rewrite-request";
import { runStoredCvRewrite } from "@/lib/ai/run-cv-rewrite";
import { cvDocuments, cvReviews, db } from "@/lib/db";

const rewriteReviewSchema = cvReviewSchema.pick({
  summary: true,
  weaknesses: true,
  suggestions: true,
});

// This endpoint is public and unauthenticated. Add authentication and rate
// limiting here before exposing it in a production environment.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "CV document not found." }, { status: 404 });
  }

  const [document] = await db
    .select({
      extractionStatus: cvDocuments.extractionStatus,
      extractionError: cvDocuments.extractionError,
      extractedText: cvDocuments.extractedText,
    })
    .from(cvDocuments)
    .where(eq(cvDocuments.id, id))
    .limit(1);

  if (!document) {
    return Response.json({ error: "CV document not found." }, { status: 404 });
  }

  if (document.extractionStatus !== "ok" || !document.extractedText) {
    return Response.json(
      {
        error:
          document.extractionError ||
          "CV improvement is unavailable because text extraction did not succeed.",
      },
      { status: 409 },
    );
  }

  const [review] = await db
    .select({
      id: cvReviews.id,
      summary: cvReviews.summary,
      weaknesses: cvReviews.weaknesses,
      suggestions: cvReviews.suggestions,
    })
    .from(cvReviews)
    .where(
      and(
        eq(cvReviews.cvDocumentId, id),
        eq(cvReviews.status, "completed"),
      ),
    )
    .orderBy(desc(cvReviews.createdAt))
    .limit(1);

  if (!review) {
    return Response.json(
      { error: "Complete a CV review before generating an improved CV." },
      { status: 409 },
    );
  }

  const parsedReview = rewriteReviewSchema.safeParse({
    summary: review.summary,
    weaknesses: review.weaknesses,
    suggestions: review.suggestions,
  });
  if (!parsedReview.success) {
    return Response.json(
      { error: "The completed CV review does not contain usable feedback." },
      { status: 409 },
    );
  }

  const parsedRequest = await parseRewriteRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.message }, { status: 400 });
  }

  const selectedProvider = await resolveRewriteProvider(parsedRequest.provider);
  if (!selectedProvider.ok) {
    return Response.json(
      { error: selectedProvider.message },
      { status: selectedProvider.status },
    );
  }

  const stored = await runStoredCvRewrite({
    cvDocumentId: id,
    cvReviewId: review.id,
    cvText: document.extractedText,
    review: parsedReview.data,
    provider: selectedProvider.provider,
  });
  const { result } = stored;

  if (!result.ok) {
    return Response.json(
      { error: result.message, kind: result.kind, rewriteId: stored.rewriteId },
      { status: rewriteFailureStatus(result) },
    );
  }

  return Response.json({
    rewriteId: stored.rewriteId,
    provider: result.providerName,
    model: result.model,
    content: result.rewrite,
    truncated: result.truncated,
    counts: {
      experience: result.rewrite.experience.length,
      projects: result.rewrite.projects.length,
      education: result.rewrite.education.length,
    },
  });
}
