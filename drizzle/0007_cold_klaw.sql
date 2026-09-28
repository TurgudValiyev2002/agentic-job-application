ALTER TABLE "job_matches" ADD COLUMN "assessment" jsonb;--> statement-breakpoint
ALTER TABLE "job_matches" ADD COLUMN "suitable" boolean DEFAULT false NOT NULL;