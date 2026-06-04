import { billingConfigured } from '../env.js';
import type { Tenant } from '../db/schema.js';

/**
 * Local subscription gating for the consolidated in-app Stripe billing.
 *
 * Billing state lives on the tenant row (`billing_status`, set by signup + the
 * daily charge job + the Stripe webhooks). There is no external marketing API.
 * When billing isn't configured (self-host / pre-billing), every workspace is
 * treated as active so the app runs ungated.
 */
export function tenantIsActive(tenant: Tenant | undefined): boolean {
  if (!billingConfigured) return true; // self-host / pre-billing: no gating
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
