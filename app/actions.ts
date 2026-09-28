"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { persistApplication } from "@/lib/db/application-write";
import { applicationSchema } from "@/lib/validation/application";

export type ApplicationActionState =
  | {
      ok: false;
      errors: Record<string, string[]>;
      message: string;
      values: Record<string, string>;
    }
  | {
      ok: true;
      applicationId: string;
      operation: "inserted" | "updated";
    };

function scalarValues(formData: FormData) {
  const values: Record<string, string> = {};

  for (const [name, value] of formData.entries()) {
    if (
      typeof value !== "string" ||
      name.startsWith("$ACTION_") ||
      name.startsWith("_") ||
      name.endsWith("Json")
    ) {
      continue;
    }

    values[name] = value;
  }

  return values;
}

function parseJsonField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string") return [];
  return JSON.parse(raw);
}

function validationErrors(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
) {
  const errors: Record<string, string[]> = {};

  for (const issue of issues) {
    const key = issue.path.length ? issue.path.join(".") : "_form";
    (errors[key] ??= []).push(issue.message);
  }

  return errors;
}

// This action is publicly reachable. Add authentication and rate limiting here
// before exposing the application form in a real production environment.
export async function submitApplication(
  _prevState: ApplicationActionState | null,
  formData: FormData,
): Promise<ApplicationActionState> {
  const values = scalarValues(formData);
  let repeatables: {
    education: unknown;
    experience: unknown;
    skills: unknown;
    languages: unknown;
    references: unknown;
    hobbies: unknown;
    interests: unknown;
  };

  try {
    repeatables = {
      education: parseJsonField(formData, "educationJson"),
      experience: parseJsonField(formData, "experienceJson"),
      skills: parseJsonField(formData, "skillsJson"),
      languages: parseJsonField(formData, "languagesJson"),
      references: parseJsonField(formData, "referencesJson"),
      hobbies: parseJsonField(formData, "hobbiesJson"),
      interests: parseJsonField(formData, "interestsJson"),
    };
  } catch {
    return {
      ok: false,
      errors: { _form: ["Some repeatable form data could not be read."] },
      message: "Please review the form and try again.",
      values,
    };
  }

  const rawPayload = {
    applicationId: formData.get("applicationId"),
    name: formData.get("name"),
    targetRole: formData.get("targetRole"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    dateOfBirth: formData.get("dateOfBirth"),
    nationality: formData.get("nationality"),
    pronouns: formData.get("pronouns"),
    addressLine1: formData.get("addressLine1"),
    addressLine2: formData.get("addressLine2"),
    city: formData.get("city"),
    stateRegion: formData.get("stateRegion"),
    postalCode: formData.get("postalCode"),
    country: formData.get("country"),
    websiteUrl: formData.get("websiteUrl"),
    linkedinUrl: formData.get("linkedinUrl"),
    githubUrl: formData.get("githubUrl"),
    portfolioUrl: formData.get("portfolioUrl"),
    headline: formData.get("headline"),
    summary: formData.get("summary"),
    yearsOfExperience: formData.get("yearsOfExperience"),
    currentEmployer: formData.get("currentEmployer"),
    cvDocumentId: formData.get("cvDocumentId"),
    desiredPosition: formData.get("desiredPosition"),
    employmentType: formData.get("employmentType"),
    workArrangement: formData.get("workArrangement"),
    earliestStartDate: formData.get("earliestStartDate"),
    expectedSalaryAmount: formData.get("expectedSalaryAmount"),
    expectedSalaryCurrency: formData.get("expectedSalaryCurrency"),
    willingToRelocate: formData.get("willingToRelocate") === "on",
    requiresVisaSponsorship:
      formData.get("requiresVisaSponsorship") === "on",
    noticePeriod: formData.get("noticePeriod"),
    volunteering: formData.get("volunteering"),
    achievements: formData.get("achievements"),
    certifications: formData.get("certifications"),
    publications: formData.get("publications"),
    funFact: formData.get("funFact"),
    coverLetter: formData.get("coverLetter"),
    howDidYouHear: formData.get("howDidYouHear"),
    consentGiven: formData.get("consentGiven") === "on",
    ...repeatables,
  };

  const parsed = applicationSchema.safeParse(rawPayload);

  if (!parsed.success) {
    return {
      ok: false,
      errors: validationErrors(parsed.error.issues),
      message: "Please correct the highlighted fields and submit again.",
      values,
    };
  }

  let savedId: string;
  try {
    const result = await persistApplication(parsed.data);

    if (!result.ok) {
      return {
        ok: false,
        errors: {},
        message:
          "This application no longer exists. Reload the page or start a blank application.",
        values,
      };
    }

    revalidatePath("/apply");
    savedId = result.applicationId;
  } catch (error) {
    console.error("Failed to persist application", error);
    return {
      ok: false,
      errors: {},
      message:
        "We could not save your application right now. Please try again shortly.",
      values,
    };
  }
  redirect(`/apply?saved=${savedId}`);
}
