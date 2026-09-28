"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { listProfiles } from "@/lib/db/queries";
import { cardClass, primaryButton, secondaryButton } from "./ui";

type Row = Awaited<ReturnType<typeof listProfiles>>[number];
export type ProfileView = Omit<Row, "updatedAt" | "selectedAt" | "archivedAt"> & { updatedAt: string; selectedAt: string | null; archivedAt: string | null };
export const profileBusy = (profile: ProfileView) => ["generating", "improving", "reviewing"].includes(profile.cvStatus);
export function profileStatus(profile: ProfileView) {
  const labels = { draft: "Draft", generating: "Generating CV", improving: "Improving", reviewing: "Reviewing", ready: "Ready", failed: "Failed" };
  return labels[profile.cvStatus] + (profile.cvStatus === "ready" && profile.overallScore !== null ? ` · ${profile.overallScore}/100` : "");
}
export function useProfiles(initial: ProfileView[]) {
  const [profiles, setProfiles] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const busy = profiles.some(profileBusy);
  async function refresh() {
    const response = await fetch("/api/profiles", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not refresh profiles.");
    const data = await response.json(); setProfiles(data.profiles); setError(null);
  }
  useEffect(() => {
    if (!busy) return;
    let stopped = false;
    const timer = setInterval(() => {
      fetch("/api/profiles", { cache: "no-store" }).then(async response => {
        if (!response.ok) throw new Error("Could not refresh profiles.");
        const data = await response.json(); if (!stopped) { setProfiles(data.profiles); setError(null); }
      }).catch(error => { if (!stopped) setError(error.message); });
    }, 5_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [busy]);
  return { profiles, refresh, error, setError };
}

export function ProfileList({ initialProfiles, saved }: { initialProfiles: ProfileView[]; saved?: string }) {
  const { profiles, refresh, error, setError } = useProfiles(initialProfiles);
  const [pending, setPending] = useState<string | null>(null);
  async function act(id: string, action: string) {
    setPending(id);
    try {
      const response = await fetch(`/api/profiles/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setPending(null); }
  }
  return <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-12">
    <div className="flex items-center justify-between gap-4"><h1 className="text-3xl font-semibold">Your profiles</h1><Link className={primaryButton} href="/apply?new=1">New profile</Link></div>
    {error && <p role="alert">{error}</p>}
    {!profiles.length && <p>No profiles yet.</p>}
    <div className="space-y-4">{profiles.map((profile, index) => <section key={profile.id} className={`${cardClass} p-5 ${saved === profile.id ? "ring-2 ring-blue-500" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">{profile.name}{index === 0 && <span className="ml-3 text-sm text-blue-600">Selected for pipeline</span>}</h2><span role="status" className="rounded-full bg-zinc-100 px-3 py-1 text-sm dark:bg-zinc-800">{profileStatus(profile)}</span></div>
      {profile.targetRole && <p className="mt-2">{profile.targetRole}</p>}
      {profile.cvError && <p className="mt-2 text-sm text-amber-700 dark:text-amber-300">{profile.cvError}</p>}
      <p className="my-3 text-xs text-zinc-500">Updated <time dateTime={profile.updatedAt}>{new Date(profile.updatedAt).toLocaleString("en-GB", { timeZone: "Europe/Vienna" })}</time></p>
      <div className="flex flex-wrap gap-2">
        <Link className={secondaryButton} href={`/apply?profile=${profile.id}`}>Edit</Link>
        <Link className={secondaryButton} href={`/apply?duplicate=${profile.id}`}>Duplicate</Link>
        {profile.cvDocumentId && <Link className={secondaryButton} href={`/cv-review?profile=${profile.id}`}>View CV & review</Link>}
        {index !== 0 && <button className={secondaryButton} disabled={pending !== null || profile.cvStatus !== "ready"} onClick={() => act(profile.id, "select")}>Select for pipeline</button>}
        {/* A draft (for example the profile migrated from the old single Details record) has never been through the chain. */}
        {(profile.cvStatus === "failed" || profile.cvStatus === "draft") && <button className={secondaryButton} disabled={pending !== null} onClick={() => act(profile.id, "retry")}>{profile.cvStatus === "failed" ? "Retry" : "Generate CV"}</button>}
        {index !== 0 && <button className={secondaryButton} disabled={pending !== null} onClick={() => act(profile.id, "archive")}>Archive</button>}
      </div>
    </section>)}</div>
  </main>;
}
