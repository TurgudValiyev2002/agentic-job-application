import type { Page } from "playwright";
import type { ApplicantProfile, ApplicationSnapshot, IndeedDraft } from "./types";
import { indeedJobUrl } from "../jobs/sources/indeed-data";
import { leverApplicationUrl } from "./urls";

/** One visible-browser session for a single application; the worker drives every adapter the same way. */
export interface ApplicationAdapter {
  page: Page;
  url: string;
  /** Whether the main frame may navigate to this address during the session. */
  allowsNavigation(url: string): boolean;
  open(): Promise<void>;
  snapshot(): Promise<ApplicationSnapshot>;
  fillProfile(profile: ApplicantProfile, pdf: Uint8Array, filename: string): Promise<void>;
  fillAnswers(answers: Record<string, string>): Promise<void>;
  /** Save through the platform's own controls. Never treat navigation alone as confirmation. */
  saveDraft?(): Promise<{ saved: true; draft: IndeedDraft } | { saved: false; attempted: boolean; message: string }>;
  /** Re-checks the platform for a draft after an unconfirmed save; null when none is visible yet. */
  verifyDraft?(): Promise<IndeedDraft | null>;
  validateForSubmission(expected: ApplicationSnapshot): Promise<{ ok: true; snapshot: ApplicationSnapshot } | { ok: false; snapshot: ApplicationSnapshot; message: string }>;
  /** `detail` describes what the page showed when no confirmation arrived, so an uncertain outcome can be judged. */
  submitOnce(timeoutMs?: number): Promise<{ confirmation: string | null; dispatched: boolean; detail?: string }>;
}

export type ApplicationKind = "indeed" | "lever";

export function applicationKind(url: string): ApplicationKind | null {
  if (indeedJobUrl(url)) return "indeed";
  if (leverApplicationUrl(url)) return "lever";
  return null;
}

/** Canonical application URL for a supported platform, or null. */
export function canonicalApplicationUrl(url: string): string | null {
  return indeedJobUrl(url) ?? leverApplicationUrl(url);
}
