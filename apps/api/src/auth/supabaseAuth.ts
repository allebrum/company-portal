import type { Request, Response, NextFunction } from 'express';
import { and, eq } from 'drizzle-orm';
import { getServiceSupabase } from '../lib/supabase.js';
import { db } from '../db/client.js';
import { tenantMembers } from '../db/schema.js';

// ---- Request session shim ----
// Auth is stateless (Supabase JWT) — there is no server session store. This
// per-request object preserves the shape the codebase already reads
// (`req.session.user = { userId, tenantId }`) so the ~34 call sites that read
// it don't change. The OAuth-connect state slots (Drive/Gmail) and the
// client-portal slot are kept on the type for compile compatibility; the flows
// that used them are being reworked to stateless equivalents.
export interface AppSession {
  user?: { userId: string; tenantId: string };
  gmailOauthState?: { state: string; returnTo?: string };
  driveOauthState?: { state: string; returnTo?: string };
  clientPortalSession?: { contactId: string; clientId: string; slug: string };
  // express-session-compatible no-ops so legacy call sites compile. Always set
  // by `supabaseAuth` at the start of every request, so non-optional.
  save: (cb?: (err?: unknown) => void) => void;
  destroy: (cb?: (err?: unknown) => void) => void;
  regenerate: (cb?: (err?: unknown) => void) => void;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session: AppSession;
    }
  }
}

const noop = (cb?: (err?: unknown) => void): void => cb?.(undefined);

function bearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : undefined;
}

/**
 * Verify a Supabase access token and resolve the active workspace. Shared by
 * the HTTP middleware and the Socket.IO handshake. Returns null when the token
 * is missing/invalid or the user belongs to no workspace.
 */
export async function resolveAuth(
  token: string | undefined,
  requestedTenantId?: string,
): Promise<{ userId: string; tenantId: string } | null> {
  if (!token) return null;
  const { data, error } = await getServiceSupabase().auth.getUser(token);
  const authUser = data?.user;
  if (error || !authUser) return null;
  const userId = authUser.id;

  let tenantId: string | undefined;
  if (requestedTenantId) {
    const m = await db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, requestedTenantId)))
      .limit(1);
    tenantId = m[0]?.tenantId;
  }
  if (!tenantId) {
    const m = await db
      .select({ tenantId: tenantMembers.tenantId })
      .from(tenantMembers)
      .where(eq(tenantMembers.userId, userId))
      .limit(1);
    tenantId = m[0]?.tenantId;
  }
  return tenantId ? { userId, tenantId } : null;
}

/**
 * Verify the Supabase access token (Authorization: Bearer …) and populate
 * `req.session.user = { userId, tenantId }`. Mounted in place of the old
 * express-session middleware. No token / invalid token → no `user` (protected
 * routes then 401 via `requireAuth`; public routes pass through).
 *
 * Active workspace: an optional `x-tenant-id` header lets a multi-workspace
 * user pick which membership is active (validated below); otherwise the first
 * membership is used. This keeps workspace switching stateless.
 */
export async function supabaseAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.session = { save: noop, destroy: noop, regenerate: noop };
  try {
    const requested = typeof req.headers['x-tenant-id'] === 'string' ? (req.headers['x-tenant-id'] as string) : undefined;
    const resolved = await resolveAuth(bearer(req), requested);
    if (resolved) req.session.user = resolved;
    next();
  } catch (e) {
    next(e);
  }
}
