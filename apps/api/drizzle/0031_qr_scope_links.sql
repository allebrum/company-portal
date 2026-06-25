ALTER TABLE "qr_codes" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qr_codes_client_idx" ON "qr_codes" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "qr_codes_project_idx" ON "qr_codes" USING btree ("project_id");