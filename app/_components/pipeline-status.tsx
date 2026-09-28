"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { PipelineRunView, PipelineStatus } from "@/lib/pipeline/types";

export const statusMeta: Record<PipelineStatus, { label: string; dot: string; badge: string }> = {
  queued: { label: "Queued", dot: "bg-zinc-400", badge: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  running: { label: "Running", dot: "bg-blue-500", badge: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  completed: { label: "Completed", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" },
  partial: { label: "Partial", dot: "bg-amber-500", badge: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  failed: { label: "Failed", dot: "bg-red-500", badge: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

export function StatusBadge({ status, pulse = false, children }: { status: PipelineStatus; pulse?: boolean; children?: React.ReactNode }) {
  const meta = statusMeta[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.badge}`}>
    <span aria-hidden="true" className={`size-1.5 rounded-full ${meta.dot} ${pulse ? "motion-safe:animate-pulse" : ""}`} />{children ?? meta.label}
  </span>;
}

export function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function relativeTime(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

// Wall-clock in ms; ticks every second while `active`. Null on the server and during hydration so markup matches.
let nowValue: number | null = null;
export function useNow(active: boolean) {
  const subscribe = useCallback((onChange: () => void) => {
    nowValue = Date.now();
    if (!active) return () => {};
    const timer = setInterval(() => { nowValue = Date.now(); onChange(); }, 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return useSyncExternalStore(subscribe, () => nowValue, () => null);
}

export function runSummary(run: PipelineRunView) {
  const ready = run.state.jobs.filter((job) => job.status === "completed").length;
  const failed = run.state.jobs.filter((job) => job.status === "failed").length;
  return { ready, failed, total: run.state.jobs.length };
}
