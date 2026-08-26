-- 0034 — client invoicing + QuickBooks.
-- Adds billing state to time entries (invoiced_at / invoiced_by / invoice_ref),
-- the remembered QuickBooks customer on clients, and the project index the
-- invoicing tab lists by. All idempotent — safe on populated prod data.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "quickbooks_customer_id" text;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "invoiced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "invoiced_by" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN IF NOT EXISTS "invoice_ref" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoiced_by_users_id_fk" FOREIGN KEY ("invoiced_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_project_idx" ON "time_entries" USING btree ("project_id");
