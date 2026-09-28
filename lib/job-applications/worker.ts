import "server-only";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { and, eq, inArray } from "drizzle-orm";
import { db, jobApplications, applicationWorkers } from "../db";
import { claimApplication, rewriteContext } from "./store";
import { LeverBrowser } from "./lever";
import { IndeedApplyBrowser } from "./indeed";
import { applicationKind, type ApplicationAdapter } from "./adapter";
import { loadIndeedSession, refreshIndeedSession } from "../indeed/session";
import { launchIndeedBrowser, verificationWaitMs } from "../indeed/browser";
import { compileLatexToPdf } from "../latex/compile";
import { cvContentSchema } from "../cv/content";
import { cvApplicationFilename } from "../cv/download-filename";
import { activeStatuses, missingRequired, type ApplicationSnapshot, type ApplicationStatus, type AnswerEvidence } from "./types";
import { CV_REWRITE_PROMPT_VERSION } from "../ai/cv-rewrite";

import { applicationAnswerSources } from "./answer-sources";
import { generateAutoAnswers } from "./auto-answers";
import { fillAutomaticApplication } from "./automatic";

/** Where a saved draft lives: on the posting itself. My jobs → Saved lists drafts only for jobs in the account's own country. */
export const DRAFT_SAVED_MESSAGE = "Saved on Indeed, not submitted. Open the posting and click Continue application to finish (My jobs → Saved shows it only for jobs in your account's country). Indeed keeps unfinished applications for up to 14 days; the job may close sooner. Review the CV and answers when reopening.";

/** The saved-draft message, warning when the tailored CV was not confirmed on Indeed (for example, it could not be uploaded). */
export function draftSavedMessage(snapshot?: { resume?: string } | null) {
  return snapshot?.resume ? DRAFT_SAVED_MESSAGE : `${DRAFT_SAVED_MESSAGE} The tailored CV could not be confirmed on this draft: Indeed may use your saved resume instead. Select or upload the tailored CV on Indeed before submitting.`;
}

type Session = { context: BrowserContext; adapter: ApplicationAdapter; startedAt: number; indeedVersion?: string; readinessCheckedAt?: number; pendingSince?: number; draftAttempted?: boolean; draftCheckedAt?: number };
export class ApplicationWorker {
  private sessions = new Map<string, Session>();
  constructor(public id: string, private dependencies: { launch?: () => Promise<Browser>; compile?: (latex: string) => Promise<Uint8Array>; generateAnswers?: typeof generateAutoAnswers } = {}) {}
  async heartbeat() {
    await db.insert(applicationWorkers).values({ id: this.id }).onConflictDoUpdate({ target: applicationWorkers.id, set: { lastSeenAt: new Date() } });
    await db.update(jobApplications).set({ heartbeatAt: new Date() }).where(and(eq(jobApplications.workerId, this.id), inArray(jobApplications.status, activeStatuses)));
  }
  private async save(id: string, status: ApplicationStatus, message: string, snapshot?: ApplicationSnapshot, confirmation?: string, evidence?: AnswerEvidence[]) {
    const values = { status, message, ...(evidence?.length ? { answerEvidence: [...((await this.row(id))?.answerEvidence ?? []), ...evidence].slice(-100) } : {}), updatedAt: new Date(), ...(snapshot ? { snapshot } : {}), ...(confirmation ? { confirmation } : {}) };
    // Never revive a cancelled session or one expired by another process.
    const rows = await db.update(jobApplications).set({ ...values, ...(snapshot ? { revision: (await this.row(id))!.revision + 1 } : {}) })
      .where(and(eq(jobApplications.id, id), eq(jobApplications.workerId, this.id), inArray(jobApplications.status, activeStatuses))).returning();
    return Boolean(rows.length);
  }
  private async row(id: string) { return (await db.select().from(jobApplications).where(eq(jobApplications.id, id)))[0]; }
  private async close(id: string) {
    const session = this.sessions.get(id); this.sessions.delete(id);
    if (!session) return;
    // Indeed rotates cookies during a session; keep the saved sign-in current.
    if (session.indeedVersion) { try { await refreshIndeedSession(session.indeedVersion, await session.context.storageState()); } catch { /* Browser already gone; the saved session stays valid. */ } }
    await session.context.browser()?.close().catch(() => {});
  }
  private async review(id: string, adapter: ApplicationAdapter, message?: string) {
    const snapshot = await adapter.snapshot();
    const missing = missingRequired(snapshot.fields);
    // A page notice (for example Indeed's CAPTCHA request) is the actionable instruction; it takes precedence over a generic message.
    await this.save(id, missing.length || snapshot.notice ? "needs_input" : "review", snapshot.notice || message || (missing.length ? "Complete the missing answers, then save and review. You can also use the visible browser for special controls or CAPTCHA." : "Review the employer, uploaded CV and every answer. Nothing has been submitted."), snapshot);
  }
  private async saveIndeedDraft(id: string, adapter: ApplicationAdapter) {
    const run = await this.row(id);
    if (!run?.snapshot || !["needs_input", "review", "save_requested"].includes(run.status)) return;
    if (!adapter.saveDraft) {
      if (run.autoApply) await this.save(id, "failed", `Automatic application stopped: this platform has no supported draft save. ${run.message ?? ""}`);
      return;
    }
    const claimed = await db.update(jobApplications).set({ status: "saving_draft", message: "Saving the unfinished application on Indeed…", updatedAt: new Date() })
      .where(and(eq(jobApplications.id, id), eq(jobApplications.workerId, this.id), eq(jobApplications.status, run.status), eq(jobApplications.revision, run.revision))).returning();
    if (!claimed.length) return;
    const session = this.sessions.get(id);
    if (session) session.draftAttempted = true;
    try {
      const result = await adapter.saveDraft();
      if (result.saved) {
        await this.save(id, "draft_saved", draftSavedMessage(run.snapshot), { ...run.snapshot, readyToSubmit: false, notice: "", indeedDraft: result.draft });
        await this.close(id);
      } else {
        const status = result.attempted ? "draft_unconfirmed" : run.autoApply ? "failed" : "needs_input";
        // A failed automatic draft is final, so its message names the cause and the outcome instead of browser instructions.
        const message = status === "failed"
          ? `${run.message ? `${run.message.replace(/^Application preparation stopped: /, "")} ` : ""}${result.message.replace(/ The (?:application|browser) remains open; no (?:Indeed )?draft save was confirmed\.$/, "")} No draft was saved on Indeed.`
          : `${run.message ? `Application stopped: ${run.message} ` : ""}${result.message}`;
        await this.save(id, status, message, run.snapshot);
      }
    } catch {
      await this.save(id, "draft_unconfirmed", "Indeed draft saving could not be confirmed. Check My jobs before retrying. The local CV and answers are preserved.", run.snapshot);
    }
  }
  private async automatic(id: string, adapter: ApplicationAdapter) {
    const run = await this.row(id);
    if (!run || !run.autoApply) return this.review(id, adapter);
    try {
      const sources = await applicationAnswerSources(run.cvDocumentId, run.profile);
      const result = await fillAutomaticApplication(adapter,
        fields => (this.dependencies.generateAnswers ?? generateAutoAnswers)(fields, sources),
        (snapshot, evidence) => this.save(id, "preparing", "Filling application answers from your saved details and original CV…", snapshot, undefined, evidence));
      const saved = await this.save(id, result.ready ? "review" : "needs_input", result.message, result.snapshot);
      if (saved && result.ready) {
        // Automatic runs never submit: the complete application is saved as a draft for the person to submit on Indeed.
        await this.saveIndeedDraft(id, adapter);
      } else if (saved && result.snapshot.submissionBlock !== "pending" && !this.sessions.get(id)?.draftAttempted) {
        await this.saveIndeedDraft(id, adapter);
      }
    } catch (error) {
      const snapshot = await adapter.snapshot().catch(() => run.snapshot ?? { url: adapter.page.url(), title: "", fields: [], resume: "", notice: "", readyToSubmit: false });
      if (await this.save(id, "needs_input", `Automatic application stopped: ${error instanceof Error ? error.message : "Answer generation failed."}`, snapshot)) await this.saveIndeedDraft(id, adapter);
    }
  }
  async tick() {
    for (const [id, session] of this.sessions) {
      const run = await this.row(id);
      if (run?.status === "draft_unconfirmed" && !session.adapter.page.isClosed() && Date.now() - session.startedAt < 30 * 60_000) {
        // Indeed can take a moment to show the started application on the posting; keep checking while the browser is open.
        if (session.adapter.verifyDraft && Date.now() - (session.draftCheckedAt ?? 0) >= 20_000) {
          session.draftCheckedAt = Date.now();
          const draft = await session.adapter.verifyDraft().catch(() => null);
          if (draft && await this.save(id, "draft_saved", draftSavedMessage(run.snapshot), { ...(run.snapshot ?? { url: session.adapter.page.url(), title: "", fields: [], resume: "", notice: "" }), readyToSubmit: false, notice: "", indeedDraft: draft })) await this.close(id);
        }
        continue;
      }
      if (run?.status === "uncertain" && !session.adapter.page.isClosed() && Date.now() - session.startedAt < 30 * 60_000) continue;
      if (!run || !activeStatuses.includes(run.status) || run.workerId !== this.id) { await this.close(id); continue; }
      try {
        if (session.adapter.page.isClosed() || Date.now() - session.startedAt > 30 * 60_000) {
          await this.save(id, ["save_requested", "saving_draft"].includes(run.status) ? "draft_unconfirmed" : ["submitting", "submit_requested"].includes(run.status) ? "uncertain" : "failed", "The browser was closed or the 30-minute session expired. Check any submission outcome before continuing.");
          await this.close(id); continue;
        }
        if (run.status === "save_requested") { await this.saveIndeedDraft(id, session.adapter); continue; }
        // Give a loading button time to become ready; a visible CAPTCHA can be saved immediately.
        // Failed saves are not retried automatically and must never fall through to submission.
        if (run.autoApply && !session.draftAttempted && ["needs_input", "review"].includes(run.status) && (run.snapshot?.submissionBlock === "captcha" || run.snapshot?.submissionBlock === "pending") && Date.now() - (session.readinessCheckedAt ?? 0) >= 5_000) {
          session.readinessCheckedAt = Date.now();
          const current = await session.adapter.snapshot();
          if (!current.notice && current.readyToSubmit) await this.automatic(id, session.adapter);
          else if (current.submissionBlock === "captcha" || (current.submissionBlock === "pending" && Date.now() - (session.pendingSince ??= Date.now()) >= 60_000)) {
            await this.saveIndeedDraft(id, session.adapter); continue;
          }
          else if (current.notice !== run.snapshot?.notice || current.submissionBlock !== run.snapshot?.submissionBlock) {
            await this.save(id, "needs_input", current.notice || "Review the application before continuing.", current);
          }
        }
        if (run.status === "update_requested") {
          // An empty update means refresh answers edited in the visible browser.
          if (run.answers && Object.keys(run.answers).length) await session.adapter.fillAnswers(run.answers);
          await this.automatic(id, session.adapter);
        }
        if (run.status === "submit_requested") {
          if (!run.snapshot) throw new Error("Missing application review.");
          const validated = await session.adapter.validateForSubmission(run.snapshot);
          if (!validated.ok) {
            await this.save(id, "needs_input", validated.message, validated.snapshot);
            if (run.autoApply) await this.saveIndeedDraft(id, session.adapter);
            continue;
          }
          const claimed = await db.update(jobApplications).set({ status: "submitting", updatedAt: new Date() }).where(and(eq(jobApplications.id, id), eq(jobApplications.workerId, this.id), eq(jobApplications.status, "submit_requested"), eq(jobApplications.revision, run.revision))).returning();
          if (!claimed.length) continue;
          const { confirmation, dispatched, detail } = await session.adapter.submitOnce();
          if (detail) console.warn(`Application ${id}: submission without confirmation (${dispatched ? "request sent" : "no request sent"}): ${detail}`);
          if (!dispatched) {
            await this.review(id, session.adapter, `No submission was sent. Complete the CAPTCHA or validation shown in the browser, refresh the answers here, then review and submit again.${detail ? ` Browser state: ${detail.slice(0, 600)}` : ""}`);
            if (run.autoApply) await this.saveIndeedDraft(id, session.adapter);
            continue;
          }
          await this.save(id, confirmation ? "submitted" : "uncertain", confirmation ? "Employer confirmation received." : `Submission could not be confirmed. Check the employer page or confirmation email. Do not submit again until you know the outcome.${detail ? ` Browser state: ${detail.slice(0, 600)}` : ""}`, undefined, confirmation ?? undefined);
          // Leave uncertain results visible for inspection until the session expires.
          if (confirmation) await this.close(id);
        }
      } catch (error) {
        const latest = await this.row(id);
        const uncertain = latest && ["submitting", "submit_requested"].includes(latest.status);
        const saved = await this.save(id, uncertain ? "uncertain" : "needs_input", error instanceof Error ? error.message : "Browser action failed.");
        if (saved && run.autoApply && !uncertain) await this.saveIndeedDraft(id, session.adapter);
      }
    }
    if (this.sessions.size >= 3) return;
    const run = await claimApplication(this.id);
    if (!run) return;
    let context: BrowserContext | undefined;
    try {
      const { rewrite, job } = await rewriteContext(run.rewriteId);
      if (rewrite.promptVersion !== CV_REWRITE_PROMPT_VERSION) throw new Error("Re-tailor this CV to pass the current evidence audit.");
      const pdf = await (this.dependencies.compile ?? compileLatexToPdf)(rewrite.latex!);
      if ((await this.row(run.id))?.status !== "preparing") return;
      const kind = applicationKind(run.url);
      if (!kind) throw new Error("Unsupported application URL.");
      const indeed = kind === "indeed" ? await loadIndeedSession() : null;
      if (kind === "indeed" && !indeed) throw new Error("Sign in to Indeed on the Pipeline page before preparing an Indeed application.");
      // Indeed needs the Cloudflare-safe launcher (Patchright + real Chrome); Lever works with stock Playwright.
      const browser = await (this.dependencies.launch ?? (kind === "indeed" ? launchIndeedBrowser : () => chromium.launch({ headless: false })))();
      // Indeed Apply opens its form via a service worker; blocking service workers leaves that popup stuck on about:blank.
      context = await browser.newContext({ acceptDownloads: false, ...(kind === "indeed" ? {} : { serviceWorkers: "block" }), ...(indeed ? { storageState: indeed.state as never } : {}) });
      const page = await context.newPage(); page.setDefaultTimeout(10_000);
      const verification = {
        onWaiting: async () => { await this.save(run.id, "preparing", `Indeed browser verification detected. Trying a visible Cloudflare checkbox automatically and waiting up to ${Math.max(1, Math.round(verificationWaitMs() / 60_000))} minutes for clearance.`); },
        onCloudflareClick: async () => { await this.save(run.id, "preparing", "Attempted the Cloudflare checkbox. Waiting for Indeed to clear verification."); },
      };
      const adapter: ApplicationAdapter = kind === "indeed" ? new IndeedApplyBrowser(page, run.url, { pauseForQuestions: run.autoApply, verification }) : new LeverBrowser(page, run.url);
      await context.route("**/*", async (route) => {
        const request = route.request();
        // The main application must remain on the chosen platform: the employer's Lever host, or Indeed's own hosts.
        if (request.isNavigationRequest() && request.frame().parentFrame() === null && !adapter.allowsNavigation(request.url())) return route.abort();
        return route.fallback();
      });
      this.sessions.set(run.id, { context, adapter, startedAt: Date.now(), ...(indeed ? { indeedVersion: indeed.version } : {}) });
      await adapter.open();
      if ((await this.row(run.id))?.status !== "preparing") { await this.close(run.id); return; }
      const content = cvContentSchema.parse(rewrite.content);
      await adapter.fillProfile(run.profile, pdf, cvApplicationFilename(content.name, job.company, run.rewriteId));
      await this.automatic(run.id, adapter);
    } catch (error) {
      const session = this.sessions.get(run.id);
      // Preserve the form and its actual failure instead of closing an uploaded CV or partially filled application.
      if (session && !session.adapter.page.isClosed()) {
        const snapshot = await session.adapter.snapshot().catch(() => ({ url: session.adapter.page.url(), title: "", fields: [], resume: "", notice: "", readyToSubmit: false }));
        const saved = await this.save(run.id, "needs_input", `Application preparation stopped: ${error instanceof Error ? error.message : "Could not prepare the application."}`, snapshot);
        if (saved && run.autoApply) await this.saveIndeedDraft(run.id, session.adapter);
        return;
      }
      await this.save(run.id, "failed", error instanceof Error ? error.message : "Could not prepare the application.");
      if (context && !this.sessions.has(run.id)) await context.browser()?.close();
      await this.close(run.id);
    }
  }
  async stop() {
    for (const id of this.sessions.keys()) {
      const run = await this.row(id);
      await this.save(id, run && ["save_requested", "saving_draft"].includes(run.status) ? "draft_unconfirmed" : run && ["submitting", "submit_requested"].includes(run.status) ? "uncertain" : "failed", "Application worker stopped. Check any submission outcome before continuing.");
      await this.close(id);
    }
    await db.delete(applicationWorkers).where(eq(applicationWorkers.id, this.id));
  }
}
