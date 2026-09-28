CREATE TYPE "public"."cv_profile_status" AS ENUM('draft', 'generating', 'improving', 'reviewing', 'ready', 'failed');--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "target_role" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "cv_status" "cv_profile_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "cv_error" text;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "cv_document_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "cv_review_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "job_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "selected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_cv_review_id_cv_reviews_id_fk" FOREIGN KEY ("cv_review_id") REFERENCES "public"."cv_reviews"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
UPDATE applications SET name = coalesce(nullif(desired_position,''), nullif(headline,''), 'Profile 1');
--> statement-breakpoint
ALTER TABLE applications ALTER COLUMN name SET NOT NULL;
--> statement-breakpoint
UPDATE applications SET selected_at = now() WHERE id = (SELECT id FROM applications ORDER BY created_at DESC LIMIT 1);
--> statement-breakpoint
UPDATE applications a SET cv_document_id = (SELECT d.id FROM cv_documents d WHERE d.application_id = a.id ORDER BY d.created_at DESC LIMIT 1);
--> statement-breakpoint
UPDATE applications a SET cv_review_id = (SELECT r.id FROM cv_reviews r WHERE r.cv_document_id = a.cv_document_id AND r.status = 'completed' ORDER BY r.created_at DESC LIMIT 1);
--> statement-breakpoint
UPDATE applications SET cv_status = 'ready' WHERE cv_review_id IS NOT NULL;
