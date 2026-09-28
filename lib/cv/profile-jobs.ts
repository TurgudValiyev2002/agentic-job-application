import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { applications, cvDocuments, cvRewrites, db, type Application } from "@/lib/db";
import { getApplication, type LatestApplication } from "@/lib/db/queries";
import { resolveAiProvider, type ActiveAiProvider } from "@/lib/ai/provider";
import { CV_REWRITE_PROMPT_VERSION } from "@/lib/ai/cv-rewrite";
import { runStoredCvRewrite } from "@/lib/ai/run-cv-rewrite";
import { runStoredCvReview } from "@/lib/ai/run-cv-review";
import { renderCvToLatex } from "@/lib/latex/render-cv";
import { buildCvFromApplication } from "./from-application";
import { applySavedContactDetails } from "./contact-details";
import { saveRewriteAsCvDocument } from "./saved-document";

type Claim = Application & { reviewOnly: boolean };
type Document = { id: string; extractedText: string };
type Patch = Partial<Pick<Application, "cvStatus" | "cvError" | "cvDocumentId" | "cvReviewId" | "jobStartedAt">>;

export async function claimProfileJob(): Promise<Claim | null> {
  return db.transaction(async tx => {
    const [row] = await tx.select().from(applications).where(and(isNull(applications.archivedAt),
      inArray(applications.cvStatus, ["generating", "improving", "reviewing"]),
      or(isNull(applications.jobStartedAt), lt(applications.jobStartedAt, sql`now() - interval '30 minutes'`)),
    )).orderBy(applications.updatedAt).limit(1).for("update", { skipLocked: true });
    if (!row) return null;
    const [document] = row.cvDocumentId ? await tx.select().from(cvDocuments).where(eq(cvDocuments.id, row.cvDocumentId)).limit(1) : [];
    // Uploaded files queue a review only, including after a worker interruption.
    const reviewOnly = row.cvStatus === "reviewing" && Boolean(document && !document.sourceRewriteId);
    const [claimed] = await tx.update(applications).set({ jobStartedAt: new Date(), updatedAt: new Date() }).where(eq(applications.id, row.id)).returning();
    return { ...claimed, reviewOnly };
  });
}

async function updateClaim(claim: Claim, patch: Patch) {
  const rows = await db.update(applications).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(applications.id, claim.id), eq(applications.jobStartedAt, claim.jobStartedAt!), isNull(applications.archivedAt)))
    .returning({ id: applications.id });
  return rows.length > 0;
}
async function loadDocument(id: string): Promise<Document> {
  const [row] = await db.select().from(cvDocuments).where(eq(cvDocuments.id, id)).limit(1);
  if (!row?.extractedText || row.extractionStatus !== "ok") throw new Error(row?.extractionError || "CV has no readable text.");
  return { id: row.id, extractedText: row.extractedText };
}
async function generate(profile: LatestApplication): Promise<Document> {
  const content = applySavedContactDetails(buildCvFromApplication(profile), profile);
  const [rewrite] = await db.insert(cvRewrites).values({ applicationId: profile.id, provider: "none", model: "details", promptVersion: CV_REWRITE_PROMPT_VERSION, content, latex: renderCvToLatex(content), status: "completed", completedAt: new Date() }).returning();
  const document = await saveRewriteAsCvDocument(rewrite.id, { select: false });
  return loadDocument(document.id);
}
async function improve(document: Document, targetRole: string, provider: ActiveAiProvider): Promise<Document> {
  const rewrite = await runStoredCvRewrite({ cvDocumentId: document.id, cvReviewId: null, cvText: document.extractedText, review: null, provider, targetRole });
  if (!rewrite.result.ok) throw new Error(rewrite.result.message);
  const saved = await saveRewriteAsCvDocument(rewrite.rewriteId, { select: false });
  return loadDocument(saved.id);
}
async function review(document: Document, provider: ActiveAiProvider) {
  const saved = await runStoredCvReview({ cvDocumentId: document.id, provider });
  if (!saved.result.ok) throw new Error(saved.result.message);
  return saved.reviewId;
}
export const profileJobDependencies = {
  claim: claimProfileJob, update: updateClaim, load: getApplication, document: loadDocument,
  generate, improve, review, provider: (): Promise<ActiveAiProvider> | ActiveAiProvider => resolveAiProvider(),
};

/** A claim timestamp fences every write: saving or retrying invalidates work already in flight. */
export async function processNextProfileJob(dependencies: Partial<typeof profileJobDependencies> = {}) {
  const deps = { ...profileJobDependencies, ...dependencies };
  const claim = await deps.claim();
  if (!claim) return false;
  try {
    const profile = await deps.load(claim.id);
    if (!profile) return true;
    let document: Document;
    let warning: string | null = null;
    if (claim.reviewOnly) {
      document = await deps.document(profile.cvDocumentId!);
    } else {
      if (!await deps.update(claim, { cvStatus: "generating", cvError: null, cvReviewId: null })) return true;
      document = await deps.generate(profile);
      if (!await deps.update(claim, { cvDocumentId: document.id, cvStatus: profile.targetRole?.trim() ? "improving" : "reviewing" })) return true;
      if (profile.targetRole?.trim()) {
        try { document = await deps.improve(document, profile.targetRole.trim(), await deps.provider()); }
        catch (error) { warning = `Improvement skipped: ${error instanceof Error ? error.message : String(error)}`; }
      }
    }
    if (!await deps.update(claim, { cvDocumentId: document.id, cvStatus: "reviewing", cvError: warning, cvReviewId: null })) return true;
    const reviewId = await deps.review(document, await deps.provider());
    await deps.update(claim, { cvReviewId: reviewId, cvStatus: "ready", jobStartedAt: null });
  } catch (error) {
    await deps.update(claim, { cvStatus: "failed", cvError: error instanceof Error ? error.message : String(error), jobStartedAt: null });
  }
  return true;
}
