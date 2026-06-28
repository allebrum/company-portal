import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  payConfig,
  payPeriods,
  timeEntries,
  tenantMembers,
  timeReminderLog,
  type PayConfig,
  type PayPeriod,
} from '../db/schema.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { listUsers } from './users.js';
import { getSettings } from './settings.js';
import { sendTimeReminderEmail, sendApprovalReminderEmail } from './mail.js';
import { env } from '../env.js';
import { currentTenantId } from '../tenancy/context.js';

/**
 * Time-submission reminder logic. Fired by jobs/timeReminders on a recurring
 * tick; this module decides — per workspace, in that workspace's timezone —
 * whether today is a "processing day" and, if so, nudges the right people:
 *
 *   - Morning: every employee with UNSUBMITTED (draft) time in the open
 *     period gets a "submit your hours" email.
 *   - End of day: everyone who can approve time (`time_entry.approve`, or the
 *     workspace owner as a fallback) gets a "time to approve" email.
 *
 * "Processing day" = the period's approval cutoff (pay date minus the
 * processing buffer), shifted off weekends by the workspace's weekend rule —
 * so a Saturday cutoff under "prior" reminds on the Friday.
 *
 * Idempotency: each send "claims" a `time_reminder_log` row keyed by
 * (tenant, period, kind, local-date) via INSERT ... ON CONFLICT DO NOTHING
 * BEFORE sending, so the sub-hourly tick (and any future second instance)
 * can never double-send.
 */

// Local-clock windows (tenant timezone). We fire at the first tick at/after
// the target hour and keep firing through the window — the idempotency log
// makes it a single send, so a brief outage at the exact hour still delivers.
const EMPLOYEE_HOUR = 8; // morning nudge to employees
const EMPLOYEE_WINDOW_END = 15; // ...up to 3pm local
const APPROVER_HOUR = 16; // end-of-day prompt to approvers
const APPROVER_WINDOW_END = 23; // ...up to 11pm local

// ---- Timezone / calendar helpers ----
/** Tenant-local calendar date as YYYY-MM-DD. */
function ymdInTz(now: Date, tz: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
/** Tenant-local hour 0–23. */
function hourInTz(now: Date, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return parseInt(s, 10) % 24;
}
// Calendar-only date math (timezone-agnostic): parse at UTC noon so a
// ±2-day shift never crosses a DST/midnight boundary into the wrong day.
function parseYmd(ymd: string): Date {
  return new Date(ymd + 'T12:00:00Z');
}
function fmtYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDaysUtc(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}
/** Shift a YYYY-MM-DD off weekends per the workspace weekend rule. */
function applyWeekendRule(ymd: string, rule: PayConfig['weekendRule']): string {
  const d = parseYmd(ymd);
  const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
  if (dow !== 0 && dow !== 6) return ymd;
  if (rule === 'as-is') return ymd;
  if (rule === 'after') return fmtYmd(addDaysUtc(d, dow === 0 ? 1 : 2));
  return fmtYmd(addDaysUtc(d, dow === 0 ? -2 : -1)); // 'prior'
}
/** Friendly label, e.g. "Fri, Jun 26". */
function labelYmd(ymd: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(parseYmd(ymd));
}
/** The processing (reminder) day for a period — its weekend-adjusted cutoff. */
export function processingDayFor(period: Pick<PayPeriod, 'approvalCutoff'>, rule: PayConfig['weekendRule']): string {
  return applyWeekendRule(period.approvalCutoff, rule);
}

// ---- Idempotent claim ----
async function claim(periodId: string, kind: 'employee' | 'approver', sentOn: string, recipients: number): Promise<boolean> {
  const tenantId = currentTenantId();
  const res = await db
    .insert(timeReminderLog)
    .values({ tenantId, periodId, kind, sentOn, recipients })
    .onConflictDoNothing()
    .returning({ id: timeReminderLog.id });
  return res.length > 0;
}

/**
 * Send any reminders due for the ACTIVE workspace right now. Must run inside a
 * `withTenant` context (so getSettings / listUsers resolve the tenant). `now`
 * is injectable for tests.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<{ employee: number; approver: number }> {
  const tenantId = currentTenantId();
  const [cfg] = await db.select().from(payConfig).where(eq(payConfig.tenantId, tenantId)).limit(1);
  if (!cfg) return { employee: 0, approver: 0 };
  if (!cfg.remindEmployees && !cfg.remindApprovers) return { employee: 0, approver: 0 };

  const tz = cfg.timezone || 'America/New_York';
  const todayLocal = ymdInTz(now, tz);
  const hour = hourInTz(now, tz);

  const open = await db
    .select()
    .from(payPeriods)
    .where(and(eq(payPeriods.tenantId, tenantId), eq(payPeriods.status, 'open')));
  const due = open.filter((p) => processingDayFor(p, cfg.weekendRule) === todayLocal);
  if (due.length === 0) return { employee: 0, approver: 0 };

  const dueDateLabel = labelYmd(todayLocal);
  let employee = 0;
  let approver = 0;
  for (const period of due) {
    if (cfg.remindEmployees && hour >= EMPLOYEE_HOUR && hour < EMPLOYEE_WINDOW_END) {
      employee += await remindEmployees(period, tenantId, todayLocal, dueDateLabel);
    }
    if (cfg.remindApprovers && hour >= APPROVER_HOUR && hour < APPROVER_WINDOW_END) {
      approver += await remindApprovers(period, tenantId, todayLocal, dueDateLabel);
    }
  }
  return { employee, approver };
}

async function remindEmployees(period: PayPeriod, tenantId: string, todayLocal: string, dueDateLabel: string): Promise<number> {
  // Aggregate draft (unsubmitted) time in this period, per user.
  const drafts = await db
    .select({ userId: timeEntries.userId, durationMin: timeEntries.durationMin })
    .from(timeEntries)
    .where(and(
      eq(timeEntries.tenantId, tenantId),
      eq(timeEntries.payPeriodId, period.id),
      eq(timeEntries.status, 'draft'),
    ));
  if (drafts.length === 0) return 0;

  const byUser = new Map<string, { count: number; min: number }>();
  for (const d of drafts) {
    const e = byUser.get(d.userId) ?? { count: 0, min: 0 };
    e.count += 1;
    e.min += d.durationMin;
    byUser.set(d.userId, e);
  }

  // Only email active members; map ids → user.
  const members = (await listUsers()).filter((u) => u.status === 'active');
  const targets = members.filter((u) => byUser.has(u.id));
  if (targets.length === 0) return 0;

  // Claim BEFORE sending so a concurrent tick can't double-send.
  if (!(await claim(period.id, 'employee', todayLocal, targets.length))) return 0;

  const settings = await getSettings();
  const senderUserId = settings.systemSenderUserId ?? null;
  const timeUrl = `${env.WEB_ORIGIN}/time`;
  let sent = 0;
  for (const u of targets) {
    const agg = byUser.get(u.id)!;
    await sendTimeReminderEmail({
      senderUserId,
      to: u.email,
      name: u.name,
      periodLabel: period.label,
      draftCount: agg.count,
      draftMinutes: agg.min,
      dueDateLabel,
      timeUrl,
    });
    sent += 1;
  }
  return sent;
}

async function remindApprovers(period: PayPeriod, tenantId: string, todayLocal: string, dueDateLabel: string): Promise<number> {
  const recipients = await approverEmails(tenantId);
  if (recipients.length === 0) return 0;

  // Tally the period's queue so the email is actionable.
  const rows = await db
    .select({ status: timeEntries.status })
    .from(timeEntries)
    .where(and(eq(timeEntries.tenantId, tenantId), eq(timeEntries.payPeriodId, period.id)));
  const submittedCount = rows.filter((r) => r.status === 'submitted').length;
  const draftCount = rows.filter((r) => r.status === 'draft').length;

  // Nothing waiting and nothing outstanding → no point nudging.
  if (submittedCount === 0 && draftCount === 0) return 0;

  if (!(await claim(period.id, 'approver', todayLocal, recipients.length))) return 0;

  const settings = await getSettings();
  await sendApprovalReminderEmail({
    senderUserId: settings.systemSenderUserId ?? null,
    to: recipients[0]!,
    cc: recipients.length > 1 ? recipients.slice(1).join(', ') : null,
    periodLabel: period.label,
    submittedCount,
    draftCount,
    dueDateLabel,
    approvalsUrl: `${env.WEB_ORIGIN}/approvals`,
  });
  return recipients.length;
}

/** Emails of everyone who can approve time; falls back to the workspace owner. */
async function approverEmails(tenantId: string): Promise<string[]> {
  const members = (await listUsers()).filter((u) => u.status === 'active');
  const out: string[] = [];
  for (const m of members) {
    const perms = await getEffectivePermissions(m.id, tenantId);
    if (perms.has('time_entry.approve')) out.push(m.email);
  }
  if (out.length === 0) {
    // Fallback: the person(s) who opened the workspace (tenant owner).
    const owners = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isOwner, true)));
    const ownerIds = new Set(owners.map((o) => o.userId));
    for (const m of members) if (ownerIds.has(m.id)) out.push(m.email);
  }
  return [...new Set(out)];
}
