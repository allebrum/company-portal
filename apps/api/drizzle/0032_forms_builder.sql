-- F31: Forms builder + embeddable runtime
-- Tenant-owned hosted forms with scoped linking, analytics events, and submissions.

CREATE TABLE "forms" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "owner_user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,
  "client_id" uuid,
  "project_id" uuid,
  "visibility" text DEFAULT 'workspace' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "form_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "form_id" uuid NOT NULL,
  "session_id" text,
  "event_type" text NOT NULL,
  "path" text,
  "ip" text,
  "user_agent" text,
  "referer" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_submissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "form_id" uuid NOT NULL,
  "session_id" text,
  "answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "ip" text,
  "user_agent" text,
  "referer" text,
  "submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "forms" ADD CONSTRAINT "forms_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "forms" ADD CONSTRAINT "forms_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "forms" ADD CONSTRAINT "forms_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_visibility_check" CHECK ("forms"."visibility" in ('private','workspace'));
ALTER TABLE "forms" ADD CONSTRAINT "forms_status_check" CHECK ("forms"."status" in ('active','paused'));
ALTER TABLE "form_events" ADD CONSTRAINT "form_events_type_check" CHECK ("form_events"."event_type" in ('view','interact','submit'));
--> statement-breakpoint
CREATE INDEX "forms_owner_idx" ON "forms" USING btree ("owner_user_id");
CREATE INDEX "forms_visibility_idx" ON "forms" USING btree ("visibility");
CREATE INDEX "forms_status_idx" ON "forms" USING btree ("status");
CREATE INDEX "forms_client_idx" ON "forms" USING btree ("client_id");
CREATE INDEX "forms_project_idx" ON "forms" USING btree ("project_id");
CREATE INDEX "form_events_form_time_idx" ON "form_events" USING btree ("form_id","occurred_at");
CREATE INDEX "form_events_form_type_idx" ON "form_events" USING btree ("form_id","event_type");
CREATE INDEX "form_events_form_session_idx" ON "form_events" USING btree ("form_id","session_id");
CREATE INDEX "form_submissions_form_time_idx" ON "form_submissions" USING btree ("form_id","submitted_at");
CREATE INDEX "form_submissions_form_session_idx" ON "form_submissions" USING btree ("form_id","session_id");
