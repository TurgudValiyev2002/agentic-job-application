CREATE TYPE "public"."application_status" AS ENUM('submitted', 'under_review', 'interviewing', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."education_level" AS ENUM('high_school', 'vocational', 'associate', 'bachelor', 'master', 'doctorate', 'other');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'internship', 'freelance', 'temporary');--> statement-breakpoint
CREATE TYPE "public"."language_proficiency" AS ENUM('basic', 'conversational', 'professional', 'fluent', 'native');--> statement-breakpoint
CREATE TYPE "public"."skill_level" AS ENUM('beginner', 'intermediate', 'advanced', 'expert');--> statement-breakpoint
CREATE TYPE "public"."work_arrangement" AS ENUM('onsite', 'hybrid', 'remote');--> statement-breakpoint
CREATE TABLE "application_languages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"language" text NOT NULL,
	"proficiency" "language_proficiency" NOT NULL,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_references" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relationship" text,
	"company" text,
	"email" text,
	"phone" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"name" text NOT NULL,
	"level" "skill_level",
	"years_of_experience" integer,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"date_of_birth" date,
	"nationality" text,
	"pronouns" text,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"state_region" text,
	"postal_code" text,
	"country" text,
	"website_url" text,
	"linkedin_url" text,
	"github_url" text,
	"portfolio_url" text,
	"headline" text,
	"summary" text,
	"years_of_experience" integer,
	"current_employer" text,
	"desired_position" text,
	"employment_type" "employment_type",
	"work_arrangement" "work_arrangement",
	"earliest_start_date" date,
	"expected_salary_amount" integer,
	"expected_salary_currency" text DEFAULT 'EUR' NOT NULL,
	"willing_to_relocate" boolean DEFAULT false NOT NULL,
	"requires_visa_sponsorship" boolean DEFAULT false NOT NULL,
	"notice_period" text,
	"hobbies" text[],
	"interests" text[],
	"volunteering" text,
	"achievements" text,
	"certifications" text,
	"publications" text,
	"fun_fact" text,
	"cover_letter" text,
	"how_did_you_hear" text,
	"consent_given" boolean NOT NULL,
	"status" "application_status" DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "education_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"institution" text NOT NULL,
	"degree" text,
	"level" "education_level",
	"field_of_study" text,
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"grade" text,
	"description" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"company" text NOT NULL,
	"job_title" text NOT NULL,
	"location" text,
	"employment_type" "employment_type",
	"start_date" date,
	"end_date" date,
	"is_current" boolean DEFAULT false NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "application_languages" ADD CONSTRAINT "application_languages_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_references" ADD CONSTRAINT "application_references_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_skills" ADD CONSTRAINT "application_skills_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "education_entries" ADD CONSTRAINT "education_entries_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_experiences" ADD CONSTRAINT "work_experiences_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_email_idx" ON "applications" USING btree ("email");--> statement-breakpoint
CREATE INDEX "applications_created_at_idx" ON "applications" USING btree ("created_at");