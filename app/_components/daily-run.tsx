"use client";

import { useState } from "react";
import { jobAgeLabels } from "@/lib/jobs/preferences";
import type { SelectableAiProvider } from "@/lib/ai/provider-ui";
import type { ScheduleView } from "@/lib/pipeline/schedule";
import { cardClass, linkButton, secondaryButton } from "./ui";
import { useNow } from "./pipeline-status";

function when(iso: string, now: number) {
  const at = new Date(iso);
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return days === 0 ? `today at ${time}` : days === 1 ? `tomorrow at ${time}` : days === -1 ? `yesterday at ${time}` : `${at.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}

export function DailyRunCard({ schedule, providers, onChange, onOpenRun }: {
  schedule: ScheduleView | null;
  providers: SelectableAiProvider[];
  onChange: (schedule: ScheduleView | null) => void;
  onOpenRun: (id: string) => void;
}) {
  const now = useNow(Boolean(schedule?.enabled));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(enabled: boolean) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/pipeline/schedule", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not change the daily run.");
      onChange(payload.schedule);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not change the daily run."); }
    finally { setBusy(false); }
  }

  if (!schedule) return <section aria-label="Daily run" className={`${cardClass} px-5 py-4 sm:px-6`}>
    <h2 className="text-base font-semibold text-zinc-950 dark:text-white">Daily run <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 align-middle text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">Off</span></h2>
    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">Use <strong className="font-semibold text-zinc-700 dark:text-zinc-300">Save as daily run</strong> below to run a setup every 24 hours.</p>
  </section>;

  const provider = providers.find((item) => item.name === schedule.provider);
  const due = schedule.nextRunAt && now !== null && Date.parse(schedule.nextRunAt) <= now;
  const details = [
    schedule.profileName ?? "Deleted profile",
    provider?.label ?? schedule.provider,
    `Top ${schedule.maxMatches}`,
    schedule.autoApply ? "saves drafts on Indeed" : "tailors CVs only",
    schedule.preferences.titles.length ? schedule.preferences.titles.join(", ") : "roles from CV",
    schedule.preferences.locations.length ? schedule.preferences.locations.join(", ") : "any location",
    jobAgeLabels[schedule.preferences.maxAgeDays].toLowerCase(),
  ];

  return <section aria-label="Daily run" className={`${cardClass} px-5 py-4 sm:px-6`}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-zinc-950 dark:text-white">Daily run <span className={`ml-1 rounded-full px-2 py-0.5 align-middle text-xs font-semibold ${schedule.enabled ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{schedule.enabled ? "On" : "Off"}</span></h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{details.join(" · ")}</p>
      </div>
      <button type="button" disabled={busy} onClick={() => toggle(!schedule.enabled)} className={secondaryButton}>{busy ? "Saving…" : schedule.enabled ? "Turn off" : "Turn on"}</button>
    </div>
    <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300" suppressHydrationWarning>
      {!schedule.enabled || now === null ? "" : due ? "Next run: within a minute." : `Next run ${when(schedule.nextRunAt!, now)}.`}
      {schedule.lastRunAt && schedule.lastRunId && now !== null && <> Last started {when(schedule.lastRunAt, now)} — <button type="button" onClick={() => onOpenRun(schedule.lastRunId!)} className={linkButton}>view run</button>.</>}
    </p>
    {schedule.enabled && schedule.lastMessage && <p role="status" className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Waiting: {schedule.lastMessage}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
  </section>;
}
