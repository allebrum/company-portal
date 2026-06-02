import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { env } from '../env.js';
import { getTenant } from '../services/tenants.js';
import { billingPortalUrl } from '../services/subscriptions.js';

/**
 * Hoppa Phase 3 — billing surface. Exempt from the subscription gate (a lapsed
 * owner must be able to reach it to re-subscribe). Returns a Stripe
 * billing-portal deep link from the marketing site for the active workspace.
 */
export const billingRouter = Router();

billingRouter.use(requireAuth);

billingRouter.post('/portal', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const tenant = await getTenant(me.tenantId);
    const returnUrl = `${env.WEB_ORIGIN}/dashboard`;
    const url = await billingPortalUrl(tenant?.billingExternalId ?? null, returnUrl);
    if (!url) {
      res.status(503).json({ error: 'billing_unavailable' });
      return;
    }
    res.json({ url });
  } catch (e) {
    next(e);
  }
});
