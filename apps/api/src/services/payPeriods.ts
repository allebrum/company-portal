import { eq, and, gte, lte, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { payPeriods, payConfig, timeEntries, type PayPeriod } from '../db/schema.js';
import type { PayConfigInput, PayDateRef } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';

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
  const processingBufferDays = cfg.processingBufferDays ?? 5;
  const payDelayDays = cfg.payDelayDays ?? 7;
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
        const periodEnd = addDays(payDate, -payDelayDays);
        const periodStart = prevPeriodEnd ? addDays(prevPeriodEnd, 1) : addDays(periodEnd, -14);
        const approvalCutoff = addDays(periodEnd, processingBufferDays);
        prevPeriodEnd = periodEnd;
        if (payDate >= today) {
          out.push({
            start: isoDate(periodStart),
            end: isoDate(periodEnd),
            approvalCutoff: isoDate(approvalCutoff),
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
      const rawPayDate = addDays(end, payDelayDays);
      const payDate = applyWeekendRule(rawPayDate, weekendRule);
      const cutoff = addDays(end, processingBufferDays);
      out.push({
        start: isoDate(start),
        end: isoDate(end),
        approvalCutoff: isoDate(cutoff),
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
      payDelayDays: cfg.payDelayDays,
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

export async function reopenPeriod(id: string, whoId: string): Promise<void> {
  await db
    .update(payPeriods)
    .set({ status: 'review', closedAt: null, updatedAt: new Date().toISOString() })
    .where(eq(payPeriods.id, id));
  emit.toOrg(EV.PAY_PERIOD_UPDATED, { id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'period.reopen', target: `Pay period reopened` });
}
