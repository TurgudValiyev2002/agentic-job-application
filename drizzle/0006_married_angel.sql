CREATE TABLE "pipeline_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cv_document_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"state" jsonb NOT NULL,
	"error" text,
	"lease_owner" uuid,
	"lease_expires_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pipeline_workers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pipeline_runs_queue_idx" ON "pipeline_runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_runs_active_cv_provider_model_idx" ON "pipeline_runs" USING btree ("cv_document_id","provider","model") WHERE "pipeline_runs"."status" in ('queued', 'running');