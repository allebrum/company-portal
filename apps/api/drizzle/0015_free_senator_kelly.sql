ALTER TABLE "groups" ALTER COLUMN "require_2fa" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "owner_group_id" uuid;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "assignee_group_id" uuid;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "attachments" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_group_id_groups_id_fk" FOREIGN KEY ("owner_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_group_id_groups_id_fk" FOREIGN KEY ("assignee_group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todos_assignee_group_idx" ON "todos" USING btree ("assignee_group_id");--> statement-breakpoint
-- F25: XOR CHECK constraints — a todo/goal is assigned to EITHER a user OR a
-- group (or neither). Both being non-null at the same time is rejected.
DO $$ BEGIN
 ALTER TABLE "todos" ADD CONSTRAINT "todos_assignee_xor_group_check" CHECK (assignee_id IS NULL OR assignee_group_id IS NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "goals" ADD CONSTRAINT "goals_owner_xor_group_check" CHECK (owner_id IS NULL OR owner_group_id IS NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;