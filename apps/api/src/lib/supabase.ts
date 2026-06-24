import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../env.js';

// Server-side Supabase clients. Two flavours:
//   - service role: bypasses RLS; used for Realtime Broadcast, Storage writes,
//     and Auth Admin operations (invites, seeding) inside Netlify Functions.
//   - JWT-bound: scoped to a request's user, RLS-enforced (used where we want
//     defense-in-depth rather than trusting the service role).
// Both are dormant until SUPABASE_URL + keys are set, so the legacy server
// still boots without them during the migration.

let serviceClient: SupabaseClient | null = null;

export function getServiceSupabase(): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase service client requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!serviceClient) {
    serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serviceClient;
}

/** A client that acts as the given user, so RLS policies apply to its queries. */
export function getUserSupabase(accessToken: string): SupabaseClient {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw new Error('Supabase user client requires SUPABASE_URL and SUPABASE_ANON_KEY');
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
