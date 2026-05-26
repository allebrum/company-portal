ALTER TABLE "app_settings" ADD COLUMN "system_sender_user_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_system_sender_user_id_users_id_fk" FOREIGN KEY ("system_sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
