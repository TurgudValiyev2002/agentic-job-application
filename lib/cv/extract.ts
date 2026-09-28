import "server-only";

import path from "node:path";

import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

import { normalizeExtractedText } from "./normalize-extracted-text";

export type ExtractionResult =
  | { status: "ok"; text: string }
  | { status: "failed" | "unsupported"; error: string };

function normalizeWhitespace(value: string) {
  return normalizeExtractedText(value)
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/[\t\u00a0 ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(
  bytes: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  const ext = path.extname(filename).toLowerCase();

  try {
    if (mimeType === "application/pdf" && ext === ".pdf") {
      const pdf = await getDocumentProxy(bytes);
      const result = await extractPdfText(pdf, { mergePages: true });
      const text = normalizeWhitespace(
        Array.isArray(result.text) ? result.text.join("\n\n") : result.text,
      );

      if (text.length < 20) {
        return {
          status: "failed",
          error:
            "This looks like a scanned PDF with no selectable text. OCR is not available, so please upload a text-based PDF, DOCX, TXT, or Markdown file.",
        };
      }

      return { status: "ok", text };
    }

    if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
      ext === ".docx"
    ) {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      const text = normalizeWhitespace(result.value);

      if (!text) {
        return {
          status: "failed",
          error: "No readable text could be extracted from this DOCX file.",
        };
      }

      return { status: "ok", text };
    }

    if (
      (mimeType === "text/plain" || mimeType === "text/markdown") &&
      (ext === ".txt" || ext === ".md")
    ) {
      const text = normalizeWhitespace(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      );

      if (!text) {
        return { status: "failed", error: "The uploaded text file is empty." };
      }

      return { status: "ok", text };
    }

    return {
      status: "unsupported",
      error: "Text extraction is not supported for this file type.",
    };
  } catch (error) {
    return {
      status: "failed",
      error:
        error instanceof Error
          ? `The CV could not be read: ${error.message}`
          : "The CV could not be read.",
    };
  }
}
