'use client';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

// The anon key is safe to ship to the browser — row-level security is the
// actual authorization boundary.
let client: SupabaseClient | null = null;

/**
 * Singleton browser Supabase client. Used for auth (session/JWT), Realtime
 * channel subscriptions, and Storage uploads. App data still flows through the
 * `/api/*` Netlify Functions (see `lib/api.ts`), which trust the Supabase JWT.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }
  return client;
}
