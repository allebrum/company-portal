-- Phase 4: authorization for Supabase Realtime PRIVATE channels.
--
-- Staff browsers subscribe to private channels user:{uid} / tenant:{tid} /
-- approvers:{tid}. Private channels enforce RLS on realtime.messages, which is
-- deny-by-default — without a SELECT policy a subscriber receives nothing. The
-- server broadcasts with the service-role key (bypasses RLS), so only the
-- subscriber (browser) side needs policies.
--
-- Tenant isolation: the JWT does not (yet) carry a tenant_id claim, so we join
-- public.tenant_members against auth.uid() to verify the subscriber belongs to
-- the tenant in the topic name. Idempotent (DROP IF EXISTS) and guarded so it's
-- a harmless no-op on a Postgres without the realtime schema (self-host).
DO $$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RETURN;
  END IF;

  -- A user may receive broadcasts on their own user channel.
  DROP POLICY IF EXISTS "mz_realtime_user_channel" ON realtime.messages;
  CREATE POLICY "mz_realtime_user_channel"
    ON realtime.messages FOR SELECT TO authenticated
    USING (
      extension = 'broadcast'
      AND realtime.topic() = 'user:' || auth.uid()::text
    );

  -- A tenant member may receive broadcasts on that tenant's channel.
  DROP POLICY IF EXISTS "mz_realtime_tenant_channel" ON realtime.messages;
  CREATE POLICY "mz_realtime_tenant_channel"
    ON realtime.messages FOR SELECT TO authenticated
    USING (
      extension = 'broadcast'
      AND EXISTS (
        SELECT 1 FROM public.tenant_members m
        WHERE m.user_id = auth.uid()
          AND realtime.topic() = 'tenant:' || m.tenant_id::text
      )
    );

  -- A tenant member may receive broadcasts on that tenant's approvers channel.
  -- (All approvers are tenant members; the entry-approval events are only acted
  -- on in the UI by users with the approve permission.)
  DROP POLICY IF EXISTS "mz_realtime_approvers_channel" ON realtime.messages;
  CREATE POLICY "mz_realtime_approvers_channel"
    ON realtime.messages FOR SELECT TO authenticated
    USING (
      extension = 'broadcast'
      AND EXISTS (
        SELECT 1 FROM public.tenant_members m
        WHERE m.user_id = auth.uid()
          AND realtime.topic() = 'approvers:' || m.tenant_id::text
      )
    );
END $$;
