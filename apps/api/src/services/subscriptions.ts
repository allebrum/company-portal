import { billingEnforced } from '../env.js';
import type { Tenant } from '../db/schema.js';

/**
 * Local subscription gate. Billing lives in the separate MARKETING service,
 * which writes the tenant's `billing_status` (+ trial/card columns) directly in
 * this database. The portal only READS it here — no Stripe, no remote call.
 *
 * When `BILLING_ENFORCED` is false (self-host / pre-billing), every workspace is
 * treated as active so the OSS app runs ungated with the billing columns null.
 */
export function tenantIsActive(tenant: Tenant | undefined): boolean {
  if (!billingEnforced) return true; // self-host / pre-billing: no gating
  if (!tenant) return false;
  if (tenant.billingExempt) return true; // grandfathered internal workspace
  const s = tenant.billingStatus;
  if (s == null) return true; // no billing record yet → don't lock out
  if (s === 'active') return true;
  // Trial access REQUIRES a saved card: a trialing workspace with no payment
  // method on file is blocked until the SetupIntent succeeds (set at
  // /billing/complete and by the setup_intent.succeeded webhook). This makes
  // the card a real gate, not just a convenience step.
  if (s === 'trialing') return !!tenant.stripePaymentMethodId;
  // past_due / canceled → blocked (block-immediately policy).
  return false;
}
