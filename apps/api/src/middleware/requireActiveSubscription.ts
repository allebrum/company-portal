import type { Request, Response, NextFunction } from 'express';
import { getTenant } from '../services/tenants.js';
import { getSubscription, isActive } from '../services/subscriptions.js';

/**
 * Hoppa Phase 3 — gate business routes on the workspace's subscription.
 *
 * Mounted globally after `tenantContext`. Behavior:
 *  - No staff session (unauth / client-portal / public routes): pass through;
 *    those routes have their own auth and aren't billed.
 *  - Exempt staff paths (/auth, /billing): always pass so a lapsed owner can
 *    still log in, switch workspace, and reach the billing portal.
 *  - Otherwise: look up the workspace's subscription via the marketing API
 *    (cached). Active/trialing → allow. Canceled/past-due → 402.
 *
 * Fail policy:
 *  - Billing unconfigured (no MARKETING_API_*): getSubscription returns a
 *    synthetic active record → everything passes (single self-hosted workspace).
 *  - Transient upstream failure (getSubscription returns null due to a network
 *    blip, not a 404): fall back to the tenant's mirror `status` column (last
 *    known good) so a marketing-site outage doesn't lock out paying customers.
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
    // Grandfathered workspaces (the internal / self-host default tenant) bypass
    // the subscription check entirely, even when SaaS gating is configured.
    if (tenant?.billingExempt) {
      next();
      return;
    }
    const sub = await getSubscription(tenant?.billingExternalId ?? null);
    if (isActive(sub)) {
      next();
      return;
    }
    // Transient upstream failure → grace on the last-known-good mirror status.
    if (!sub && (tenant?.status === 'active' || tenant?.status === 'trialing')) {
      next();
      return;
    }
    res.status(402).json({ error: 'subscription_inactive', billingPortalHint: true });
  } catch (e) {
    next(e);
  }
}
