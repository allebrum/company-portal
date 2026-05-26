ALTER TABLE "active_timers" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "time_entries" ALTER COLUMN "project_id" DROP NOT NULL;