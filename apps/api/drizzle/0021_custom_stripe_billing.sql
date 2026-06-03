-- Custom Stripe billing: self-owned trial + off-session recurring charge.
-- Additive, nullable columns on tenants (+ default on failed_attempts), safe on
-- populated prod data. billingExternalId (already present) is the Stripe
-- customer id; these add the payment method, billing state, and schedule.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "billing_status" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "next_bill_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "last_payment_error" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_next_bill_idx" ON "tenants" ("next_bill_at");
