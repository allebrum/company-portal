import type { Request, Response, NextFunction } from 'express';
import { getTenant } from '../services/tenants.js';
import { tenantIsActive } from '../services/subscriptions.js';

/**
 * Gate business routes on the workspace's subscription. Billing lives in the
 * separate marketing service; this only READS the tenant's local billing_status
 * (written there). Mounted globally after `tenantContext`.
 *
 *  - No staff session (unauth / client-portal / public routes): pass through.
 *  - Exempt staff paths (/auth, /billing, …): always pass so a lapsed owner can
 *    still log in, switch workspace, and reach /billing/manage-link (the link to
 *    the marketing-hosted fix-card page).
 *  - Otherwise: active / trialing-with-card → allow; past_due / canceled /
 *    trialing-no-card → 402. billing_exempt and self-host (BILLING_ENFORCED
 *    false) always pass — see `tenantIsActive`.
 */
const EXEMPT_PREFIXES = ['/auth', '/billing', '/provisioning', '/health', '/q', '/portal'];

function isExempt(path: string): boolean {
  return EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}

export async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tenantId = req.session?.user?.tenantId;
  if (!tenantId) {
    next();
    return;
  }
  if (isExempt(req.path)) {
    next();
    return;
  }
  try {
    const tenant = await getTenant(tenantId);
    if (tenantIsActive(tenant)) {
      next();
      return;
    }
    res.status(402).json({ error: 'subscription_inactive', billingPortalHint: true });
  } catch (e) {
    next(e);
  }
}
