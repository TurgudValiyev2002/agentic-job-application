CREATE TABLE "cv_rewrites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cv_document_id" uuid NOT NULL,
	"cv_review_id" uuid,
	"status" "cv_review_status" DEFAULT 'queued' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"content" jsonb,
	"latex" text,
	"raw_response" jsonb,
	"error_message" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cv_rewrites" ADD CONSTRAINT "cv_rewrites_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cv_rewrites" ADD CONSTRAINT "cv_rewrites_cv_review_id_cv_reviews_id_fk" FOREIGN KEY ("cv_review_id") REFERENCES "public"."cv_reviews"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cv_rewrites_cv_document_id_idx" ON "cv_rewrites" USING btree ("cv_document_id");