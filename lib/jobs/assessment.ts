import type { SearchPreferences } from "./preferences";
import { z } from "zod";
import { hasEvidence } from "../ai/evidence";

// Evidence coverage ranks plausible candidates; it is not an employer's qualification verdict.
export const MIN_MATCH_SCORE = 50;
// Carries the offending quotation so a single corrective retry can name it.
export class EvidenceError extends Error {
  constructor(message: string, public readonly quote = "") { super(message); this.name = "EvidenceError"; }
}
export const jobAssessmentSchema = z.object({
  roleFit: z.enum(["aligned", "uncertain", "different"]),
  requirements: z.array(z.object({
    requirement: z.string().trim().min(1).max(500),
    shortLabel: z.string().trim().min(1).max(48).optional().describe("A neutral 2–6 word topic label for the card, e.g. Experience duration, Backend frameworks, SQL diagnostics. No quotation, status, or sentence; keep the full qualification in requirement."),
    jobQuote: z.string().trim().min(1).max(1500).describe("An EXACT CONTIGUOUS substring copied from the posting. No ellipses, omitted words, rephrasing or added labels."),
    importance: z.enum(["required", "preferred"]),
    status: z.enum(["met", "partial", "not_demonstrated", "contradicted"]),
    cvQuote: z.string().trim().max(1500).describe("An EXACT CONTIGUOUS substring copied from the CV. No ellipses or rephrasing. Empty only for not_demonstrated."),
    explanation: z.string().trim().min(1).max(700),
  }).strict()).min(1).max(30),
}).strict();
export type JobAssessment = z.infer<typeof jobAssessmentSchema> & { preferences?: SearchPreferences };

export function assessRequirements(assessment: JobAssessment, cv: string, job: string) {
  let points = 0, total = 0;
  const seen = new Set<string>();
  for (const item of assessment.requirements) {
    if (!hasEvidence(job, item.jobQuote)) throw new EvidenceError("A requirement citation is absent from the posting.", item.jobQuote);
    const key = item.requirement.toLowerCase();
    if (seen.has(key)) throw new EvidenceError("The same requirement was scored twice.", item.requirement);
    seen.add(key);
    if (item.status !== "not_demonstrated" && !hasEvidence(cv, item.cvQuote)) throw new EvidenceError("A CV citation is missing or absent from the source.", item.cvQuote);
    if (item.status === "not_demonstrated" && item.cvQuote) throw new EvidenceError("A not-demonstrated requirement must not claim CV evidence.", item.cvQuote);
    const weight = item.importance === "required" ? 3 : 1;
    total += weight;
    points += weight * (item.status === "met" ? 1 : item.status === "partial" ? 0.5 : 0);
  }
  const score = Math.round(100 * points / total);
  const suitable = score >= MIN_MATCH_SCORE && assessment.roleFit === "aligned" &&
    assessment.requirements.some((item) => item.status === "met" || item.status === "partial") &&
    !assessment.requirements.some((item) => item.importance === "required" && item.status === "contradicted");
  const met = assessment.requirements.filter((item) => item.status === "met");
  return {
    score, suitable, assessment,
    matched: met.map((item) => item.requirement),
    missing: assessment.requirements.filter((item) => item.status !== "met").map((item) => `${item.requirement} (${item.status.replaceAll("_", " ")})`),
    rationale: `CV evidence coverage: ${score}/100. ${suitable ? "Worth considering; eligible for tailoring even with gaps. This is not a hiring prediction." : assessment.roleFit !== "aligned" ? "Career alignment needs review before automatic tailoring." : "Insufficient evidence overlap or an explicitly conflicting required qualification. Missing CV evidence alone does not mean the applicant is unqualified."}`,
  };
}
