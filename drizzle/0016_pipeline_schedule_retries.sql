CREATE TABLE "pipeline_schedules" (
	"id" text PRIMARY KEY DEFAULT 'daily' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"profile_id" uuid,
	"provider" text NOT NULL,
	"preferences" jsonb NOT NULL,
	"auto_apply" boolean DEFAULT false NOT NULL,
	"max_matches" integer NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_run_id" uuid,
	"last_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_runs" ADD COLUMN "retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pipeline_schedules" ADD CONSTRAINT "pipeline_schedules_profile_id_applications_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;