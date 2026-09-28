import { z } from "zod";

const emptyToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalText = z.preprocess(
  emptyToUndefined,
  z.string().trim().min(1).optional(),
);

const requiredText = (message: string) =>
  z.preprocess(
    emptyToUndefined,
    z.string({ error: message }).trim().min(1, { error: message }),
  );

const optionalUrl = (label: string) =>
  z.preprocess(
    emptyToUndefined,
    z.url({ error: `${label} must be a valid URL.` }).optional(),
  );

const optionalEmail = z.preprocess(
  emptyToUndefined,
  z.email({ error: "Enter a valid email address." }).optional(),
);

const optionalNonNegativeInteger = (label: string) =>
  z.preprocess(
    (value) => {
      const normalized = emptyToUndefined(value);
      return typeof normalized === "string" ? Number(normalized) : normalized;
    },
    z
      .number({ error: `${label} must be a number.` })
      .int({ error: `${label} must be a whole number.` })
      .nonnegative({ error: `${label} cannot be negative.` })
      .optional(),
  );

const dateString = (label: string) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        error: `${label} must use YYYY-MM-DD format.`,
      })
      .refine(
        (value) => {
          const [year, month, day] = value.split("-").map(Number);
          const parsed = new Date(Date.UTC(year, month - 1, day));
          return (
            parsed.getUTCFullYear() === year &&
            parsed.getUTCMonth() === month - 1 &&
            parsed.getUTCDate() === day
          );
        },
        { error: `${label} must be a real calendar date.` },
      )
      .optional(),
  );

const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "internship",
  "freelance",
  "temporary",
]);

export const educationEntrySchema = z.object({
  institution: requiredText("Institution is required."),
  degree: optionalText,
  level: z.preprocess(
    emptyToUndefined,
    z
      .enum([
        "high_school",
        "vocational",
        "associate",
        "bachelor",
        "master",
        "doctorate",
        "other",
      ])
      .optional(),
  ),
  fieldOfStudy: optionalText,
  startDate: dateString("Start date"),
  endDate: dateString("End date"),
  isCurrent: z.boolean().default(false),
  grade: optionalText,
  description: optionalText,
});

export const workExperienceSchema = z.object({
  company: requiredText("Company is required."),
  jobTitle: requiredText("Job title is required."),
  location: optionalText,
  employmentType: z.preprocess(
    emptyToUndefined,
    employmentTypeSchema.optional(),
  ),
  startDate: dateString("Start date"),
  endDate: dateString("End date"),
  isCurrent: z.boolean().default(false),
  description: optionalText,
});

export const applicationSkillSchema = z.object({
  name: requiredText("Skill name is required."),
  level: z.preprocess(
    emptyToUndefined,
    z.enum(["beginner", "intermediate", "advanced", "expert"]).optional(),
  ),
  yearsOfExperience: optionalNonNegativeInteger("Years of experience"),
});

export const applicationLanguageSchema = z.object({
  language: requiredText("Language is required."),
  proficiency: z.enum(
    ["basic", "conversational", "professional", "fluent", "native"],
    { error: "Language proficiency is required." },
  ),
});

export const applicationReferenceSchema = z.object({
  name: requiredText("Reference name is required."),
  relationship: optionalText,
  company: optionalText,
  email: optionalEmail,
  phone: optionalText,
});

const tagArray = z
  .array(z.string().trim().min(1))
  .transform((values) => [...new Set(values)]);

export const applicationSchema = z
  .object({
    applicationId: z.preprocess(
      emptyToUndefined,
      z.uuid({ error: "The application reference is invalid." }).optional(),
    ),
    name: requiredText("Profile name is required."),
    targetRole: optionalText,
    firstName: requiredText("First name is required."),
    lastName: requiredText("Last name is required."),
    email: z.preprocess(
      emptyToUndefined,
      z.email({ error: "Enter a valid email address." }),
    ),
    phone: optionalText,
    dateOfBirth: dateString("Date of birth"),
    nationality: optionalText,
    pronouns: optionalText,
    addressLine1: optionalText,
    addressLine2: optionalText,
    city: optionalText,
    stateRegion: optionalText,
    postalCode: optionalText,
    country: optionalText,
    websiteUrl: optionalUrl("Website URL"),
    linkedinUrl: optionalUrl("LinkedIn URL"),
    githubUrl: optionalUrl("GitHub URL"),
    portfolioUrl: optionalUrl("Portfolio URL"),
    headline: optionalText,
    summary: optionalText,
    yearsOfExperience: optionalNonNegativeInteger("Years of experience"),
    currentEmployer: optionalText,
    cvDocumentId: z.preprocess(
      emptyToUndefined,
      z.uuid({ error: "The uploaded CV reference is invalid." }).optional(),
    ),
    desiredPosition: optionalText,
    employmentType: z.preprocess(
      emptyToUndefined,
      employmentTypeSchema.optional(),
    ),
    workArrangement: z.preprocess(
      emptyToUndefined,
      z.enum(["onsite", "hybrid", "remote"]).optional(),
    ),
    earliestStartDate: dateString("Earliest start date"),
    expectedSalaryAmount: optionalNonNegativeInteger("Expected salary"),
    expectedSalaryCurrency: z.preprocess(
      emptyToUndefined,
      z.string().trim().min(1).default("EUR"),
    ),
    willingToRelocate: z.boolean().default(false),
    requiresVisaSponsorship: z.boolean().default(false),
    noticePeriod: optionalText,
    hobbies: tagArray.default([]),
    interests: tagArray.default([]),
    volunteering: optionalText,
    achievements: optionalText,
    certifications: optionalText,
    publications: optionalText,
    funFact: optionalText,
    coverLetter: optionalText,
    howDidYouHear: optionalText,
    consentGiven: z.literal(true, {
      error: "You must consent to the processing of your application data.",
    }),
    education: z.array(educationEntrySchema).default([]),
    experience: z.array(workExperienceSchema).default([]),
    skills: z.array(applicationSkillSchema).default([]),
    languages: z.array(applicationLanguageSchema).default([]),
    references: z.array(applicationReferenceSchema).default([]),
  })
  .refine(
    (application) =>
      application.education.length > 0 || application.experience.length > 0,
    {
      error:
        "Add at least one education entry or work experience before submitting.",
      path: [],
    },
  );

export type ApplicationPayload = z.infer<typeof applicationSchema>;
