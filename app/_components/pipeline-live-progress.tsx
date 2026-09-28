"use client";

import { DEFAULT_MAX_MATCHES } from "@/lib/pipeline/options";
import { workingStatuses } from "@/lib/job-applications/types";
import { useState } from "react";
import { pipelineIsActive, type PipelineRunView, type PipelineState } from "@/lib/pipeline/types";
import { StatusBadge, formatDuration, runSummary, useNow } from "./pipeline-status";

type StepStatus = "done" | "active" | "waiting" | "error" | "skipped";
type ActivityEvent = NonNullable<PipelineState["activity"]>[number];

const codeClass = "rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.8em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200";
const ACTIVITY_PREVIEW = 8;

// Folds runs of messages that differ only by a number ("Read 12 full job postings…") into one row.
function collapseActivity(events: ActivityEvent[]) {
  const rows: Array<ActivityEvent & { key: string; count: number; firstAt: string }> = [];
  for (const event of events) {
    const key = event.message.replace(/\d+/g, "#");
    const last = rows.at(-1);
    if (last && last.key === key) { last.count += 1; last.at = event.at; last.message = event.message; }
    else rows.push({ ...event, key, count: 1, firstAt: event.at });
  }
  return rows;
}

export function PipelineLiveProgress({ run, reconnecting = false, onRunChange }: { run: PipelineRunView; reconnecting?: boolean; onRunChange?: (run: PipelineRunView) => void }) {
  const active = pipelineIsActive(run.status);
  const now = useNow(active);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  // A failed attempt waits in the queue for its backoff; everything finished before it is kept.
  const retrying = run.status === "queued" && run.retryAt !== null;
  const retryIn = retrying && now ? Date.parse(run.retryAt!) - now : null;

  async function stopRetrying() {
    setStopping(true); setStopError(null);
    try {
      const response = await fetch(`/api/pipeline/${run.id}/stop-retrying`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not stop retrying.");
      onRunChange?.(payload);
    } catch (error) { setStopError(error instanceof Error ? error.message : "Could not stop retrying."); }
    finally { setStopping(false); }
  }

  const { ready, failed, total } = runSummary(run);
  const scoring = run.state.scoring ?? (run.state.matching ? {
    scored: run.state.matching.scored, failed: run.state.matching.failed, total: run.state.matching.considered,
  } : null);
  const scoreDone = scoring ? scoring.scored + scoring.failed : 0;
  const live = run.state.live;
  const start = Date.parse(run.state.startedAt ?? run.createdAt);
  const end = active ? now ?? Date.parse(run.updatedAt) : Date.parse(run.updatedAt);
  const staleSeconds = active && now ? Math.max(0, Math.floor((now - Date.parse(run.updatedAt)) / 1000)) : 0;
  const searching = run.state.stage === "finding" || run.state.stage === "ranking";
  const searchDone = Boolean(run.state.matching) || run.state.stage === "done";
  const searchStatus: StepStatus = searchDone ? "done" : run.status === "failed" && searching ? "error" : run.status === "running" && searching ? "active" : "waiting";
  const tailorStatus: StepStatus = total && ready === total ? "done" : failed && !active ? "error" : run.status === "running" && run.state.stage === "tailoring" ? "active" : !active && !total ? "skipped" : "waiting";
  const currentJob = run.state.jobs.find((job) => job.status === "running");
  const submitted = run.state.jobs.filter(job => job.applicationStatus === "submitted").length;
  const drafts = run.state.jobs.filter(job => job.applicationStatus === "draft_saved").length;
  const applicationPending = run.state.jobs.some(job => job.applicationId && (!job.applicationStatus || workingStatuses.includes(job.applicationStatus)));
  const applicationIssues = run.state.jobs.some(job => job.applicationError || (job.applicationStatus && !["submitted", "draft_saved", ...workingStatuses].includes(job.applicationStatus)));
  const showApplicationOutcome = Boolean(run.state.autoApply && !active && ready);
  // Applications run in the applications worker after the pipeline queues them; their status arrives with each poll.
  const applications = run.state.jobs.filter(job => job.applicationId);
  const applyTotal = run.state.jobs.filter(job => job.status === "completed").length;
  const applying = applications.find(job => !job.applicationStatus || workingStatuses.includes(job.applicationStatus));
  const applyWorking = applications.filter(job => !job.applicationStatus || workingStatuses.includes(job.applicationStatus)).length;
  const applyAttention = applications.filter(job => job.applicationStatus && ["review", "needs_input", "draft_unconfirmed", "uncertain", "failed"].includes(job.applicationStatus)).length + run.state.jobs.filter(job => job.applicationError).length;
  const applyFinished = applications.length - applyWorking + run.state.jobs.filter(job => job.applicationError).length;
  const applyStatus: StepStatus = applicationPending || run.state.stage === "applying" ? "active"
    : applyTotal && applyFinished >= applyTotal ? applyAttention ? "error" : "done"
      : !active && !applyTotal ? "skipped" : "waiting";
  const applyDetail = applyFinished || applyWorking
    ? [drafts && `${drafts} draft${drafts === 1 ? "" : "s"} saved`, submitted && `${submitted} submitted`, applyWorking && `${applyWorking} in progress`, applyAttention && `${applyAttention} need${applyAttention === 1 ? "s" : ""} you`].filter(Boolean).join(" · ")
    : applyStatus === "skipped" ? "No tailored CVs" : "Waiting for tailored CVs";
  const title = retrying ? retryIn !== null && retryIn > 1_000 ? `Retrying in ${formatDuration(retryIn)}` : "Retrying now"
    : run.status === "queued" ? "Waiting for a worker"
    : showApplicationOutcome ? applicationPending ? "Saving drafts on Indeed" : applicationIssues ? "Some drafts need you" : `${drafts} draft${drafts === 1 ? "" : "s"} ready to submit on Indeed`
    : run.status === "completed" ? `${ready} tailored CV${ready === 1 ? "" : "s"} ready`
      : run.status === "partial" ? `${ready} CV${ready === 1 ? "" : "s"} ready · ${failed} need${failed === 1 ? "s" : ""} attention`
        : run.status === "failed" ? "This run stopped early"
          : run.state.stage === "finding" ? live?.phase === "profiling" ? "Reading your CV" : "Finding jobs"
            : run.state.stage === "ranking" ? live?.phase === "screening" ? "Screening jobs" : live?.phase === "scoring" ? "Scoring your matches" : "Building your shortlist"
              : run.state.stage === "applying" ? "Queuing drafts" : "Tailoring your CVs";
  const connection = reconnecting ? "Reconnecting…" : active && !run.workerActive ? "Worker offline" : null;
  const liveMessage = reconnecting ? "Reconnecting…"
    : !run.workerActive ? <>Worker offline. Start it with <code className={codeClass}>npm run dev:all</code>; progress is saved.</>
      : retrying ? `Attempt failed: ${run.error ?? "unknown error"} Retry ${run.retries} of ${run.maxRetries}.`
      : run.status === "queued" ? "Waiting for a worker."
        : live?.message ?? "Working…";
  const activity = collapseActivity(run.state.activity ?? []).reverse();
  const visibleActivity = showAllActivity ? activity : activity.slice(0, ACTIVITY_PREVIEW);

  return (
    <section aria-label="Run progress" className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={showApplicationOutcome ? applicationPending ? "running" : applicationIssues ? "partial" : run.status : run.status} pulse={active && run.workerActive && !reconnecting}>{showApplicationOutcome ? applicationPending ? "Saving drafts" : applicationIssues ? "Drafts need you" : "Finished" : retrying ? "Retrying" : undefined}</StatusBadge>
          {run.state.scheduled && <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Daily run</span>}
          {run.retries > 0 && !retrying && <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-semibold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{active ? `Retry ${run.retries} of ${run.maxRetries}` : `${run.retries} ${run.retries === 1 ? "retry" : "retries"}`}</span>}
          {connection && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">{connection}</span>}
          <span className="ml-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{formatDuration(end - start)} {active ? "elapsed" : "total"}</span>
        </div>
        <h2 className="mt-3 text-xl font-semibold tracking-tight text-zinc-950 dark:text-white" role="status">{title}</h2>
        <p className="mt-1 break-words text-sm text-zinc-500 dark:text-zinc-400">{run.state.profileName ?? run.filename} <span aria-hidden="true">·</span> {run.model}</p>

        <ol className={`mt-6 grid gap-x-4 gap-y-5 ${run.state.autoApply ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`} aria-label="Pipeline stages">
          <Step title="Upload CV" status="done" detail="Text extracted" />
          <Step title="Find & rank jobs" status={searchStatus} detail={live?.phase === "screening" && run.state.screening ? `${run.state.screening.screened} of ${run.state.screening.total} screened · ${run.state.screening.irrelevant} skipped` : scoring ? `${scoreDone} of ${scoring.total} scored${scoring.failed ? ` · ${scoring.failed} failed` : ""}` : run.state.search ? `${run.state.search.jobPostingIds.length} unique jobs found` : live?.phase === "profiling" ? "Creating your search profile" : run.state.fetched !== undefined ? `${run.state.fetched} postings retrieved` : "Search, shortlist, score"} />
          <Step title={`Tailor up to ${run.state.maxMatches ?? DEFAULT_MAX_MATCHES} CVs`} status={tailorStatus} detail={total ? `${ready} of ${total} ready${failed ? ` · ${failed} failed` : ""}` : tailorStatus === "skipped" ? "No suitable matches" : "Waiting for the shortlist"} />
          {run.state.autoApply && <Step title="Drafts on Indeed" status={applyStatus} detail={applyDetail} />}
        </ol>

        {!active && applicationPending && <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin dark:border-blue-900 dark:border-t-blue-400" />
            <div className="min-w-0 flex-1">
              <p aria-live="polite" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{applying?.applicationMessage ?? (applying?.applicationStatus === "queued" || !applying?.applicationStatus ? "Waiting for the applications worker…" : "Working on the application…")}</p>
              {applying && <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">{applying.title} at {applying.company} · {(applying.applicationStatus ?? "queued").replaceAll("_", " ")}</p>}
            </div>
          </div>
          {applyTotal > 0 && <MeasuredProgress label="Application progress" completed={Math.min(applyFinished, applyTotal)} total={applyTotal} />}
        </div>}

        {active && <div className={`mt-6 rounded-xl border p-4 ${retrying ? "border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20" : "border-blue-100 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20"}`}>
          <div className="flex items-start gap-3">
            {run.status === "running" && run.workerActive && !reconnecting
              ? <span aria-hidden="true" className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-blue-200 border-t-blue-600 motion-safe:animate-spin dark:border-blue-900 dark:border-t-blue-400" />
              : <span aria-hidden="true" className="mt-1 size-3 shrink-0 rounded-full border-2 border-zinc-300 dark:border-zinc-700" />}
            <div className="min-w-0 flex-1">
              <p aria-live="polite" className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{liveMessage}</p>
              {currentJob && <p className="mt-1 truncate text-xs text-zinc-600 dark:text-zinc-400">{currentJob.title} at {currentJob.company}</p>}
              {staleSeconds >= 15 && run.status === "running" && <p className="mt-2 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">Last update {formatDuration(staleSeconds * 1000)} ago</p>}
              {retrying && <div className="mt-3 flex flex-wrap items-center gap-3">
                <button type="button" onClick={stopRetrying} disabled={stopping} className="text-sm font-semibold text-amber-900 underline disabled:opacity-50 dark:text-amber-200">{stopping ? "Stopping…" : "Stop retrying"}</button>
                {stopError && <span role="alert" className="text-xs text-red-700 dark:text-red-300">{stopError}</span>}
              </div>}
            </div>
          </div>
          {run.state.stage === "ranking" && scoring && scoring.total > 0 && <MeasuredProgress label="Job scoring progress" completed={scoreDone} total={scoring.total} />}
          {run.state.stage === "tailoring" && total > 0 && <MeasuredProgress label="CV tailoring progress" completed={ready + failed} total={total} />}
        </div>}

        {run.state.autoApply && <div className="mt-5 rounded-lg border border-amber-200 p-3 text-sm dark:border-amber-900">
          <p>{drafts} draft{drafts === 1 ? "" : "s"} saved on Indeed{submitted ? ` · ${submitted} submitted` : ""} · {ready} tailored CV{ready === 1 ? "" : "s"}</p>
          {showApplicationOutcome && !submitted && !drafts && <p className="mt-1 font-semibold">No drafts saved on Indeed yet.</p>}
          <a href="/job-applications" className="mt-1 inline-block font-semibold text-blue-700 underline dark:text-blue-300">Open drafts</a>
        </div>}
        <dl className="mt-6 grid grid-cols-3 divide-x divide-zinc-200 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          <Metric label={run.state.search ? "Jobs found" : "Postings retrieved"} value={run.state.search?.jobPostingIds.length ?? run.state.fetched ?? 0} />
          <Metric label="Scored" value={scoring?.scored ?? 0} hint={scoring?.failed ? `${scoring.failed} failed` : undefined} />
          <Metric label="CVs ready" value={ready} hint={failed ? `${failed} failed` : undefined} />
        </dl>

        {run.error && !retrying && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{run.error}</p>}
        {run.state.warnings.length > 0 && <ul className="mt-4 space-y-2">{run.state.warnings.map((warning, index) => <li key={index} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{warning}</li>)}</ul>}
      </div>

      {(run.state.screening || activity.length > 0 || active) && <div className="divide-y divide-zinc-100 border-t border-zinc-100 dark:divide-zinc-800 dark:border-zinc-800">
        {run.state.screening && <details className="group px-5 py-3 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-zinc-900 marker:hidden dark:text-zinc-100">
            <Chevron />AI screening
            <span className="ml-auto text-xs font-normal text-zinc-500 dark:text-zinc-400">{run.state.screening.relevant} relevant · {run.state.screening.uncertain} uncertain · {run.state.screening.irrelevant} skipped</span>
          </summary>
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-2">{run.state.screening.decisions.map((decision) => <li key={decision.jobPostingId} className="text-xs">
            <p className="flex items-center gap-2"><span className={`size-1.5 shrink-0 rounded-full ${decision.classification === "relevant" ? "bg-emerald-500" : decision.classification === "irrelevant" ? "bg-zinc-300 dark:bg-zinc-700" : "bg-amber-500"}`} aria-hidden="true" /><strong className="truncate text-zinc-900 dark:text-zinc-100">{decision.title}</strong><span className="shrink-0 text-zinc-500">{decision.classification}</span></p>
            <p className="ml-3.5 text-zinc-500 dark:text-zinc-400">{decision.reason}</p>
          </li>)}</ul>
        </details>}

        <details open={active} className="group px-5 py-3 sm:px-6">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-zinc-900 marker:hidden dark:text-zinc-100">
            <Chevron />Activity
            <span className="ml-auto text-xs font-normal text-zinc-500 dark:text-zinc-400">{active ? "Updating live" : activity.length ? `${activity.length} event${activity.length === 1 ? "" : "s"}` : ""}</span>
          </summary>
          {activity.length ? <>
            <ol className="mt-3 space-y-2.5" aria-label="Pipeline activity, newest first">
              {visibleActivity.map((event, index) => <li key={`${event.at}-${index}`} className="flex items-start gap-3 text-xs">
                <span aria-hidden="true" className={`mt-1.5 size-1.5 shrink-0 rounded-full ${index === 0 && active ? "bg-blue-500 motion-safe:animate-pulse" : "bg-zinc-300 dark:bg-zinc-700"}`} />
                <p className="min-w-0 flex-1 leading-5 text-zinc-700 dark:text-zinc-300">{event.message}{event.count > 1 && <span className="ml-1.5 rounded bg-zinc-100 px-1 py-px text-[10px] font-medium tabular-nums text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={`${event.count} similar updates`}>×{event.count}</span>}</p>
                <span className="shrink-0 pt-0.5 tabular-nums text-zinc-400" title={event.at}>+{formatDuration(Date.parse(event.at) - start)}</span>
              </li>)}
            </ol>
            {activity.length > ACTIVITY_PREVIEW && <button type="button" onClick={() => setShowAllActivity((value) => !value)} className="mt-3 text-xs font-semibold text-blue-700 hover:underline dark:text-blue-300">{showAllActivity ? "Show fewer" : `Show all ${activity.length} events`}</button>}
          </> : <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{active ? "Waiting for the first update…" : "Detailed activity is recorded for new runs."}</p>}
        </details>
      </div>}
    </section>
  );
}

function Chevron() {
  return <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-90 motion-reduce:transition-none"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Step({ title, status, detail }: { title: string; status: StepStatus; detail: string }) {
  const rail = status === "done" ? "bg-emerald-500" : status === "active" ? "bg-blue-500" : status === "error" ? "bg-amber-500" : "bg-zinc-200 dark:bg-zinc-800";
  const label = status === "active" ? "In progress" : status === "done" ? "Done" : status === "error" ? "Needs attention" : status === "skipped" ? "Skipped" : "Waiting";
  const labelColor = status === "active" ? "text-blue-700 dark:text-blue-300" : status === "done" ? "text-emerald-700 dark:text-emerald-400" : status === "error" ? "text-amber-700 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500";
  return <li aria-current={status === "active" ? "step" : undefined} className="min-w-0">
    <div className="h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"><div className={`h-full rounded-full ${rail} ${status === "active" ? "w-2/3 motion-safe:animate-pulse" : "w-full"}`} /></div>
    <div className="mt-3 flex items-baseline justify-between gap-2">
      <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">{title}</h3>
      <span className={`shrink-0 text-xs font-medium ${labelColor}`}>{label}</span>
    </div>
    <p className="mt-0.5 text-xs leading-5 text-zinc-500 dark:text-zinc-400">{detail}</p>
  </li>;
}

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return <div className="px-3 py-3 text-center sm:px-4">
    <dd className="text-2xl font-semibold tabular-nums tracking-tight text-zinc-950 dark:text-white">{value}</dd>
    <dt className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{label}{hint && <span className="text-amber-700 dark:text-amber-400"> · {hint}</span>}</dt>
  </div>;
}

function MeasuredProgress({ label, completed, total }: { label: string; completed: number; total: number }) {
  return <div className="mt-3 flex items-center gap-3">
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.min(completed, total)} className="h-1.5 flex-1 overflow-hidden rounded-full bg-blue-100 dark:bg-blue-900/50">
      <div className="h-full rounded-full bg-blue-600 transition-[width] duration-500 motion-reduce:transition-none dark:bg-blue-400" style={{ width: `${Math.min(100, completed / total * 100)}%` }} />
    </div>
    <span className="shrink-0 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{Math.min(completed, total)}/{total}</span>
  </div>;
}
