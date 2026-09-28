import type { PipelineState, PipelineStatus } from "../pipeline/types";
import type { SearchPreferences } from "../jobs/preferences";

import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const applicationStatus = pgEnum("application_status", [
  "submitted",
  "under_review",
  "interviewing",
  "accepted",
  "rejected",
]);

export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "internship",
  "freelance",
  "temporary",
]);

export const workArrangement = pgEnum("work_arrangement", [
  "onsite",
  "hybrid",
  "remote",
]);

export const educationLevel = pgEnum("education_level", [
  "high_school",
  "vocational",
  "associate",
  "bachelor",
  "master",
  "doctorate",
  "other",
]);

export const languageProficiency = pgEnum("language_proficiency", [
  "basic",
  "conversational",
  "professional",
  "fluent",
  "native",
]);

export const skillLevel = pgEnum("skill_level", [
  "beginner",
  "intermediate",
  "advanced",
  "expert",
]);

export const cvExtractionStatus = pgEnum("cv_extraction_status", [
  "pending",
  "ok",
  "failed",
  "unsupported",
]);

export const cvReviewStatus = pgEnum("cv_review_status", [
  "queued",
  "running",
  "completed",
  "failed",
]);

export const cvProfileStatus = pgEnum("cv_profile_status", ["draft", "generating", "improving", "reviewing", "ready", "failed"]);

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Legacy internal intake writers predate named profiles; the public form requires a name.
    name: text("name").notNull().$defaultFn(() => "Profile 1"),
    targetRole: text("target_role"),
    cvStatus: cvProfileStatus("cv_status").default("draft").notNull(),
    cvError: text("cv_error"),
    cvDocumentId: uuid("cv_document_id").references((): AnyPgColumn => cvDocuments.id, { onDelete: "set null" }),
    cvReviewId: uuid("cv_review_id").references((): AnyPgColumn => cvReviews.id, { onDelete: "set null" }),
    jobStartedAt: timestamp("job_started_at", { withTimezone: true }),
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    dateOfBirth: date("date_of_birth"),
    nationality: text("nationality"),
    pronouns: text("pronouns"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    stateRegion: text("state_region"),
    postalCode: text("postal_code"),
    country: text("country"),
    websiteUrl: text("website_url"),
    linkedinUrl: text("linkedin_url"),
    githubUrl: text("github_url"),
    portfolioUrl: text("portfolio_url"),
    headline: text("headline"),
    summary: text("summary"),
    yearsOfExperience: integer("years_of_experience"),
    currentEmployer: text("current_employer"),
    desiredPosition: text("desired_position"),
    employmentType: employmentType("employment_type"),
    workArrangement: workArrangement("work_arrangement"),
    earliestStartDate: date("earliest_start_date"),
    expectedSalaryAmount: integer("expected_salary_amount"),
    expectedSalaryCurrency: text("expected_salary_currency")
      .default("EUR")
      .notNull(),
    willingToRelocate: boolean("willing_to_relocate").default(false).notNull(),
    requiresVisaSponsorship: boolean("requires_visa_sponsorship")
      .default(false)
      .notNull(),
    noticePeriod: text("notice_period"),
    hobbies: text("hobbies").array(),
    interests: text("interests").array(),
    volunteering: text("volunteering"),
    achievements: text("achievements"),
    certifications: text("certifications"),
    publications: text("publications"),
    funFact: text("fun_fact"),
    coverLetter: text("cover_letter"),
    howDidYouHear: text("how_did_you_hear"),
    consentGiven: boolean("consent_given").notNull(),
    status: applicationStatus("status").default("submitted").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("applications_email_idx").on(table.email),
    index("applications_created_at_idx").on(table.createdAt),
  ],
);

export const educationEntries = pgTable("education_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  institution: text("institution").notNull(),
  degree: text("degree"),
  level: educationLevel("level"),
  fieldOfStudy: text("field_of_study"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  isCurrent: boolean("is_current").default(false).notNull(),
  grade: text("grade"),
  description: text("description"),
  sortOrder: integer("sort_order").notNull(),
});

export const workExperiences = pgTable("work_experiences", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  company: text("company").notNull(),
  jobTitle: text("job_title").notNull(),
  location: text("location"),
  employmentType: employmentType("employment_type"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  isCurrent: boolean("is_current").default(false).notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull(),
});

export const applicationSkills = pgTable("application_skills", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  level: skillLevel("level"),
  yearsOfExperience: integer("years_of_experience"),
  sortOrder: integer("sort_order").notNull(),
});

export const applicationLanguages = pgTable("application_languages", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  proficiency: languageProficiency("proficiency").notNull(),
  sortOrder: integer("sort_order").notNull(),
});

export const applicationReferences = pgTable("application_references", {
  id: uuid("id").defaultRandom().primaryKey(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  relationship: text("relationship"),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  sortOrder: integer("sort_order").notNull(),
});

export const cvDocuments = pgTable(
  "cv_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    storagePath: text("storage_path").notNull(),
    checksum: text("checksum"),
    extractedText: text("extracted_text"),
    extractionStatus: cvExtractionStatus("extraction_status")
      .default("pending")
      .notNull(),
    extractionError: text("extraction_error"),
    // Set when this document was written from an improved CV (a cv_rewrites row)
    // rather than uploaded, so the same rewrite is never materialised twice.
    sourceRewriteId: uuid("source_rewrite_id").references(
      (): AnyPgColumn => cvRewrites.id,
      { onDelete: "set null" },
    ),
    // When the user last chose this CV for the pipeline. The most recent one is
    // preselected on the next run; null means it was never chosen.
    selectedAt: timestamp("selected_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("cv_documents_application_id_idx").on(table.applicationId),
    index("cv_documents_checksum_idx").on(table.checksum),
    index("cv_documents_source_rewrite_id_idx").on(table.sourceRewriteId),
  ],
);

export const cvReviews = pgTable(
  "cv_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cvDocumentId: uuid("cv_document_id")
      .notNull()
      .references(() => cvDocuments.id, { onDelete: "cascade" }),
    status: cvReviewStatus("status").default("queued").notNull(),
    provider: text("provider").notNull().default("lmstudio"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    overallScore: integer("overall_score"),
    summary: text("summary"),
    strengths: text("strengths").array(),
    weaknesses: text("weaknesses").array(),
    suggestions: jsonb("suggestions"),
    rawResponse: jsonb("raw_response"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("cv_reviews_cv_document_id_idx").on(table.cvDocumentId)],
);

export const cvRewrites = pgTable(
  "cv_rewrites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable: a CV can also be generated straight from the application form,
    // in which case there is no uploaded document behind it.
    cvDocumentId: uuid("cv_document_id").references(() => cvDocuments.id, {
      onDelete: "cascade",
    }),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    cvReviewId: uuid("cv_review_id").references(() => cvReviews.id, {
      onDelete: "set null",
    }),
    jobPostingId: uuid("job_posting_id").references(() => jobPostings.id, {
      onDelete: "set null",
    }),
    status: cvReviewStatus("status").default("queued").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    content: jsonb("content"),
    latex: text("latex"),
    rawResponse: jsonb("raw_response"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("cv_rewrites_cv_document_id_idx").on(table.cvDocumentId),
    index("cv_rewrites_cv_document_id_job_posting_id_idx").on(
      table.cvDocumentId,
      table.jobPostingId,
    ),
  ],
);

export const jobPostings = pgTable("job_postings", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull(),
  externalId: text("external_id").notNull(),
  fingerprint: text("fingerprint").notNull().unique(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  location: text("location"),
  remote: boolean("remote").default(false).notNull(),
  url: text("url").notNull(),
  description: text("description"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  raw: jsonb("raw").notNull(),
  // real[] keeps the current Postgres image unchanged. pgvector is the
  // upgrade path when job volume makes database-side similarity worthwhile.
  embedding: real("embedding").array(),
  embeddingModel: text("embedding_model"),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }),
  contentHash: text("content_hash"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const cvSearchProfiles = pgTable("cv_search_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  cvDocumentId: uuid("cv_document_id")
    .notNull()
    .references(() => cvDocuments.id, { onDelete: "cascade" }),
  titles: text("titles").array().notNull(),
  skills: text("skills").array().notNull(),
  seniority: text("seniority").notNull(),
  locations: text("locations").array().notNull(),
  remotePreference: text("remote_preference").notNull(),
  keywords: text("keywords").array().notNull(),
  raw: jsonb("raw").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const jobMatches = pgTable(
  "job_matches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobPostingId: uuid("job_posting_id")
      .notNull()
      .references(() => jobPostings.id, { onDelete: "cascade" }),
    cvDocumentId: uuid("cv_document_id")
      .notNull()
      .references(() => cvDocuments.id, { onDelete: "cascade" }),
    similarity: real("similarity").notNull(),
    score: integer("score").notNull(),
    matched: text("matched").array().notNull(),
    missing: text("missing").array().notNull(),
    rationale: text("rationale").notNull(),
    assessment: jsonb("assessment").$type<import("../jobs/assessment").JobAssessment>(),
    suitable: boolean("suitable").default(false).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    unique("job_matches_job_posting_id_cv_document_id_unique").on(
      table.jobPostingId,
      table.cvDocumentId,
    ),
    index("job_matches_cv_document_id_score_idx").on(
      table.cvDocumentId,
      table.score.desc(),
    ),
  ],
);

export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  cvDocumentId: uuid("cv_document_id").notNull().references(() => cvDocuments.id, { onDelete: "restrict" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  status: text("status").$type<PipelineStatus>().default("queued").notNull(),
  state: jsonb("state").$type<PipelineState>().notNull(),
  error: text("error"),
  leaseOwner: uuid("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  attempts: integer("attempts").default(0).notNull(),
  /** Failed attempts already sent back to the queue; a waiting retry is `queued` with `retryAt` in the future. */
  retries: integer("retries").default(0).notNull(),
  retryAt: timestamp("retry_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("pipeline_runs_queue_idx").on(table.status, table.createdAt),
  uniqueIndex("pipeline_runs_active_cv_provider_model_idx")
    .on(table.cvDocumentId, table.provider, table.model)
    .where(sql`${table.status} in ('queued', 'running')`),
]);

/**
 * A place the app can reach a model: Ollama, LM Studio, any OpenAI-compatible API link, or a platform (OpenAI,
 * OpenRouter) with an API key. Keys are encrypted with ACCOUNT_CREDENTIALS_KEY and never leave the server.
 */
export const modelConnections = pgTable("model_connections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  baseUrl: text("base_url").notNull(),
  encryptedApiKey: text("encrypted_api_key"),
  model: text("model").notNull(),
  timeoutMs: integer("timeout_ms").notNull(),
  /** Used for background work (profile CVs, form answers, the daily run's default) and preselected in pickers. */
  isDefault: boolean("is_default").default(false).notNull(),
  /** When set, this connection also produces embeddings with this model. */
  embeddingModel: text("embedding_model"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("model_connections_one_default_idx").on(table.isDefault).where(sql`${table.isDefault}`),
  uniqueIndex("model_connections_one_embedding_idx").on(sql`(${table.embeddingModel} is not null)`).where(sql`${table.embeddingModel} is not null`),
]);

/** The saved daily run: one row, started by the pipeline worker once every 24 hours while enabled. */
export const pipelineSchedules = pgTable("pipeline_schedules", {
  id: text("id").primaryKey().default("daily"),
  enabled: boolean("enabled").default(true).notNull(),
  profileId: uuid("profile_id").references(() => applications.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  preferences: jsonb("preferences").$type<SearchPreferences>().notNull(),
  autoApply: boolean("auto_apply").default(false).notNull(),
  maxMatches: integer("max_matches").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastRunId: uuid("last_run_id"),
  /** Why the last due run could not start (profile not ready, model unavailable, …); cleared when one starts. */
  lastMessage: text("last_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const pipelineWorkers = pgTable("pipeline_workers", {
  id: uuid("id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

export const applicationsRelations = relations(applications, ({ many }) => ({
  educationEntries: many(educationEntries),
  workExperiences: many(workExperiences),
  skills: many(applicationSkills),
  languages: many(applicationLanguages),
  references: many(applicationReferences),
  cvDocuments: many(cvDocuments),
}));

export const cvDocumentsRelations = relations(cvDocuments, ({ one, many }) => ({
  application: one(applications, {
    fields: [cvDocuments.applicationId],
    references: [applications.id],
  }),
  reviews: many(cvReviews),
  rewrites: many(cvRewrites),
  searchProfiles: many(cvSearchProfiles),
  jobMatches: many(jobMatches),
}));

export const cvReviewsRelations = relations(cvReviews, ({ one, many }) => ({
  cvDocument: one(cvDocuments, {
    fields: [cvReviews.cvDocumentId],
    references: [cvDocuments.id],
  }),
  rewrites: many(cvRewrites),
}));

export const cvRewritesRelations = relations(cvRewrites, ({ one }) => ({
  cvDocument: one(cvDocuments, {
    fields: [cvRewrites.cvDocumentId],
    references: [cvDocuments.id],
  }),
  review: one(cvReviews, {
    fields: [cvRewrites.cvReviewId],
    references: [cvReviews.id],
  }),
  jobPosting: one(jobPostings, {
    fields: [cvRewrites.jobPostingId],
    references: [jobPostings.id],
  }),
}));

export const jobPostingsRelations = relations(jobPostings, ({ many }) => ({
  matches: many(jobMatches),
  rewrites: many(cvRewrites),
}));

export const cvSearchProfilesRelations = relations(
  cvSearchProfiles,
  ({ one }) => ({
    cvDocument: one(cvDocuments, {
      fields: [cvSearchProfiles.cvDocumentId],
      references: [cvDocuments.id],
    }),
  }),
);

export const jobMatchesRelations = relations(jobMatches, ({ one }) => ({
  jobPosting: one(jobPostings, {
    fields: [jobMatches.jobPostingId],
    references: [jobPostings.id],
  }),
  cvDocument: one(cvDocuments, {
    fields: [jobMatches.cvDocumentId],
    references: [cvDocuments.id],
  }),
}));

export const educationEntriesRelations = relations(
  educationEntries,
  ({ one }) => ({
    application: one(applications, {
      fields: [educationEntries.applicationId],
      references: [applications.id],
    }),
  }),
);

export const workExperiencesRelations = relations(
  workExperiences,
  ({ one }) => ({
    application: one(applications, {
      fields: [workExperiences.applicationId],
      references: [applications.id],
    }),
  }),
);

export const applicationSkillsRelations = relations(
  applicationSkills,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationSkills.applicationId],
      references: [applications.id],
    }),
  }),
);

export const applicationLanguagesRelations = relations(
  applicationLanguages,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationLanguages.applicationId],
      references: [applications.id],
    }),
  }),
);

export const applicationReferencesRelations = relations(
  applicationReferences,
  ({ one }) => ({
    application: one(applications, {
      fields: [applicationReferences.applicationId],
      references: [applications.id],
    }),
  }),
);

export type Application = typeof applications.$inferSelect;
export type EducationEntry = typeof educationEntries.$inferSelect;
export type WorkExperience = typeof workExperiences.$inferSelect;
export type ApplicationSkill = typeof applicationSkills.$inferSelect;
export type ApplicationLanguage = typeof applicationLanguages.$inferSelect;
export type ApplicationReference = typeof applicationReferences.$inferSelect;
export type CvDocument = typeof cvDocuments.$inferSelect;
export type CvReview = typeof cvReviews.$inferSelect;
export type CvRewrite = typeof cvRewrites.$inferSelect;
export type JobPosting = typeof jobPostings.$inferSelect;

// Local application automation is separate from the applicant intake form above.
export const applicantProfiles = pgTable("applicant_profiles", {
  cvDocumentId: uuid("cv_document_id").primaryKey().references(() => cvDocuments.id, { onDelete: "cascade" }),
  profile: jsonb("profile").$type<import("../job-applications/types").ApplicantProfile>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One local Indeed browser session (encrypted cookies from a manual sign-in) shared by every CV until the user replaces it.
// Indeed signs in with an emailed one-time code, so no password is ever stored. Never part of AI input or job snapshots.
export const INDEED_SESSION_ID = "default";
export const indeedSessions = pgTable("indeed_sessions", {
  id: text("id").primaryKey(),
  encryptedState: text("encrypted_state").notNull(),
  emailHint: text("email_hint"),
  applicationHistory: jsonb("application_history").$type<import("../indeed/history-data").IndeedHistorySnapshot>(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const jobApplications = pgTable("job_applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  rewriteId: uuid("rewrite_id").notNull().references(() => cvRewrites.id, { onDelete: "restrict" }),
  cvDocumentId: uuid("cv_document_id").notNull().references(() => cvDocuments.id, { onDelete: "restrict" }),
  jobPostingId: uuid("job_posting_id").notNull().references(() => jobPostings.id, { onDelete: "restrict" }),
  // Email + canonical employer posting, independent of source listing or CV version.
  dedupeKey: text("dedupe_key").notNull().unique(),
  url: text("url").notNull(),
  profile: jsonb("profile").$type<import("../job-applications/types").ApplicantProfile>().notNull(),
  status: text("status").$type<import("../job-applications/types").ApplicationStatus>().default("queued").notNull(),
  snapshot: jsonb("snapshot").$type<import("../job-applications/types").ApplicationSnapshot>(),
  answers: jsonb("answers").$type<Record<string, string>>(),
  autoApply: boolean("auto_apply").default(false).notNull(),
  answerEvidence: jsonb("answer_evidence").$type<import("../job-applications/types").AnswerEvidence[]>().default([]).notNull(),
  revision: integer("revision").default(0).notNull(),
  message: text("message"),
  confirmation: text("confirmation"),
  workerId: uuid("worker_id"),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("job_applications_queue_idx").on(table.status, table.createdAt)]);

export const applicationWorkers = pgTable("application_workers", {
  id: uuid("id").primaryKey(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});
