"use client";

import { useState } from "react";

import {
  providerUiCopy,
  type AiProviderName,
  type SelectableAiProvider,
} from "@/lib/ai/provider-ui";

import { CvReviewPanel, type CvReviewView } from "./cv-review-panel";
import {
  CvRewriteActions,
  type CvRewriteView,
} from "./cv-rewrite-actions";
import { CvUpload, type UploadedCv } from "./cv-upload";
import { SaveCvAction } from "./save-cv-action";
import { Notice, PageHeader, Pill, cardBodyClass, cardClass, cardHeaderClass, primaryButton, spinnerClass } from "./ui";

function responseError(value: unknown, fallback: string) {
  return typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
    ? value.error
    : fallback;
}

export function CvReviewer({
  maxBytes,
  providers,
  defaultProvider,
  initialDocument,
  initialReview,
  initialRewrite,
}: {
  maxBytes: number;
  providers: SelectableAiProvider[];
  defaultProvider: AiProviderName;
  initialDocument: UploadedCv | null;
  initialReview: CvReviewView | null;
  initialRewrite: CvRewriteView | null;
}) {
  const [document, setDocument] =
    useState<UploadedCv | null>(initialDocument);
  const [selectedProviderName, setSelectedProviderName] =
    useState<AiProviderName>(defaultProvider);
  const [runningProvider, setRunningProvider] =
    useState<SelectableAiProvider | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [review, setReview] = useState<CvReviewView | null>(initialReview);
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [rewrite, setRewrite] =
    useState<CvRewriteView | null>(initialRewrite);
  const selectedProvider =
    providers.find((provider) => provider.name === selectedProviderName) ||
    providers.find((provider) => provider.name === "lmstudio") ||
    (() => {
      throw new Error("No AI providers are configured for the CV reviewer.");
    })();
  const selectedCopy = providerUiCopy(selectedProvider);
  const pendingCopy = providerUiCopy(runningProvider || selectedProvider);
  const canRequestReview =
    document?.extractionStatus === "ok" &&
    selectedProvider.available &&
    !reviewing &&
    !rewriting;
  const canRequestRewrite =
    Boolean(document && review) &&
    selectedProvider.available &&
    !reviewing &&
    !rewriting;

  function updateDocument(nextDocument: UploadedCv | null) {
    setDocument(nextDocument);
    setReview(null);
    setReviewError(null);
    setRewrite(null);
    setRewriteError(null);
  }

  async function requestRewrite() {
    if (!document || !review || !canRequestRewrite) return;
    const requestedProvider = selectedProvider;

    setRunningProvider(requestedProvider);
    setRewriting(true);
    setRewriteError(null);

    try {
      const response = await fetch(`/api/cv/${document.id}/rewrite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: requestedProvider.name }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setRewriteError(
          responseError(payload, "The improved CV could not be generated."),
        );
        return;
      }
      setRewrite(payload as CvRewriteView);
    } catch {
      setRewriteError("The improved CV could not reach the server. Try again.");
    } finally {
      setRewriting(false);
      setRunningProvider(null);
    }
  }

  async function requestReview() {
    if (!document || !canRequestReview) return;
    const requestedProvider = selectedProvider;

    setRunningProvider(requestedProvider);
    setReviewing(true);
    setReviewError(null);

    try {
      const response = await fetch(`/api/cv/${document.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: requestedProvider.name }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setReviewError(
          responseError(payload, "The CV review could not be completed."),
        );
        return;
      }
      setReview(payload as CvReviewView);
    } catch {
      setReviewError("The CV review could not reach the server. Please try again.");
    } finally {
      setReviewing(false);
      setRunningProvider(null);
    }
  }

  const stage = !document ? "Upload a CV to begin" : document.extractionStatus !== "ok" ? "This CV could not be read — try another file" : review ? "Reviewed" : "Ready to review";

  return (
    <>
      <PageHeader eyebrow="CV review" title="Review your CV" />

      <div className="mt-8 space-y-6">
        <section aria-labelledby="upload-cv-heading" className={`${cardClass} overflow-hidden`}>
          <div className={cardHeaderClass}>
            <div>
              <h2 id="upload-cv-heading" className="text-base font-semibold text-zinc-950 dark:text-white">Your CV</h2>
              <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{stage}</p>
            </div>
            {document?.extractionStatus === "ok" && <Pill tone={review ? "success" : "info"}>{review ? "Reviewed" : "Text extracted"}</Pill>}
          </div>
          <div className={cardBodyClass}>
            <CvUpload maxBytes={maxBytes} value={document} onChange={updateDocument} disabled={reviewing || rewriting} />

            {document?.extractionStatus === "ok" && document.textPreview ? (
              <details className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900/60">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Extracted text preview</summary>
                <p className="mt-2 line-clamp-4 leading-6 text-zinc-600 dark:text-zinc-400">{document.textPreview}</p>
              </details>
            ) : null}

            <fieldset className="mt-6" disabled={reviewing || rewriting}>
              <legend className="text-sm font-semibold text-zinc-950 dark:text-white">Model</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {providers.map((provider) => {
                  const optionCopy = providerUiCopy(provider);
                  const reasonId = `provider-${provider.name}-reason`;
                  const checked = selectedProviderName === provider.name;
                  return (
                    <label key={provider.name}
                      className={`flex gap-3 rounded-xl border p-3.5 transition-colors ${checked ? "border-blue-500 bg-blue-50/70 dark:border-blue-500 dark:bg-blue-950/30" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"} ${provider.available ? "cursor-pointer hover:border-blue-300 dark:hover:border-blue-800" : "cursor-not-allowed opacity-65"}`}>
                      <input type="radio" name="ai-provider" value={provider.name} checked={checked} onChange={() => setSelectedProviderName(provider.name)} disabled={!provider.available || reviewing || rewriting}
                        aria-describedby={provider.unavailableReason ? reasonId : undefined}
                        className="mt-0.5 size-4 shrink-0 accent-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950" />
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-zinc-950 dark:text-white">{optionCopy.optionTitle}</span>
                        <span className="mt-0.5 block truncate text-xs text-zinc-600 dark:text-zinc-400">{provider.label}</span>
                        {provider.unavailableReason ? <span id={reasonId} className="mt-1 block text-xs leading-5 text-amber-700 dark:text-amber-300">{provider.unavailableReason}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400" aria-live="polite">{selectedCopy.privacyNotice}</p>
            </fieldset>

            {document && !review ? (
              <div className="mt-6 flex flex-col gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
                <p className={`text-sm ${canRequestReview ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>{reviewing ? `Reviewing with ${pendingCopy.optionTitle}. This can take a minute or two.` : canRequestReview ? `Ready: ${document.originalFilename} with ${selectedProvider.label}` : stage}</p>
                <button type="button" onClick={requestReview} disabled={!canRequestReview} className={primaryButton}>
                  {reviewing && <span aria-hidden="true" className={`${spinnerClass} border-white/40 border-t-white`} />}
                  {reviewing ? pendingCopy.pendingLabel : "Review my CV"}
                </button>
              </div>
            ) : null}

            {reviewError ? (
              <Notice tone="danger" role="alert" className="mt-4">
                {reviewError}{" "}
                <button type="button" onClick={requestReview} disabled={!canRequestReview} className="font-semibold underline underline-offset-4 disabled:opacity-60">Try again</button>
              </Notice>
            ) : null}
          </div>
        </section>

        {review ? (
          <CvReviewPanel
            review={review}
            onReviewAgain={requestReview}
            reviewing={reviewing}
            canReview={canRequestReview}
            pendingLabel={pendingCopy.pendingLabel}
            onImprove={requestRewrite}
            improving={rewriting}
            canImprove={canRequestRewrite}
          />
        ) : null}

        {rewriteError ? (
          <Notice tone="danger" role="alert">
            {rewriteError}{" "}
            <button type="button" onClick={requestRewrite} disabled={!canRequestRewrite} className="font-semibold underline underline-offset-4 disabled:opacity-60">Try again</button>
          </Notice>
        ) : null}

        {document && rewrite ? (
          <CvRewriteActions documentId={document.id} rewrite={rewrite}>
            <SaveCvAction key={rewrite.rewriteId} rewriteId={rewrite.rewriteId} initialSaved={rewrite.saved} />
          </CvRewriteActions>
        ) : null}
      </div>
    </>
  );
}
