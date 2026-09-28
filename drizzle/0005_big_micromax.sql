ALTER TABLE "cv_rewrites" ALTER COLUMN "cv_document_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cv_rewrites" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "cv_rewrites" ADD CONSTRAINT "cv_rewrites_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;