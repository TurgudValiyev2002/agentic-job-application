"use client";

import Link from "next/link";

import { useActionState, useState } from "react";

import { submitApplication } from "@/app/actions";
import type { LatestApplication } from "@/lib/db/queries";

import { CvUpload, type UploadedCv } from "./cv-upload";
import { PageHeader, Pill, cardClass, cardHeaderClass, secondaryButton } from "./ui";

import {
  CheckboxField,
  errorAnchor,
  firstError,
  FormSection,
  SelectField,
  TextAreaField,
  TextField,
} from "./field";
import {
  EducationSection,
  ExperienceSection,
  LanguagesSection,
  ReferencesSection,
  SkillsSection,
  type EducationRow,
  type ExperienceRow,
  type LanguageRow,
  type ReferenceRow,
  type SkillRow,
} from "./repeatable-sections";
import { TagInput } from "./tag-input";

// PostgreSQL date columns arrive as calendar-date strings. Keep their YYYY-MM-DD
// portion intact instead of constructing a Date, which could shift the day by timezone.
function dateInputValue(value: string | null) {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

type InitialApplication = LatestApplication & {
  submittedAt: { iso: string; text: string };
  updatedAtDisplay: { iso: string; text: string };
};

function ApplicationFormInstance({
  onReset,
  initialApplication,
  maxCvBytes,
}: {
  onReset: () => void;
  initialApplication: InitialApplication | null;
  maxCvBytes: number;
}) {
  const [state, formAction, pending] = useActionState(submitApplication, null);
  const [education, setEducation] = useState<EducationRow[]>(() =>
    initialApplication?.education.map((entry) => ({
      id: entry.id,
      institution: entry.institution,
      degree: entry.degree ?? "",
      level: entry.level ?? "",
      fieldOfStudy: entry.fieldOfStudy ?? "",
      startDate: dateInputValue(entry.startDate),
      endDate: dateInputValue(entry.endDate),
      isCurrent: entry.isCurrent,
      grade: entry.grade ?? "",
      description: entry.description ?? "",
    })) ?? [],
  );
  const [experience, setExperience] = useState<ExperienceRow[]>(() =>
    initialApplication?.experience.map((entry) => ({
      id: entry.id,
      company: entry.company,
      jobTitle: entry.jobTitle,
      location: entry.location ?? "",
      employmentType: entry.employmentType ?? "",
      startDate: dateInputValue(entry.startDate),
      endDate: dateInputValue(entry.endDate),
      isCurrent: entry.isCurrent,
      description: entry.description ?? "",
    })) ?? [],
  );
  const [skills, setSkills] = useState<SkillRow[]>(() =>
    initialApplication?.skills.map((entry) => ({
      id: entry.id,
      name: entry.name,
      level: entry.level ?? "",
      yearsOfExperience:
        entry.yearsOfExperience === null ? "" : String(entry.yearsOfExperience),
    })) ?? [],
  );
  const [languages, setLanguages] = useState<LanguageRow[]>(() =>
    initialApplication?.languages.map((entry) => ({
      id: entry.id,
      language: entry.language,
      proficiency: entry.proficiency,
    })) ?? [],
  );
  const [references, setReferences] = useState<ReferenceRow[]>(() =>
    initialApplication?.references.map((entry) => ({
      id: entry.id,
      name: entry.name,
      relationship: entry.relationship ?? "",
      company: entry.company ?? "",
      email: entry.email ?? "",
      phone: entry.phone ?? "",
    })) ?? [],
  );
  const [hobbies, setHobbies] = useState<string[]>(
    () => initialApplication?.hobbies ?? [],
  );
  const [interests, setInterests] = useState<string[]>(
    () => initialApplication?.interests ?? [],
  );
  const [cvDocument, setCvDocument] = useState<UploadedCv | null>(() =>
    initialApplication?.cvDocument
      ? {
          ...initialApplication.cvDocument,
          extractionError: null,
          textPreview: "",
        }
      : null,
  );

  if (state?.ok) {
    const updated = state.operation === "updated";

    return (
      <main className="flex min-h-[80vh] items-center px-4 py-16 sm:px-6">
        <section className="mx-auto w-full max-w-xl rounded-2xl border border-emerald-200 bg-white p-7 shadow-sm dark:border-emerald-900 dark:bg-zinc-950 sm:p-10">
          <div className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-2xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" aria-hidden="true">
            ✓
          </div>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">
            Application {updated ? "updated" : "submitted"}
          </h1>
          <div className="mt-6 rounded-lg bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
            <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Application reference
            </p>
            <p className="mt-1 break-all font-mono text-sm text-zinc-900 dark:text-zinc-100">
              {state.applicationId}
            </p>
          </div>
          {updated ? (
            <Link
              href="/apply"
              className="mt-8 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus:ring-offset-zinc-950"
            >
              Back to the prefilled form
            </Link>
          ) : (
            <button
              type="button"
              onClick={onReset}
              className="mt-8 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus:ring-offset-zinc-950"
            >
              Submit another application
            </button>
          )}
        </section>
      </main>
    );
  }

  const errors = state && !state.ok ? state.errors : undefined;
  const submittedValues = state && !state.ok ? state.values : undefined;
  const scalarDefault = (name: string, fallback = "") => {
    if (submittedValues) return submittedValues[name] ?? "";

    const storedValue = initialApplication?.[
      name as keyof LatestApplication
    ];
    return typeof storedValue === "string" || typeof storedValue === "number"
      ? String(storedValue)
      : fallback;
  };
  const scalarChecked = (name: string, storedValue: boolean) =>
    submittedValues ? submittedValues[name] === "on" : storedValue;
  const errorKeys = errors ? Object.keys(errors).filter((key) => errors[key]?.length) : [];
  const firstErrorKey = errorKeys[0];
  const formKey = submittedValues
    ? JSON.stringify(submittedValues)
    : (initialApplication?.id ?? "new");

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto max-w-3xl">
        <PageHeader eyebrow="Details" title={initialApplication?.name || "New CV profile"} description="Contact details are shared across profiles." />

        {initialApplication?.id ? (
          <section aria-label="Saved details" className={`${cardClass} mt-8 overflow-hidden`}>
            <div className={cardHeaderClass}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{initialApplication.firstName} {initialApplication.lastName}</h2>
                  <Pill tone="success">Saved</Pill>
                </div>
                <p className="mt-0.5 truncate text-sm text-zinc-500 dark:text-zinc-400">
                  {initialApplication.email} · updated <time dateTime={initialApplication.updatedAtDisplay.iso}>{initialApplication.updatedAtDisplay.text}</time>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/apply" className={secondaryButton}>All profiles</Link>
                <Link href="/apply?new=1" className={secondaryButton}>Start blank</Link>
              </div>
            </div>
          </section>
        ) : null}

        <form key={formKey} id="application-form" action={formAction} className="mt-10 space-y-12">
          {state && !state.ok ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-5 dark:border-red-900 dark:bg-red-950/50" role="alert" aria-live="polite">
              <h2 className="font-semibold text-red-900 dark:text-red-200">Please review your application</h2>
              <p className="mt-1 text-sm leading-6 text-red-800 dark:text-red-300">{state.message}</p>
              {firstErrorKey ? (
                <a href={`#${errorAnchor(firstErrorKey)}`} className="mt-3 inline-block text-sm font-semibold text-red-800 underline underline-offset-4 hover:text-red-950 dark:text-red-300 dark:hover:text-red-100">
                  Go to the first error
                </a>
              ) : null}
            </div>
          ) : null}

          {/* Repeatable rows and tags intentionally depend on JavaScript and are
              submitted only through these controlled JSON fields. */}
          {initialApplication ? (
            <input
              type="hidden"
              name="applicationId"
              value={initialApplication.id}
            />
          ) : null}
          <input type="hidden" name="educationJson" value={JSON.stringify(education)} />
          <input type="hidden" name="experienceJson" value={JSON.stringify(experience)} />
          <input type="hidden" name="skillsJson" value={JSON.stringify(skills)} />
          <input type="hidden" name="languagesJson" value={JSON.stringify(languages)} />
          <input type="hidden" name="referencesJson" value={JSON.stringify(references)} />
          <input type="hidden" name="hobbiesJson" value={JSON.stringify(hobbies)} />
          <input type="hidden" name="interestsJson" value={JSON.stringify(interests)} />

          <FormSection title="CV profile">
            <TextField name="name" label="Profile name" defaultValue={scalarDefault("name")} required error={firstError(errors, "name")} />
            <TextField name="targetRole" label="Target role (optional)" defaultValue={scalarDefault("targetRole")} error={firstError(errors, "targetRole")} />
          </FormSection>
          <FormSection title="Personal details">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField name="firstName" label="First name" autoComplete="given-name" defaultValue={scalarDefault("firstName")} required error={firstError(errors, "firstName")} />
              <TextField name="lastName" label="Last name" autoComplete="family-name" defaultValue={scalarDefault("lastName")} required error={firstError(errors, "lastName")} />
              <TextField name="email" label="Email address" type="email" autoComplete="email" defaultValue={scalarDefault("email")} required error={firstError(errors, "email")} />
              <TextField name="phone" label="Phone number" type="tel" autoComplete="tel" defaultValue={scalarDefault("phone")} error={firstError(errors, "phone")} />
              <TextField name="dateOfBirth" label="Date of birth" type="date" defaultValue={scalarDefault("dateOfBirth")} error={firstError(errors, "dateOfBirth")} />
              <TextField name="nationality" label="Nationality" autoComplete="country-name" defaultValue={scalarDefault("nationality")} error={firstError(errors, "nationality")} />
              <TextField name="pronouns" label="Pronouns" defaultValue={scalarDefault("pronouns")} error={firstError(errors, "pronouns")} />
            </div>
          </FormSection>

          <FormSection title="Address">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField name="addressLine1" label="Address line 1" autoComplete="address-line1" defaultValue={scalarDefault("addressLine1")} className="sm:col-span-2" error={firstError(errors, "addressLine1")} />
              <TextField name="addressLine2" label="Address line 2" autoComplete="address-line2" defaultValue={scalarDefault("addressLine2")} className="sm:col-span-2" error={firstError(errors, "addressLine2")} />
              <TextField name="city" label="City" autoComplete="address-level2" defaultValue={scalarDefault("city")} error={firstError(errors, "city")} />
              <TextField name="stateRegion" label="State or region" autoComplete="address-level1" defaultValue={scalarDefault("stateRegion")} error={firstError(errors, "stateRegion")} />
              <TextField name="postalCode" label="Postal code" autoComplete="postal-code" defaultValue={scalarDefault("postalCode")} error={firstError(errors, "postalCode")} />
              <TextField name="country" label="Country" autoComplete="country-name" defaultValue={scalarDefault("country")} error={firstError(errors, "country")} />
            </div>
          </FormSection>

          <FormSection title="Online presence">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField name="websiteUrl" label="Website" type="url" defaultValue={scalarDefault("websiteUrl")} placeholder="https://example.com" error={firstError(errors, "websiteUrl")} />
              <TextField name="linkedinUrl" label="LinkedIn" type="url" defaultValue={scalarDefault("linkedinUrl")} placeholder="https://linkedin.com/in/…" error={firstError(errors, "linkedinUrl")} />
              <TextField name="githubUrl" label="GitHub" type="url" defaultValue={scalarDefault("githubUrl")} placeholder="https://github.com/…" error={firstError(errors, "githubUrl")} />
              <TextField name="portfolioUrl" label="Portfolio" type="url" defaultValue={scalarDefault("portfolioUrl")} placeholder="https://portfolio.example" error={firstError(errors, "portfolioUrl")} />
            </div>
          </FormSection>

          <FormSection title="Professional profile">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField name="headline" label="Professional headline" defaultValue={scalarDefault("headline")} placeholder="Product designer focused on accessible systems" className="sm:col-span-2" error={firstError(errors, "headline")} />
              <TextField name="yearsOfExperience" label="Years of experience" type="number" min="0" step="1" defaultValue={scalarDefault("yearsOfExperience")} error={firstError(errors, "yearsOfExperience")} />
              <TextField name="currentEmployer" label="Current employer" defaultValue={scalarDefault("currentEmployer")} error={firstError(errors, "currentEmployer")} />
              <TextAreaField name="summary" label="Professional summary" rows={6} defaultValue={scalarDefault("summary")} className="sm:col-span-2" error={firstError(errors, "summary")} />
            </div>
          </FormSection>

          <FormSection title="Your CV">
            <p className="mb-5 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              <Link
                href="/cv-review"
                className="font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
              >
                Open CV reviewer →
              </Link>
            </p>
            <CvUpload
              maxBytes={maxCvBytes}
              value={cvDocument}
              onChange={setCvDocument}
            />
          </FormSection>

          <FormSection title="Position sought">
            <div className="grid gap-5 sm:grid-cols-2">
              <TextField name="desiredPosition" label="Desired position" defaultValue={scalarDefault("desiredPosition")} className="sm:col-span-2" error={firstError(errors, "desiredPosition")} />
              <SelectField name="employmentType" label="Employment type" defaultValue={scalarDefault("employmentType")} error={firstError(errors, "employmentType")}>
                <option value="">Select a type</option><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="internship">Internship</option><option value="freelance">Freelance</option><option value="temporary">Temporary</option>
              </SelectField>
              <SelectField name="workArrangement" label="Work arrangement" defaultValue={scalarDefault("workArrangement")} error={firstError(errors, "workArrangement")}>
                <option value="">Select an arrangement</option><option value="onsite">On-site</option><option value="hybrid">Hybrid</option><option value="remote">Remote</option>
              </SelectField>
              <TextField name="earliestStartDate" label="Earliest start date" type="date" defaultValue={scalarDefault("earliestStartDate")} error={firstError(errors, "earliestStartDate")} />
              <TextField name="noticePeriod" label="Notice period" defaultValue={scalarDefault("noticePeriod")} placeholder="For example, 4 weeks" error={firstError(errors, "noticePeriod")} />
              <TextField name="expectedSalaryAmount" label="Expected salary" type="number" min="0" step="1" defaultValue={scalarDefault("expectedSalaryAmount")} error={firstError(errors, "expectedSalaryAmount")} />
              <TextField name="expectedSalaryCurrency" label="Currency" defaultValue={scalarDefault("expectedSalaryCurrency", "EUR")} maxLength={3} error={firstError(errors, "expectedSalaryCurrency")} />
              <CheckboxField name="willingToRelocate" label="I am willing to relocate" defaultChecked={scalarChecked("willingToRelocate", initialApplication?.willingToRelocate ?? false)} error={firstError(errors, "willingToRelocate")} />
              <CheckboxField name="requiresVisaSponsorship" label="I require visa sponsorship" defaultChecked={scalarChecked("requiresVisaSponsorship", initialApplication?.requiresVisaSponsorship ?? false)} error={firstError(errors, "requiresVisaSponsorship")} />
            </div>
          </FormSection>

          <EducationSection rows={education} setRows={setEducation} errors={errors} />
          <ExperienceSection rows={experience} setRows={setExperience} errors={errors} />
          <SkillsSection rows={skills} setRows={setSkills} errors={errors} />
          <LanguagesSection rows={languages} setRows={setLanguages} errors={errors} />

          <FormSection title="Hobbies & interests">
            <div className="mt-6 grid gap-6 sm:grid-cols-2">
              <TagInput id="hobbies" label="Hobbies" hint="Enter or comma to add" tags={hobbies} onChange={setHobbies} />
              <TagInput id="interests" label="Interests" hint="Enter or comma to add" tags={interests} onChange={setInterests} />
              <TextAreaField name="volunteering" label="Volunteering" rows={4} defaultValue={scalarDefault("volunteering")} className="sm:col-span-2" error={firstError(errors, "volunteering")} />
              <TextAreaField name="achievements" label="Achievements" rows={4} defaultValue={scalarDefault("achievements")} error={firstError(errors, "achievements")} />
              <TextAreaField name="certifications" label="Certifications" rows={4} defaultValue={scalarDefault("certifications")} error={firstError(errors, "certifications")} />
              <TextAreaField name="publications" label="Publications" rows={4} defaultValue={scalarDefault("publications")} className="sm:col-span-2" error={firstError(errors, "publications")} />
              <TextField name="funFact" label="A short fun fact" defaultValue={scalarDefault("funFact")} maxLength={240} className="sm:col-span-2" error={firstError(errors, "funFact")} />
            </div>
          </FormSection>

          <ReferencesSection rows={references} setRows={setReferences} errors={errors} />

          <FormSection title="Anything else">
            <div className="space-y-6">
              <TextAreaField name="coverLetter" label="Cover letter" rows={9} defaultValue={scalarDefault("coverLetter")} error={firstError(errors, "coverLetter")} />
              <TextField name="howDidYouHear" label="How did you hear about us?" defaultValue={scalarDefault("howDidYouHear")} error={firstError(errors, "howDidYouHear")} />
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900/60 sm:p-5">
                <CheckboxField
                  name="consentGiven"
                  label="I consent to the processing of the information in this application for recruitment purposes."
                  required
                  defaultChecked={scalarChecked("consentGiven", initialApplication?.consentGiven ?? false)}
                  error={firstError(errors, "consentGiven")}
                />
              </div>
            </div>
          </FormSection>

          <div className="border-t border-zinc-200 pt-8 dark:border-zinc-800">
            {state && !state.ok && !errorKeys.length ? (
              <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">{state.message}</p>
            ) : null}
            <button
              type="submit"
              disabled={pending}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-blue-700 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-wait disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus:ring-offset-zinc-950 sm:w-auto"
            >
              {pending ? "Saving profile…" : "Save profile"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export function ApplicationForm({
  initialApplication,
  maxCvBytes,
}: {
  initialApplication: InitialApplication | null;
  maxCvBytes: number;
}) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <ApplicationFormInstance
      key={resetKey}
      initialApplication={initialApplication}
      maxCvBytes={maxCvBytes}
      onReset={() => setResetKey((key) => key + 1)}
    />
  );
}
