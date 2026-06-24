import type { Request, Response, NextFunction } from 'express';
import { verifyPortalSession } from '../auth/portalSession.js';

/**
 * Gate for the public client portal API. The portal is stateless: the browser
 * sends the signed portal-session token (minted at `/portal/exchange`) in the
 * `X-Portal-Token` header. We verify it and populate
 * `req.session.clientPortalSession.{contactId, clientId, slug}` for downstream
 * handlers, which scope every query to that `clientId`. Internal staff routes
 * use `requireAuth` + the Supabase `user` field instead; the two tracks never
 * share.
 */
export function requireClientPortalAuth(req: Request, res: Response, next: NextFunction): void {
  const sess = verifyPortalSession(req.header('x-portal-token') ?? undefined);
  if (!sess) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.session.clientPortalSession = sess;
  next();
}
