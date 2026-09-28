"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { canDraft, missingRequired, reviewStatuses, workingStatuses, type AnswerEvidence, type ApplicantProfile, type ApplicationStatus, type ApplicationView } from "@/lib/job-applications/types";
import { EmptyState, Notice, Pill, cardBodyClass, cardClass, cardFooterClass, cardHeaderClass, inputClass, linkButton, primaryButton, secondaryButton, spinnerClass, type Tone } from "./ui";

type Bootstrap = { profile: ApplicantProfile; jobTitle: string; company: string; postingUrl: string; applicationUrl: string | null; existingId: string | null; eligible: boolean; workerActive: boolean };
const profileLabels: Record<keyof ApplicantProfile, string> = { name: "Full name", email: "Email", phone: "Phone", location: "Current location", currentCompany: "Current employer", linkedin: "LinkedIn URL", github: "GitHub URL", portfolio: "Portfolio / website URL" };
const statusMeta: Record<ApplicationStatus, { label: string; tone: Tone }> = {
  queued: { label: "Waiting for browser", tone: "neutral" }, preparing: { label: "Preparing", tone: "info" }, review: { label: "Ready for review", tone: "info" }, needs_input: { label: "Needs your input", tone: "warning" },
  update_requested: { label: "Saving answers", tone: "info" }, submit_requested: { label: "Submission requested", tone: "info" }, submitting: { label: "Submitting", tone: "info" }, submitted: { label: "Submitted", tone: "success" },
  save_requested: { label: "Save requested", tone: "info" }, saving_draft: { label: "Saving on Indeed", tone: "info" }, draft_saved: { label: "Saved on Indeed", tone: "info" }, draft_unconfirmed: { label: "Check draft save", tone: "warning" },
  uncertain: { label: "Check outcome", tone: "warning" }, failed: { label: "Preparation ended", tone: "danger" }, cancelled: { label: "Cancelled", tone: "neutral" },
};
const labelClass = "block text-sm font-medium text-zinc-900 dark:text-zinc-100";

async function getJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Application request failed.");
  return payload;
}

export function WorkerStatus({ online }: { online: boolean }) {
  return <Pill tone={online ? "success" : "warning"} pulse={online}>{online ? "Browser worker online" : "Browser worker offline"}</Pill>;
}

export function ApplicationPanel({ rewriteId, applicationId }: { rewriteId?: string; applicationId?: string }) {
  const [setup, setSetup] = useState<Bootstrap | null>(null);
  const [profile, setProfile] = useState<ApplicantProfile | null>(null);
  const [url, setUrl] = useState("");
  const [destinationChecked, setDestinationChecked] = useState(false);
  const [id, setId] = useState(applicationId ?? "");
  const [run, setRun] = useState<ApplicationView | null>(null);
  const [runs, setRuns] = useState<ApplicationView[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    let stopped = false;
    if (rewriteId && !id) getJson(`/api/job-applications/bootstrap?rewrite=${encodeURIComponent(rewriteId)}`).then((data: Bootstrap) => {
      if (!stopped) { setSetup(data); setProfile(data.profile); setUrl(data.applicationUrl ?? ""); setOnline(data.workerActive); }
    }).catch((error) => { if (!stopped) setError(error.message); });
    return () => { stopped = true; };
  }, [rewriteId, id]);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (id) {
          const data = await getJson(`/api/job-applications/${encodeURIComponent(id)}`);
          if (!stopped) { setRun(data); setOnline(data.workerActive); }
        } else {
          const data = await getJson("/api/job-applications");
          if (!stopped) { setRuns(data.applications.filter(Boolean)); setOnline(data.workerActive); }
        }
      } catch (error) { if (!stopped) setError(error instanceof Error ? error.message : "Could not refresh applications."); }
      finally { if (!stopped) timer = setTimeout(poll, 2000); }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id]);
  async function prepare(event: React.FormEvent) {
    event.preventDefault(); if (!destinationChecked) return;
    setPending(true); setError("");
    try {
      const data = await getJson("/api/job-applications/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rewriteId, profile, url }) });
      setId(data.id); window.history.replaceState(null, "", `/job-applications?id=${data.id}`);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not prepare application."); }
    finally { setPending(false); }
  }

  const canPrepare = Boolean(setup?.eligible) && online && destinationChecked && !pending;
  const prepareHint = !setup ? "" : !setup.eligible ? "Re-tailor this CV first to pass the current evidence audit." : !online ? "Start the browser worker on this computer to prepare applications." : !destinationChecked ? "Confirm the application link to continue." : "Ready to open the form in a visible browser.";

  return <div className="mt-8 space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <WorkerStatus online={online} />
      {!online && <p className="text-sm text-zinc-600 dark:text-zinc-400">On this computer, run <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">npm run applications:worker</code>. Application windows open here.</p>}
      {id && <Link className={`${linkButton} ml-auto`} href="/job-applications">← All applications</Link>}
    </div>
    {error && <Notice tone="danger" role="alert">{error}</Notice>}

    {id && !run && <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><span aria-hidden="true" className={spinnerClass} />Loading application…</p>}
    {run && <ApplicationReview key={`${run.id}:${run.revision}`} run={run} onChange={setRun} />}

    {!id && rewriteId && !setup && !error && <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><span aria-hidden="true" className={spinnerClass} />Loading tailored CV and application link…</p>}
    {!id && setup && profile && <form onSubmit={prepare} className={`${cardClass} overflow-hidden`}>
      <div className={cardHeaderClass}>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{setup.jobTitle}</h2>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{setup.company} · <a href={setup.postingUrl} target="_blank" rel="noreferrer" className={linkButton}>View posting ↗</a> · <a href={`/api/rewrites/${rewriteId}/cv.pdf`} target="_blank" rel="noreferrer" className={linkButton}>Preview CV PDF ↗</a></p>
        </div>
        {setup.eligible ? <Pill tone="success">CV passes evidence audit</Pill> : <Pill tone="warning">Re-tailor needed</Pill>}
      </div>
      {setup.existingId && <Notice tone="info" className="mx-5 mt-4 sm:mx-6">An application for this job already exists. <Link className="font-semibold underline underline-offset-4" href={`/job-applications?id=${setup.existingId}`}>Open it</Link> instead of preparing a new one.</Notice>}

      <div className={cardBodyClass}>
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">Where to apply</h3>
        <label className={`${labelClass} mt-3`}>Application URL (Indeed posting or Lever form)<input required type="url" className={inputClass} value={url} onChange={(event) => { setUrl(event.target.value); setDestinationChecked(false); }} placeholder="https://de.indeed.com/viewjob?jk=… or https://jobs.lever.co/company/job-id/apply" /></label>
        {!setup.applicationUrl && <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">No Indeed Apply or Lever form found. Paste a supported link.</p>}
        <label className="mt-4 flex items-start gap-2.5 text-sm text-zinc-800 dark:text-zinc-200"><input type="checkbox" className="mt-0.5 size-4 accent-blue-700" checked={destinationChecked} onChange={(event) => setDestinationChecked(event.target.checked)} />I checked that this application link is for {setup.company} and the {setup.jobTitle} role.</label>
      </div>

      <div className={cardBodyClass}>
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">Your details</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">{Object.entries(profileLabels).map(([key, label]) => <label key={key} className={labelClass}>{label}{["name", "email"].includes(key) && <span className="ml-1 text-red-600 dark:text-red-400" aria-hidden="true">*</span>}<input className={inputClass} type={key === "email" ? "email" : "text"} required={["name", "email"].includes(key)} maxLength={key === "phone" ? 100 : 500} value={profile[key as keyof ApplicantProfile]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} /></label>)}</div>
      </div>

      <div className={cardFooterClass}>
        <p className={`text-sm ${canPrepare ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>{prepareHint}</p>
        <button className={`${primaryButton} ml-auto`} disabled={!canPrepare}>{pending && <span aria-hidden="true" className={`${spinnerClass} border-white/40 border-t-white`} />}{pending ? "Preparing…" : "Prepare application"}</button>
      </div>
    </form>}

    {!id && !rewriteId && (runs === null
      ? <p className="flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400"><span aria-hidden="true" className={spinnerClass} />Loading applications…</p>
      : runs.length === 0
        ? <EmptyState title="No applications yet" description={<>Run the pipeline with <strong>Save drafts on Indeed</strong> on, or choose <strong>Apply with this CV</strong> on a tailored result.</>} action={<Link className={primaryButton} href="/pipeline">Go to Pipeline</Link>} />
        : <ApplicationGroups runs={runs} />)}
  </div>;
}

type Group = "drafts" | "attention" | "working" | "submitted" | "ended";
const groupOf = (status: ApplicationStatus): Group =>
  status === "draft_saved" ? "drafts" : status === "submitted" ? "submitted" : ["failed", "cancelled"].includes(status) ? "ended" : ["draft_unconfirmed", "uncertain", "needs_input", "review"].includes(status) ? "attention" : "working";
const groupMeta: Record<Group, { title: string; blurb?: string }> = {
  drafts: { title: "Waiting on Indeed", blurb: "Saved on Indeed, not submitted. Finish them there within about 14 days." },
  attention: { title: "Needs a look" }, working: { title: "In progress" }, submitted: { title: "Submitted" }, ended: { title: "Ended without a submission" },
};
const markets: Record<string, string> = { www: "Indeed US", uk: "Indeed UK", de: "Indeed Germany", at: "Indeed Austria", ch: "Indeed Switzerland", ca: "Indeed Canada", fr: "Indeed France", nl: "Indeed Netherlands", ie: "Indeed Ireland", au: "Indeed Australia", sg: "Indeed Singapore", in: "Indeed India", es: "Indeed Spain", it: "Indeed Italy", pt: "Indeed Portugal", be: "Indeed Belgium", se: "Indeed Sweden", pl: "Indeed Poland" };
export const marketOf = (url: string) => { try { const host = new URL(url).hostname; const prefix = host.split(".")[0]; return host.endsWith("indeed.com") ? markets[prefix] ?? `Indeed ${prefix.toUpperCase()}` : host.replace(/^www\./, ""); } catch { return ""; } };
export const relativeTime = (iso: string, now = Date.now()) => {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
};
/** Indeed keeps an unfinished application for about 14 days; a rough countdown is more useful than the save date alone. */
export const draftKeptFor = (savedAt: string | undefined, now = Date.now()) => {
  if (!savedAt) return "";
  const daysLeft = Math.ceil((new Date(savedAt).getTime() + 14 * 86_400_000 - now) / 86_400_000);
  return daysLeft <= 0 ? "may have expired on Indeed" : daysLeft === 1 ? "kept about 1 more day" : `kept about ${daysLeft} more days`;
};
const firstSentence = (text: string | null) => (text ?? "").split(/(?<=[.!?])\s/)[0].slice(0, 160);
const answersFilled = (run: ApplicationView) => run.answerEvidence?.length ?? 0;

/** Drafts first: they are the thing to act on. Filters and search keep a long history usable. */
function ApplicationGroups({ runs }: { runs: ApplicationView[] }) {
  const [filter, setFilter] = useState<"all" | Group>("all");
  const [query, setQuery] = useState("");
  const groups: Record<Group, ApplicationView[]> = { drafts: [], attention: [], working: [], submitted: [], ended: [] };
  const needle = query.trim().toLowerCase();
  for (const run of runs) if (!needle || `${run.jobTitle} ${run.company} ${run.profileName ?? ""} ${marketOf(run.url)}`.toLowerCase().includes(needle)) groups[groupOf(run.status)].push(run);
  groups.drafts.sort((a, b) => (b.snapshot?.indeedDraft?.savedAt ?? b.updatedAt).localeCompare(a.snapshot?.indeedDraft?.savedAt ?? a.updatedAt));
  for (const group of ["attention", "working", "submitted", "ended"] as const) groups[group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const order: Group[] = ["drafts", "attention", "working", "submitted", "ended"];
  const counts = Object.fromEntries(order.map((group) => [group, runs.filter((run) => groupOf(run.status) === group).length])) as Record<Group, number>;
  const shown = filter === "all" ? order : [filter];
  const chip = (key: "all" | Group, label: string, count: number) => <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key}
    className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition ${filter === key ? "border-zinc-900 bg-zinc-900 text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:text-zinc-300"}`}>
    {label}<span className={`tabular-nums ${filter === key ? "opacity-70" : "text-zinc-500 dark:text-zinc-400"}`}>{count}</span></button>;
  return <div className="space-y-8">
    <div className="flex flex-wrap items-center gap-2">
      {chip("all", "All", runs.length)}{order.map((group) => counts[group] > 0 && chip(group, groupMeta[group].title, counts[group]))}
      {runs.length > 5 && <input aria-label="Search applications" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search job, company or profile" className="ml-auto min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-1.5 text-sm dark:border-zinc-700 sm:max-w-xs" />}
    </div>
    {shown.every((group) => !groups[group].length) && <p className="text-sm text-zinc-500 dark:text-zinc-400">Nothing matches.</p>}
    {shown.map((group) => groups[group].length > 0 && (group === "ended" && filter === "all"
      ? <details key={group} className="group">
        <summary className="cursor-pointer px-1 text-sm font-semibold text-zinc-700 dark:text-zinc-300">{groupMeta.ended.title} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {groups.ended.length}</span></summary>
        <ul className="mt-3 space-y-3">{groups.ended.map((run) => <ApplicationCard key={run.id} run={run} group="ended" />)}</ul>
      </details>
      : <section key={group} aria-label={groupMeta[group].title} className="space-y-3">
        <h2 className="px-1 text-sm font-semibold text-zinc-950 dark:text-white">{groupMeta[group].title} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {groups[group].length}</span></h2>
        {groupMeta[group].blurb && <p className="px-1 text-sm text-zinc-500 dark:text-zinc-400">{groupMeta[group].blurb}</p>}
        <ul className="space-y-3">{groups[group].map((run) => <ApplicationCard key={run.id} run={run} group={group} />)}</ul>
      </section>))}
  </div>;
}

/** One row per application: what it is, what state it is in, and the one action that matters for that state. */
function ApplicationCard({ run, group }: { run: ApplicationView; group: Group }) {
  const detail = `/job-applications?id=${run.id}`;
  const meta = [run.company, marketOf(run.url), run.profileName ? `Profile: ${run.profileName}` : ""].filter(Boolean).join(" · ");
  const savedAt = run.snapshot?.indeedDraft?.savedAt;
  const line = group === "drafts" ? [`Saved ${relativeTime(savedAt ?? run.updatedAt)}`, draftKeptFor(savedAt), answersFilled(run) ? `${answersFilled(run)} answer${answersFilled(run) === 1 ? "" : "s"} filled` : "", run.snapshot?.resume ? `CV: ${run.snapshot.resume}` : ""].filter(Boolean).join(" · ")
    : group === "working" ? run.message || statusMeta[run.status].label
    : group === "submitted" ? `${run.confirmation ? firstSentence(run.confirmation) : "Submitted"} · ${relativeTime(run.updatedAt)}`
    : `${firstSentence(run.message)}${run.message ? " · " : ""}${relativeTime(run.updatedAt)}`;
  return <li className={`${cardClass} p-4 sm:px-5`}>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
      <Link className="min-w-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" href={detail}>
        <p className="text-sm font-semibold text-zinc-950 dark:text-white sm:truncate">{run.jobTitle}</p>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400 sm:truncate">{meta}</p>
        <p className={`mt-1 text-xs sm:truncate ${group === "attention" ? "text-amber-700 dark:text-amber-300" : group === "ended" ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-600 dark:text-zinc-400"}`}>{group === "working" && run.workerActive && <span aria-hidden="true" className={`${spinnerClass} mr-1.5 inline-block size-3 align-[-2px]`} />}{line}</p>
      </Link>
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        {group !== "drafts" && <Pill tone={statusMeta[run.status].tone} pulse={workingStatuses.includes(run.status) && run.workerActive}>{statusMeta[run.status].label}</Pill>}
        {group === "drafts" && <a href={run.snapshot?.indeedDraft?.continueUrl ?? run.url} target="_blank" rel="noreferrer" className={primaryButton}>Continue on Indeed ↗</a>}
        {group === "attention" && <Link href={detail} className={primaryButton}>Open</Link>}
        {group === "ended" && <Link href={`/job-applications?rewrite=${run.rewriteId}`} className={secondaryButton}>Prepare again</Link>}
        {group !== "attention" && <Link href={detail} className={linkButton}>Details</Link>}
      </div>
    </div>
  </li>;
}

const sourceTag = (sources: string[]) => {
  const first = sources[0] ?? "";
  return first.startsWith("automatic-apply policy") ? { label: "Rule", tone: "neutral" as Tone } : first.startsWith("best effort") ? { label: "Best effort", tone: "warning" as Tone }
    : /^(?:details|profile|education|experience|skills|languages)\./.test(first) ? { label: "Your details", tone: "info" as Tone } : { label: "Your CV", tone: "success" as Tone };
};
/** The questions the worker answered on your behalf, each with where the answer came from; estimates are marked. */
function AnswersGiven({ evidence }: { evidence: AnswerEvidence[] }) {
  const [open, setOpen] = useState<number | null>(null);
  return <section aria-label="Answers given" className="mx-5 mb-4 sm:mx-6">
    <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">Answers given <span className="font-normal text-zinc-500 dark:text-zinc-400">· {evidence.length}</span></h3>
    <ul className="mt-2 divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">{evidence.map((item, index) => {
      const tag = sourceTag(item.sources);
      return <li key={index} className="px-3.5 py-3 text-sm">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{item.question}</p>
        <div className="mt-1 flex flex-wrap items-start gap-2">
          <p className="min-w-0 flex-1 whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{item.answer}</p>
          <button type="button" onClick={() => setOpen(open === index ? null : index)} className="shrink-0" aria-expanded={open === index} aria-label={`Show sources for “${item.question}”`}><Pill tone={tag.tone}>{tag.label}</Pill></button>
        </div>
        {open === index && <ul className="mt-2 space-y-1 rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-400">{item.sources.map((source, position) => <li key={position} className="break-words">{source}</li>)}</ul>}
      </li>;
    })}</ul>
  </section>;
}

function ApplicationReview({ run, onChange }: { run: ApplicationView; onChange: (run: ApplicationView) => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState<"update" | "submit" | "cancel" | "draft" | "save_draft" | null>(null);
  const [draftingField, setDraftingField] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draftNotes, setDraftNotes] = useState<Record<string, string[]>>({});
  const editable = reviewStatuses.includes(run.status) && run.workerActive && pending === null;
  const dirty = Object.keys(answers).length > 0;
  const missing = missingRequired(run.snapshot?.fields ?? []);
  const working = workingStatuses.includes(run.status);
  const reviewing = reviewStatuses.includes(run.status);
  const isDraft = run.status === "draft_saved" || run.status === "draft_unconfirmed";
  const fields = run.snapshot?.fields.filter((field) => field.type !== "file") ?? [];
  const canSubmit = editable && !dirty && reviewed && missing.length === 0 && Boolean(run.snapshot?.resume) && run.snapshot?.readyToSubmit !== false && !run.snapshot?.notice;

  async function command(action: "update" | "submit" | "cancel" | "draft" | "save_draft", fieldId?: string, refresh = false) {
    setPending(action); setError(""); setReviewed(false); if (action === "draft") setDraftingField(fieldId ?? null);
    try {
      const payload = await getJson(`/api/job-applications/${run.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, revision: run.revision, ...(action === "update" ? { answers: refresh ? {} : answers } : {}), ...(fieldId ? { fieldId } : {}) }) });
      if (action === "draft" && fieldId) { setAnswers((old) => ({ ...old, [fieldId]: payload.answer })); setDraftNotes((old) => ({ ...old, [fieldId]: payload.sourceQuotes })); }
      else { onChange(payload); if (action === "update") setAnswers({}); }
    } catch (error) { setError(error instanceof Error ? error.message : "Request failed."); }
    finally { setPending(null); setDraftingField(null); }
  }
  function change(id: string, value: string) { setAnswers((old) => ({ ...old, [id]: value })); setReviewed(false); }

  const submitHint = run.snapshot?.readyToSubmit === false ? "Finish the remaining Indeed steps before submitting." : run.snapshot?.notice ? "Resolve the form's notice first." : !run.workerActive ? "The browser worker is offline." : dirty ? "Save your answers before submitting." : missing.length > 0 ? `${missing.length} required answer${missing.length === 1 ? "" : "s"} still missing in the browser.` : !run.snapshot?.resume ? "The CV has not been uploaded to the form yet." : !reviewed ? "Confirm your review to enable submission." : "Ready to submit.";

  return <section className={`${cardClass} overflow-hidden`} aria-label="Application review">
    <div className={cardHeaderClass}>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">{run.jobTitle}</h2>
          <Pill tone={statusMeta[run.status].tone} pulse={working && run.workerActive}>{statusMeta[run.status].label}</Pill>
        </div>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{[run.company, marketOf(run.url), run.profileName ? `Profile: ${run.profileName}` : ""].filter(Boolean).join(" · ")} · <a href={run.url} target="_blank" rel="noreferrer" className={linkButton}>Posting ↗</a></p>
      </div>
      {isDraft && <a href={run.snapshot?.indeedDraft?.continueUrl ?? run.url} target="_blank" rel="noreferrer" className={primaryButton}>{run.status === "draft_saved" ? "Continue on Indeed" : "Check on Indeed"} ↗</a>}
      {["queued", "preparing", ...reviewStatuses].includes(run.status) && <button type="button" className={secondaryButton} disabled={pending !== null} onClick={() => command("cancel")}>{pending === "cancel" ? "Cancelling…" : "Cancel"}</button>}
      {["failed", "cancelled"].includes(run.status) && <Link className={primaryButton} href={`/job-applications?rewrite=${run.rewriteId}`}>Prepare again</Link>}
    </div>

    {isDraft && <div className="px-5 pb-4 sm:px-6">
      <p className="text-sm text-zinc-800 dark:text-zinc-200">{run.status === "draft_saved" ? <><strong>Saved on Indeed</strong> {relativeTime(run.snapshot?.indeedDraft?.savedAt ?? run.updatedAt)}{draftKeptFor(run.snapshot?.indeedDraft?.savedAt) ? ` · ${draftKeptFor(run.snapshot?.indeedDraft?.savedAt)}` : ""} · not submitted.</> : <><strong>Save not confirmed</strong> · {relativeTime(run.updatedAt)}.</>}</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{run.status === "draft_saved" ? "Finish on Indeed: open the posting and choose Continue application." : "Open the posting to check whether the draft saved."}{run.snapshot?.indeedDraft?.evidence ? ` Last checked: ${run.snapshot.indeedDraft.evidence}` : ""}</p>
    </div>}
    {!isDraft && (run.message || working || run.confirmation) && <div className="space-y-2 px-5 pb-4 sm:px-6">
      {working && <p className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"><span aria-hidden="true" className={spinnerClass} />{run.status === "queued" ? "Waiting for a free browser session…" : "The browser worker is processing this step…"}</p>}
      {run.message && <Notice tone={run.status === "failed" ? "danger" : run.status === "uncertain" || run.status === "needs_input" ? "warning" : "neutral"} role="status">{run.message}</Notice>}
      {run.confirmation && <Notice tone="success" role="status">{run.confirmation}</Notice>}
    </div>}

    {run.autoApply && (working || reviewing) && <Notice tone="info" className="mx-5 mb-4 sm:mx-6">Automatic: saved as a draft on Indeed when complete. You submit it.</Notice>}
    {run.answerEvidence?.length > 0 && <AnswersGiven evidence={run.answerEvidence} />}
    {run.snapshot && <>
      <dl className="grid gap-x-6 gap-y-2 border-t border-zinc-100 px-5 py-4 text-sm sm:grid-cols-2 sm:px-6 dark:border-zinc-800">
        {run.profileName && <div className="min-w-0"><dt className="text-xs text-zinc-500 dark:text-zinc-400">CV profile</dt><dd className="mt-0.5 truncate font-medium text-zinc-900 dark:text-zinc-100">{run.profileName}</dd></div>}
        <div className="min-w-0"><dt className="text-xs text-zinc-500 dark:text-zinc-400">Last update</dt><dd className="mt-0.5 truncate font-medium text-zinc-900 dark:text-zinc-100" title={new Date(run.updatedAt).toLocaleString()}>{relativeTime(run.updatedAt)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-zinc-500 dark:text-zinc-400">Last Indeed step</dt><dd className="mt-0.5 truncate font-medium text-zinc-900 dark:text-zinc-100">{run.snapshot.title}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-zinc-500 dark:text-zinc-400">Uploaded CV</dt><dd className="mt-0.5 truncate font-medium text-zinc-900 dark:text-zinc-100">{run.snapshot.resume || <span className="text-amber-700 dark:text-amber-300">Not uploaded</span>} · <Link href={`/api/rewrites/${run.rewriteId}/cv.pdf`} target="_blank" className={linkButton}>Preview PDF</Link></dd></div>
      </dl>
      {run.snapshot.notice && <Notice tone="warning" role="alert" className="mx-5 mb-4 sm:mx-6">{run.snapshot.notice}</Notice>}
      {run.snapshot.reviewText && <details className="mx-5 mb-4 rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800 sm:mx-6"><summary className="cursor-pointer font-medium">Indeed final application review</summary><p className="mt-3 whitespace-pre-wrap">{run.snapshot.reviewText}</p></details>}

      {(reviewing || (!run.answerEvidence?.length && fields.length > 0 && !isDraft)) && <div className={cardBodyClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">{reviewing ? "Form answers" : "Last form step"} <span className="font-normal text-zinc-500 dark:text-zinc-400">· {fields.length}</span></h3>
          {reviewing && <button type="button" className={linkButton} disabled={!editable || dirty} onClick={() => command("update", undefined, true)}>{pending === "update" && !dirty ? "Refreshing…" : "Refresh from browser"}</button>}
        </div>
        <div className="mt-4 space-y-4">{fields.map((field) => {
          const value = answers[field.id] ?? field.value;
          const edited = field.id in answers;
          const isMissing = missing.some((item) => item.id === field.id);
          return <div key={field.id} className={`rounded-xl border p-3.5 ${isMissing ? "border-amber-200 bg-amber-50/40 dark:border-amber-900/60 dark:bg-amber-950/20" : "border-zinc-200 dark:border-zinc-800"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <label className={labelClass} htmlFor={field.id}>{field.label}{field.required && <span className="ml-1 text-red-600 dark:text-red-400" aria-hidden="true">*</span>}</label>
              {edited && <Pill tone="info">Unsaved</Pill>}
              {isMissing && !edited && <Pill tone="warning">Required</Pill>}
            </div>
            {field.type === "checkbox" ? <label className="mt-2 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300"><input id={field.id} type="checkbox" className="size-4 accent-blue-700" disabled={!editable} checked={value === "true"} onChange={(event) => change(field.id, String(event.target.checked))} />Yes</label>
              : field.options.length ? <select id={field.id} className={inputClass} disabled={!editable} value={value} onChange={(event) => change(field.id, event.target.value)}><option value="">Choose an answer</option>{field.options.filter((option) => option.value !== "").map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
              : field.type === "textarea" ? <textarea id={field.id} className={inputClass} rows={4} maxLength={10000} disabled={!editable} value={value} onChange={(event) => change(field.id, event.target.value)} />
              : <input id={field.id} className={inputClass} disabled={!editable} maxLength={10000} type={["email", "tel", "url", "date", "number"].includes(field.type) ? field.type : "text"} value={value} onChange={(event) => change(field.id, event.target.value)} />}
            {canDraft(field) && <button type="button" disabled={!editable} className={`${linkButton} mt-2 inline-flex items-center gap-2`} onClick={() => command("draft", field.id)}>{draftingField === field.id && <span aria-hidden="true" className={spinnerClass} />}{draftingField === field.id ? "Drafting and checking…" : "Draft from profile + CV"}</button>}
            {draftNotes[field.id] && <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-400"><p className="font-medium text-zinc-700 dark:text-zinc-300">AI draft. Sources:</p>{draftNotes[field.id].map((quote, index) => <blockquote key={index} className="mt-1.5 border-l-2 border-zinc-300 pl-2 dark:border-zinc-700">{quote}</blockquote>)}</div>}
          </div>;
        })}</div>
      </div>}
    </>}

    {reviewing && <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:px-6">
      <label className="flex items-start gap-2.5 text-sm text-zinc-800 dark:text-zinc-200"><input type="checkbox" className="mt-0.5 size-4 accent-blue-700" checked={reviewed} disabled={!editable || dirty || missing.length > 0} onChange={(event) => setReviewed(event.target.checked)} />I reviewed this employer, the CV and all answers, and want to submit this application.</label>
    </div>}
    {error && <Notice tone="danger" role="alert" className="mx-5 mb-4 sm:mx-6">{error}</Notice>}
    {reviewing && <div className={cardFooterClass}>
      <p className={`text-sm ${canSubmit ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>{submitHint}</p>
      <div className="ml-auto flex flex-wrap gap-2">
        <button type="button" className={secondaryButton} disabled={!editable || !dirty} onClick={() => command("update")}>{pending === "update" && dirty && <span aria-hidden="true" className={spinnerClass} />}{pending === "update" && dirty ? "Saving…" : run.autoApply ? "Save and continue automatically" : "Save answers"}</button>
        {/^https:\/\/(?:[a-z]+\.)?indeed\.com\//.test(run.url) && <button type="button" className={secondaryButton} disabled={!editable || dirty} onClick={() => command("save_draft")}>{pending === "save_draft" ? "Saving on Indeed…" : "Save draft on Indeed"}</button>}
        <button type="button" className={primaryButton} disabled={!canSubmit} onClick={() => command("submit")}>{pending === "submit" && <span aria-hidden="true" className={`${spinnerClass} border-white/40 border-t-white`} />}{pending === "submit" ? "Submitting…" : "Submit application"}</button>
      </div>
    </div>}
  </section>;
}
