import type { AnswerEvidence, ApplicationField } from "./types";

/**
 * Automatic runs answer routine eligibility and consent questions by rule instead of pausing for the person:
 * the applicant chose automatic applications knowing these are answered affirmatively for suitable jobs.
 * Polarity follows the question: "authorized to work" is yes, "require sponsorship" is no.
 */
type Rule = { pattern: RegExp; polarity: "yes" | "no"; reason: string };

const RULES: Rule[] = [
  { pattern: /without (?:visa )?sponsor|ohne (?:visa-?)?sponsor/i, polarity: "yes", reason: "authorized to work without sponsorship" },
  { pattern: /sponsor\w*|visa\w*/i, polarity: "no", reason: "no visa sponsorship required" },
  { pattern: /authori[sz]\w*|eligib\w*|legally (?:able|permitted|allowed)|right to work|permission to work|work permit|arbeitserlaubnis|arbeitsgenehmigung|arbeitsberechtig\w*/i, polarity: "yes", reason: "authorized to work" },
  { pattern: /(?:at least|over|older than|minimum(?: age)?) 18|18 (?:years|jahre)|legal (?:working )?age|volljährig/i, polarity: "yes", reason: "of legal working age" },
  { pattern: /background (?:check|screening)|drug (?:test|screen)|reference check|hintergrundprüfung/i, polarity: "yes", reason: "consents to standard checks" },
  { pattern: /certif\w*|attest\w*|confirm\w* (?:that )?(?:the|all|my|this)|accurate|truthful|wahrheitsgemäß|bestätig\w*/i, polarity: "yes", reason: "certifies the application is accurate" },
  { pattern: /\b(?:agree|consent|acknowledge|accept)\b|zustimm\w*|einverstanden|akzeptier\w*/i, polarity: "yes", reason: "agrees to the stated terms" },
];

const YES = /^(?:yes|ja|y|true|i (?:am|do|agree|consent|confirm|certify)|agree|accept)\b/i;
const NO = /^(?:no|nein|n|false|i (?:do not|don't|am not))\b/i;

/** Questions the policy owns; the model never answers these. Exported for the answer generator. */
export function isPolicyQuestion(label: string) {
  return RULES.some((rule) => rule.pattern.test(label));
}

function pick(field: ApplicationField, polarity: "yes" | "no", german: boolean) {
  const wanted = polarity === "yes" ? YES : NO;
  const rejected = polarity === "yes" ? NO : YES;
  if (field.options.length) {
    const exact = field.options.find((option) => wanted.test(option.label.trim()) && !rejected.test(option.label.trim()));
    return exact?.value ?? null;
  }
  if (field.type === "checkbox") return polarity === "yes" ? "true" : null;
  if (["text", "textarea"].includes(field.type)) return polarity === "yes" ? (german ? "Ja" : "Yes") : (german ? "Nein" : "No");
  return null;
}

/**
 * Answers the eligibility and consent questions among `fields`. Only blank fields are answered, only when the
 * control offers a clear yes/no (or is free text), and each answer carries its rule as evidence.
 */
export function policyAnswers(fields: ApplicationField[], facts: Record<string, string> = {}): { answers: Record<string, string>; evidence: AnswerEvidence[] } {
  const answers: Record<string, string> = {};
  const evidence: AnswerEvidence[] = [];
  for (const field of fields) {
    if (field.value.trim() || field.type === "file" || /signature|unterschrift/i.test(field.label)) continue;
    const rule = RULES.find((item) => item.pattern.test(field.label));
    if (!rule) continue;
    let { polarity, reason } = rule;
    // A saved fact that the applicant does need sponsorship overrides the default.
    if (rule.reason === "no visa sponsorship required" && facts["details.requiresVisaSponsorship"] === "true") { polarity = "yes"; reason = "the saved details say sponsorship is required"; }
    const german = /[äöüß]|\b(?:sie|ich|bin|sind|haben)\b/i.test(field.label);
    const value = pick(field, polarity, german);
    if (value === null) continue;
    answers[field.id] = value;
    evidence.push({ question: field.label, answer: field.options.find((option) => option.value === value)?.label ?? value, sources: [`automatic-apply policy: ${reason}`] });
  }
  return { answers, evidence };
}
