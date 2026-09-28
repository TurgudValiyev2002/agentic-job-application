import "server-only";
import { eq } from "drizzle-orm";
import { db, applications, cvDocuments, cvRewrites, educationEntries, workExperiences, applicationSkills, applicationLanguages } from "../db";
import type { ApplicantProfile } from "./types";

export type AnswerSources = { cv: string; facts: Record<string, string> };

/** Only this CV's linked intake is used. Never fall back to another person's latest Details form. */
export async function applicationAnswerSources(cvDocumentId: string, profile: ApplicantProfile): Promise<AnswerSources> {
  let [document] = await db.select().from(cvDocuments).where(eq(cvDocuments.id, cvDocumentId));
  const visited = new Set<string>();
  while (document?.sourceRewriteId) {
    if (visited.has(document.id) || visited.size >= 20) throw new Error("The original CV source could not be resolved.");
    visited.add(document.id);
    const [rewrite] = await db.select().from(cvRewrites).where(eq(cvRewrites.id, document.sourceRewriteId));
    // CVs rendered directly from Details contain user-entered facts, with no LLM rewriting.
    if (rewrite?.provider === "none" && !rewrite.cvDocumentId && document.applicationId) break;
    if (!rewrite?.cvDocumentId) throw new Error("The original CV behind this rewrite is unavailable. Upload the source CV to continue.");
    [document] = await db.select().from(cvDocuments).where(eq(cvDocuments.id, rewrite.cvDocumentId));
  }
  if (!document?.extractedText) throw new Error("The original CV is no longer readable.");
  const facts: Record<string, string> = {};
  const add = (prefix: string, row: Record<string, unknown>, keys: readonly string[]) => {
    for (const key of keys) {
      const value = row[key];
      if (value !== null && value !== undefined && String(value).trim()) facts[`${prefix}.${key}`] = typeof value === "string" ? value : JSON.stringify(value);
    }
  };
  if (document.applicationId) {
    const [intake] = await db.select().from(applications).where(eq(applications.id, document.applicationId));
    // A changed contact email must not mix a saved profile with somebody else's intake.
    if (intake && intake.email.toLowerCase() === profile.email.toLowerCase()) {
      add("details", intake, ["firstName", "lastName", "email", "phone", "addressLine1", "addressLine2", "city", "stateRegion", "postalCode", "country", "headline", "summary", "yearsOfExperience", "currentEmployer", "desiredPosition", "employmentType", "workArrangement", "earliestStartDate", "expectedSalaryAmount", "expectedSalaryCurrency", "noticePeriod", "interests", "volunteering", "achievements", "certifications", "publications", "coverLetter", "howDidYouHear"]);
      // These legacy checkboxes defaulted to false. Absence of a choice is not evidence for "no".
      if (intake.willingToRelocate) facts["details.willingToRelocate"] = "true";
      if (intake.requiresVisaSponsorship) facts["details.requiresVisaSponsorship"] = "true";
      const related = await Promise.all([
        db.select().from(educationEntries).where(eq(educationEntries.applicationId, intake.id)),
        db.select().from(workExperiences).where(eq(workExperiences.applicationId, intake.id)),
        db.select().from(applicationSkills).where(eq(applicationSkills.applicationId, intake.id)),
        db.select().from(applicationLanguages).where(eq(applicationLanguages.applicationId, intake.id)),
      ]);
      const names = ["education", "experience", "skills", "languages"];
      related.forEach((rows, i) => rows.forEach((row, j) => add(`${names[i]}.${j}`, row, Object.keys(row).filter(key => !["id", "applicationId", "sortOrder"].includes(key)))));
    }
  }
  add("profile", profile, Object.keys(profile));
  return { cv: document.extractedText, facts };
}
