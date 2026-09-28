// How one job's CV is tailored when the fact-checks keep rejecting drafts. Pure, so it is tested without a model.
//
// 1. strict:  the normal rewrite and checks (with their one repair call).
// 2. lenient: the same rewrite, but lines the audit cannot verify and invalid added skills are removed instead
//             of failing the CV. Nothing unverified is ever kept.
// 3. profile: the profile's own reviewed CV is used for this job, untailored.
// Only rejections escalate. Network, timeout and configuration errors are thrown so the run retries them later;
// the level reached is stored on the job, so a retried run continues where it stopped.

/** `removed` counts the lines lenient mode had to drop; a lenient draft that needed none is a plain success. */
export type TailorAttempt = { ok: true; rewriteId: string; removed?: number } | { ok: false; rejected: boolean; message: string };
export type Tailoring = "lenient" | "profile";

export async function tailorWithEscalation(
  job: { tailorRejections?: number },
  steps: {
    strict: () => Promise<TailorAttempt>;
    lenient: () => Promise<TailorAttempt>;
    /** The profile CV saved for this job, or null when the profile has none (an uploaded file). */
    profile: () => Promise<string | null>;
    onEscalate?: (next: Tailoring, reason: string) => Promise<void>;
  },
): Promise<{ rewriteId: string; tailoring?: Tailoring }> {
  let reason = "";
  for (let level = job.tailorRejections ?? 0; level < 2; level++) {
    const attempt = await (level === 0 ? steps.strict() : steps.lenient());
    if (attempt.ok) return level === 0 || !attempt.removed ? { rewriteId: attempt.rewriteId } : { rewriteId: attempt.rewriteId, tailoring: "lenient" };
    if (!attempt.rejected) throw new Error(attempt.message);
    reason = attempt.message;
    job.tailorRejections = level + 1;
    await steps.onEscalate?.(level === 0 ? "lenient" : "profile", reason);
  }
  const rewriteId = await steps.profile();
  if (!rewriteId) throw new Error(`${reason || "Tailoring was rejected."} This profile has no reviewed CV to fall back on.`);
  return { rewriteId, tailoring: "profile" };
}
