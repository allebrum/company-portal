ALTER TABLE "app_settings" ADD COLUMN "terms_url" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "privacy_url" text;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "portal_name" text DEFAULT 'Allebrum' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "brand_primary_color" text DEFAULT '#9333ea' NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "brand_logo_data_url" text;