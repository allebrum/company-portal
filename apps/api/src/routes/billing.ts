import { Router, type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import argon2 from 'argon2';
import type Stripe from 'stripe';
import { env, billingConfigured, billingWebhookConfigured } from '../env.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate, getValidated } from '../middleware/validate.js';
import { getTenant, getOwnerUserId, provisionBillingSignup } from '../services/tenants.js';
import {
  createStripeCustomer,
  createSetupIntent,
  getSetupIntent,
  storePaymentMethod,
  markPaid,
  markPastDue,
  constructWebhookEvent,
  signSignupRef,
  verifySignupRef,
} from '../services/billing.js';
import { chargeTenantNow } from '../services/billingJob.js';
import { issueToken, HANDOFF_TTL_MS } from '../auth/tokens.js';

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

/**
 * Gate the signup endpoints to the marketing BFF. When SIGNUP_BFF_SECRET is set
 * (SaaS), require a matching `X-Signup-Key` header so the public can't drive
 * signup directly and bypass the BFF's rate-limit. When unset (self-host), the
 * endpoints stay open. Constant-time compare to avoid leaking the secret.
 */
function requireSignupKey(req: Request, res: Response, next: NextFunction): void {
  const secret = env.SIGNUP_BFF_SECRET;
  if (!secret) {
    next();
    return;
  }
  const provided = req.header('x-signup-key') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length === b.length && timingSafeEqual(a, b)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
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

// ---- Signup step 1: account + workspace + trial + card-capture intent --------
// Called by the marketing BFF (not the browser directly). Collects the password
// up front (the portal is the login authority), provisions the workspace, starts
// the trial, and returns a SetupIntent client_secret for the browser to confirm
// the card. The auto-login handoff is NOT minted here — only after the card is
// validated in /complete.
const SignupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  workspaceName: z.string().min(1).max(80),
  ownerName: z.string().max(120).optional(),
});

billingRouter.post(
  '/signup',
  requireSignupKey,
  rateLimit({ key: 'signup', max: 10, windowSec: 60, clientIpHeader: 'x-client-ip' }),
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

      // Race-free provisioning: a per-email advisory lock makes a duplicate
      // tenant/customer impossible; a retry reuses the in-progress one; a real
      // prior account returns `account_exists` so the UI says "sign in".
      const passwordHash = await argon2.hash(input.password);
      const result = await provisionBillingSignup({
        email,
        ownerName,
        workspaceName: input.workspaceName,
        slug: slugify(input.workspaceName),
        passwordHash,
        createCustomer: () =>
          createStripeCustomer({ email, name: ownerName, workspaceName: input.workspaceName }),
      });
      if (result.kind === 'account_exists') {
        res.status(409).json({ error: 'account_exists' });
        return;
      }

      // SetupIntent client_secret for the frontend to confirm the card (no
      // charge). Access stays gated until the card is on file.
      const clientSecret = await createSetupIntent(result.customerId);
      const t = await getTenant(result.tenantId);

      res.status(201).json({
        clientSecret,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
        signupRef: signSignupRef(result.tenantId),
        trialEndsAt: t?.trialEndsAt ?? null,
      });
    } catch (e) {
      next(e);
    }
  },
);

// ---- Signup step 2: validate the saved card, then grant access ---------------
// Called by the BFF after the browser confirms the SetupIntent. Validates the
// SetupIntent succeeded server-side ("validate payment intent"), stores the
// card, and mints a single-use auto-login handoff URL into the portal.
const CompleteSchema = z.object({
  signupRef: z.string().min(1),
  setupIntentId: z.string().min(1),
});

billingRouter.post(
  '/complete',
  requireSignupKey,
  rateLimit({ key: 'signup-complete', max: 20, windowSec: 60, clientIpHeader: 'x-client-ip' }),
  validate(CompleteSchema),
  async (req, res, next) => {
    try {
      if (!billingConfigured) {
        res.status(503).json({ error: 'billing_not_configured' });
        return;
      }
      const { signupRef, setupIntentId } = getValidated<typeof CompleteSchema._type>(req);
      const tenantId = verifySignupRef(signupRef);
      if (!tenantId) {
        res.status(401).json({ error: 'invalid_ref' });
        return;
      }
      const tenant = await getTenant(tenantId);
      if (!tenant?.billingExternalId) {
        res.status(404).json({ error: 'unknown_signup' });
        return;
      }
      // Validate the card was actually saved, and that it belongs to this
      // workspace's customer (so a leaked SetupIntent id can't cross workspaces).
      const si = await getSetupIntent(setupIntentId);
      if (si.status !== 'succeeded') {
        res.status(400).json({ error: 'card_not_confirmed' });
        return;
      }
      if (si.customerId && si.customerId !== tenant.billingExternalId) {
        res.status(400).json({ error: 'customer_mismatch' });
        return;
      }
      if (si.paymentMethodId) {
        await storePaymentMethod(tenant.billingExternalId, si.paymentMethodId);
      }
      // Mint the single-use auto-login handoff for the workspace owner.
      const ownerId = await getOwnerUserId(tenant.id);
      if (!ownerId) {
        res.status(500).json({ error: 'no_owner' });
        return;
      }
      const { rawToken } = await issueToken({ kind: 'user', userId: ownerId }, 'portal-login', HANDOFF_TTL_MS);
      const handoffUrl = `${env.WEB_ORIGIN}/auth/handoff?token=${encodeURIComponent(rawToken)}`;
      res.json({ handoffUrl });
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

// Store a just-confirmed card WITHOUT charging — used by the in-app add-card
// flow during a trial (a trialing workspace needs a card on file to pass the
// gate, but must not be billed until the trial ends). past_due reactivation
// additionally calls /retry afterwards.
const ConfirmSetupSchema = z.object({ setupIntentId: z.string().min(1) });
billingRouter.post('/confirm-setup', requireAuth, validate(ConfirmSetupSchema), async (req, res, next) => {
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
    const { setupIntentId } = getValidated<typeof ConfirmSetupSchema._type>(req);
    const si = await getSetupIntent(setupIntentId);
    if (si.status !== 'succeeded') {
      res.status(400).json({ error: 'card_not_confirmed' });
      return;
    }
    if (si.customerId && si.customerId !== t.billingExternalId) {
      res.status(400).json({ error: 'customer_mismatch' });
      return;
    }
    if (si.paymentMethodId) await storePaymentMethod(t.billingExternalId, si.paymentMethodId);
    res.json({ ok: true });
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
