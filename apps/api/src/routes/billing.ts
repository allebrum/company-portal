import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { env } from '../env.js';
import { signManageRef } from '../auth/manageRef.js';

/**
 * Slim billing surface. Billing itself (Stripe, signup, charging, webhooks) lives
 * in the separate MARKETING service; this is the only billing endpoint left in
 * the portal: for a logged-in user whose workspace is past_due / trialing-without-
 * card, it mints a short-lived signed "manage billing" ref and returns the
 * marketing-hosted fix-card URL. Gate-exempt (a lapsed owner must reach it). No
 * Stripe here.
 */
export const billingRouter = Router();

billingRouter.post('/manage-link', requireAuth, (req, res) => {
  const me = req.session.user!;
  if (!env.MARKETING_ORIGIN) {
    res.status(503).json({ error: 'billing_unavailable' });
    return;
  }
  const ref = signManageRef(me.tenantId, me.userId);
  const url = `${env.MARKETING_ORIGIN.replace(/\/+$/, '')}/billing?ref=${encodeURIComponent(ref)}`;
  res.json({ url });
});
