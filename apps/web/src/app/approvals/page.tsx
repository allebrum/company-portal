'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Card, Pill, Empty, Section } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useEntries,
  useUsers,
  useProjects,
  usePayPeriods,
  useApproveEntries,
  useRejectEntries,
  useReopenEntries,
  useClosePeriod,
  useMovePeriodToReview,
  useReopenPeriod,
  useRecalculatePayPeriods,
  useSendBookkeeperReport,
  useSettings,
  type PayPeriodRow,
  type EntryRow,
  type UserRow,
  type ProjectRow,
} from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import {
  fmtMins,
  fmtMoney,
  fmtClock,
  ENTRY_STATUS_LABEL,
  ENTRY_STATUS_PILL,
  PAY_PERIOD_STATUS_LABEL,
  PAY_PERIOD_STATUS_PILL,
} from '@/lib/formatters';

export default function ApprovalsPage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const { data: entries = [] } = useEntries();
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: periods = [] } = usePayPeriods();
  const { data: settings } = useSettings();
  const approve = useApproveEntries();
  const reject = useRejectEntries();
  const reopen = useReopenEntries();
  const closeP = useClosePeriod();
  const toReview = useMovePeriodToReview();
  const reopenP = useReopenPeriod();
  const sendBookkeeper = useSendBookkeeperReport();
  const recalc = useRecalculatePayPeriods();
  // Gate the Recalculate button to the same permission that backs the
  // server route (`pay.manage`). Owners and Bookkeepers have it; regular
  // approvers don't — they shouldn't be rebuilding the schedule.
  const canRecalc = can('pay.manage');

  // Which period card is currently open in the review modal (null = no
  // modal). All the review/approve/close machinery now lives inside the
  // modal — clicking a card opens it; closing it returns to the cards.
  const [openPeriodId, setOpenPeriodId] = useState<string | null>(null);
  const isPrivileged = can('time_entry.approve');

  // Highlight the period the admin should land on first — most recently
  // ended (review-ready), then 'review' status, then in-flight. Purely
  // visual; clicking is still required to open the modal.
  const suggestedPeriodId = useMemo(() => {
    if (periods.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    const endedDesc = [...periods]
      .filter((p) => p.endDate <= today)
      .sort((a, b) => b.endDate.localeCompare(a.endDate));
    return (
      endedDesc[0]?.id
      ?? periods.find((p) => p.status === 'review')?.id
      ?? periods.find((p) => p.startDate <= today && p.endDate >= today)?.id
      ?? periods.find((p) => p.status === 'open')?.id
      ?? periods[0]?.id
      ?? null
    );
  }, [periods]);

  const openPeriod = periods.find((p) => p.id === openPeriodId) ?? null;
  const openPeriodEntries = useMemo(
    () =>
      openPeriodId
        ? entries
            .filter((e) => e.payPeriodId === openPeriodId)
            .sort((a, b) => a.startIso.localeCompare(b.startIso))
        : [],
    [entries, openPeriodId],
  );

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  };

  if (!isPrivileged) {
    return (
      <Empty
        title="Approver access only"
        description="Time approvals are limited to Owners and Admins."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Approvals</div>
          <h1 className="text-2xl font-bold text-gray-900">Review time</h1>
          <p className="text-sm text-gray-500">
            Click a pay period card to open the full review — approve, return,
            and close the period out to payroll.
          </p>
        </div>
        {canRecalc && (
          <Button
            variant="outline"
            size="sm"
            disabled={recalc.isPending}
            onClick={async () => {
              try {
                const r = await recalc.mutateAsync();
                const parts: string[] = [];
                if (r.merged) parts.push(`${r.merged} overlapping merged`);
                if (r.deleted) parts.push(`${r.deleted} stale removed`);
                parts.push(`${r.inserted} generated`);
                if (r.preserved) parts.push(`${r.preserved} preserved`);
                toast.success(`Recalculated · ${parts.join(' · ')}`);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Recalculate failed');
              }
            }}
            title="Clean up overlapping and stale pay periods, then rebuild upcoming periods from the current schedule. Periods with logged time are merged or preserved."
          >
            Recalculate pay periods
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {periods.map((p) => {
          const isSuggested = p.id === suggestedPeriodId;
          const periodEntries = entries.filter((e) => e.payPeriodId === p.id);
          const submittedCount = periodEntries.filter((e) => e.status === 'submitted').length;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setOpenPeriodId(p.id)}
              className={`text-left w-full rounded-2xl border bg-white p-4 transition-all hover:border-brand-300 hover:shadow-md ${
                isSuggested ? 'border-brand-400 ring-2 ring-brand-100 shadow-sm' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-gray-900 truncate">{p.label}</div>
                  <div className="text-[11px] text-gray-500">
                    Pay <span className="font-semibold text-gray-700">{p.payDate}</span>
                    <span className="text-gray-300"> · </span>
                    Cutoff {p.approvalCutoff}
                  </div>
                </div>
                <Pill tone={PAY_PERIOD_STATUS_PILL[p.status]}>{PAY_PERIOD_STATUS_LABEL[p.status]}</Pill>
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-gray-500">
                <span className="font-semibold text-gray-700">{periodEntries.length}</span>
                {periodEntries.length === 1 ? 'entry' : 'entries'}
                {submittedCount > 0 && (
                  <>
                    <span className="text-gray-300">·</span>
                    <span className="font-semibold text-amber-700">{submittedCount} submitted</span>
                  </>
                )}
                {isSuggested && (
                  <span className="ml-auto text-[10px] uppercase font-bold tracking-widest text-brand-700">
                    Ready to review
                  </span>
                )}
              </div>
              {/* Quick status flips (don't open the modal) */}
              <div className="mt-3 flex items-center gap-1.5">
                {p.status === 'open' && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void run(() => toReview.mutateAsync(p.id), 'Moved to review'); }}
                    className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  >
                    Move to review
                  </button>
                )}
                {p.status === 'closed' && can('pay.manage') && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void run(() => reopenP.mutateAsync(p.id), 'Period reopened'); }}
                    className="text-[11px] px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </button>
          );
        })}
        {periods.length === 0 && (
          <div className="col-span-full">
            <Empty
              title="No pay periods yet"
              description="Set a schedule in Admin → Pay periods. Periods will appear here automatically."
            />
          </div>
        )}
      </div>

      {openPeriod && (
        <PeriodReviewModal
          open={!!openPeriod}
          onClose={() => setOpenPeriodId(null)}
          period={openPeriod}
          entries={openPeriodEntries}
          users={users}
          projects={projects}
          bookkeeperEmail={settings?.bookkeeperEmail ?? null}
          canPayManage={can('pay.manage')}
          approveMut={approve}
          rejectMut={reject}
          reopenMut={reopen}
          onClosePeriod={async () => {
            await run(() => closeP.mutateAsync(openPeriod.id), `${openPeriod.label} closed`);
            setOpenPeriodId(null);
          }}
          onCloseAndSend={async () => {
            try {
              await closeP.mutateAsync(openPeriod.id);
              await sendBookkeeper.mutateAsync(openPeriod.id);
              toast.success(`${openPeriod.label} closed · report emailed to bookkeeper`);
              setOpenPeriodId(null);
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Action failed';
              if (msg === 'bookkeeper_email_not_set') {
                toast.error('Set a bookkeeper email in Admin → Pay periods first');
              } else {
                toast.error(msg);
              }
            }
          }}
          closeBusy={closeP.isPending || sendBookkeeper.isPending}
        />
      )}
    </div>
  );
}

/**
 * Final-check modal admins see after clicking "Close period…". Shows a
 * per-employee summary of approved (or about-to-be-approved) hours +
 * revenue + approvers, plus two CTAs: Close-only (no email) or the
 * primary "Close & send to bookkeeper" path that hits the new endpoint.
 *
 * Disabled-with-hint when `bookkeeperEmail` isn't set so admins can't
 * land in the surprise-401 case from the server.
 */
/**
 * Big near-full-page review modal launched from a pay-period card click.
 * Houses the entire review workflow:
 *
 *  - Header band: period label, dates, pay date, status, billable totals.
 *  - Bulk-action toolbar: Approve / Return selected (or all submitted).
 *  - Entries table: every entry in the period with Date / Start / End /
 *    Duration / Who / Project / Note / Status / row-level Reopen.
 *  - Per-employee summary table: roll-up of hours / billable / approvers
 *    for the bookkeeper-email preview, with click-to-expand entry detail.
 *  - Footer: Cancel / Close period / Close & send to bookkeeper.
 *
 * Replaces the previous split UX (inline entries panel + separate
 * PayrollReviewModal) so admins do the whole flow in one focused surface.
 */
function PeriodReviewModal({
  open,
  onClose,
  period,
  entries,
  users,
  projects,
  bookkeeperEmail,
  canPayManage,
  approveMut,
  rejectMut,
  reopenMut,
  onClosePeriod,
  onCloseAndSend,
  closeBusy,
}: {
  open: boolean;
  onClose: () => void;
  period: PayPeriodRow;
  entries: EntryRow[];
  users: UserRow[];
  projects: ProjectRow[];
  bookkeeperEmail: string | null;
  canPayManage: boolean;
  approveMut: ReturnType<typeof useApproveEntries>;
  rejectMut: ReturnType<typeof useRejectEntries>;
  reopenMut: ReturnType<typeof useReopenEntries>;
  onClosePeriod: () => Promise<void>;
  onCloseAndSend: () => Promise<void>;
  closeBusy: boolean;
}) {
  const toast = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectFormOpen, setRejectFormOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('Please double-check duration and resubmit.');
  // Employee filter: text query + multi-select. Empty query AND empty
  // multi-select = show everyone. Both narrow independently, so an
  // admin can type "ali" to find Alice, then click her chip to lock
  // the filter and keep reviewing even after clearing the query.
  const [filterQuery, setFilterQuery] = useState('');
  const [filterUserIds, setFilterUserIds] = useState<Set<string>>(new Set());
  // Reset row selection + return form + filter whenever a different period opens.
  useEffect(() => {
    if (!open) return;
    setSelected(new Set());
    setRejectFormOpen(false);
    setFilterQuery('');
    setFilterUserIds(new Set());
  }, [open, period.id]);

  // Unique users referenced by any entry in this period — used for the
  // chip-style filter ribbon. Sort by name for predictable layout.
  const usersInPeriod = useMemo(() => {
    const ids = new Set(entries.map((e) => e.userId));
    return users
      .filter((u) => ids.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, users]);

  // Apply both filters to the entries list. The query matches substring
  // on user name OR email so admins can type either. The chip set is
  // an explicit allow-list when non-empty.
  const visibleEntries = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return entries.filter((e) => {
      if (filterUserIds.size > 0 && !filterUserIds.has(e.userId)) return false;
      if (q) {
        const u = users.find((x) => x.id === e.userId);
        if (!u) return false;
        const hay = `${u.name} ${u.email}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, users, filterQuery, filterUserIds]);
  const hasFilter = filterUserIds.size > 0 || filterQuery.trim() !== '';

  const submitted = visibleEntries.filter((e) => e.status === 'submitted');
  // Period-total bar reflects ALL entries (admin's situational
  // awareness), not just the filtered view — the filter is a
  // review-focus tool, not a redefinition of the period.
  const totalMin = entries.reduce((s, e) => s + e.durationMin, 0);
  const billRevenue = entries.reduce((s, e) => {
    const proj = projects.find((p) => p.id === e.projectId);
    if (!proj?.billable) return s;
    const u = users.find((x) => x.id === e.userId);
    const rate = u ? Number(u.billable) : 0;
    return s + (e.durationMin / 60) * rate;
  }, 0);
  const acting = selected.size > 0 ? [...selected] : submitted.map((e) => e.id);

  const toggleFilterUser = (userId: string) => {
    setFilterUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };
  const clearFilter = () => {
    setFilterUserIds(new Set());
    setFilterQuery('');
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  };
  const doApprove = async () => {
    if (acting.length === 0) return;
    await run(() => approveMut.mutateAsync(acting), `${acting.length} approved`);
    setSelected(new Set());
  };
  const doReject = async () => {
    if (acting.length === 0) return;
    await run(() => rejectMut.mutateAsync({ ids: acting, note: rejectNote }), `${acting.length} returned`);
    setSelected(new Set());
    setRejectFormOpen(false);
  };

  // Per-employee aggregate for the "Payroll summary" panel below the
  // entries table. Treat submitted + approved as in-scope since Close
  // auto-approves any leftover submissions. Driven off the FILTERED
  // entries so the summary reflects whatever subset the admin is
  // currently reviewing.
  const usableStatuses = new Set(['submitted', 'approved']);
  type Row = {
    userId: string; name: string; email: string;
    hours: number; revenue: number; approverNames: Set<string>;
    entries: EntryRow[];
  };
  const byUser = new Map<string, Row>();
  for (const e of visibleEntries) {
    if (!usableStatuses.has(e.status)) continue;
    const u = users.find((x) => x.id === e.userId);
    if (!u) continue;
    let row = byUser.get(e.userId);
    if (!row) {
      row = { userId: e.userId, name: u.name, email: u.email, hours: 0, revenue: 0, approverNames: new Set(), entries: [] };
      byUser.set(e.userId, row);
    }
    row.hours += e.durationMin / 60;
    row.entries.push(e);
    const proj = e.projectId ? projects.find((p) => p.id === e.projectId) : null;
    if (proj?.billable) {
      const rate = Number(u.billable) || 0;
      row.revenue += (e.durationMin / 60) * rate;
    }
    if (e.approvedBy) {
      const approver = users.find((x) => x.id === e.approvedBy);
      if (approver) row.approverNames.add(approver.name);
    }
  }
  const summaries = [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totalHours = summaries.reduce((s, r) => s + r.hours, 0);
  const totalRev = summaries.reduce((s, r) => s + r.revenue, 0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };
  const isClosed = period.status === 'closed';
  const canMutate = !isClosed; // approve/return only when period is still open

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${period.label} · pays ${period.payDate}`}
      size="screen"
      footer={
        canPayManage ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={closeBusy}>Cancel</Button>
            {!isClosed && (
              <>
                <Button
                  variant="outline"
                  onClick={() => void onClosePeriod()}
                  disabled={closeBusy}
                  title="Close the period without emailing the bookkeeper"
                >
                  Close period
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void onCloseAndSend()}
                  disabled={closeBusy || !bookkeeperEmail}
                  title={bookkeeperEmail ? `Email the report to ${bookkeeperEmail}` : 'Set a bookkeeper email in Admin → Pay periods first'}
                >
                  Close &amp; send to bookkeeper
                </Button>
              </>
            )}
            {isClosed && (
              <span className="text-[12px] text-gray-500 italic">
                Period is closed — reopen from the cards overview to re-edit.
              </span>
            )}
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>Done</Button>
        )
      }
    >
      <div className="space-y-5">
        {/* Header band: period dates + totals */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
          <div>
            <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">Pay period</div>
            <div className="text-sm text-gray-700">
              <span className="font-semibold text-gray-900">{period.startDate}</span>
              {' – '}
              <span className="font-semibold text-gray-900">{period.endDate}</span>
              {' · '}Pays out <span className="font-semibold text-brand-700">{period.payDate}</span>
              {' · '}<Pill tone={PAY_PERIOD_STATUS_PILL[period.status]}>{PAY_PERIOD_STATUS_LABEL[period.status]}</Pill>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">Period totals</div>
            <div className="text-sm text-gray-700">
              <span className="font-semibold tabular-nums">{fmtMins(totalMin)}</span> · {fmtMoney(billRevenue)} billable
            </div>
          </div>
        </div>

        {!bookkeeperEmail && !isClosed && canPayManage && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
            No bookkeeper email is set. You can still close the period, but the report won't be emailed.
            Add one in <span className="font-semibold">Admin → Pay periods</span>.
          </div>
        )}

        {/* Bulk action toolbar */}
        {canMutate && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm text-gray-600">
              {selected.size > 0
                ? `${selected.size} selected`
                : `${submitted.length} submitted ${submitted.length === 1 ? 'entry' : 'entries'} pending review`}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                disabled={acting.length === 0 || rejectMut.isPending}
                onClick={() => setRejectFormOpen((v) => !v)}
              >
                Return {selected.size > 0 ? `(${selected.size})` : '(all)'}
              </Button>
              <Button
                variant="primary"
                disabled={acting.length === 0 || approveMut.isPending}
                onClick={() => void doApprove()}
              >
                Approve {selected.size > 0 ? `(${selected.size})` : '(all)'}
              </Button>
            </div>
          </div>
        )}

        {/* Inline reject-note form (slides open under the toolbar) */}
        {rejectFormOpen && canMutate && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
            <div className="text-sm font-semibold text-amber-900">
              Returning {acting.length} {acting.length === 1 ? 'entry' : 'entries'} to the submitter
            </div>
            <p className="text-[12px] text-amber-800">The owner will see the note below alongside each entry.</p>
            <Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} rows={3} />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setRejectFormOpen(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => void doReject()}>
                Send back {acting.length}
              </Button>
            </div>
          </div>
        )}

        {/* Employee filter ribbon — both a search box and chip multi-
            select. Both filters apply to the entries table AND the
            payroll-summary panel below. */}
        {usersInPeriod.length > 1 && (
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="search"
                value={filterQuery}
                onChange={(ev) => setFilterQuery(ev.target.value)}
                placeholder="Filter by employee name or email…"
                className="flex-1 min-w-0 text-sm rounded-lg border border-gray-200 px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-200 focus:border-brand-400"
              />
              {hasFilter && (
                <button
                  type="button"
                  onClick={clearFilter}
                  className="text-[11px] uppercase tracking-widest font-bold text-brand-700 hover:text-brand-900"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {usersInPeriod.map((u) => {
                const active = filterUserIds.has(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => toggleFilterUser(u.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] transition-colors ${
                      active
                        ? 'border-brand-500 bg-brand-50 text-brand-800'
                        : 'border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300'
                    }`}
                    title={active ? `Stop reviewing only ${u.name}` : `Only review ${u.name}`}
                  >
                    <Avatar user={u} size={16} />
                    <span>{u.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Entries table */}
        <div>
          <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400 mb-1">
            Entries · {visibleEntries.length}
            {hasFilter && (
              <span className="ml-1 normal-case tracking-normal text-gray-400 italic">
                (filtered from {entries.length})
              </span>
            )}
          </div>
          {visibleEntries.length === 0 ? (
            <Empty
              title={hasFilter ? 'No entries match the filter' : 'No entries in this period'}
              description={hasFilter ? 'Try clearing the filter or picking a different employee.' : undefined}
            />
          ) : (
            <Card>
              <div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]">
                <thead className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
                  <tr>
                    <th className="px-3 py-3 w-10"></th>
                    <th className="px-3 py-3">Date</th>
                    <th className="px-3 py-3 text-right">Start</th>
                    <th className="px-3 py-3 text-right">End</th>
                    <th className="px-3 py-3 text-right">Duration</th>
                    <th className="px-3 py-3">Who</th>
                    <th className="px-3 py-3">Project</th>
                    <th className="px-3 py-3">Note</th>
                    <th className="px-3 py-3">Status</th>
                    <th className="px-3 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {visibleEntries.map((e) => {
                    const u = users.find((x) => x.id === e.userId);
                    const proj = projects.find((p) => p.id === e.projectId);
                    const selectable = e.status === 'submitted' && canMutate;
                    return (
                      <tr
                        key={e.id}
                        className={`hover:bg-gray-50 ${selectable ? 'cursor-pointer' : ''}`}
                        onClick={() => { if (selectable) toggleRow(e.id); }}
                      >
                        <td className="px-3 py-3" onClick={(ev) => ev.stopPropagation()}>
                          {selectable && (
                            <input
                              type="checkbox"
                              checked={selected.has(e.id)}
                              onChange={() => toggleRow(e.id)}
                              className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">{e.startIso.slice(0, 10)}</td>
                        <td className="px-3 py-3 text-right text-gray-700 tabular-nums whitespace-nowrap">{fmtClock(e.startIso)}</td>
                        <td className="px-3 py-3 text-right text-gray-700 tabular-nums whitespace-nowrap">{e.endIso ? fmtClock(e.endIso) : '—'}</td>
                        <td className="px-3 py-3 text-right tabular-nums font-semibold whitespace-nowrap">{fmtMins(e.durationMin)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <Avatar user={u} size={20} />
                            <span className="text-gray-700 whitespace-nowrap">{u?.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-gray-700">{proj?.name ?? '—'}</td>
                        <td className="px-3 py-3 text-gray-600 max-w-[260px]">
                          <div className="truncate">{e.note}</div>
                          {e.status === 'rejected' && e.rejectionNote && (
                            <div className="text-[11px] text-red-600 mt-0.5 truncate">↩ {e.rejectionNote}</div>
                          )}
                        </td>
                        <td className="px-3 py-3"><Pill tone={ENTRY_STATUS_PILL[e.status]}>{ENTRY_STATUS_LABEL[e.status]}</Pill></td>
                        <td className="px-3 py-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                          {e.status === 'approved' && canMutate && (
                            <Button variant="ghost" size="sm" onClick={() => run(() => reopenMut.mutateAsync([e.id]), 'Entry reopened')}>Reopen</Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </Card>
          )}
        </div>

        {/* Per-employee payroll summary */}
        {summaries.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400 mb-1">
              Payroll summary · final check before {isClosed ? 'reopen' : 'close'}
            </div>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500">
                  <tr>
                    <th className="px-3 py-2 text-left w-6"></th>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-right">Hours</th>
                    <th className="px-3 py-2 text-right">Billable</th>
                    <th className="px-3 py-2 text-left">Approvers</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {summaries.map((r) => {
                    const isExpanded = expanded.has(r.userId);
                    return (
                      <Fragment key={r.userId}>
                        <tr
                          onClick={() => toggleExpanded(r.userId)}
                          className="cursor-pointer hover:bg-gray-50"
                          title={isExpanded ? 'Hide entry detail' : 'Show entry-by-entry timestamps'}
                        >
                          <td className="px-3 py-2 text-gray-400">
                            <span className={`inline-block transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▸</span>
                          </td>
                          <td className="px-3 py-2">
                            <div className="text-gray-900 font-semibold">{r.name}</div>
                            <div className="text-[11px] text-gray-500">{r.email}</div>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.hours.toFixed(2)}h</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.revenue)}</td>
                          <td className="px-3 py-2 text-[12px] text-gray-600 truncate max-w-[220px]">
                            {[...r.approverNames].sort().join(', ') || '—'}
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className="bg-gray-50/40">
                            <td></td>
                            <td colSpan={4} className="px-3 py-3">
                              <table className="w-full text-[12px]">
                                <thead className="text-[10px] uppercase tracking-widest text-gray-400">
                                  <tr>
                                    <th className="text-left pb-1">Date</th>
                                    <th className="text-right pb-1">Start</th>
                                    <th className="text-right pb-1">End</th>
                                    <th className="text-right pb-1">Duration</th>
                                    <th className="text-left pb-1">Note</th>
                                    <th className="text-left pb-1">Status</th>
                                    <th className="text-left pb-1">Approver</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                  {r.entries.map((e) => {
                                    const approver = e.approvedBy ? users.find((u) => u.id === e.approvedBy) : null;
                                    return (
                                      <tr key={e.id} className="hover:bg-white">
                                        <td className="py-1 tabular-nums whitespace-nowrap">{e.startIso.slice(0, 10)}</td>
                                        <td className="py-1 text-right tabular-nums whitespace-nowrap">{fmtClock(e.startIso)}</td>
                                        <td className="py-1 text-right tabular-nums whitespace-nowrap">{e.endIso ? fmtClock(e.endIso) : '—'}</td>
                                        <td className="py-1 text-right tabular-nums font-semibold whitespace-nowrap">{fmtMins(e.durationMin)}</td>
                                        <td className="py-1 truncate max-w-[220px] text-gray-700">{e.note || '—'}</td>
                                        <td className="py-1"><Pill tone={ENTRY_STATUS_PILL[e.status]}>{ENTRY_STATUS_LABEL[e.status]}</Pill></td>
                                        <td className="py-1 text-gray-600 whitespace-nowrap">{approver?.name ?? '—'}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-gray-50/60">
                  <tr>
                    <td></td>
                    <td className="px-3 py-2 font-bold text-gray-900">Totals</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{totalHours.toFixed(2)}h</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtMoney(totalRev)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="mt-2 text-[12px] text-gray-500">
              Click an employee row to expand entry-by-entry timestamps.
              "Close" auto-approves any remaining submitted entries.
              "Close &amp; send" additionally emails this per-employee table to{' '}
              <strong>{bookkeeperEmail ?? '—'}</strong> from your connected Gmail.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
