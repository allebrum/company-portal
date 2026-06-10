-- Tenant-scope the Google Drive credential.
--
-- Previously `oauth_tokens` had no tenant_id and services/drive.ts resolved the
-- newest `google_drive` row GLOBALLY, so every workspace shared whichever Google
-- account was connected last — all tenants' folders landed in one Drive
-- (cross-tenant data exposure). This adds tenant_id (+ index + FK) and backfills
-- the existing, formerly-global Drive token to the default/internal workspace.
--
-- NOTE: `drizzle-kit generate` also re-emitted drift for migrations 0020-0024
-- (their meta snapshots were never committed). That schema is already applied in
-- prod, so only the oauth_tokens delta is kept here; the committed 0025 snapshot
-- re-syncs the schema snapshot going forward.
ALTER TABLE "oauth_tokens" ADD COLUMN IF NOT EXISTS "tenant_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oauth_tokens_tenant_idx" ON "oauth_tokens" USING btree ("tenant_id");--> statement-breakpoint
-- Backfill: the previously-global Drive credential belongs to the internal
-- team's workspace — the OLDEST tenant (mirrors services/tenants.ts
-- getDefaultTenantId). Every other workspace gets no Drive row, so it shows
-- "not connected" until an admin connects its own Drive (intended). Idempotent
-- via the `tenant_id IS NULL` guard.
UPDATE "oauth_tokens"
  SET "tenant_id" = (SELECT "id" FROM "tenants" ORDER BY "created_at" ASC LIMIT 1)
  WHERE "provider" = 'google_drive' AND "tenant_id" IS NULL;
