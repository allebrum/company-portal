import Stripe from 'stripe';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env, billingConfigured } from '../env.js';
import { db } from '../db/client.js';
import { tenants, type Tenant } from '../db/schema.js';

/**
 * Custom Stripe billing (consolidated in-app).
 *
 * No Stripe Prices / Products / Subscriptions: Stripe only stores the card
 * (SetupIntent, off-session) and processes our charges. WE own the schedule —
 * a self-tracked 30-day trial, then an off-session PaymentIntent every
 * BILLING_INTERVAL_DAYS for MONTHLY_PRICE_CENTS. State lives on the `tenants`
 * row; the daily job (services/billingJob.ts) drives the recurring charges and
 * webhooks are the authoritative outcome.
 *
 * Everything here throws `billing_not_configured` when STRIPE_SECRET_KEY is
 * unset, so callers must guard on `billingConfigured`. Subscription gating
 * treats unconfigured as "allow everyone" (self-host).
 */

export type BillingStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

let _stripe: Stripe | null = null;
export function stripe(): Stripe {
  if (!billingConfigured) throw new Error('billing_not_configured');
  if (!_stripe) _stripe = new Stripe(env.STRIPE_SECRET_KEY!);
  return _stripe;
}

function nowIso(): string {
  return new Date().toISOString();
}
function addDays(from: string | Date, days: number): string {
  const d = typeof from === 'string' ? new Date(from) : from;
  return new Date(d.getTime() + days * 86_400_000).toISOString();
}

// ---- Stripe operations (server-side only) -----------------------------------

/** Create a Stripe customer (one per workspace). Returns the customer id. */
export async function createStripeCustomer(args: {
  email: string;
  name?: string | null;
  workspaceName?: string | null;
}): Promise<string> {
  const customer = await stripe().customers.create({
    email: args.email,
    name: args.name ?? undefined,
    metadata: { workspace_name: args.workspaceName ?? '' },
  });
  return customer.id;
}

/** SetupIntent to capture + save the card off-session. Frontend confirms it. */
export async function createSetupIntent(customerId: string): Promise<string> {
  const si = await stripe().setupIntents.create({
    customer: customerId,
    usage: 'off_session',
    payment_method_types: ['card'],
  });
  if (!si.client_secret) throw new Error('setup_intent_no_client_secret');
  return si.client_secret;
}

/**
 * Retrieve a SetupIntent to validate it server-side (the marketing signup
 * `/complete` step: only grant access if the card was actually saved). Returns
 * its status plus the resolved customer + payment-method ids.
 */
export async function getSetupIntent(setupIntentId: string): Promise<{
  status: Stripe.SetupIntent.Status;
  customerId: string | null;
  paymentMethodId: string | null;
}> {
  const si = await stripe().setupIntents.retrieve(setupIntentId);
  const customerId = typeof si.customer === 'string' ? si.customer : (si.customer?.id ?? null);
  const paymentMethodId =
    typeof si.payment_method === 'string' ? si.payment_method : (si.payment_method?.id ?? null);
  return { status: si.status, customerId, paymentMethodId };
}

/** Make a payment method the customer's default (called on setup_intent.succeeded). */
export async function setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
  await stripe().customers.update(customerId, {
    invoice_settings: { default_payment_method: paymentMethodId },
  });
}

/**
 * Off-session recurring charge. The idempotency key (built by the caller from
 * tenant + period + attempt) guarantees a job retry within the same attempt
 * never double-charges. Throws a Stripe error on decline/auth-required, which
 * the caller maps to past_due.
 */
export async function chargeOffSession(args: {
  customerId: string;
  paymentMethodId: string;
  amountCents: number;
  currency: string;
  tenantId: string;
  idempotencyKey: string;
}): Promise<Stripe.PaymentIntent> {
  return stripe().paymentIntents.create(
    {
      amount: args.amountCents,
      currency: args.currency,
      customer: args.customerId,
      payment_method: args.paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: { tenant_id: args.tenantId },
    },
    { idempotencyKey: args.idempotencyKey },
  );
}

/** Verify + parse a Stripe webhook from the raw request bytes. */
export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  return stripe().webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET!);
}

// ---- Tenant billing-state mutations -----------------------------------------

export async function getTenantByCustomerId(customerId: string): Promise<Tenant | undefined> {
  const [row] = await db.select().from(tenants).where(eq(tenants.billingExternalId, customerId)).limit(1);
  return row;
}

/** Start the self-owned trial on a freshly-provisioned paid workspace. */
export async function startTrial(tenantId: string): Promise<{ trialEndsAt: string; nextBillAt: string }> {
  const trialEndsAt = addDays(nowIso(), env.TRIAL_DAYS);
  const nextBillAt = trialEndsAt; // first charge fires when the trial ends
  await db
    .update(tenants)
    .set({
      billingStatus: 'trialing',
      trialEndsAt,
      nextBillAt,
      failedAttempts: 0,
      lastPaymentError: null,
      updatedAt: nowIso(),
    })
    .where(eq(tenants.id, tenantId));
  return { trialEndsAt, nextBillAt };
}

/** Persist + default the saved card (from the setup_intent.succeeded webhook). */
export async function storePaymentMethod(customerId: string, paymentMethodId: string): Promise<void> {
  await setDefaultPaymentMethod(customerId, paymentMethodId);
  await db
    .update(tenants)
    .set({ stripePaymentMethodId: paymentMethodId, updatedAt: nowIso() })
    .where(eq(tenants.billingExternalId, customerId));
}

/**
 * A charge succeeded → active, advance the next bill date one interval out.
 * Idempotent: if next_bill_at is already in the future (the other code path —
 * job or webhook — already advanced this period), leave it. So the daily job's
 * synchronous result AND the payment_intent.succeeded webhook can both call
 * this without double-advancing.
 */
export async function markPaid(tenantId: string): Promise<void> {
  const [t] = await db
    .select({ nextBillAt: tenants.nextBillAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  const alreadyAdvanced = t?.nextBillAt && new Date(t.nextBillAt).getTime() > Date.now();
  const nextBillAt = alreadyAdvanced ? t!.nextBillAt! : addDays(nowIso(), env.BILLING_INTERVAL_DAYS);
  await db
    .update(tenants)
    .set({
      billingStatus: 'active',
      nextBillAt,
      failedAttempts: 0,
      lastPaymentError: null,
      updatedAt: nowIso(),
    })
    .where(eq(tenants.id, tenantId));
}

/** A charge failed → past_due; retry the next day (caller stops at max retries). */
export async function markPastDue(tenantId: string, reason: string, attempts: number): Promise<void> {
  await db
    .update(tenants)
    .set({
      billingStatus: 'past_due',
      failedAttempts: attempts,
      lastPaymentError: reason.slice(0, 500),
      nextBillAt: addDays(nowIso(), 1),
      updatedAt: nowIso(),
    })
    .where(eq(tenants.id, tenantId));
}

/** Exhausted retries → canceled; stop charging (no next_bill_at advance). */
export async function markCanceled(tenantId: string, reason: string): Promise<void> {
  await db
    .update(tenants)
    .set({
      billingStatus: 'canceled',
      lastPaymentError: reason.slice(0, 500),
      nextBillAt: null,
      updatedAt: nowIso(),
    })
    .where(eq(tenants.id, tenantId));
}

// ---- Signed signup ref -------------------------------------------------------
// The browser gets an opaque, HMAC-signed, short-lived reference instead of the
// raw tenant id (so the tenant id isn't leaked / enumerable, and /complete can't
// be driven with a forged tenant id). Secret = SESSION_SECRET (always set).

const SIGNUP_REF_TTL_MS = 30 * 60 * 1000; // 30 min — enough to finish the card step

/** Mint an opaque `tenantId.expiry` ref, HMAC-signed and base64url-encoded. */
export function signSignupRef(tenantId: string): string {
  const payload = `${tenantId}.${Date.now() + SIGNUP_REF_TTL_MS}`;
  const sig = createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

/** Verify a signup ref → tenant id, or null if tampered / expired / malformed. */
export function verifySignupRef(ref: string): string | null {
  const i = ref.lastIndexOf('.');
  if (i <= 0) return null;
  let payload: string;
  try {
    payload = Buffer.from(ref.slice(0, i), 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = createHmac('sha256', env.SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(ref.slice(i + 1));
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const dot = payload.lastIndexOf('.');
  if (dot <= 0) return null;
  const exp = Number(payload.slice(dot + 1));
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return payload.slice(0, dot);
}

export { nowIso, addDays };
