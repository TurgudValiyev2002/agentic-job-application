CREATE TABLE "indeed_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"encrypted_state" text NOT NULL,
	"email_hint" text,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "wellfound_accounts" CASCADE;