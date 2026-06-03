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
  // past_due / canceled → blocked (block-immediately policy).
  return s === 'active' || s === 'trialing';
}
