import { Router } from 'express';
import { z } from 'zod';
import type Stripe from 'stripe';
import { env, billingConfigured, billingWebhookConfigured } from '../env.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate, getValidated } from '../middleware/validate.js';
import { getTenant, provisionTenant } from '../services/tenants.js';
import {
  createStripeCustomer,
  createSetupIntent,
  startTrial,
  storePaymentMethod,
  markPaid,
  markPastDue,
  constructWebhookEvent,
} from '../services/billing.js';
import { chargeTenantNow } from '../services/billingJob.js';
import { issueToken, INVITE_TTL_MS } from '../auth/tokens.js';
import { sendInviteEmail } from '../services/mail.js';

/**
 * Custom Stripe billing surface (consolidated in-app). Mounted at /billing,
 * which the subscription gate exempts (a lapsed owner must reach it). Public:
 * /config, /signup, /stripe/webhook. Session-gated: /status, /update-card.
 */
export const billingRouter = Router();

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

// ---- Public: browser billing config (publishable key, price, trial) ----------
billingRouter.get('/config', (_req, res) => {
  res.json({
    enabled: billingConfigured,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
    monthlyPriceCents: env.MONTHLY_PRICE_CENTS,
    currency: env.BILLING_CURRENCY,
    trialDays: env.TRIAL_DAYS,
  });
});

// ---- Public: self-serve signup → workspace + trial + card-capture intent -----
const SignupSchema = z.object({
  email: z.string().email(),
  workspaceName: z.string().min(1).max(80),
  ownerName: z.string().max(120).optional(),
});

billingRouter.post(
  '/signup',
  rateLimit({ key: 'signup', max: 10, windowSec: 60 }),
  validate(SignupSchema),
  async (req, res, next) => {
    try {
      if (!billingConfigured) {
        res.status(503).json({ error: 'billing_not_configured' });
        return;
      }
      const input = getValidated<typeof SignupSchema._type>(req);
      const email = input.email.trim().toLowerCase();
      const ownerName = input.ownerName?.trim() || email;

      // 1. Stripe customer (stores the card; no charge).
      const customerId = await createStripeCustomer({
        email,
        name: ownerName,
        workspaceName: input.workspaceName,
      });
      // 2. Provision the workspace + owner (global identity by email).
      const { tenantId, ownerUserId, created } = await provisionTenant({
        name: input.workspaceName,
        slug: slugify(input.workspaceName),
        ownerEmail: email,
        ownerName,
        billingExternalId: customerId,
      });
      // 3. Start the self-owned trial (no charge until it ends).
      const { trialEndsAt } = await startTrial(tenantId);
      // 4. SetupIntent client_secret for the frontend to confirm the card.
      const clientSecret = await createSetupIntent(customerId);
      // 5. Invite the owner to set a password + land in their workspace.
      const { rawToken, expiresAt } = await issueToken(
        { kind: 'user', userId: ownerUserId },
        'invite',
        INVITE_TTL_MS,
      );
      const inviteUrl = `${env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(rawToken)}`;
      if (created) {
        try {
          await sendInviteEmail({
            senderUserId: null,
            to: email,
            inviterName: input.workspaceName,
            acceptUrl: inviteUrl,
            expiresAt,
          });
        } catch {
          /* best-effort — the URL is returned regardless */
        }
      }

      res.status(201).json({
        clientSecret,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
        inviteUrl,
        trialEndsAt,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---- Public: Stripe webhook (source of truth) --------------------------------
billingRouter.post('/stripe/webhook', async (req, res) => {
  if (!billingWebhookConfigured) {
    res.status(503).json({ error: 'webhook_not_configured' });
    return;
  }
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  const signature = req.header('stripe-signature');
  if (!rawBody || !signature) {
    res.status(400).json({ error: 'missing_signature' });
    return;
  }
  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] webhook signature failed:', err instanceof Error ? err.message : err);
    res.status(400).json({ error: 'bad_signature' });
    return;
  }

  // Ack fast so Stripe doesn't retry on slow handlers.
  res.json({ received: true });

  try {
    if (event.type === 'setup_intent.succeeded') {
      const si = event.data.object as Stripe.SetupIntent;
      const customerId = typeof si.customer === 'string' ? si.customer : si.customer?.id;
      const pmId = typeof si.payment_method === 'string' ? si.payment_method : si.payment_method?.id;
      if (customerId && pmId) await storePaymentMethod(customerId, pmId);
    } else if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const tenantId = pi.metadata?.tenant_id;
      if (tenantId) await markPaid(tenantId); // idempotent (guards double-advance)
    } else if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const tenantId = pi.metadata?.tenant_id;
      const reason = pi.last_payment_error?.message ?? 'payment_failed';
      if (tenantId) {
        const t = await getTenant(tenantId);
        // Backstop only — the daily job owns the attempt count + cancel
        // decision, so don't increment attempts here.
        if (t && t.billingStatus !== 'canceled') {
          await markPastDue(tenantId, reason, t.failedAttempts);
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[billing] webhook handler error:', err);
  }
});

// ---- Session-gated: the in-app billing screen + card update ------------------
billingRouter.get('/status', requireAuth, async (req, res, next) => {
  try {
    const me = req.session.user!;
    const t = await getTenant(me.tenantId);
    res.json({
      billingStatus: t?.billingStatus ?? null,
      billingExempt: t?.billingExempt ?? false,
      trialEndsAt: t?.trialEndsAt ?? null,
      nextBillAt: t?.nextBillAt ?? null,
      hasPaymentMethod: !!t?.stripePaymentMethodId,
      lastPaymentError: t?.lastPaymentError ?? null,
      monthlyPriceCents: env.MONTHLY_PRICE_CENTS,
      currency: env.BILLING_CURRENCY,
    });
  } catch (e) {
    next(e);
  }
});

// New SetupIntent so an owner can replace a failing card (fixes past_due).
billingRouter.post('/update-card', requireAuth, async (req, res, next) => {
  try {
    if (!billingConfigured) {
      res.status(503).json({ error: 'billing_not_configured' });
      return;
    }
    const me = req.session.user!;
    const t = await getTenant(me.tenantId);
    if (!t?.billingExternalId) {
      res.status(400).json({ error: 'no_stripe_customer' });
      return;
    }
    const clientSecret = await createSetupIntent(t.billingExternalId);
    res.json({ clientSecret, publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null });
  } catch (e) {
    next(e);
  }
});

// Charge now (e.g. right after the owner replaced a failing card) so access is
// restored immediately rather than waiting for the nightly job.
billingRouter.post('/retry', requireAuth, async (req, res, next) => {
  try {
    if (!billingConfigured) {
      res.status(503).json({ error: 'billing_not_configured' });
      return;
    }
    const me = req.session.user!;
    const result = await chargeTenantNow(me.tenantId);
    res.json({ result });
  } catch (e) {
    next(e);
  }
});
