import type { Request, Response, NextFunction } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clientContacts } from '../db/schema.js';

/**
 * Restricts a portal action to the client's `primary` contact. Mount AFTER
 * `requireClientPortalAuth`. Used for higher-trust actions — connecting /
 * disconnecting third-party accounts — that an invited `viewer` must not
 * perform on the company's behalf. The role is read from the contact row
 * (the portal token only carries the contact id), so it can't be spoofed.
 */
export async function requirePrimaryContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  const sess = req.session.clientPortalSession;
  if (!sess) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const [c] = await db
      .select({ role: clientContacts.role })
      .from(clientContacts)
      .where(eq(clientContacts.id, sess.contactId))
      .limit(1);
    if (!c || c.role !== 'primary') {
      res.status(403).json({ error: 'primary_contact_required' });
      return;
    }
    next();
  } catch (e) {
    next(e);
  }
}
