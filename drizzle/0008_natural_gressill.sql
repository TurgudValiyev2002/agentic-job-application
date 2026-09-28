CREATE TABLE "applicant_profiles" (
	"cv_document_id" uuid PRIMARY KEY NOT NULL,
	"profile" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "application_workers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rewrite_id" uuid NOT NULL,
	"cv_document_id" uuid NOT NULL,
	"job_posting_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"url" text NOT NULL,
	"profile" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"snapshot" jsonb,
	"answers" jsonb,
	"revision" integer DEFAULT 0 NOT NULL,
	"message" text,
	"confirmation" text,
	"worker_id" uuid,
	"heartbeat_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "applicant_profiles" ADD CONSTRAINT "applicant_profiles_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_rewrite_id_cv_rewrites_id_fk" FOREIGN KEY ("rewrite_id") REFERENCES "public"."cv_rewrites"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_posting_id_job_postings_id_fk" FOREIGN KEY ("job_posting_id") REFERENCES "public"."job_postings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_applications_queue_idx" ON "job_applications" USING btree ("status","created_at");