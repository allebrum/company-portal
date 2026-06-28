import { db } from '../db/client.js';
import { tenants } from '../db/schema.js';
import { withTenant } from '../tenancy/context.js';
import { sendDueReminders } from '../services/reminders.js';

/**
 * Time-submission reminder sweep — the recurring tick behind the payroll
 * reminder emails (see services/reminders.ts for the per-tenant logic).
 *
 * Runs every 30 minutes (plus a delayed boot run). Each tick walks every
 * workspace, resolves "is now a reminder window in THIS tenant's timezone?",
 * and sends what's due. The 30-minute cadence is deliberate: reminders are
 * gated on a tenant-local hour window, and the idempotency log
 * (`time_reminder_log`) guarantees at most one send per (tenant, period,
 * kind, day) — so ticking often just means we react promptly to the window
 * opening, never that we spam.
 *
 * Matches the existing setInterval pattern (jobs/payPeriodSweep) rather than
 * pulling in node-cron — same single-process deploy, same `.unref()` so the
 * timer never blocks shutdown, same per-tenant error isolation.
 */
const TICK_INTERVAL_MS = 30 * 60 * 1000;

async function tick(): Promise<void> {
  const rows = await db.select({ id: tenants.id }).from(tenants);
  let employee = 0;
  let approver = 0;
  let failed = 0;
  for (const t of rows) {
    try {
      const r = await withTenant(t.id, () => sendDueReminders());
      employee += r.employee;
      approver += r.approver;
    } catch (e) {
      failed++;
      console.error(`[time-reminders] tenant ${t.id} failed`, e);
    }
  }
  if (employee > 0 || approver > 0 || failed > 0) {
    console.log(`[time-reminders] ${rows.length} tenants · ${employee} employee · ${approver} approver emails · ${failed} failures`);
  }
}

export function startTimeReminderSweep(): void {
  // Delay the boot run so migrations/init settle (mirrors payPeriodSweep).
  setTimeout(() => {
    void tick();
  }, 20_000).unref();
  setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS).unref();
}
