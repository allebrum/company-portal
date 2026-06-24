-- Supabase platform glue (runs after the table baseline).
--
-- 1) Tie the `users` profile to Supabase Auth identities: a profile row's id
--    must equal an auth.users id, and is removed when the auth user is deleted.
ALTER TABLE "users"
  ADD CONSTRAINT "users_id_auth_users_fk"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint

-- 2) Enable Row-Level Security (deny-by-default) on every app table.
--    The API connects as the Postgres/service role and BYPASSES RLS, so this
--    does not affect server-side Drizzle queries (tenant scoping there stays
--    in `tenantEq()`). RLS here is defense-in-depth for any future
--    direct-from-browser Supabase access; per-table policies and the custom
--    access-token hook (tenant_id JWT claim) are added when that lands.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
  END LOOP;
END $$;
