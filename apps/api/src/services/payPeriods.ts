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
import { tenantEq, stampTenant } from '../tenancy/scope.js';

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
  prevPeriodEndIso?: string,
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
    // Seed the chain off the latest existing period's end date when one was
    // provided; otherwise we'd compute the first period's start by guessing
    // (end − 14d) and overlap whatever was in the DB.
    let prevPeriodEnd: Date | null = prevPeriodEndIso
      ? new Date(prevPeriodEndIso + 'T00:00:00')
      : null;
    let safety = 0;
    while (out.length < count && safety++ < 60) {
      const year = cursorMonth.getFullYear();
      const month = cursorMonth.getMonth();
      for (const dayRef of sorted) {
        const rawPayDate = resolveDayOfMonth(year, month, dayRef);
        const payDate = applyWeekendRule(rawPayDate, weekendRule);
        const periodEnd = addDays(payDate, -buffer);
        // Only advance the chain when we actually emit a period. The loop
        // warm-starts at `today.month - 1` to walk past pay dates that are
        // earlier than `today`; if we advanced `prevPeriodEnd` for those
        // skipped iterations we'd overwrite the seed passed in by
        // `ensureFuturePeriods` (= the latest existing period's end), which
        // is exactly how a duplicate of an already-closed period would be
        // re-emitted: the first pushable period would chain off some
        // stale skipped end instead of the closed period's real end.
        if (payDate >= today) {
          const periodStart = prevPeriodEnd
            ? addDays(prevPeriodEnd, 1)
            : addDays(periodEnd, -14);
          out.push({
            start: isoDate(periodStart),
            end: isoDate(periodEnd),
            approvalCutoff: isoDate(periodEnd),
            payDate: isoDate(payDate),
            label: fmtRange(periodStart, periodEnd),
          });
          prevPeriodEnd = periodEnd;
          if (out.length >= count) break;
        }
      }
      cursorMonth = new Date(year, month + 1, 1);
    }
  } else {
    const stepDays = cfg.cadence === 'weekly' ? 7 : 14;
    // Chain off the previous period when we have one — guarantees no overlap.
    // Otherwise anchor (or today) is the starting point, advanced forward in
    // step-sized hops until the current period covers today.
    let start: Date;
    if (prevPeriodEndIso) {
      start = addDays(new Date(prevPeriodEndIso + 'T00:00:00'), 1);
    } else {
      start = cfg.anchor ? new Date(cfg.anchor + 'T00:00:00') : new Date(today);
      while (addDays(start, stepDays - 1) < today) start = addDays(start, stepDays);
    }
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
  return db
    .select()
    .from(payPeriods)
    .where(tenantEq(payPeriods.tenantId))
    .orderBy(asc(payPeriods.startDate));
}

export async function periodForDate(iso: string): Promise<PayPeriod | undefined> {
  const ymd = iso.slice(0, 10);
  const rows = await db
    .select()
    .from(payPeriods)
    .where(and(lte(payPeriods.startDate, ymd), gte(payPeriods.endDate, ymd), tenantEq(payPeriods.tenantId)))
    .limit(1);
  return rows[0];
}

export async function generateAndInsert(args: {
  whoId: string;
  count: number;
  fromDate?: string;
  prevPeriodEnd?: string;
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
    args.prevPeriodEnd,
  );

  // Dedup by BOTH startDate and payDate. The payDate check is what keeps
  // a buffer change (e.g. 5 → 4) from regenerating a duplicate of an
  // already-closed pay run: the closed period already owns pay-date Jun 1,
  // even though the new schedule wants to emit a period with a different
  // start (May 12 vs May 11) for the same Jun 1 pay run.
  const existing = await db
    .select({ s: payPeriods.startDate, p: payPeriods.payDate })
    .from(payPeriods)
    .where(tenantEq(payPeriods.tenantId));
  const haveStart = new Set(existing.map((r) => r.s));
  const havePayDate = new Set(existing.map((r) => r.p));
  const toInsert = schedule
    .filter((s) => !haveStart.has(s.start) && !havePayDate.has(s.payDate))
    .map((s) => ({
      label: s.label,
      startDate: s.start,
      endDate: s.end,
      approvalCutoff: s.approvalCutoff,
      payDate: s.payDate,
      status: 'open' as const,
    }));

  if (toInsert.length === 0) return { inserted: 0 };
  await db.insert(payPeriods).values(toInsert.map(stampTenant));

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
    .where(and(eq(payPeriods.status, 'open'), gte(payPeriods.startDate, today), tenantEq(payPeriods.tenantId)))
    .orderBy(asc(payPeriods.startDate));
  if (future.length >= 3) return { inserted: 0 };
  // Generate forward from the latest existing end+1 (or today if none).
  // Critically: also pass `prevPeriodEnd` to the schedule generator so the
  // first new period's start is `lastEnd+1` instead of (end − 14d), which
  // is how we used to overlap the most recent existing period.
  const lastEnd = await db
    .select({ end: payPeriods.endDate })
    .from(payPeriods)
    .where(tenantEq(payPeriods.tenantId))
    .orderBy(desc(payPeriods.endDate))
    .limit(1);
  const startCursor = lastEnd[0]
    ? addDays(new Date(lastEnd[0].end + 'T00:00:00'), 1)
    : new Date(today + 'T00:00:00');
  return generateAndInsert({
    whoId: args.whoId ?? '00000000-0000-0000-0000-000000000000',
    count: targetCount,
    fromDate: isoDate(startCursor),
    prevPeriodEnd: lastEnd[0]?.end,
  });
}

/**
 * Walk *all* pay periods in start-date order; whenever two overlap (the
 * next period's start ≤ the prior period's end), merge them: pick a
 * keeper, reassign the loser's `time_entries.pay_period_id` to the
 * keeper (regardless of entry status — submitted, approved, draft all
 * follow), then delete the loser.
 *
 * Status was previously a filter ("only consider open periods") which
 * meant any pair where one side had been moved to `review` or `closed`
 * sailed past consolidation untouched. Now status is a **keeper-pref
 * signal** instead:
 *
 *   closed (3) > review (2) > open (1) → more entries → older createdAt
 *
 * Closed periods are payroll history and must not be deleted. If both
 * sides of an overlap are closed we skip the pair (a true human-needs-to-
 * look-at-this situation — two payroll runs were already executed for
 * overlapping ranges). Otherwise the higher-status row wins and the
 * lower-status one's entries follow it before the row is deleted.
 *
 * This is the cleanup that `regenerateFuturePeriods`'s "delete empty
 * stale rows" rule can't do on its own — when prior config drift
 * produced overlapping periods AND admins took action on entries in
 * either half (so neither is empty AND one or both are non-`open`),
 * both rows used to survive. They no longer do.
 */
export async function consolidateOverlappingPeriods(args: { whoId: string }): Promise<{
  merged: number;
}> {
  const rows = await db
    .select({
      id: payPeriods.id,
      start: payPeriods.startDate,
      end: payPeriods.endDate,
      status: payPeriods.status,
      createdAt: payPeriods.createdAt,
    })
    .from(payPeriods)
    .where(tenantEq(payPeriods.tenantId))
    .orderBy(asc(payPeriods.startDate), asc(payPeriods.createdAt));

  if (rows.length < 2) return { merged: 0 };

  // Count entries per period so the keeper-pick prefers the better-populated
  // row. (Two zero-entry overlaps fall back to status / older createdAt.)
  const entryCounts = new Map<string, number>();
  const entryRows = await db
    .select({ pid: timeEntries.payPeriodId })
    .from(timeEntries)
    .where(and(isNotNull(timeEntries.payPeriodId), tenantEq(timeEntries.tenantId)));
  for (const r of entryRows) {
    if (!r.pid) continue;
    entryCounts.set(r.pid, (entryCounts.get(r.pid) ?? 0) + 1);
  }

  const statusRank = (s: string) => (s === 'closed' ? 3 : s === 'review' ? 2 : 1);

  let merged = 0;
  // Tracks the keeper for the current overlap "cluster" — start with the
  // first row and absorb any subsequent rows that overlap with it.
  let keeper = rows[0];
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i];
    if (cur.start <= keeper.end) {
      // Overlap.
      // Refuse to mutate closed-vs-closed: that's two payroll runs that
      // already ran against overlapping ranges and needs eyes on it.
      if (keeper.status === 'closed' && cur.status === 'closed') {
        keeper = cur;
        continue;
      }
      const keeperCount = entryCounts.get(keeper.id) ?? 0;
      const curCount = entryCounts.get(cur.id) ?? 0;
      const curRank = statusRank(cur.status);
      const keeperRank = statusRank(keeper.status);
      const curWins =
        curRank > keeperRank ||
        (curRank === keeperRank && curCount > keeperCount) ||
        (curRank === keeperRank && curCount === keeperCount && cur.createdAt < keeper.createdAt);
      const winner = curWins ? cur : keeper;
      const loser = curWins ? keeper : cur;

      // Reassign every entry on the loser to the winner — submitted,
      // approved, rejected, draft all come along so admin actions
      // already taken aren't orphaned. Then delete the loser row.
      await db
        .update(timeEntries)
        .set({ payPeriodId: winner.id, updatedAt: new Date().toISOString() })
        .where(and(eq(timeEntries.payPeriodId, loser.id), tenantEq(timeEntries.tenantId)));
      await db.delete(payPeriods).where(and(eq(payPeriods.id, loser.id), tenantEq(payPeriods.tenantId)));

      entryCounts.set(winner.id, keeperCount + curCount);
      keeper = winner;
      merged++;
    } else {
      keeper = cur;
    }
  }

  if (merged > 0) {
    await appendActivity({
      whoId: args.whoId,
      kind: 'period.consolidate',
      target: `Merged ${merged} overlapping pay period${merged === 1 ? '' : 's'}`,
    });
  }
  return { merged };
}

/**
 * Called after `updatePayConfig` persists a new schedule AND from the
 * manual "Recalculate pay periods" admin button.
 *
 * Three-phase cleanup so duplicates from prior config drift can't survive:
 *
 *   1. Consolidate overlapping open periods (merge entries, keep one row).
 *   2. Drop every open period that **either** (a) starts in the future,
 *      **or** (b) has zero time entries linked.
 *   3. Refill the runway via `ensureFuturePeriods`, which now chains the
 *      schedule off the latest existing period so newly generated rows
 *      can't overlap the surviving ones.
 *
 * Periods with any time entries are preserved unconditionally so we
 * don't retroactively rewrite payroll history; closed / review periods
 * are also never touched.
 */
export async function regenerateFuturePeriods(args: { whoId: string }): Promise<{
  deleted: number;
  inserted: number;
  preserved: number;
  merged: number;
}> {
  const { merged } = await consolidateOverlappingPeriods({ whoId: args.whoId });

  const today = isoDate(new Date());
  // All currently-open periods (post-consolidation).
  const openRows = await db
    .select({ id: payPeriods.id, start: payPeriods.startDate })
    .from(payPeriods)
    .where(and(eq(payPeriods.status, 'open'), tenantEq(payPeriods.tenantId)));
  // Distinct period ids referenced by at least one time entry.
  const usedRows = await db
    .selectDistinct({ pid: timeEntries.payPeriodId })
    .from(timeEntries)
    .where(and(isNotNull(timeEntries.payPeriodId), tenantEq(timeEntries.tenantId)));
  const usedSet = new Set(usedRows.map((r) => r.pid).filter((x): x is string => !!x));

  const toDelete = openRows
    .filter((p) => p.start > today || !usedSet.has(p.id))
    .map((p) => p.id);
  const preserved = openRows.length - toDelete.length;

  if (toDelete.length > 0) {
    await db.delete(payPeriods).where(and(inArray(payPeriods.id, toDelete), tenantEq(payPeriods.tenantId)));
  }
  const { inserted } = await ensureFuturePeriods({ whoId: args.whoId, count: 12 });
  return { deleted: toDelete.length, inserted, preserved, merged };
}

export async function moveToReview(id: string, whoId: string): Promise<void> {
  await db.update(payPeriods).set({ status: 'review', updatedAt: new Date().toISOString() }).where(and(eq(payPeriods.id, id), tenantEq(payPeriods.tenantId)));
  emit.toOrg(EV.PAY_PERIOD_UPDATED, { id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'period.review', target: `Pay period moved to review` });
}

export async function closePeriod(id: string, whoId: string): Promise<{ autoApproved: number }> {
  const now = new Date().toISOString();
  await db
    .update(payPeriods)
    .set({ status: 'closed', closedAt: now, updatedAt: now })
    .where(and(eq(payPeriods.id, id), tenantEq(payPeriods.tenantId)));

  // auto-approve any remaining submitted entries
  const result = await db
    .update(timeEntries)
    .set({ status: 'approved', approvedBy: whoId, approvedAt: now, updatedAt: now })
    .where(and(eq(timeEntries.payPeriodId, id), eq(timeEntries.status, 'submitted'), tenantEq(timeEntries.tenantId)))
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
    .where(and(eq(payPeriods.id, periodId), tenantEq(payPeriods.tenantId)))
    .limit(1);
  const period = periodRows[0];
  if (!period) throw new HttpError(404, 'period_not_found');

  // Payroll-eligibility filter: only `approved` entries roll into the
  // bookkeeper report. Drafts, submitted, and rejected entries are not
  // signed off for payment — including them would inflate the totals
  // the bookkeeper acts on. Note this is intentionally not parameterized:
  // the bookkeeper email is the payroll source of truth; non-approved
  // entries belong on the in-app review surface, not in payroll.
  //
  // Operationally this stays consistent with the Close-and-send flow,
  // because `closePeriod` auto-approves any leftover `submitted`
  // entries before this query runs — so a "close & send" never drops
  // legitimately-pending work, while a "send without closing" simply
  // skips anything the admin hasn't approved yet.
  const entries = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.payPeriodId, periodId), eq(timeEntries.status, 'approved'), tenantEq(timeEntries.tenantId)));
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const approverIds = [...new Set(entries.map((e) => e.approvedBy).filter((x): x is string => !!x))];
  const projectIds = [...new Set(entries.map((e) => e.projectId).filter((x): x is string => !!x))];
  const allUserIds = [...new Set([...userIds, ...approverIds])];
  const [userRows, projectRows] = await Promise.all([
    allUserIds.length
      ? db.select({ id: users.id, name: users.name, email: users.email, billable: users.billable }).from(users).where(inArray(users.id, allUserIds))
      : Promise.resolve([] as Array<{ id: string; name: string; email: string; billable: string }>),
    projectIds.length
      ? db.select({ id: projects.id, name: projects.name, billable: projects.billable }).from(projects).where(and(inArray(projects.id, projectIds), tenantEq(projects.tenantId)))
      : Promise.resolve([] as Array<{ id: string; name: string; billable: boolean }>),
  ]);
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const projectById = new Map(projectRows.map((p) => [p.id, p]));

  // Per-employee aggregation. We collect the raw entry rows alongside
  // the totals so the bookkeeper email can render an entry-by-entry
  // detail table beneath each summary row — matches the in-app
  // PeriodReviewModal's expanded view.
  type Summary = {
    userId: string;
    name: string;
    email: string;
    durationMin: number;
    revenue: number;
    approverIds: Set<string>;
    statuses: Set<string>;
    rawEntries: typeof entries;
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
        rawEntries: [],
      };
      byUser.set(e.userId, s);
    }
    s.durationMin += e.durationMin;
    s.statuses.add(e.status);
    if (e.approvedBy) s.approverIds.add(e.approvedBy);
    s.rawEntries.push(e);
    const proj = e.projectId ? projectById.get(e.projectId) : undefined;
    if (proj?.billable) {
      const rate = Number(u.billable) || 0;
      s.revenue += (e.durationMin / 60) * rate;
    }
  }

  // Clock formatter — match the in-app `fmtClock` (HH:MM in the
  // viewer's local TZ). The bookkeeper email is rendered server-side
  // in the API server's TZ; that's the same TZ admins see when
  // reviewing, so the numbers line up.
  const fmtClock = (iso: string): string => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

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
      entries: s.rawEntries
        .slice()
        .sort((a, b) => a.startIso.localeCompare(b.startIso))
        .map((e) => ({
          date: e.startIso.slice(0, 10),
          start: fmtClock(e.startIso),
          end: e.endIso ? fmtClock(e.endIso) : '—',
          durationMin: e.durationMin,
          project: e.projectId ? projectById.get(e.projectId)?.name ?? '—' : '—',
          note: e.note ?? '',
          status: e.status,
          approver: e.approvedBy ? userById.get(e.approvedBy)?.name ?? '—' : '—',
        })),
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
    .where(and(eq(payPeriods.id, id), tenantEq(payPeriods.tenantId)));
  emit.toOrg(EV.PAY_PERIOD_UPDATED, { id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'period.reopen', target: `Pay period reopened` });
}
