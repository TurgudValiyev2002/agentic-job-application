import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull } from "drizzle-orm";

import { cvDocuments, cvRewrites, db, type CvDocument } from "@/lib/db";
import { deleteFile, saveFile } from "@/lib/storage";

import { cvContentSchema } from "./content";
import { cvDownloadBaseName } from "./download-filename";
import { renderCvToText } from "./render-text";

/** A CV the pipeline can read: an upload, or an improved CV written out as text. */
export type SavedCvDocument = {
  id: string;
  originalFilename: string;
  byteSize: number;
  extractionStatus: CvDocument["extractionStatus"];
  extractionError: string | null;
  textPreview: string;
  /** Where the document came from when it was not uploaded, for example "Improved CV · gemma4:26b". */
  sourceLabel: string | null;
  createdAt: string;
  selectedAt: string | null;
};

export class SavedCvError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

const documentColumns = {
  id: cvDocuments.id,
  checksum: cvDocuments.checksum,
  originalFilename: cvDocuments.originalFilename,
  byteSize: cvDocuments.byteSize,
  extractionStatus: cvDocuments.extractionStatus,
  extractionError: cvDocuments.extractionError,
  extractedText: cvDocuments.extractedText,
  createdAt: cvDocuments.createdAt,
  selectedAt: cvDocuments.selectedAt,
  sourceProvider: cvRewrites.provider,
  sourceModel: cvRewrites.model,
};

function sourceLabel(provider: string | null, model: string | null) {
  if (!provider) return null;
  return provider === "none" ? "Built from your details" : `Improved CV · ${model}`;
}

type DocumentRow = Awaited<ReturnType<typeof documentQuery>>[number];

function toView(row: DocumentRow): SavedCvDocument {
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    byteSize: row.byteSize,
    extractionStatus: row.extractionStatus,
    extractionError: row.extractionError ?? null,
    textPreview: row.extractedText?.slice(0, 300) ?? "",
    sourceLabel: sourceLabel(row.sourceProvider, row.sourceModel),
    createdAt: row.createdAt.toISOString(),
    selectedAt: row.selectedAt?.toISOString() ?? null,
  };
}

function documentQuery() {
  return db.select(documentColumns).from(cvDocuments)
    .leftJoin(cvRewrites, eq(cvRewrites.id, cvDocuments.sourceRewriteId));
}

/** The CV the pipeline preselects: whichever the user chose most recently. */
export async function getSelectedCvDocument() {
  const [row] = await documentQuery()
    .where(and(isNotNull(cvDocuments.selectedAt), eq(cvDocuments.extractionStatus, "ok")))
    .orderBy(desc(cvDocuments.selectedAt)).limit(1);
  return row ? toView(row) : null;
}

/** Remembers this CV for the next pipeline run. Returns false when it does not exist. */
export async function selectCvDocument(id: string) {
  const rows = await db.update(cvDocuments).set({ selectedAt: new Date(), updatedAt: new Date() })
    .where(eq(cvDocuments.id, id)).returning({ id: cvDocuments.id });
  return rows.length > 0;
}

/** The document already written from this rewrite, if any, with whether it is the pipeline's current CV. */
export async function documentForRewrite(rewriteId: string) {
  const [[row], selected] = await Promise.all([
    documentQuery().where(eq(cvDocuments.sourceRewriteId, rewriteId)).orderBy(desc(cvDocuments.createdAt)).limit(1),
    getSelectedCvDocument(),
  ]);
  if (!row) return null;
  return { document: toView(row), isPipelineCv: selected?.id === row.id };
}

/**
 * Writes a completed rewrite out as a readable CV document so the pipeline, the
 * reviewer and the job matcher can use it like an upload. The same content is
 * never stored twice: an existing document with the same checksum is reused.
 */
export async function saveRewriteAsCvDocument(rewriteId: string, { select = true } = {}) {
  const [rewrite] = await db.select({
    status: cvRewrites.status, content: cvRewrites.content, provider: cvRewrites.provider,
    applicationId: cvRewrites.applicationId, sourceDocumentApplicationId: cvDocuments.applicationId,
  }).from(cvRewrites).leftJoin(cvDocuments, eq(cvDocuments.id, cvRewrites.cvDocumentId))
    .where(eq(cvRewrites.id, rewriteId)).limit(1);
  const content = cvContentSchema.safeParse(rewrite?.content);
  if (!rewrite || rewrite.status !== "completed" || !content.success) {
    throw new SavedCvError("CV rewrite not found.", 404);
  }

  const text = renderCvToText(content.data);
  const bytes = new TextEncoder().encode(text);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const selectedAt = select ? new Date() : null;

  const [existing] = await db.select({ id: cvDocuments.id }).from(cvDocuments)
    .where(and(eq(cvDocuments.sourceRewriteId, rewriteId), eq(cvDocuments.checksum, checksum)))
    .orderBy(desc(cvDocuments.createdAt)).limit(1);
  let id = existing?.id;

  if (id) {
    if (select) await selectCvDocument(id);
  } else {
    const storagePath = await saveFile(bytes, ".md");
    const suffix = rewrite.provider === "none" ? "cv-from-details" : "improved-cv";
    try {
      [{ id }] = await db.insert(cvDocuments).values({
        originalFilename: `${cvDownloadBaseName(content.data.name)}-${suffix}.md`,
        mimeType: "text/markdown", byteSize: bytes.byteLength, storagePath, checksum,
        extractedText: text, extractionStatus: "ok", sourceRewriteId: rewriteId,
        applicationId: rewrite.applicationId ?? rewrite.sourceDocumentApplicationId, selectedAt,
      }).returning({ id: cvDocuments.id });
    } catch (error) {
      await deleteFile(storagePath).catch((cleanupError) => console.error("Failed to clean up CV after database error", cleanupError));
      throw error;
    }
  }

  const [row] = await documentQuery().where(eq(cvDocuments.id, id)).limit(1);
  return toView(row);
}
