import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// Signed `state` for provider OAuth round-trips. Protects against CSRF and
// cross-client linking: the callback only acts on the client_id baked into the
// (server-signed) state, never one supplied by the request. Stateless — no
// server-side pending record — so it survives serverless.

export interface OAuthState {
  clientId: string;
  provider: 'composio' | 'zernio';
  /** toolkit (Composio) or platform (Zernio) being connected. */
  ref: string;
}

const TTL_MS = 15 * 60 * 1000; // 15 min — an OAuth round-trip is short.

function secret(): string {
  // Reuses the portal signing secret (same trust domain). Domain-separated by
  // the 'oauth-state' prefix below so a portal token can't be replayed here.
  if (!env.PORTAL_SESSION_SECRET) {
    throw new Error('PORTAL_SESSION_SECRET is required to sign OAuth state');
  }
  return env.PORTAL_SESSION_SECRET;
}

export function signState(s: OAuthState): string {
  const body = { ...s, nonce: randomBytes(12).toString('hex'), exp: Date.now() + TTL_MS };
  const payload = Buffer.from('oauth-state:' + JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyState(token: string | undefined): OAuthState | null {
  if (!token) return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(token.slice(i + 1));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let raw: string;
  try {
    raw = Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!raw.startsWith('oauth-state:')) return null;
  let data: { clientId?: string; provider?: string; ref?: string; exp?: number };
  try {
    data = JSON.parse(raw.slice('oauth-state:'.length));
  } catch {
    return null;
  }
  if (typeof data.exp !== 'number' || Date.now() > data.exp) return null;
  if (!data.clientId || (data.provider !== 'composio' && data.provider !== 'zernio') || !data.ref) return null;
  return { clientId: data.clientId, provider: data.provider, ref: data.ref };
}
