"use client";
import { useEffect, useState } from "react";
import type { IndeedHistoryView } from "@/lib/indeed/history-data";
import { EmptyState, Notice, Pill, cardClass, primaryButton, linkButton, spinnerClass } from "./ui";
import { IndeedSession } from "./indeed-session";

const labels: Record<string, string> = { APPLIED: "Applied", VIEWED: "Viewed", REVIEWED: "Reviewed", CONTACTING: "Contacting", PHONE_SCREENED: "Phone screen", INTERVIEW: "Interview", OFFER: "Offer", HIRED: "Hired", REJECTED: "Not selected", NOT_INTERESTED: "Not interested", WITHDRAWN: "Withdrawn" };
const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });

export function IndeedHistory({ showSession = true }: { showSession?: boolean } = {}) {
  const [data, setData] = useState<IndeedHistoryView | null>(null);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("active");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/indeed-history", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Could not load your saved Indeed history.");
        const result: IndeedHistoryView = await response.json();
        setData(result);
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load Indeed history."); }
    }
    void load();
    // Reads the local snapshot only; catches sign-in replacement/removal without opening Chrome.
    const timer = setInterval(() => { if (!syncing) void load(); }, 10_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [syncing]);
  async function sync() {
    setSyncing(true); setError("");
    try {
      const response = await fetch("/api/indeed-history", { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(120_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sync Indeed history.");
      setData(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not sync Indeed history."); }
    finally { setSyncing(false); }
  }
  const snapshot = data?.snapshot;
  const rows = (snapshot?.applications ?? []).filter(job => (filter === "all" || (filter === "archived" ? job.archived : !job.archived)) && `${job.title} ${job.company} ${job.location}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="mt-8 space-y-6">
    {showSession && <IndeedSession />}
    <section aria-label="Indeed application history" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">Your Indeed activity</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{snapshot ? <>Last synced <time dateTime={snapshot.syncedAt}>{new Date(snapshot.syncedAt).toLocaleString()}</time>{data?.emailHint ? ` · ${data.emailHint}` : ""}</> : "Not synced yet."}</p>
        </div>
        <button className={primaryButton} disabled={!data?.saved || syncing} onClick={() => void sync()}>{syncing && <span aria-hidden="true" className={spinnerClass} />}{syncing ? "Syncing Indeed…" : "Sync from Indeed"}</button>
      </div>
      {error && <Notice tone="warning" role="alert">{error}{snapshot ? " Showing your last successful sync." : ""}</Notice>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([['applied', 'Applied'], ['interviews', 'Interviews'], ['saved', 'Saved jobs'], ['archived', 'Archived']] as const).map(([key, label]) => <div key={key} className={`${cardClass} p-4 sm:p-5`}><p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums text-zinc-950 dark:text-white">{snapshot ? snapshot.counts[key] : "—"}</p></div>)}
      </div>
      {snapshot?.since && <p className="text-xs text-zinc-500 dark:text-zinc-400">Since {date(snapshot.since)}</p>}
      {!data ? <p className="text-sm text-zinc-500">Loading account history…</p> : !data.saved ? <EmptyState title="Connect your Indeed account" description="Sign in, then sync." />
        : !snapshot ? <EmptyState title="Not synced yet" />
          : !snapshot.applications.length ? <EmptyState title="No applications on Indeed yet" />
            : <>
              <div className="flex flex-wrap gap-3">
                <input aria-label="Search Indeed applications" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search job or company" className="min-w-48 flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700" />
                <select aria-label="Filter Indeed applications" value={filter} onChange={event => setFilter(event.target.value)} className="rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"><option value="active">Applied</option><option value="archived">Archived</option><option value="all">All applications</option></select>
              </div>
              {rows.length ? <ul className="space-y-3">{rows.map(job => <li key={job.id} className={`${cardClass} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-zinc-950 dark:text-white">{job.title}</h3><p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{job.company}{job.location ? ` · ${job.location}` : ""}</p></div><Pill tone={job.status === "REJECTED" || job.status === "WITHDRAWN" ? "neutral" : "info"}>{labels[job.status] ?? job.status}</Pill></div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">{job.appliedAt && <span>Applied <time dateTime={job.appliedAt}>{date(job.appliedAt)}</time></span>}{job.archived && <span>Archived</span>}{job.statusSource === "self_reported" && <span>Status added by you in Indeed</span>}{job.url && <a href={job.url} target="_blank" rel="noreferrer" className={linkButton}>View posting ↗</a>}</div>
              </li>)}</ul> : <p className="py-5 text-center text-sm text-zinc-500">No applications match this filter.</p>}
            </>}
      <a href="https://myjobs.indeed.com/applied" target="_blank" rel="noreferrer" className={`${linkButton} inline-block`}>Open Indeed My Jobs ↗</a>
    </section>
  </div>;
}
