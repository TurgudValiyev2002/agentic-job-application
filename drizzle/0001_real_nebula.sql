CREATE TYPE "public"."cv_extraction_status" AS ENUM('pending', 'ok', 'failed', 'unsupported');--> statement-breakpoint
CREATE TYPE "public"."cv_review_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "cv_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"storage_path" text NOT NULL,
	"checksum" text,
	"extracted_text" text,
	"extraction_status" "cv_extraction_status" DEFAULT 'pending' NOT NULL,
	"extraction_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cv_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cv_document_id" uuid NOT NULL,
	"status" "cv_review_status" DEFAULT 'queued' NOT NULL,
	"provider" text DEFAULT 'lmstudio' NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"overall_score" integer,
	"summary" text,
	"strengths" text[],
	"weaknesses" text[],
	"suggestions" jsonb,
	"raw_response" jsonb,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_reviews" ADD CONSTRAINT "cv_reviews_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cv_documents_application_id_idx" ON "cv_documents" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "cv_documents_checksum_idx" ON "cv_documents" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "cv_reviews_cv_document_id_idx" ON "cv_reviews" USING btree ("cv_document_id");