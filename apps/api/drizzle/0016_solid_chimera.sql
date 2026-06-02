ALTER TABLE "upload_qr_session_files" ADD COLUMN IF NOT EXISTS "upload_title" text;--> statement-breakpoint
ALTER TABLE "upload_qr_session_files" ADD COLUMN IF NOT EXISTS "upload_notes" text;