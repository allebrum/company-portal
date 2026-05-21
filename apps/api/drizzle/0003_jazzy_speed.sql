ALTER TABLE "goals" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;