-- Convergence migration (hoppa -> main).
--
-- (1) The mobile QR-upload feature shipped on `main` created its tables via
--     `drizzle-kit push` without a CREATE migration (only 0016_solid_chimera's
--     two ALTERs exist). A fresh self-host DB running `db:migrate` therefore
--     never gets these tables. CREATE ... IF NOT EXISTS makes this safe on the
--     already-drifted production DB (no-op) and correct on fresh DBs.
-- (2) Tenant-scope the upload_qr tables (add tenant_id, backfill to the default
--     workspace created by 0017_curved_skreet, then SET NOT NULL).
-- (3) Add tenants.billing_exempt so the default/self-host workspace is never
--     402'd once SaaS subscription gating is enabled.

CREATE TABLE IF NOT EXISTS "upload_qr_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"label" text DEFAULT 'Mobile upload' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"uploaded_count" integer DEFAULT 0 NOT NULL,
	"last_uploaded_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_qr_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upload_qr_session_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"upload_title" text,
	"upload_notes" text,
	"original_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"destination_kind" text NOT NULL,
	"destination_id" text NOT NULL,
	"stored_file_id" text,
	"stored_file_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "upload_qr_sessions" ADD CONSTRAINT "upload_qr_sessions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "upload_qr_session_files" ADD CONSTRAINT "upload_qr_session_files_session_id_upload_qr_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "upload_qr_sessions"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "upload_qr_sessions_token_idx" ON "upload_qr_sessions" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_qr_sessions_target_idx" ON "upload_qr_sessions" ("target_kind","target_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_qr_session_files_session_time_idx" ON "upload_qr_session_files" ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_qr_session_files_destination_idx" ON "upload_qr_session_files" ("destination_kind","destination_id");--> statement-breakpoint
ALTER TABLE "upload_qr_sessions" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "upload_qr_session_files" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "upload_qr_sessions" ADD CONSTRAINT "upload_qr_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "upload_qr_session_files" ADD CONSTRAINT "upload_qr_session_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$
DECLARE default_tenant_id uuid;
BEGIN
	SELECT id INTO default_tenant_id FROM tenants ORDER BY created_at LIMIT 1;
	IF default_tenant_id IS NOT NULL THEN
		UPDATE upload_qr_sessions SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
		UPDATE upload_qr_session_files SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "upload_qr_sessions" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_qr_session_files" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_exempt" boolean DEFAULT false NOT NULL;
