import "server-only";
import { eq } from "drizzle-orm";
import { cvDocuments, cvReviews, db } from "@/lib/db";
import { CV_REVIEW_PROMPT_VERSION, reviewCv } from "./cv-review";
import type { ActiveAiProvider } from "./provider";

export async function runStoredCvReview({ cvDocumentId, provider }: { cvDocumentId: string; provider: ActiveAiProvider }) {
  const [document] = await db.select().from(cvDocuments).where(eq(cvDocuments.id, cvDocumentId)).limit(1);
  if (!document || document.extractionStatus !== "ok" || !document.extractedText) throw new Error(document?.extractionError || "CV has no readable text.");
  const [row] = await db.insert(cvReviews).values({ cvDocumentId, status: "running", provider: provider.providerName, model: provider.model, promptVersion: CV_REVIEW_PROMPT_VERSION }).returning();
  try {
    const result = await reviewCv(document.extractedText, provider);
    const completedAt = new Date();
    await db.update(cvReviews).set(result.ok
      ? { status: "completed", ...result.review, rawResponse: result.rawResponse, durationMs: result.durationMs, completedAt }
      : { status: "failed", errorMessage: result.message, durationMs: result.durationMs, completedAt }
    ).where(eq(cvReviews.id, row.id));
    return { reviewId: row.id, result, completedAt };
  } catch (error) {
    await db.update(cvReviews).set({ status: "failed", errorMessage: error instanceof Error ? error.message : String(error), completedAt: new Date() }).where(eq(cvReviews.id, row.id));
    throw error;
  }
}
