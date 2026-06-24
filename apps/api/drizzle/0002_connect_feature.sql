CREATE TYPE "public"."connection_provider" AS ENUM('composio', 'zernio');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"tenant_id" uuid,
	"provider" "connection_provider" NOT NULL,
	"external_id" text NOT NULL,
	"integration" text NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"tenant_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "composio_user_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "zernio_profile_id" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connections" ADD CONSTRAINT "connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connections_client_provider_ext_unique" ON "connections" USING btree ("client_id","provider","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_client_idx" ON "connections" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connections_tenant_idx" ON "connections" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_client_time_idx" ON "workflow_runs" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_runs_tenant_idx" ON "workflow_runs" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_composio_user_id_unique" UNIQUE("composio_user_id");--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_zernio_profile_id_unique" UNIQUE("zernio_profile_id");--> statement-breakpoint
-- Enable RLS (deny-by-default) on the new tables, matching every other public
-- table. The API connects as the service role and bypasses RLS; portal access
-- is gated server-side by the verified portal session's client_id.
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_runs" ENABLE ROW LEVEL SECURITY;