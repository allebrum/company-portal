import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { withTenant } from '../tenancy/context.js';
import { ensureFuturePeriods } from '../services/payPeriods.js';

/**
 * Background pay-period sweep — the third leg of period generation:
 *
 *   1. Lazy fill on `GET /pay-periods` (whoever loads Approvals).
 *   2. Self-heal in the entries service (logging time with no covering
 *      period tops the schedule up and retries).
 *   3. THIS sweep: on boot and every 12h, walk every workspace and make
 *      sure its runway exists — covers tenants where nobody has touched
 *      a pay surface in months, so periods "just keep popping up".
 *
 * `ensureFuturePeriods` is idempotent and exits early when 3+ future open
 * periods exist, so a full sweep is a handful of cheap SELECTs per tenant.
 * Failures are per-tenant: one workspace's bad config can't stall the rest.
 */
const SWEEP_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function sweepOnce(): Promise<void> {
  const rows = await db.select({ id: tenants.id }).from(tenants);
  let inserted = 0;
  let failed = 0;
  for (const t of rows) {
    try {
      const r = await withTenant(t.id, () => ensureFuturePeriods({}));
      inserted += r.inserted;
    } catch (e) {
      failed++;
      console.error(`[pay-period-sweep] tenant ${t.id} failed`, e);
    }
  }
  if (inserted > 0 || failed > 0) {
    console.log(`[pay-period-sweep] ${rows.length} tenants · inserted ${inserted} periods · ${failed} failures`);
  }
}

export function startPayPeriodSweep(): void {
  // Boot-time run is delayed a beat so migrations/init finish settling and
  // a crash-looping container doesn't hammer the DB.
  setTimeout(() => {
    void sweepOnce();
  }, 15_000).unref();
  setInterval(() => {
    void sweepOnce();
  }, SWEEP_INTERVAL_MS).unref();
}
