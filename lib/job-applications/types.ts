import { z } from "zod";

export const applicantProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(250),
  phone: z.string().trim().max(100).default(""),
  location: z.string().trim().max(200).default(""),
  currentCompany: z.string().trim().max(200).default(""),
  linkedin: z.string().trim().max(500).default(""),
  github: z.string().trim().max(500).default(""),
  portfolio: z.string().trim().max(500).default(""),
}).strict();
export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;
export type ApplicationStatus = "queued" | "preparing" | "review" | "needs_input" | "update_requested" | "save_requested" | "saving_draft" | "draft_saved" | "draft_unconfirmed" | "submit_requested" | "submitting" | "submitted" | "uncertain" | "failed" | "cancelled";
export type ApplicationField = {
  id: string; name: string; label: string; type: string; value: string; required: boolean;
  options: { label: string; value: string }[];
  fileHash?: string;
};
export type IndeedDraft = { savedAt: string; continueUrl: string; evidence: string };
export type ApplicationSnapshot = { fields: ApplicationField[]; url: string; title: string; resume: string; notice: string; reviewText?: string; readyToSubmit?: boolean; submissionBlock?: "captcha" | "pending"; indeedDraft?: IndeedDraft };
export type AnswerEvidence = { question: string; answer: string; sources: string[] };
export type ApplicationView = {
  autoApply: boolean; answerEvidence: AnswerEvidence[];
  id: string; rewriteId: string; company: string; jobTitle: string; url: string;
  status: ApplicationStatus; profile: ApplicantProfile; snapshot: ApplicationSnapshot | null;
  revision: number; message: string | null; confirmation: string | null; workerActive: boolean;
  /** The CV profile the application was made with, when its CV is linked to one. */
  profileName: string | null;
  createdAt: string; updatedAt: string;
};
export const reviewStatuses: ApplicationStatus[] = ["review", "needs_input"];
export const activeStatuses: ApplicationStatus[] = ["preparing", "review", "needs_input", "update_requested", "save_requested", "saving_draft", "submit_requested", "submitting"];
export const workingStatuses: ApplicationStatus[] = ["queued", "preparing", "update_requested", "save_requested", "saving_draft", "submit_requested", "submitting"];
/** Exclude submitted, uncertain, saved-draft and in-progress jobs from discovery to prevent duplicates. This is not a submitted-application count. */
export const appliedStatuses: ApplicationStatus[] = ["queued", "preparing", "review", "needs_input", "update_requested", "save_requested", "saving_draft", "draft_saved", "draft_unconfirmed", "submit_requested", "submitting", "submitted", "uncertain"];
export function missingRequired(fields: ApplicationField[]) {
  return fields.filter((field) => field.required && (field.type === "checkbox" ? field.value !== "true" : !field.value.trim()));
}
export function canDraft(field: Pick<ApplicationField, "type" | "label">) {
  return field.type === "textarea"
    && !/\b(?:salar\w*|compensation|sponsor\w*|visa\w*|authori[sz]\w*|citizen\w*|disabil\w*|gender\w*|ethnic\w*|race|veteran\w*|criminal\w*|consent\w*|agree\w*|relocat\w*|start date|notice period|age|birth\w*|date of birth|right to work|work permit|availability)\b/i.test(field.label);
}
