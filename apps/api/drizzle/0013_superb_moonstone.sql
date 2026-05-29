CREATE TABLE IF NOT EXISTS "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD COLUMN "contact_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_slug" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "portal_published_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_contacts_client_email_unique" ON "client_contacts" USING btree ("client_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_contacts_email_idx" ON "client_contacts" USING btree ("email");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_contact_id_client_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_tokens_contact_kind_idx" ON "auth_tokens" USING btree ("contact_id","kind","used_at");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_portal_slug_unique" UNIQUE("portal_slug");--> statement-breakpoint
-- Subject XOR — every auth_tokens row points at exactly one subject:
-- a staff user (F1 invite/reset) OR a client contact (F23 portal-magic).
-- Drizzle's table DSL doesn't model CHECK constraints inline, so we add
-- it manually. The migration above already dropped NOT NULL on user_id
-- so the new portal-magic kind can land with contact_id alone.
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_subject_xor_check" CHECK (
  (user_id IS NOT NULL AND contact_id IS NULL)
  OR (user_id IS NULL AND contact_id IS NOT NULL)
);