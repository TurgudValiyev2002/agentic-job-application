import { createHash } from "node:crypto";
import path from "node:path";

import { cvDocuments, db } from "@/lib/db";
import { extractText } from "@/lib/cv/extract";
import { deleteFile, saveFile } from "@/lib/storage";

const allowedMimeTypes: Record<string, ReadonlySet<string>> = {
  ".pdf": new Set(["application/pdf"]),
  ".docx": new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]),
  ".txt": new Set(["text/plain"]),
  ".md": new Set(["text/plain", "text/markdown"]),
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonError(error: string, status: number) {
  return Response.json({ error }, { status });
}

function normalizeDisplayFilename(filename: string) {
  const leaf = filename.replaceAll("\\", "/").split("/").at(-1) ?? "";
  return leaf.replaceAll("..", ".").trim();
}

function magicMatches(bytes: Uint8Array, ext: string) {
  if (!bytes.length) return true;

  if (ext === ".pdf") {
    return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  }

  if (ext === ".docx") {
    return (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    );
  }

  try {
    const sample = bytes.slice(0, 4096);
    return (
      !sample.includes(0) &&
      new TextDecoder("utf-8", { fatal: true }).decode(sample).length >= 0
    );
  } catch {
    return false;
  }
}

// This endpoint is public and unauthenticated. Add authentication and rate
// limiting here before exposing it in a production environment.
export async function uploadCv(request: Request) {
  const maxBytes = positiveInteger(process.env.CV_MAX_BYTES, 10_485_760);
  const contentLength = Number(request.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return jsonError(`The CV must be no larger than ${maxBytes} bytes.`, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError("The multipart upload could not be read.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return jsonError('Upload a CV using the multipart field named "file".', 400);
  }

  if (file.size > maxBytes) {
    return jsonError(`The CV must be no larger than ${maxBytes} bytes.`, 413);
  }

  const originalFilename = normalizeDisplayFilename(file.name);
  const ext = path.extname(originalFilename).toLowerCase();
  const mimeTypes = allowedMimeTypes[ext];

  if (!mimeTypes) {
    return jsonError("Upload a .pdf, .docx, .txt, or .md CV.", 415);
  }

  if (!mimeTypes.has(file.type)) {
    return jsonError(
      `The declared file type ${file.type || "(missing)"} is not allowed for ${ext}.`,
      415,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!magicMatches(bytes, ext)) {
    return jsonError(
      `The file contents do not match the ${ext} extension.`,
      415,
    );
  }

  if (!bytes.length) {
    return jsonError("The uploaded CV is empty.", 400);
  }

  // PDF.js may transfer and detach the supplied buffer while extracting text.
  const byteSize = bytes.byteLength;
  const checksum = createHash("sha256").update(bytes).digest("hex");
  let storagePath: string;

  try {
    storagePath = await saveFile(bytes, ext);
  } catch (error) {
    console.error("Failed to store CV", error);
    return jsonError("The CV could not be stored. Please try again.", 500);
  }

  const extraction = await extractText(bytes, file.type, originalFilename);

  try {
    const [document] = await db
      .insert(cvDocuments)
      .values({
        originalFilename,
        mimeType: file.type,
        byteSize,
        storagePath,
        checksum,
        extractedText: extraction.status === "ok" ? extraction.text : null,
        extractionStatus: extraction.status,
        extractionError: extraction.status === "ok" ? null : extraction.error,
      })
      .returning({
        id: cvDocuments.id,
        originalFilename: cvDocuments.originalFilename,
        byteSize: cvDocuments.byteSize,
        extractionStatus: cvDocuments.extractionStatus,
        extractionError: cvDocuments.extractionError,
        extractedText: cvDocuments.extractedText,
      });

    return Response.json(
      {
        id: document.id,
        originalFilename: document.originalFilename,
        byteSize: document.byteSize,
        extractionStatus: document.extractionStatus,
        extractionError: document.extractionError,
        textPreview: document.extractedText?.slice(0, 300) ?? "",
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to persist CV metadata", error);
    await deleteFile(storagePath).catch((cleanupError) =>
      console.error("Failed to clean up CV after database error", cleanupError),
    );
    return jsonError("The CV upload could not be saved. Please try again.", 500);
  }
}
