"use client";

import { useState, type ReactNode } from "react";

import { CvContentPreview } from "./cv-content-preview";

import type { CvContent } from "@/lib/cv/content";

export type CvRewriteView = {
  rewriteId: string;
  provider: string;
  model: string;
  content: CvContent;
  counts: {
    experience: number;
    projects: number;
    education: number;
  };
  completedAt?: {
    iso: string;
    text: string;
  };
  /** Whether this rewrite was saved as a CV document and is the pipeline's current CV. */
  saved?: { documentId: string; isPipelineCv: boolean } | null;
};

const PDF_TIMEOUT_MS = 70_000;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function CvRewriteActions({
  rewrite,
  title = "Improved CV",
  children,
}: {
  documentId?: string;
  title?: string;
  rewrite: CvRewriteView;
  /** Extra actions rendered under the preview, such as saving the CV for the pipeline. */
  children?: ReactNode;
}) {
  const [compilingPdf, setCompilingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const texUrl = `/api/rewrites/${rewrite.rewriteId}/cv.tex`;
  const pdfUrl = `/api/rewrites/${rewrite.rewriteId}/cv.pdf`;

  async function downloadPdf() {
    setCompilingPdf(true);
    setPdfError(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);

    try {
      const response = await fetch(pdfUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error || "PDF compilation failed.");
      }

      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename =
        disposition.match(/filename="([^"]+)"/i)?.[1] ?? "improved-cv.pdf";
      downloadBlob(await response.blob(), filename);
    } catch (error) {
      setPdfError(
        `${
          error instanceof DOMException && error.name === "AbortError"
            ? "PDF generation took too long."
            : error instanceof Error
              ? error.message
              : "PDF compilation failed."
        } Download .tex is still available.`,
      );
    } finally {
      window.clearTimeout(timeout);
      setCompilingPdf(false);
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-zinc-950 dark:text-white">
            {title}
          </p>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {rewrite.model} · {rewrite.counts.experience} experience · {rewrite.counts.projects}{" "}
            projects · {rewrite.counts.education} education
            {rewrite.completedAt ? (
              <>
                {" "}·{" "}
                <time dateTime={rewrite.completedAt.iso}>
                  {rewrite.completedAt.text}
                </time>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={texUrl}
            className="inline-flex min-h-10 items-center justify-center rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus:ring-offset-zinc-950"
          >
            Download .tex
          </a>
          <button
            type="button"
            onClick={downloadPdf}
            disabled={compilingPdf}
            className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:focus:ring-offset-zinc-950"
          >
            {compilingPdf ? "Generating PDF…" : "Download PDF"}
          </button>
        </div>
      </div>
      {!!rewrite.content.addedSkills?.length && <p className="mt-3 text-sm text-amber-800 dark:text-amber-300">Added to Skills for this role: {rewrite.content.addedSkills.map(item => item.skill).join(", ")}. These came from the posting and were not evidenced in the original CV.</p>}
      <CvContentPreview content={rewrite.content} />
      {pdfError ? (
        <p className="mt-3 text-xs text-red-800 dark:text-red-300" role="alert">
          {pdfError}
        </p>
      ) : null}
      {children}
    </div>
  );
}
