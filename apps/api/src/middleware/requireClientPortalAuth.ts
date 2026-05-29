import type { Request, Response, NextFunction } from 'express';

/**
 * Gate for the public client portal API (F23). Mirrors `requireAuth` but
 * checks the sibling `clientPortalSession` field on the session — set
 * after a successful magic-link exchange. Internal staff routes stay on
 * `requireAuth` and the staff `user` field; the two tracks never share.
 *
 * Returns 401 `unauthorized` when no portal session is set. Downstream
 * handlers can trust `req.session.clientPortalSession.{contactId,
 * clientId, slug}` to be present.
 */
export function requireClientPortalAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.clientPortalSession?.contactId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}
