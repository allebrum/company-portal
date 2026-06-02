-- Hoppa Phase 2: re-key the per-tenant singletons, widen the integration /
-- override PKs, and swap the global unique indexes to per-tenant ones.
-- tenant_id was backfilled in 0016 and is stamped by db:init, so SET NOT NULL
-- is safe (tables are empty on a fresh Hoppa DB; populated rows already have it).

-- Drop the global unique indexes that become per-tenant below.
DROP INDEX IF EXISTS "groups_name_lower_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "pay_periods_start_end_unique";--> statement-breakpoint

-- app_settings: re-key from id='singleton' to tenant_id PK (one row per workspace).
ALTER TABLE "app_settings" DROP CONSTRAINT IF EXISTS "app_settings_pkey";--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD PRIMARY KEY ("tenant_id");--> statement-breakpoint
ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "id";--> statement-breakpoint

-- pay_config: same re-key.
ALTER TABLE "pay_config" DROP CONSTRAINT IF EXISTS "pay_config_pkey";--> statement-breakpoint
ALTER TABLE "pay_config" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_config" ADD PRIMARY KEY ("tenant_id");--> statement-breakpoint
ALTER TABLE "pay_config" DROP COLUMN IF EXISTS "id";--> statement-breakpoint

-- integrations: widen PK from (kind) to (tenant_id, kind) so each workspace
-- connects its own Drive/Gmail/etc.
ALTER TABLE "integrations" DROP CONSTRAINT IF EXISTS "integrations_pkey";--> statement-breakpoint
ALTER TABLE "integrations" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind");--> statement-breakpoint

-- user_permission_overrides: widen PK to include tenant_id (per-workspace overrides).
ALTER TABLE "user_permission_overrides" DROP CONSTRAINT IF EXISTS "user_permission_overrides_user_id_permission_key_pk";--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_user_id_permission_key_tenant_id_pk" PRIMARY KEY("user_id","permission_key","tenant_id");--> statement-breakpoint

-- groups / pay_periods: NOT NULL + per-tenant unique indexes so every workspace
-- has its own Owner/Member groups and its own pay-period date ranges.
ALTER TABLE "groups" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_periods" ALTER COLUMN "tenant_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "groups_name_lower_idx" ON "groups" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pay_periods_start_end_unique" ON "pay_periods" USING btree ("tenant_id","start_date","end_date");
