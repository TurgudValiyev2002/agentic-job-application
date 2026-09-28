import "server-only";

import { and, eq, isNull, ne, or, sql } from "drizzle-orm";

import type { ApplicationPayload } from "@/lib/validation/application";

import {
  applicationLanguages,
  applicationReferences,
  applications,
  applicationSkills,
  cvDocuments,
  db,
  educationEntries,
  workExperiences,
} from "./index";

export const sharedIdentityFields = ["firstName", "lastName", "email", "phone", "dateOfBirth", "nationality", "pronouns", "addressLine1", "addressLine2", "city", "stateRegion", "postalCode", "country", "websiteUrl", "linkedinUrl", "githubUrl", "portfolioUrl"] as const;

export type PersistApplicationResult =
  | {
      ok: true;
      applicationId: string;
      operation: "inserted" | "updated";
    }
  | { ok: false; reason: "application_not_found" };

export async function persistApplication(
  payload: ApplicationPayload,
): Promise<PersistApplicationResult> {
  const {
    applicationId: submittedApplicationId,
    education,
    experience,
    skills,
    languages,
    references,
    cvDocumentId,
    ...application
  } = payload;

  return db.transaction(async (tx) => {
    // Serialize saves so identity propagation and first selection agree across concurrent requests.
    await tx.execute(sql`select pg_advisory_xact_lock(74819302)`);
    const identity = Object.fromEntries(sharedIdentityFields.map(key => [key, application[key] ?? null]));
    const values = { ...application, ...identity, targetRole: application.targetRole ?? null, cvStatus: "generating" as const, cvError: null, cvReviewId: null, jobStartedAt: null, updatedAt: new Date() };
    let applicationId: string;
    let operation: "inserted" | "updated";

    if (submittedApplicationId) {
      const [existingApplication] = await tx
        .select({ id: applications.id })
        .from(applications)
        .where(and(eq(applications.id, submittedApplicationId), isNull(applications.archivedAt)))
        .limit(1);

      if (!existingApplication) {
        return { ok: false, reason: "application_not_found" } as const;
      }

      applicationId = existingApplication.id;
      operation = "updated";

      await tx
        .update(applications)
        .set(values)
        .where(eq(applications.id, applicationId));

      await tx
        .delete(educationEntries)
        .where(eq(educationEntries.applicationId, applicationId));
      await tx
        .delete(workExperiences)
        .where(eq(workExperiences.applicationId, applicationId));
      await tx
        .delete(applicationSkills)
        .where(eq(applicationSkills.applicationId, applicationId));
      await tx
        .delete(applicationLanguages)
        .where(eq(applicationLanguages.applicationId, applicationId));
      await tx
        .delete(applicationReferences)
        .where(eq(applicationReferences.applicationId, applicationId));
    } else {
      const [created] = await tx
        .insert(applications)
        .values(values)
        .returning({ id: applications.id });

      applicationId = created.id;
      operation = "inserted";
    }

    if (education.length) {
      await tx.insert(educationEntries).values(
        education.map((entry, sortOrder) => ({
          ...entry,
          applicationId,
          sortOrder,
        })),
      );
    }

    if (experience.length) {
      await tx.insert(workExperiences).values(
        experience.map((entry, sortOrder) => ({
          ...entry,
          applicationId,
          sortOrder,
        })),
      );
    }

    if (skills.length) {
      await tx.insert(applicationSkills).values(
        skills.map((entry, sortOrder) => ({
          ...entry,
          applicationId,
          sortOrder,
        })),
      );
    }

    if (languages.length) {
      await tx.insert(applicationLanguages).values(
        languages.map((entry, sortOrder) => ({
          ...entry,
          applicationId,
          sortOrder,
        })),
      );
    }

    if (references.length) {
      await tx.insert(applicationReferences).values(
        references.map((entry, sortOrder) => ({
          ...entry,
          applicationId,
          sortOrder,
        })),
      );
    }

    await tx.update(applications).set({ ...identity, updatedAt: new Date() })
      .where(and(ne(applications.id, applicationId), isNull(applications.archivedAt)));
    const [selected] = await tx.select({ id: applications.id }).from(applications)
      .where(and(isNull(applications.archivedAt), sql`${applications.selectedAt} is not null`)).limit(1);
    if (!selected) await tx.update(applications).set({ selectedAt: new Date() }).where(eq(applications.id, applicationId));

    if (cvDocumentId) {
      const [linkedCv] = await tx
        .update(cvDocuments)
        .set({ applicationId, updatedAt: new Date() })
        .where(
          and(
            eq(cvDocuments.id, cvDocumentId),
            or(
              isNull(cvDocuments.applicationId),
              eq(cvDocuments.applicationId, applicationId),
            ),
          ),
        )
        .returning({ id: cvDocuments.id });

      if (!linkedCv) {
        throw new Error(
          "The CV is missing or already linked to another application.",
        );
      }
    }

    return { ok: true, applicationId, operation } as const;
  });
}
