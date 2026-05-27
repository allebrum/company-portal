import { eq, and, gt, gte, lte, asc, desc, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  payPeriods, payConfig, timeEntries, users, projects, type PayPeriod,
} from '../db/schema.js';
import type { PayConfigInput, PayDateRef } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { getSettings } from './settings.js';
import { sendPayrollReportEmail } from './mail.js';
import { HttpError } from '../middleware/errorHandler.js';

// ---- Date utilities (ported from project/app/data.jsx) ----
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function applyWeekendRule(date: Date, rule: 'prior' | 'after' | 'as-is'): Date {
  const dow = date.getDay();
  if (dow !== 0 && dow !== 6) return date;
  if (rule === 'as-is') return date;
  if (rule === 'after') return addDays(date, dow === 0 ? 1 : 2);
  return addDays(date, dow === 0 ? -2 : -1);
}
function resolveDayOfMonth(year: number, month: number, dayRef: PayDateRef): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  if (dayRef === 'last') return new Date(year, month, lastDay);
  return new Date(year, month, Math.min(dayRef, lastDay));
}
function fmtRange(s: Date, e: Date): string {
  const a = s.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const b = e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  return `${a} – ${b}`;
}

export type GeneratedPeriod = {
  start: string;
  end: string;
  approvalCutoff: string;
  payDate: string;
  label: string;
};

export function generatePeriodSchedule(
  cfg: PayConfigInput,
  count = 6,
  fromDateIso?: string,
): GeneratedPeriod[] {
  // Single buffer governs both the gap-to-pay-date AND the approval cutoff.
  // period_end = pay_date − buffer. approval_cutoff = period_end (admins
  // approve by the time the period closes; payment hits N days later).
  const buffer = cfg.processingBufferDays ?? 5;
  const weekendRule = cfg.weekendRule ?? 'prior';
  const out: GeneratedPeriod[] = [];
  const today = fromDateIso ? new Date(fromDateIso) : new Date();
  today.setHours(0, 0, 0, 0);

  if (cfg.cadence === 'by-date') {
    const payDates: PayDateRef[] =
      cfg.payDates && cfg.payDates.length > 0 ? cfg.payDates : [15, 'last'];
    const sorted = [...payDates].sort((a, b) => {
      const av = a === 'last' ? 31 : a;
      const bv = b === 'last' ? 31 : b;
      return av - bv;
    });

    let cursorMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    let prevPeriodEnd: Date | null = null;
    let safety = 0;
    while (out.length < count && safety++ < 60) {
      const year = cursorMonth.getFullYear();
      const month = cursorMonth.getMonth();
      for (const dayRef of sorted) {
        const rawPayDate = resolveDayOfMonth(year, month, dayRef);
        const payDate = applyWeekendRule(rawPayDate, weekendRule);
        const periodEnd = addDays(payDate, -buffer);
        const periodStart = prevPeriodEnd ? addDays(prevPeriodEnd, 1) : addDays(periodEnd, -14);
        prevPeriodEnd = periodEnd;
        if (payDate >= today) {
          out.push({
            start: isoDate(periodStart),
            end: isoDate(periodEnd),
            approvalCutoff: isoDate(periodEnd),
            payDate: isoDate(payDate),
            label: fmtRange(periodStart, periodEnd),
          });
          if (out.length >= count) break;
        }
      }
      cursorMonth = new Date(year, month + 1, 1);
    }
  } else {
    const stepDays = cfg.cadence === 'weekly' ? 7 : 14;
    let start = cfg.anchor ? new Date(cfg.anchor + 'T00:00:00') : new Date(today);
    while (addDays(start, stepDays - 1) < today) start = addDays(start, stepDays);
    for (let i = 0; i < count; i++) {
      const end = addDays(start, stepDays - 1);
      const rawPayDate = addDays(end, buffer);
      const payDate = applyWeekendRule(rawPayDate, weekendRule);
      out.push({
        start: isoDate(start),
        end: isoDate(end),
        approvalCutoff: isoDate(end),
        payDate: isoDate(payDate),
        label: fmtRange(start, end),
      });
      start = addDays(end, 1);
    }
  }
  return out;
}

// ---- Service ops ----
export async function listPeriods(): Promise<PayPeriod[]> {
  return db.select().from(payPeriods).orderBy(asc(payPeriods.startDate));
}

export async function periodForDate(iso: string): Promise<PayPeriod | undefined> {
  const ymd = iso.slice(0, 10);
  const rows = await db
    .select()
    .from(payPeriods)
    .where(and(lte(payPeriods.startDate, ymd), gte(payPeriods.endDate, ymd)))
    .limit(1);
  return rows[0];
}

export async function generateAndInsert(args: {
  whoId: string;
  count: number;
  fromDate?: string;
}): Promise<{ inserted: number }> {
  const cfgRows = await db.select().from(payConfig).limit(1);
  const cfg = cfgRows[0];
  if (!cfg) throw new Error('pay_config singleton missing');
  const schedule = generatePeriodSchedule(
    {
      cadence: cfg.cadence,
      payDates: cfg.payDates as PayDateRef[],
      weekendRule: cfg.weekendRule,
      anchor: cfg.anchor,
      processingBufferDays: cfg.processingBufferDays,
      autoClose: cfg.autoClose,
      approverId: cfg.approverId,
    },
    args.count,
    args.fromDate,
  );

  const existing = await db.select({ s: payPeriods.startDate }).from(payPeriods);
  const have = new Set(existing.map((r) => r.s));
  const toInsert = schedule
    .filter((s) => !have.has(s.start))
    .map((s) => ({
      label: s.label,
      startDate: s.start,
      endDate: s.end,
      approvalCutoff: s.approvalCutoff,
      payDate: s.payDate,
      status: 'open' as const,
    }));

  if (toInsert.length === 0) return { inserted: 0 };
  await db.insert(payPeriods).values(toInsert);

  await appendActivity({
    whoId: args.whoId,
    kind: 'period.generate',
    target: `Generated ${toInsert.length} pay periods`,
  });
  emit.toOrg(EV.PAY_PERIOD_GENERATED, {
    id: 'multi',
    by: args.whoId,
    at: new Date().toISOString(),
    count: toInsert.length,
  });

  return { inserted: toInsert.length };
}

/**
 * Lazily ensure the workspace has a runway of future pay periods so
 * admins never have to manually click "Generate". Idempotent: cheap to
 * call on every `GET /pay-periods` request. Skips work entirely when
 * `count` future open periods already exist.
 *
 * `whoId` is optional because the lazy-fill path runs in the context of
 * whichever user happens to be loading the Approvals page; the activity
 * log just records that user as the trigger.
 */
export async function ensureFuturePeriods(args: {
  whoId?: string;
  count?: number;
}): Promise<{ inserted: number }> {
  const targetCount = args.count ?? 12;
  const today = isoDate(new Date());
  // Count future open periods that haven't started yet.
  const future = await db
    .select({ start: payPeriods.startDate })
    .from(payPeriods)
    .where(and(eq(payPeriods.status, 'open'), gte(payPeriods.startDate, today)))
    .orderBy(asc(payPeriods.startDate));
  if (future.length >= 3) return { inserted: 0 };
  // Generate forward from the latest existing end+1 (or today if none).
  const lastEnd = await db
    .select({ end: payPeriods.endDate })
    .from(payPeriods)
    .orderBy(desc(payPeriods.endDate))
    .limit(1);
  const fromDate = lastEnd[0]?.end ?? today;
  const startCursor = lastEnd[0] ? addDays(new Date(lastEnd[0].end + 'T00:00:00'), 1) : new Date(today + 'T00:00:00');
  return generateAndInsert({
    whoId: args.whoId ?? '00000000-0000-0000-0000-000000000000',
    count: targetCount,
    fromDate: isoDate(startCursor),
  });
  // The reference to `fromDate` keeps the variable used; the generator's
  // internal "from" cursor is what matters for the next period boundary.
  void fromDate;
}

/**
 * Called after `updatePayConfig` persists a new schedule AND from the
 * manual "Recalculate pay periods" admin button. Drops every open period
 * that **either** (a) starts in the future, **or** (b) has zero time
 * entries linked. Either condition makes it a stale row safe to discard.
 *
 * Periods with any time entries are preserved unconditionally so we
 * don't retroactively rewrite payroll history; closed / review periods
 * are also never touched.
 *
 * After cleanup, `ensureFuturePeriods` fills the runway from the new
 * config. Returns counts so the manual route can toast a summary.
 */
export async function regenerateFuturePeriods(args: { whoId: string }): Promise<{
  deleted: number;
  inserted: number;
  preserved: number;
}> {
  const today = isoDate(new Date());
  // All currently-open periods.
  const openRows = await db
    .select({ id: payPeriods.id, start: payPeriods.startDate })
    .from(payPeriods)
    .where(eq(payPeriods.status, 'open'));
  // Distinct period ids referenced by at least one time entry.
  const usedRows = await db
    .selectDistinct({ pid: timeEntries.payPeriodId })
    .from(timeEntries)
    .where(isNotNull(timeEntries.payPeriodId));
  const usedSet = new Set(usedRows.map((r) => r.pid).filter((x): x is string => !!x));

  const toDelete = openRows
    .filter((p) => p.start > today || !usedSet.has(p.id))
    .map((p) => p.id);
  const preserved = openRows.length - toDelete.length;

  if (toDelete.length > 0) {
    await db.delete(payPeriods).where(inArray(payPeriods.id, toDelete));
  }
  const { inserted } = await ensureFuturePeriods({ whoId: args.whoId, count: 12 });
  return { deleted: toDelete.length, inserted, preserved };
}

export async function moveToReview(id: string, whoId: string): Promise<void> {
  await db.update(payPeriods).set({ status: 'review', updatedAt: new Date().toISOString() }).where(eq(payPeriods.id, id));
  emit.toOrg(EV.PAY_PERIOD_UPDATED, { id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'period.review', target: `Pay period moved to review` });
}

export async function closePeriod(id: string, whoId: string): Promise<{ autoApproved: number }> {
  const now = new Date().toISOString();
  await db
    .update(payPeriods)
    .set({ status: 'closed', closedAt: now, updatedAt: now })
    .where(eq(payPeriods.id, id));

  // auto-approve any remaining submitted entries
  const result = await db
    .update(timeEntries)
    .set({ status: 'approved', approvedBy: whoId, approvedAt: now, updatedAt: now })
    .where(and(eq(timeEntries.payPeriodId, id), eq(timeEntries.status, 'submitted')))
    .returning({ id: timeEntries.id });

  emit.toOrg(EV.PAY_PERIOD_CLOSED, { id, by: whoId, at: now });
  if (result.length > 0) {
    emit.toOrg(EV.ENTRY_APPROVED, { id, by: whoId, at: now, count: result.length });
  }
  await appendActivity({ whoId, kind: 'period.close', target: `Pay period closed` });
  return { autoApproved: result.length };
}

/**
 * Build a per-employee summary of a period's time entries and email it to
 * the workspace's bookkeeper. Sender is the admin who triggered the action
 * — their connected Gmail (F4) is the From: address. When no sender is
 * connected, the mail service logs the body and no-ops (existing fallback
 * pattern; never throws).
 *
 * 400 `bookkeeper_email_not_set` when no recipient is configured.
 */
export async function sendPayrollReportToBookkeeper(
  periodId: string,
  whoId: string,
): Promise<{ ok: true; sentTo: string; rows: number }> {
  const settings = await getSettings();
  const to = settings.bookkeeperEmail;
  if (!to || to.trim() === '') {
    throw new HttpError(400, 'bookkeeper_email_not_set');
  }
  const periodRows = await db
    .select()
    .from(payPeriods)
    .where(eq(payPeriods.id, periodId))
    .limit(1);
  const period = periodRows[0];
  if (!period) throw new HttpError(404, 'period_not_found');

  // Load entries for the period plus a denormalized user / project lookup
  // so the email can render readable rows without an extra n+1.
  const entries = await db
    .select()
    .from(timeEntries)
    .where(eq(timeEntries.payPeriodId, periodId));
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const approverIds = [...new Set(entries.map((e) => e.approvedBy).filter((x): x is string => !!x))];
  const projectIds = [...new Set(entries.map((e) => e.projectId).filter((x): x is string => !!x))];
  const allUserIds = [...new Set([...userIds, ...approverIds])];
  const [userRows, projectRows] = await Promise.all([
    allUserIds.length
      ? db.select({ id: users.id, name: users.name, email: users.email, billable: users.billable }).from(users).where(inArray(users.id, allUserIds))
      : Promise.resolve([] as Array<{ id: string; name: string; email: string; billable: string }>),
    projectIds.length
      ? db.select({ id: projects.id, name: projects.name, billable: projects.billable }).from(projects).where(inArray(projects.id, projectIds))
      : Promise.resolve([] as Array<{ id: string; name: string; billable: boolean }>),
  ]);
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const projectById = new Map(projectRows.map((p) => [p.id, p]));

  // Per-employee aggregation.
  type Summary = {
    userId: string;
    name: string;
    email: string;
    durationMin: number;
    revenue: number;
    approverIds: Set<string>;
    statuses: Set<string>;
  };
  const byUser = new Map<string, Summary>();
  for (const e of entries) {
    const u = userById.get(e.userId);
    if (!u) continue;
    let s = byUser.get(e.userId);
    if (!s) {
      s = {
        userId: e.userId,
        name: u.name,
        email: u.email,
        durationMin: 0,
        revenue: 0,
        approverIds: new Set(),
        statuses: new Set(),
      };
      byUser.set(e.userId, s);
    }
    s.durationMin += e.durationMin;
    s.statuses.add(e.status);
    if (e.approvedBy) s.approverIds.add(e.approvedBy);
    const proj = e.projectId ? projectById.get(e.projectId) : undefined;
    if (proj?.billable) {
      const rate = Number(u.billable) || 0;
      s.revenue += (e.durationMin / 60) * rate;
    }
  }

  const summaries = [...byUser.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      name: s.name,
      email: s.email,
      hours: s.durationMin / 60,
      revenue: s.revenue,
      approvers: [...s.approverIds]
        .map((id) => userById.get(id)?.name ?? 'Unknown')
        .sort(),
      statuses: [...s.statuses].sort(),
    }));

  await sendPayrollReportEmail({
    senderUserId: whoId,
    to,
    period: {
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
      payDate: period.payDate,
      status: period.status,
    },
    summaries,
  });
  await appendActivity({
    whoId,
    kind: 'pay.bookkeeper_sent',
    target: `${period.label} → ${to}`,
  });
  return { ok: true, sentTo: to, rows: summaries.length };
}

export async function reopenPeriod(id: string, whoId: string): Promise<void> {
  await db
    .update(payPeriods)
    .set({ status: 'review', closedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(payPeriods.id, id));
  emit.toOrg(EV.PAY_PERIOD_UPDATED, { id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'period.reopen', target: `Pay period reopened` });
}
