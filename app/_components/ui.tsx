import type { ReactNode } from "react";

// Shared visual vocabulary. Pages compose these so buttons, cards and pills look the same everywhere.

export const primaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-zinc-950";
export const secondaryButton = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 dark:focus-visible:ring-offset-zinc-950";
export const linkButton = "text-sm font-semibold text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300";
export const inputClass = "mt-1 block w-full rounded-lg border border-zinc-300 bg-white p-2.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white dark:placeholder:text-zinc-600";
export const cardClass = "rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950";
export const cardHeaderClass = "flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6";
export const cardBodyClass = "border-t border-zinc-100 px-5 py-5 dark:border-zinc-800 sm:px-6";
export const cardFooterClass = "flex flex-wrap items-center gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/40 sm:px-6";
export const spinnerClass = "size-4 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin dark:border-blue-900 dark:border-t-blue-400";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export const toneClasses: Record<Tone, { pill: string; dot: string; notice: string }> = {
  neutral: { pill: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300", dot: "bg-zinc-400", notice: "border-zinc-200 bg-zinc-50 text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-200" },
  info: { pill: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300", dot: "bg-blue-500", notice: "border-blue-100 bg-blue-50/70 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200" },
  success: { pill: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300", dot: "bg-emerald-500", notice: "border-emerald-100 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200" },
  warning: { pill: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300", dot: "bg-amber-500", notice: "border-amber-100 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200" },
  danger: { pill: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300", dot: "bg-red-500", notice: "border-red-100 bg-red-50/70 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200" },
};

export function Pill({ tone = "neutral", pulse = false, children }: { tone?: Tone; pulse?: boolean; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${toneClasses[tone].pill}`}>
    <span aria-hidden="true" className={`size-1.5 rounded-full ${toneClasses[tone].dot} ${pulse ? "motion-safe:animate-pulse" : ""}`} />{children}
  </span>;
}

export function Notice({ tone = "neutral", role, className = "", children }: { tone?: Tone; role?: "alert" | "status"; className?: string; children: ReactNode }) {
  return <p role={role} className={`rounded-lg border p-3 text-sm ${toneClasses[tone].notice} ${className}`}>{children}</p>;
}

export function PageHeader({ eyebrow, title, description, meta, actions }: { eyebrow: string; title: string; description?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">{title}</h1>
      {description && <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">{description}</p>}
      {meta && <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{meta}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
  </div>;
}

export function ScoreBadge({ score, label = "evidence coverage" }: { score: number; label?: string }) {
  const tone = score >= 70 ? "bg-emerald-500" : score >= 50 ? "bg-blue-500" : "bg-amber-500";
  return <div className="shrink-0 text-right">
    <p className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-950 dark:text-white">{score}<span className="text-sm font-normal text-zinc-400">/100</span></p>
    <div className="mt-1 ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} /></div>
    <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{label}</p>
  </div>;
}

export function EmptyState({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return <section className={`${cardClass} p-6 text-center sm:p-8`}>
    <p className="text-base font-semibold text-zinc-950 dark:text-white">{title}</p>
    {description && <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
    {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
  </section>;
}

export function sourceLabel(source?: string | null) {
  return source === "arbeitnow" ? "Arbeitnow" : source === "themuse" ? "The Muse" : source === "wellfound" ? "Wellfound" : source === "indeed" ? "Indeed" : source ?? undefined;
}
