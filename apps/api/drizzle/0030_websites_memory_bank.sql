CREATE TABLE IF NOT EXISTS "websites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "site_url" text NOT NULL,
  "category" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "billing_cycle" text DEFAULT 'monthly' NOT NULL,
  "billing_amount_cents" integer,
  "billing_currency" text DEFAULT 'USD' NOT NULL,
  "renewal_date" date,
  "notes" text DEFAULT '' NOT NULL,
  "credential_username_enc" text,
  "credential_password_enc" text,
  "credentials_updated_at" timestamp with time zone,
  "created_by_user_id" uuid,
  "updated_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "websites_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "websites_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "websites_updated_by_user_id_users_id_fk"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action,
  CONSTRAINT "websites_status_check"
    CHECK ("status" IN ('active', 'trial', 'paused', 'canceled')),
  CONSTRAINT "websites_billing_cycle_check"
    CHECK ("billing_cycle" IN ('monthly', 'annual', 'quarterly', 'one-time', 'custom')),
  CONSTRAINT "websites_billing_currency_check"
    CHECK ("billing_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "website_members" (
  "website_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "website_members_website_id_user_id_pk" PRIMARY KEY("website_id", "user_id"),
  CONSTRAINT "website_members_website_id_websites_id_fk"
    FOREIGN KEY ("website_id") REFERENCES "public"."websites"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "website_members_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
  CONSTRAINT "website_members_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "websites_tenant_name_idx" ON "websites" ("tenant_id", lower("name"));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "websites_tenant_renewal_idx" ON "websites" ("tenant_id", "renewal_date");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "websites_tenant_status_idx" ON "websites" ("tenant_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "website_members_tenant_user_idx" ON "website_members" ("tenant_id", "user_id");