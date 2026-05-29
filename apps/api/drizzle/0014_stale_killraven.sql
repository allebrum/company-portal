CREATE TABLE IF NOT EXISTS "qr_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"target_url" text NOT NULL,
	"short_code" text NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"foreground_color" text DEFAULT '#000000' NOT NULL,
	"background_color" text DEFAULT '#FFFFFF' NOT NULL,
	"error_correction" text DEFAULT 'M' NOT NULL,
	"logo_data_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "qr_codes_short_code_unique" UNIQUE("short_code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qr_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"qr_code_id" uuid NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"referer" text,
	"browser" text,
	"os" text,
	"device" text,
	"country" text,
	"country_code" text,
	"region" text,
	"city" text,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "qr_scans" ADD CONSTRAINT "qr_scans_qr_code_id_qr_codes_id_fk" FOREIGN KEY ("qr_code_id") REFERENCES "public"."qr_codes"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qr_codes_owner_idx" ON "qr_codes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qr_codes_visibility_idx" ON "qr_codes" USING btree ("visibility");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qr_scans_code_time_idx" ON "qr_scans" USING btree ("qr_code_id","scanned_at");--> statement-breakpoint
-- F24 enum-style CHECK constraints. Drizzle's DSL doesn't model CHECK
-- inline; we apply them manually so bad payloads fail at the DB even
-- if the zod layer is bypassed.
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_visibility_check"
  CHECK (visibility IN ('private','workspace'));--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_error_correction_check"
  CHECK (error_correction IN ('L','M','Q','H'));