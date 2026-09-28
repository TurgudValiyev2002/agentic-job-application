"use client";

import { ScoreBadge, cardClass, cardFooterClass, primaryButton, secondaryButton, spinnerClass } from "./ui";

export type CvReviewView = {
  reviewId: string;
  provider: string;
  model: string;
  truncated?: boolean;
  overallScore: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  suggestions: Array<{
    section: string;
    issue: string;
    suggestion: string;
  }>;
  completedAt?: {
    iso: string;
    text: string;
  };
};

export function CvReviewPanel({
  review,
  onReviewAgain,
  reviewing,
  canReview,
  pendingLabel,
  onImprove,
  improving,
  canImprove,
}: {
  review: CvReviewView;
  onReviewAgain: () => void;
  reviewing: boolean;
  canReview: boolean;
  pendingLabel: string;
  onImprove: () => void;
  improving: boolean;
  canImprove: boolean;
}) {
  const via = review.provider === "openrouter" ? "via OpenRouter" : review.provider === "lmstudio" ? "locally with LM Studio" : review.provider === "ollama" ? "with Ollama" : `via ${review.provider}`;
  return (
    <section className={`${cardClass} overflow-hidden`} aria-labelledby="cv-review-heading">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">CV review</p>
            <h2 id="cv-review-heading" className="mt-1 text-xl font-semibold tracking-tight text-zinc-950 dark:text-white">Your feedback</h2>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {review.completedAt ? <>Ran <time dateTime={review.completedAt.iso}>{review.completedAt.text}</time> · </> : null}
              {review.model} {via}{review.truncated ? " · long CV shortened for the model" : ""}
            </p>
          </div>
          <ScoreBadge score={review.overallScore} label="overall" />
        </div>
        <p className="mt-4 text-sm leading-6 text-zinc-700 dark:text-zinc-300">{review.summary}</p>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <FeedbackList title="What works well" items={review.strengths} tone="positive" />
          <FeedbackList title="What could be stronger" items={review.weaknesses} tone="neutral" />
        </div>

        <div className="mt-6">
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">Suggestions by section</h3>
          {review.suggestions.length ? (
            <div className="mt-3 space-y-3">
              {review.suggestions.map((item, index) => (
                <article key={`${item.section}-${index}`} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/70">
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.section}</h4>
                  <dl className="mt-2 space-y-2 text-sm leading-6">
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Issue</dt><dd className="text-zinc-600 dark:text-zinc-400">{item.issue}</dd></div>
                    <div className="flex gap-2"><dt className="w-14 shrink-0 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Try</dt><dd className="text-zinc-700 dark:text-zinc-300">{item.suggestion}</dd></div>
                  </dl>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No section-specific suggestions were returned.</p>
          )}
        </div>
      </div>

      <div className={cardFooterClass}>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={onReviewAgain} disabled={!canReview} className={secondaryButton}>
            {reviewing && <span aria-hidden="true" className={spinnerClass} />}
            {reviewing ? pendingLabel : "Review again"}
          </button>
          <button type="button" onClick={onImprove} disabled={!canImprove} className={primaryButton}>
            {improving && <span aria-hidden="true" className={`${spinnerClass} border-white/40 border-t-white`} />}
            {improving ? "Improving…" : "Improve CV"}
          </button>
        </div>
      </div>
    </section>
  );
}

function FeedbackList({ title, items, tone }: { title: string; items: string[]; tone: "positive" | "neutral" }) {
  const marker = tone === "positive" ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400";
  return (
    <div>
      <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">{title}</h3>
      {items.length ? (
        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-2 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
              <span className={`shrink-0 font-bold ${marker}`} aria-hidden="true">{tone === "positive" ? "✓" : "•"}</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">None noted.</p>
      )}
    </div>
  );
}
