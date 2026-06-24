import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// Stateless client-portal session. The portal's external contacts are NOT
// Supabase auth users; after a magic-link exchange we mint this short-lived
// HMAC-signed token (carrying the contact + their client + slug) and hand it to
// the browser, which sends it back as the `X-Portal-Token` header. The token is
// the only authority for portal routes — `client_id` is read from it
// server-side, never from the request body/query.

export interface PortalSession {
  contactId: string;
  clientId: string;
  slug: string;
}

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function secret(): string {
  if (!env.PORTAL_SESSION_SECRET) {
    throw new Error('PORTAL_SESSION_SECRET is required for the client portal');
  }
  return env.PORTAL_SESSION_SECRET;
}

export function signPortalSession(s: PortalSession): string {
  const payload = Buffer.from(JSON.stringify({ ...s, exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyPortalSession(token: string | undefined): PortalSession | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let data: { contactId?: string; clientId?: string; slug?: string; exp?: number };
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof data.exp !== 'number' || Date.now() > data.exp) return null;
  if (!data.contactId || !data.clientId || !data.slug) return null;
  return { contactId: data.contactId, clientId: data.clientId, slug: data.slug };
}
