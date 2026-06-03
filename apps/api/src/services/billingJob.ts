import { and, eq, lte, isNotNull, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, type Tenant } from '../db/schema.js';
import { env, billingConfigured } from '../env.js';
import { chargeOffSession, markPaid, markPastDue, markCanceled, nowIso } from './billing.js';
import { getTenant } from './tenants.js';

/**
 * Daily recurring-billing job (in-process node-cron).
 *
 * Selects workspaces whose `next_bill_at` has passed and charges them
 * off-session for MONTHLY_PRICE_CENTS. We own the schedule — Stripe just runs
 * the charge. Idempotency keys (tenant + period day + attempt) mean a job
 * re-run within the same attempt never double-charges, while each retry uses a
 * fresh key so it actually re-attempts. Webhooks reconcile the outcome too.
 */

type ChargeResult = 'paid' | 'past_due' | 'canceled' | 'skipped';

async function chargeTenant(t: Tenant): Promise<ChargeResult> {
  if (!t.billingExternalId) return 'skipped';
  const amount = env.MONTHLY_PRICE_CENTS;
  if (amount <= 0) return 'skipped'; // misconfigured price — never charge $0

  const attempts = (t.failedAttempts ?? 0) + 1;
  const fail = async (reason: string): Promise<ChargeResult> => {
    if (attempts >= env.BILLING_MAX_RETRIES) {
      await markCanceled(t.id, reason);
      return 'canceled';
    }
    await markPastDue(t.id, reason, attempts);
    return 'past_due';
  };

  // No saved card (abandoned trial / card removed) — can't charge.
  if (!t.stripePaymentMethodId) return fail('no_payment_method');

  // Idempotency key keyed on the CURRENT attempt count: a crash-rerun within
  // the same attempt reuses it (dedupe); the next retry increments
  // failed_attempts so its key is fresh (real re-attempt).
  const periodDay = (t.nextBillAt ?? nowIso()).slice(0, 10);
  const idempotencyKey = `${t.id}-${periodDay}-${t.failedAttempts ?? 0}`;

  try {
    await chargeOffSession({
      customerId: t.billingExternalId,
      paymentMethodId: t.stripePaymentMethodId,
      amountCents: amount,
      currency: env.BILLING_CURRENCY,
      tenantId: t.id,
      idempotencyKey,
    });
    await markPaid(t.id);
    return 'paid';
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const reason = (err as { message?: string }).message ?? code ?? 'charge_failed';
    if (code === 'authentication_required') {
      // SCA required — an off-session charge can't complete; the owner must
      // re-confirm the card. TODO: wire a real "confirm your payment" email via
      // the workspace system sender (F4). Stubbed/logged for now.
      // eslint-disable-next-line no-console
      console.warn(`[billing] tenant ${t.id} needs SCA — would email owner to confirm payment`);
    }
    return fail(reason);
  }
}

/**
 * Charge a single workspace immediately (used by POST /billing/retry after an
 * owner replaces a failing card, so access is restored without waiting for the
 * nightly run). Same idempotency + state transitions as the daily job.
 */
export async function chargeTenantNow(tenantId: string): Promise<ChargeResult> {
  if (!billingConfigured) return 'skipped';
  const t = await getTenant(tenantId);
  if (!t || t.billingExempt) return 'skipped';
  if (!['trialing', 'active', 'past_due'].includes(t.billingStatus ?? '')) return 'skipped';
  return chargeTenant(t);
}

export async function runDailyBilling(): Promise<{
  paid: number;
  pastDue: number;
  canceled: number;
  skipped: number;
}> {
  const tally = { paid: 0, pastDue: 0, canceled: 0, skipped: 0 };
  if (!billingConfigured) return tally;

  const due = await db
    .select()
    .from(tenants)
    .where(
      and(
        isNotNull(tenants.nextBillAt),
        lte(tenants.nextBillAt, nowIso()),
        eq(tenants.billingExempt, false),
        isNotNull(tenants.billingExternalId),
        inArray(tenants.billingStatus, ['trialing', 'active', 'past_due']),
      ),
    );

  for (const t of due) {
    try {
      const r = await chargeTenant(t);
      if (r === 'paid') tally.paid++;
      else if (r === 'past_due') tally.pastDue++;
      else if (r === 'canceled') tally.canceled++;
      else tally.skipped++;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[billing] unexpected error charging tenant ${t.id}:`, err);
      tally.skipped++;
    }
  }

  if (due.length > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[billing] daily run: ${tally.paid} charged, ${tally.pastDue} past_due, ` +
        `${tally.canceled} canceled, ${tally.skipped} skipped (of ${due.length} due)`,
    );
  }
  return tally;
}
