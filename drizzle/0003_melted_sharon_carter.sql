CREATE TABLE "cv_search_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cv_document_id" uuid NOT NULL,
	"titles" text[] NOT NULL,
	"skills" text[] NOT NULL,
	"seniority" text NOT NULL,
	"locations" text[] NOT NULL,
	"remote_preference" text NOT NULL,
	"keywords" text[] NOT NULL,
	"raw" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_posting_id" uuid NOT NULL,
	"cv_document_id" uuid NOT NULL,
	"similarity" real NOT NULL,
	"score" integer NOT NULL,
	"matched" text[] NOT NULL,
	"missing" text[] NOT NULL,
	"rationale" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_matches_job_posting_id_cv_document_id_unique" UNIQUE("job_posting_id","cv_document_id")
);
--> statement-breakpoint
CREATE TABLE "job_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"remote" boolean DEFAULT false NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"posted_at" timestamp with time zone,
	"raw" jsonb NOT NULL,
	"embedding" real[],
	"embedding_model" text,
	"embedded_at" timestamp with time zone,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_postings_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
ALTER TABLE "cv_search_profiles" ADD CONSTRAINT "cv_search_profiles_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_posting_id_job_postings_id_fk" FOREIGN KEY ("job_posting_id") REFERENCES "public"."job_postings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_matches_cv_document_id_score_idx" ON "job_matches" USING btree ("cv_document_id","score" DESC NULLS LAST);