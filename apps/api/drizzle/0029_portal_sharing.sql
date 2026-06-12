ALTER TABLE "goals" ADD COLUMN "shared_with_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "shared_with_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Backfill: the portal exposed EVERY client goal before this flag existed, so
-- pre-0029 goals stay shared (no surprise disappearance from live portals).
-- New goals default to false (opt-in). To-dos get no backfill — they were
-- never client-visible.
UPDATE "goals" SET "shared_with_client" = true;--> statement-breakpoint
-- Same preservation for client space files: /portal/files exposed the whole
-- array pre-0029, so existing entries are marked shared; new uploads default
-- to unshared (the flag lives inside the JSONB elements).
UPDATE "clients" SET "space_files" = (
  SELECT COALESCE(jsonb_agg(elem || '{"sharedWithClient": true}'::jsonb), '[]'::jsonb)
  FROM jsonb_array_elements("space_files") elem
) WHERE jsonb_array_length("space_files") > 0;