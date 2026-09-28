-- Wellfound login becomes a single shared row. Old rows were encrypted per CV and cannot be re-read, so the login must be entered again.
DELETE FROM "wellfound_accounts";--> statement-breakpoint
ALTER TABLE "wellfound_accounts" DROP CONSTRAINT "wellfound_accounts_cv_document_id_cv_documents_id_fk";--> statement-breakpoint
ALTER TABLE "wellfound_accounts" DROP COLUMN "cv_document_id";--> statement-breakpoint
ALTER TABLE "wellfound_accounts" ADD COLUMN "id" text PRIMARY KEY NOT NULL;
