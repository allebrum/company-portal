export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080').replace(/\/$/, '');

// Signup lives on the marketing site (SaaS). The portal's /signup route is a
// thin redirect here so old bookmarks/links don't 404. Unset (self-host) →
// the redirect falls back to /login.
export const MARKETING_SIGNUP_URL = (process.env.NEXT_PUBLIC_MARKETING_SIGNUP_URL ?? '').replace(/\/$/, '');

// Supabase (Auth/Realtime/Storage). Build-time inlined; see lib/supabase.ts.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://localhost:54321').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
