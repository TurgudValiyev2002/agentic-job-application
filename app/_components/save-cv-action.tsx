"use client";

import Link from "next/link";
import { useState } from "react";

import { linkButton, primaryButton, spinnerClass } from "./ui";

export type SavedRewriteState = { documentId: string; isPipelineCv: boolean } | null;

/** Makes an improved CV the one the pipeline starts with. */
export function SaveCvAction({ rewriteId, initialSaved }: { rewriteId: string; initialSaved?: SavedRewriteState }) {
  const [saved, setSaved] = useState<SavedRewriteState>(initialSaved ?? null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/rewrites/${rewriteId}/save`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error ?? "The improved CV could not be saved.");
        return;
      }
      setSaved({ documentId: payload.document.id, isPipelineCv: true });
    } catch {
      setError("The save request could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-emerald-200 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-emerald-900">
      {saved?.isPipelineCv ? (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-300">
          <span className="font-semibold">Saved.</span> The pipeline now starts with this CV.{" "}
          <Link href="/pipeline" className={linkButton}>Open pipeline →</Link>
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Save it to use it in the pipeline.</p>
      )}
      {!saved?.isPipelineCv && (
        <button type="button" onClick={save} disabled={pending} className={primaryButton}>
          {pending && <span aria-hidden="true" className={`${spinnerClass} border-white/40 border-t-white`} />}
          {pending ? "Saving…" : "Save as my CV"}
        </button>
      )}
      {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}
