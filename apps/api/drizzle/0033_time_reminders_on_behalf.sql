-- Time-submission reminders + on-behalf submit permission.
--
-- NOTE: the drizzle snapshot baseline was stale at 0029 (migrations 0030–0032
-- were authored by hand without refreshing meta/), so `drizzle-kit generate`
-- wanted to re-emit forms/websites/qr_codes here. Those tables already exist
-- (created by 0030–0032), so this migration is trimmed to ONLY the new work;
-- the regenerated 0033 snapshot still captures the full schema, healing the
-- baseline for future generations.

-- 1. Pay-config: workspace timezone + reminder toggles. Safe on populated
--    prod data — NOT NULL columns ship with defaults so existing rows backfill.
ALTER TABLE "pay_config" ADD COLUMN IF NOT EXISTS "timezone" text DEFAULT 'America/New_York' NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_config" ADD COLUMN IF NOT EXISTS "remind_employees" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_config" ADD COLUMN IF NOT EXISTS "remind_approvers" boolean DEFAULT true NOT NULL;--> statement-breakpoint

-- 2. Reminder idempotency log — one row per (tenant, period, kind, local-day).
CREATE TABLE IF NOT EXISTS "time_reminder_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_on" date NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_reminder_log" ADD CONSTRAINT "time_reminder_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_reminder_log" ADD CONSTRAINT "time_reminder_log_period_id_pay_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."pay_periods"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_reminder_log_once_idx" ON "time_reminder_log" USING btree ("tenant_id","period_id","kind","sent_on");--> statement-breakpoint

-- 3. New permission in the catalog (db:init also seeds this on deploy; both
--    idempotent). Category mirrors PERMISSION_CATEGORIES in @allebrum/shared.
INSERT INTO "permissions" ("key","label","category")
VALUES ('time_entry.submit_on_behalf','Submit / log time on behalf of others','Time entries')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- 4. Backfill: grant the new permission to every group that can already
--    approve time (admins/approvers — the persona who chases missing hours)
--    across all tenants, so the capability shows up without manual setup.
--    Copies tenant_id from the source row; idempotent on the PK.
INSERT INTO "group_permissions" ("group_id","permission_key","tenant_id")
SELECT "group_id", 'time_entry.submit_on_behalf', "tenant_id"
FROM "group_permissions"
WHERE "permission_key" = 'time_entry.approve'
ON CONFLICT ("group_id","permission_key") DO NOTHING;
