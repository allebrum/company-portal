ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "notifications" jsonb;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "last_digest_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "turnstile_site_key" text;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN IF NOT EXISTS "turnstile_secret_enc" text;
