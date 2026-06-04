import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

/**
 * "Manage billing" handoff ref — the portal→marketing fix-card token. A logged-in
 * user who is past_due / trialing-without-card is sent to the marketing-hosted
 * billing page with this opaque, short-lived, HMAC-signed ref. The portal both
 * signs it (POST /billing/manage-link) and validates it (POST
 * /provisioning/billing-ref/validate), so the secret stays portal-side
 * (`SESSION_SECRET`). It binds the tenant + the user that requested it.
 */

const MANAGE_REF_TTL_MS = 15 * 60 * 1000; // 15 min

export function signManageRef(tenantId: string, userId: string): string {
  const payload = `${tenantId}.${userId}.${Date.now() + MANAGE_REF_TTL_MS}`;
  const sig = createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyManageRef(ref: string): { tenantId: string; userId: string } | null {
  const i = ref.lastIndexOf('.');
  if (i <= 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(ref.slice(0, i), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(ref.slice(i + 1));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { tenantId: parts[0]!, userId: parts[1]! };
}
