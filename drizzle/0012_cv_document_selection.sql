ALTER TABLE "cv_documents" ADD COLUMN "source_rewrite_id" uuid;--> statement-breakpoint
ALTER TABLE "cv_documents" ADD COLUMN "selected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_source_rewrite_id_cv_rewrites_id_fk" FOREIGN KEY ("source_rewrite_id") REFERENCES "public"."cv_rewrites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cv_documents_source_rewrite_id_idx" ON "cv_documents" USING btree ("source_rewrite_id");