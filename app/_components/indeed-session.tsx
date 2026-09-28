"use client";

import { useCallback, useEffect, useState } from "react";
import { Pill, primaryButton, secondaryButton, spinnerClass, type Tone } from "./ui";

type SessionStatus = { saved: boolean; emailHint: string | null; verifiedAt: string | null; signIn: { active: boolean; startedAt: string | null; message: string | null; patched: boolean } };
type CheckResult = { ok: boolean; message: string };

function formatVerified(iso: string) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function IndeedSession() {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const [busy, setBusy] = useState<"load" | "sign-in" | "check" | "remove" | null>("load");
  const [error, setError] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/indeed-session", { cache: "no-store", signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setSession(data);
    return data as SessionStatus;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/indeed-session", { cache: "no-store", signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); setSession(data); })
      .catch((reason) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load the session."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(null); });
    return () => controller.abort();
  }, []);

  // While the visible sign-in window is open, poll until the server records the outcome.
  const signingIn = Boolean(session?.signIn.active);
  useEffect(() => {
    if (!signingIn) return;
    const timer = setInterval(() => {
      refresh().then((data) => { if (!data.signIn.active) setNotice(data.signIn.message ?? ""); }).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [signingIn, refresh]);

  async function action(kind: "sign-in" | "check" | "remove") {
    setBusy(kind); setError(""); setNotice(""); if (kind !== "check") setCheck(null);
    try {
      const response = await fetch(kind === "remove" ? "/api/indeed-session" : `/api/indeed-session/${kind}`, {
        method: kind === "remove" ? "DELETE" : "POST", headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90_000),
      });
      const data = await response.json();
      if (!response.ok && response.status !== 409) throw new Error(data.error || "Could not update the session.");
      if (kind === "check") setCheck({ ok: Boolean(data.ok), message: data.message });
      else if (kind === "sign-in") setNotice(data.message);
      else setNotice("Session removed.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update the session."); }
    finally { setBusy(null); }
  }

  const saved = Boolean(session?.saved);
  const status: { label: string; tone: Tone; pulse?: boolean } = busy === "load" ? { label: "Checking…", tone: "neutral" }
    : signingIn ? { label: "Sign-in window open", tone: "info", pulse: true }
      : !saved ? { label: "Not signed in", tone: "neutral" }
        : session?.verifiedAt ? { label: "Signed in", tone: "success" }
          : { label: "Session saved, not verified", tone: "warning" };

  return <section aria-label="Indeed account" className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 sm:px-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-zinc-950 dark:text-white">Indeed</h2>
          <Pill tone={status.tone} pulse={status.pulse}>{status.label}</Pill>
        </div>
        <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
          {signingIn ? <>Finish signing in in the browser window that opened.</>
            : saved ? <><span className="font-medium text-zinc-700 dark:text-zinc-300">{session?.emailHint ?? "Indeed session"}</span>{session?.verifiedAt ? <> · verified <time dateTime={session.verifiedAt}>{formatVerified(session.verifiedAt)}</time></> : <> · not checked yet</>}</>
              : <>Not signed in</>}
        </p>
      </div>
      {busy !== "load" && <div className="flex flex-wrap gap-2">
        {saved && !signingIn && <button type="button" disabled={busy !== null} onClick={() => void action("check")} className={primaryButton}>
          {busy === "check" && <span aria-hidden="true" className={`${spinnerClass} border-white/40 border-t-white`} />}{busy === "check" ? "Checking…" : "Check session"}
        </button>}
        <button type="button" disabled={busy !== null || signingIn} onClick={() => void action("sign-in")} className={saved ? secondaryButton : primaryButton}>
          {busy === "sign-in" && <span aria-hidden="true" className={spinnerClass} />}{saved ? "Sign in again" : "Sign in to Indeed"}
        </button>
        {saved && !signingIn && <button type="button" disabled={busy !== null} onClick={() => void action("remove")} className={`${secondaryButton} text-red-700 dark:text-red-300`}>{busy === "remove" ? "Removing…" : "Remove"}</button>}
      </div>}
    </div>

    {check && <p role="status" className={`border-t px-5 py-3 text-sm sm:px-6 ${check.ok ? "border-emerald-100 bg-emerald-50/70 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-100 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"}`}>
      <span className="font-semibold">{check.ok ? "Signed in." : "Session check failed."}</span> {check.message}
    </p>}
    {session && !session.signIn.patched && <p role="status" className="border-t border-amber-100 bg-amber-50/70 px-5 py-3 text-sm text-amber-900 sm:px-6 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"><span className="font-semibold">Cloudflare verification will loop in stock Playwright.</span> Install Patchright on this computer, then restart the app and workers: <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs dark:bg-amber-900/50">npm install patchright@1.63.0</code></p>}
    {notice && <p role="status" className="border-t border-zinc-100 px-5 py-3 text-sm text-zinc-700 sm:px-6 dark:border-zinc-800 dark:text-zinc-300">{notice}</p>}
    {error && <p role="alert" className="border-t border-red-100 bg-red-50/70 px-5 py-3 text-sm text-red-800 sm:px-6 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</p>}
  </section>;
}
