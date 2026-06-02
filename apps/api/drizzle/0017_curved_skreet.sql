CREATE TABLE IF NOT EXISTS "tenant_members" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_members_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"billing_external_id" text,
	"plan" text,
	"seat_limit" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "activity_created_idx";--> statement-breakpoint
ALTER TABLE "active_timers" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_log" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "drive_items" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "drive_linked_folders" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "epics" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "goal_resources" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "group_permissions" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_config" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_periods" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user_groups" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
ALTER TABLE "user_permission_overrides" ADD COLUMN "tenant_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_members" ADD CONSTRAINT "tenant_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_members_user_idx" ON "tenant_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_slug_idx" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_billing_idx" ON "tenants" USING btree ("billing_external_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "active_timers" ADD CONSTRAINT "active_timers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_items" ADD CONSTRAINT "drive_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "drive_linked_folders" ADD CONSTRAINT "drive_linked_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "epics" ADD CONSTRAINT "epics_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goal_resources" ADD CONSTRAINT "goal_resources_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "group_permissions" ADD CONSTRAINT "group_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "integrations" ADD CONSTRAINT "integrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "milestones" ADD CONSTRAINT "milestones_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pay_config" ADD CONSTRAINT "pay_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pay_periods" ADD CONSTRAINT "pay_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_permission_overrides" ADD CONSTRAINT "user_permission_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_tenant_created_idx" ON "activity_log" USING btree ("tenant_id","created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_tenant_idx" ON "clients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "group_permissions_tenant_idx" ON "group_permissions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "groups_tenant_idx" ON "groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pay_periods_tenant_idx" ON "pay_periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_groups_tenant_user_idx" ON "user_groups" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_perm_overrides_tenant_user_idx" ON "user_permission_overrides" USING btree ("tenant_id","user_id");--> statement-breakpoint
-- ============================================================================
-- Hoppa Phase 1 backfill (additive, idempotent).
-- Creates the default workspace and stamps every existing row with it so the
-- new nullable tenant_id columns are populated. On a fresh Hoppa database the
-- UPDATEs touch zero rows (tables are empty) but the default tenant is created
-- so db:init can attach the break-glass admin + seeded groups/settings to it.
-- Phase 2 flips these columns to NOT NULL once every insert stamps tenant_id.
-- ============================================================================
DO $$
DECLARE
  default_tenant_id uuid;
BEGIN
  SELECT id INTO default_tenant_id FROM tenants ORDER BY created_at LIMIT 1;
  IF default_tenant_id IS NULL THEN
    INSERT INTO tenants (name, slug, status) VALUES ('Default Workspace', 'default', 'active')
    RETURNING id INTO default_tenant_id;
  END IF;

  UPDATE clients                   SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE projects                  SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE goals                     SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE epics                     SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE milestones                SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE goal_resources            SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE todos                     SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE pay_periods               SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE time_entries              SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE active_timers             SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE activity_log              SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE integrations              SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE drive_linked_folders      SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE drive_items               SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE qr_codes                  SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE groups                    SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE group_permissions         SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE user_groups               SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE user_permission_overrides SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE app_settings              SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;
  UPDATE pay_config                SET tenant_id = default_tenant_id WHERE tenant_id IS NULL;

  -- Every existing user joins the default workspace; is_owner = member of the
  -- system "Owner" group.
  INSERT INTO tenant_members (tenant_id, user_id, is_owner)
  SELECT default_tenant_id, u.id,
         EXISTS (
           SELECT 1 FROM user_groups ug
           JOIN groups g ON g.id = ug.group_id
           WHERE ug.user_id = u.id AND lower(g.name) = 'owner'
         )
  FROM users u
  ON CONFLICT (tenant_id, user_id) DO NOTHING;
END $$;