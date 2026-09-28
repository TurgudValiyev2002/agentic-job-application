CREATE TABLE "model_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"base_url" text NOT NULL,
	"encrypted_api_key" text,
	"model" text NOT NULL,
	"timeout_ms" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"embedding_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_connections_one_default_idx" ON "model_connections" USING btree ("is_default") WHERE "model_connections"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "model_connections_one_embedding_idx" ON "model_connections" USING btree (("embedding_model" is not null)) WHERE "model_connections"."embedding_model" is not null;