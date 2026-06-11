ALTER TABLE "milestones" ADD COLUMN "signed_off_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "signed_off_by_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "milestones" ADD COLUMN "sign_off_comment" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "milestones" ADD CONSTRAINT "milestones_signed_off_by_contact_id_client_contacts_id_fk" FOREIGN KEY ("signed_off_by_contact_id") REFERENCES "public"."client_contacts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
