CREATE TABLE "wellfound_accounts" (
	"cv_document_id" uuid PRIMARY KEY NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"verified_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wellfound_accounts" ADD CONSTRAINT "wellfound_accounts_cv_document_id_cv_documents_id_fk" FOREIGN KEY ("cv_document_id") REFERENCES "public"."cv_documents"("id") ON DELETE cascade ON UPDATE no action;