"use client";

import { acceptedArrangements, acceptedSeniorities, defaultSearchPreferences, jobAgeLabels, seniorityLabels, workArrangementLabels, type JobAgeDays, type SearchPreferences } from "@/lib/jobs/preferences";
import { SearchPreferencesFields, cleanSearchPreferences } from "./search-preferences";
import { workingStatuses } from "@/lib/job-applications/types";
import { ApplyToJob } from "./apply-to-job";
import { MatchEvidence } from "./match-evidence";
import { GapSummary } from "./gap-summary";
import { IndeedSession } from "./indeed-session";
import { useEffect, useRef, useState } from "react";
import type { AiProviderName, SelectableAiProvider } from "@/lib/ai/provider-ui";
import { pipelineIsActive, type PipelineJob, type PipelineRunView } from "@/lib/pipeline/types";
import { DEFAULT_MAX_MATCHES, maxMatchesOptions } from "@/lib/pipeline/options";
import { profileStatus, useProfiles, type ProfileView } from "./profile-list";
import Link from "next/link";
import { CvUpload } from "./cv-upload";
import { PipelineLiveProgress } from "./pipeline-live-progress";
import { CvRewriteActions } from "./cv-rewrite-actions";
import { relativeTime, runSummary, statusMeta, useNow } from "./pipeline-status";
import { cardClass, inputClass, primaryButton, secondaryButton, sourceLabel } from "./ui";
import { DailyRunCard } from "./daily-run";
import type { ScheduleView } from "@/lib/pipeline/schedule";


const arrangementSummary = (preferences: SearchPreferences | undefined) => { const accepted = acceptedArrangements(preferences ?? defaultSearchPreferences); return accepted.length ? accepted.map((item) => workArrangementLabels[item]).join(", ") : "Any arrangement"; };
const senioritySummary = (preferences: SearchPreferences | undefined) => { const accepted = acceptedSeniorities(preferences ?? defaultSearchPreferences); return accepted.length ? accepted.map((item) => seniorityLabels[item]).join(", ") : "From CV"; };

export function PipelinePanel({ maxBytes, providers, defaultProvider, initialRuns, initialRunId, initialProfiles, defaultMaxAgeDays, initialSchedule }: {
  maxBytes: number;
  /** Starting value for the "Posted within" setting (JOB_MAX_AGE_DAYS); the user can change it per run. */
  defaultMaxAgeDays: JobAgeDays;
  providers: SelectableAiProvider[];
  defaultProvider: AiProviderName;
  initialRuns: PipelineRunView[];
  initialRunId?: string;
  initialProfiles: ProfileView[];
  /** The saved daily run; its settings also prefill the New run form. */
  initialSchedule: ScheduleView | null;
}) {
  const [schedule, setSchedule] = useState(initialSchedule);
  const [preferences, setPreferences] = useState<SearchPreferences>(initialSchedule?.preferences ?? { ...defaultSearchPreferences, maxAgeDays: defaultMaxAgeDays });
  const { profiles, refresh: refreshProfiles, error: profilesError } = useProfiles(initialProfiles);
  // Profiles arrive most recently selected first: the composer starts on the one marked "Selected for pipeline".
  const [profileId, setProfileId] = useState(initialProfiles[0]?.id ?? "");
  const [selecting, setSelecting] = useState(false);
  const selectedProfile = profiles.find(profile => profile.id === profileId);
  const document = selectedProfile?.cvStatus === "ready" && selectedProfile.cvDocumentId
    ? { id: selectedProfile.cvDocumentId, originalFilename: selectedProfile.name, extractionStatus: "ok" } : null;
  const [providerName, setProviderName] = useState(initialSchedule && providers.some(item => item.name === initialSchedule.provider) ? initialSchedule.provider : defaultProvider);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedId, setSelectedId] = useState(initialRuns.some((item) => item.id === initialRunId) ? initialRunId! : initialRuns[0]?.id ?? "");
  const [composerOpen, setComposerOpen] = useState(initialRuns.length === 0);
  const [autoApply, setAutoApply] = useState(initialSchedule?.autoApply ?? true);
  const [maxMatches, setMaxMatches] = useState<number>(initialSchedule?.maxMatches ?? DEFAULT_MAX_MATCHES);
  const [starting, setStarting] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleNotice, setScheduleNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLElement>(null);
  const requestId = useRef<string | null>(null);
  const provider = providers.find((item) => item.name === providerName) ?? providers[0];
  const run = runs.find((item) => item.id === selectedId);
  const active = Boolean(run && pipelineIsActive(run.status));
  const applicationsActive = Boolean(run?.state.jobs.some(job => job.applicationId && (!job.applicationStatus || workingStatuses.includes(job.applicationStatus))));
  const now = useNow(runs.some((item) => pipelineIsActive(item.status)));

  useEffect(() => {
    if (!selectedId || (!active && !applicationsActive)) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`/api/pipeline/${selectedId}`, { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not refresh pipeline progress.");
        if (!stopped) {
          setRuns((current) => current.map((item) => item.id === payload.id ? payload : item));
          setPollError(null);
        }
      } catch (error) {
        if (!stopped) setPollError(error instanceof Error ? error.message : "Progress is temporarily unavailable. Reconnecting…");
      } finally {
        if (!stopped) timer = setTimeout(poll, 1_000);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); controller.abort(); };
  }, [selectedId, active, applicationsActive]);

  useEffect(() => {
    if (active) progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId, active]);

  // While the daily run is on, notice when the worker starts it and show that run.
  const scheduleEnabled = Boolean(schedule?.enabled);
  const knownRunIds = useRef(new Set(initialRuns.map((item) => item.id)));
  useEffect(() => {
    if (!scheduleEnabled) return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch("/api/pipeline/schedule", { cache: "no-store" });
        if (!response.ok) return;
        const { schedule: next } = await response.json() as { schedule: ScheduleView | null };
        setSchedule(next);
        if (next?.lastRunId && !knownRunIds.current.has(next.lastRunId)) await openRun(next.lastRunId);
      } catch { /* The next poll retries. */ }
    }, 30_000);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openRun only reads setters and refs.
  }, [scheduleEnabled]);

  async function openRun(id: string) {
    if (!knownRunIds.current.has(id)) {
      const response = await fetch(`/api/pipeline/${id}`, { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as PipelineRunView;
      knownRunIds.current.add(id);
      setRuns((current) => [payload, ...current.filter((item) => item.id !== id)].slice(0, 10));
    }
    selectRun(id);
  }

  async function saveDailyRun() {
    if (!profileId || savingSchedule) return;
    setSavingSchedule(true); setError(null); setScheduleNotice(null);
    try {
      const response = await fetch("/api/pipeline/schedule", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId, provider: provider.name, autoApply, maxMatches, preferences: cleanSearchPreferences(preferences) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not save the daily run.");
      setSchedule(payload.schedule);
      setScheduleNotice(schedule ? "Daily run updated." : "Daily run saved.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save the daily run."); }
    finally { setSavingSchedule(false); }
  }

  function selectRun(id: string) {
    setSelectedId(id);
    setPollError(null);
    window.history.replaceState(null, "", `/pipeline?run=${encodeURIComponent(id)}`);
  }

  function openComposer() {
    setComposerOpen(true);
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function selectProfile(id: string) {
    setSelecting(true); setError(null);
    try {
      const response = await fetch(`/api/profiles/${id}/select`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setProfileId(id); requestId.current = null; await refreshProfiles();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setSelecting(false); }
  }

  async function start() {
    if (!document || document.extractionStatus !== "ok" || starting || selecting || !provider.available) return;
    setStarting(true);
    setError(null);
    requestId.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/pipeline", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cvDocumentId: document.id, profileId, provider: provider.name, requestId: requestId.current, autoApply, maxMatches, preferences: cleanSearchPreferences(preferences) }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not start the pipeline.");
      knownRunIds.current.add(payload.id);
      setRuns((current) => [payload, ...current.filter((item) => item.id !== payload.id)].slice(0, 10));
      selectRun(payload.id);
      setComposerOpen(false);
      requestId.current = null;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not start the pipeline. Please retry.");
    } finally { setStarting(false); }
  }

  const canStart = !starting && !selecting && !active && document?.extractionStatus === "ok" && provider.available;
  const readiness = !document ? "Choose a ready profile to begin" : document.extractionStatus !== "ok" ? "This CV could not be read — try another file" : !provider.available ? "The selected model is unavailable" : `Ready: ${document.originalFilename} with ${provider.label}`;

  return (
    <div className="mt-8 space-y-6">
      <IndeedSession />
      <DailyRunCard schedule={schedule} providers={providers} onChange={setSchedule} onOpenRun={(id) => void openRun(id)} />
      <section ref={composerRef} aria-label="Start a new run" className={`${cardClass} scroll-mt-6 overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div>
            <h2 className="text-base font-semibold text-zinc-950 dark:text-white">New run</h2>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{active ? "A run is in progress." : readiness}</p>
          </div>
          {runs.length > 0 && !active && <button type="button" aria-expanded={composerOpen} onClick={() => composerOpen ? setComposerOpen(false) : openComposer()} className={composerOpen ? secondaryButton : primaryButton}>{composerOpen ? "Hide" : "Start a new run"}</button>}
        </div>

        {active && run ? <dl className="grid gap-x-6 gap-y-3 border-t border-zinc-100 px-5 py-4 text-sm sm:grid-cols-2 sm:px-6 dark:border-zinc-800">
          <Summary label="CV" value={run.filename} />
          {run.state.profileName && <Summary label="Profile" value={run.state.profileName} />}
          <Summary label="Model" value={run.model} />
          <Summary label="Roles" value={run.state.preferences?.titles.length ? run.state.preferences.titles.join(", ") : "From your CV"} />
          <Summary label="Locations" value={run.state.preferences?.locations.length ? run.state.preferences.locations.join(", ") : "International · no location preference"} />
          <Summary label="Arrangement" value={arrangementSummary(run.state.preferences)} />
          <Summary label="Seniority" value={senioritySummary(run.state.preferences)} />
          <Summary label="Posted within" value={jobAgeLabels[run.state.preferences?.maxAgeDays ?? 0]} />
          <Summary label="Top matches" value={`Up to ${run.state.maxMatches ?? DEFAULT_MAX_MATCHES}`} />
        </dl> : composerOpen && <div className="border-t border-zinc-100 px-5 py-5 sm:px-6 dark:border-zinc-800">
          <fieldset disabled={starting || selecting} className="space-y-3">
            <legend className="mb-3 font-semibold">CV profile</legend>
            {profiles.map(profile => <label key={profile.id} className="flex items-start gap-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <input type="radio" name="pipeline-profile" checked={profileId === profile.id} disabled={profile.cvStatus !== "ready" || !profile.cvDocumentId} onChange={() => selectProfile(profile.id)} className="mt-1" />
              <span><strong>{profile.name}</strong> · {profileStatus(profile)}{profile.targetRole && <span className="block text-sm text-zinc-500">{profile.targetRole}</span>}{profile.cvError && <span className="block text-sm text-amber-700">{profile.cvError}</span>}</span>
            </label>)}
            <Link href="/apply" className="inline-block text-sm underline">Manage profiles</Link>
          </fieldset>
          {profilesError && <p role="alert">{profilesError}</p>}
          {selectedProfile && <details className="mt-4"><summary className="cursor-pointer text-sm underline">Use a file instead</summary><div className="mt-3">
            <CvUpload key={profileId} maxBytes={maxBytes} value={null} disabled={starting || selecting} uploadUrl={`/api/profiles/${profileId}/cv`} onChange={() => { requestId.current = null; void refreshProfiles().catch(error => setError(error.message)); }} />
          </div></details>}

          <label className="mt-6 block text-sm font-semibold text-zinc-950 dark:text-white">
            Model
            <select className={`${inputClass} mt-2`} value={providerName} disabled={starting} onChange={(event) => { setProviderName(event.target.value as AiProviderName); requestId.current = null; }}>
              {providers.map((item) => <option key={item.name} value={item.name} disabled={!item.available}>{item.label}{!item.available ? " (unavailable)" : ""}</option>)}
            </select>
          </label>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{provider?.privacyNotice} · <Link href="/settings" className="underline">Manage models</Link></p>

          <SearchPreferencesFields value={preferences} disabled={starting} onChange={(next) => { setPreferences(next); requestId.current = null; }}>
            <label className="text-sm">Top matches
              <select className={`${inputClass} mt-1`} value={maxMatches} onChange={event => { setMaxMatches(Number(event.target.value)); requestId.current = null; }}>
                {maxMatchesOptions.map(count => <option key={count} value={count}>Top {count}</option>)}
              </select>
            </label>
          </SearchPreferencesFields>

          <label className="mt-6 flex items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200"><input type="checkbox" checked={autoApply} disabled={starting} onChange={event => { setAutoApply(event.target.checked); requestId.current = null; }} className="mt-1 size-4 accent-blue-700" /><span><strong>Save drafts on Indeed for the top {maxMatches} {maxMatches === 1 ? "match" : "matches"}</strong><span className="mt-1 block text-xs text-zinc-500">Indeed Apply postings only; you submit them yourself</span></span></label>
          <div className="mt-6 flex flex-col gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
            <p className={`text-sm ${canStart ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>{readiness}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={saveDailyRun} disabled={!document || !provider.available || savingSchedule || selecting} className={secondaryButton} title="Run these settings automatically once every 24 hours">{savingSchedule ? "Saving…" : schedule ? "Update daily run" : "Save as daily run"}</button>
              <button type="button" onClick={start} disabled={!canStart} className={primaryButton}>{starting ? "Starting…" : autoApply ? "Find jobs, tailor and save drafts" : "Find jobs and tailor CVs"}</button>
            </div>
          </div>
          {scheduleNotice && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{scheduleNotice}</p>}
          {error && <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
        </div>}
      </section>

      {runs.length > 0 && <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside aria-label="Recent runs" className="min-w-0 lg:sticky lg:top-6 lg:self-start">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-white">Runs</h2>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Last {runs.length}</span>
          </div>
          <ul className="mt-2 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
            {runs.map((item) => {
              const selected = item.id === selectedId;
              const summary = runSummary(item);
              const itemActive = pipelineIsActive(item.status);
              return <li key={item.id} className="w-56 shrink-0 lg:w-auto">
                <button type="button" aria-pressed={selected} onClick={() => selectRun(item.id)} className={`w-full rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${selected ? "border-blue-300 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/30" : "border-zinc-200 bg-white hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"}`}>
                  <span className="flex items-center gap-2 text-xs">
                    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${statusMeta[item.status].dot} ${itemActive ? "motion-safe:animate-pulse" : ""}`} />
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">{item.status === "queued" && item.retryAt ? "Retrying" : itemActive ? statusMeta[item.status].label : summary.total ? `${summary.ready} of ${summary.total} CV${summary.total === 1 ? "" : "s"}` : statusMeta[item.status].label}</span>
                    <time dateTime={item.createdAt} title={item.createdAt} className="ml-auto shrink-0 text-zinc-500 dark:text-zinc-400" suppressHydrationWarning>{now ? relativeTime(item.createdAt, now) : item.createdAt.slice(0, 10)}</time>
                  </span>
                  <span className="mt-1.5 block truncate text-sm font-medium text-zinc-950 dark:text-white">{item.state.profileName ?? item.filename}</span>
                  <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">{item.state.scheduled ? "Daily · " : ""}{item.model}</span>
                </button>
              </li>;
            })}
          </ul>
        </aside>

        <div className="min-w-0 space-y-6">
          {pollError && <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{pollError}</p>}
          {run?.state.profileName && <p className="text-sm font-medium">Profile: {run.state.profileName}</p>}
          {run && <div ref={progressRef} className="scroll-mt-6"><PipelineLiveProgress key={run.id} run={run} reconnecting={Boolean(pollError)} onRunChange={(next) => setRuns((current) => current.map((item) => item.id === next.id ? next : item))} /></div>}
          {run && <RunResults run={run} onNewRun={openComposer} />}
        </div>
      </div>}
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt><dd className="mt-0.5 truncate font-medium text-zinc-900 dark:text-zinc-100">{value}</dd></div>;
}

function RunResults({ run, onNewRun }: { run: PipelineRunView; onNewRun: () => void }) {
  const active = pipelineIsActive(run.status);
  const searching = active && ["finding", "ranking"].includes(run.state.stage);
  const jobs = run.state.jobs;

  if (!jobs.length) {
    if (active) return null;
    return <section aria-label="Shortlist" className={`${cardClass} p-6 text-center sm:p-8`}>
      <p className="text-base font-semibold text-zinc-950 dark:text-white">{run.status === "failed" ? "No shortlist for this run" : "No suitable matches found"}</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-zinc-600 dark:text-zinc-400">{run.status === "failed" ? "The run stopped before a shortlist was ready." : "Try wider roles or locations."}</p>
      <button type="button" onClick={onNewRun} className={`${secondaryButton} mt-5`}>Start a new run</button>
    </section>;
  }

  return <section aria-label="Shortlist" className="space-y-4">
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
      <h2 className="text-base font-semibold text-zinc-950 dark:text-white">Shortlist <span className="font-normal text-zinc-500 dark:text-zinc-400">· {jobs.length} match{jobs.length === 1 ? "" : "es"}</span></h2>
      {searching && <p role="status" className="text-xs text-zinc-500 dark:text-zinc-400">Still scoring</p>}
    </div>
    {jobs.map((job, index) => <JobCard key={job.jobPostingId} job={job} index={index} run={run} searching={searching} />)}
  </section>;
}


function JobCard({ job, index, run, searching }: { job: PipelineJob; index: number; run: PipelineRunView; searching: boolean }) {
  const result = run.results.find((item) => item.rewriteId === job.rewriteId);
  const met = job.assessment?.requirements.filter((item) => item.status === "met").map((item) => item.shortLabel ?? item.requirement).slice(0, 4) ?? [];
  const tone = job.score >= 70 ? "bg-emerald-500" : job.score >= 50 ? "bg-blue-500" : "bg-amber-500";
  const chip = job.status === "completed" ? <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">CV ready</span>
    : job.status === "running" ? <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300"><span aria-hidden="true" className="size-3 rounded-full border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin dark:border-blue-900 dark:border-t-blue-400" />Tailoring</span>
      : job.status === "failed" ? <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">Failed</span>
        : <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{searching ? "Shortlisted" : "Queued"}</span>;

  return <article aria-label={`${job.title} at ${job.company}`} className={`${cardClass} overflow-hidden`}>
    <div className="p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-sm font-semibold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-zinc-950 dark:text-white">{job.title}</h3>
            {chip}
            {job.status === "completed" && job.tailoring && <span title={job.tailoring === "profile" ? "Tailoring was rejected twice; this is the profile's reviewed CV." : "Lines the fact-check could not verify were removed."} className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{job.tailoring === "profile" ? "Profile CV" : "Lines removed"}</span>}
          </div>
          <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{job.company}{job.location ? ` · ${job.location}` : ""}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-950 dark:text-white">{job.score}<span className="text-sm font-normal text-zinc-400">/100</span></p>
          <div className="mt-1 ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, job.score)}%` }} /></div>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">evidence coverage</p>
        </div>
      </div>

      <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{job.rationale}</p>
      {met.length > 0 && <ul aria-label="Evidence supports" className="mt-3 flex flex-wrap gap-1.5">
        {met.map((item, i) => <li key={i} className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">✓ {item}</li>)}
      </ul>}
      <GapSummary assessment={job.assessment} missing={job.missing} />
      <MatchEvidence assessment={job.assessment} />

      {job.status === "running" && <p role="status" className="mt-4 rounded-lg bg-blue-50/70 p-3 text-sm text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">{run.state.live?.jobPostingId === job.jobPostingId ? run.state.live.message : "Tailoring and validating this CV…"}</p>}
      {job.status === "pending" && !searching && <p className="mt-4 text-sm text-zinc-500 dark:text-zinc-400">Waiting to tailor.</p>}
      {job.applicationId && <p className="mt-4 text-sm text-blue-700 dark:text-blue-300"><a className="font-semibold underline" href={`/job-applications?id=${job.applicationId}`}>Application: {job.applicationStatus?.replaceAll("_", " ") ?? "queued"}</a>{job.applicationMessage && <span className="mt-1 block text-zinc-600 dark:text-zinc-400">{job.applicationMessage}</span>}</p>}
      {job.applicationError && <p role="alert" className="mt-4 text-sm text-amber-700 dark:text-amber-300">Application needs attention: {job.applicationError}</p>}
      {job.error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{job.error}</p>}

      {result && <CvRewriteActions title="Tailored CV" rewrite={{
        rewriteId: result.rewriteId, provider: run.provider, model: run.model, content: result.content,
        counts: { experience: result.content.experience.length, projects: result.content.projects.length, education: result.content.education.length },
      }} />}
    </div>
    <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/40">
      <a href={job.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-700 hover:underline dark:text-blue-300">View posting{job.source ? ` on ${sourceLabel(job.source)}` : ""} ↗</a>
      {result && !job.applicationId && <span className="ml-auto"><ApplyToJob rewriteId={result.rewriteId} className="" /></span>}
    </div>
  </article>;
}
