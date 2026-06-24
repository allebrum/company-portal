import type { Request, Response, NextFunction } from 'express';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { tenantEq } from '../tenancy/scope.js';

/**
 * Guards routes with a `:id` client param against cross-tenant access: confirms
 * the client belongs to the caller's active workspace before the handler runs.
 * Mount AFTER `requireAuth` (and inside the global tenantContext). 404 — not 403
 * — on a foreign/unknown client so existence isn't revealed across tenants.
 */
export async function requireClientInTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = req.params.id;
    if (!id) {
      res.status(400).json({ error: 'client_id_required' });
      return;
    }
    const [c] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), tenantEq(clients.tenantId)))
      .limit(1);
    if (!c) {
      res.status(404).json({ error: 'client_not_found' });
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
}
