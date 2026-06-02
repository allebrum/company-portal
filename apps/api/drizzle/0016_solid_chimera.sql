-- Guarded for the converged history: on PROD the upload_qr_session_files table
-- already exists (created via db:push, never a CREATE migration), so these
-- columns get added. On a FRESH self-host DB the table doesn't exist yet at
-- this point — it (with these columns) is created later by
-- 0020_converge_uploadqr_billing_exempt — so skip rather than error. Prod never
-- re-runs this migration (drizzle's migrator gates on the `when` timestamp), so
-- editing it here only affects fresh databases.
DO $$ BEGIN
  IF to_regclass('public.upload_qr_session_files') IS NOT NULL THEN
    ALTER TABLE "upload_qr_session_files" ADD COLUMN IF NOT EXISTS "upload_title" text;
    ALTER TABLE "upload_qr_session_files" ADD COLUMN IF NOT EXISTS "upload_notes" text;
  END IF;
END $$;