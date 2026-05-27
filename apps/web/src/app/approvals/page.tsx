'use client';

import { useEffect, useMemo, useState } from 'react';
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
  fmtTimeRange,
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

  const [periodId, setPeriodId] = useState<string>('');
  // Auto-default to the period that contains today, falling back to the
  // first 'review' or first 'open' period. We only set this once after the
  // periods list arrives so manual selection isn't clobbered on refetch.
  useEffect(() => {
    if (periodId || periods.length === 0) return;
    const today = new Date().toISOString().slice(0, 10);
    const current = periods.find((p) => p.startDate <= today && p.endDate >= today);
    setPeriodId(
      current?.id
        ?? periods.find((p) => p.status === 'review')?.id
        ?? periods.find((p) => p.status === 'open')?.id
        ?? periods[0]?.id
        ?? '',
    );
  }, [periods, periodId]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('Please double-check duration and resubmit.');
  const [reviewOpen, setReviewOpen] = useState(false);

  const isPrivileged = can('time_entry.approve');

  const period = periods.find((p) => p.id === periodId);
  const periodEntries = useMemo(
    () =>
      entries
        .filter((e) => e.payPeriodId === periodId)
        .sort((a, b) => a.startIso.localeCompare(b.startIso)),
    [entries, periodId],
  );
  const submitted = periodEntries.filter((e) => e.status === 'submitted');
  const totalMin = periodEntries.reduce((s, e) => s + e.durationMin, 0);
  const billRevenue = periodEntries.reduce((s, e) => {
    const proj = projects.find((p) => p.id === e.projectId);
    if (!proj?.billable) return s;
    const u = users.find((x) => x.id === e.userId);
    const rate = u ? Number(u.billable) : 0;
    return s + (e.durationMin / 60) * rate;
  }, 0);

  const acting = (selected.size > 0 ? [...selected] : submitted.map((e) => e.id));

  const toggleRow = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
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
          <p className="text-sm text-gray-500">Approve or return submitted entries by pay period.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {periods.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-gray-900">{p.label}</div>
                <div className="text-[11px] text-gray-500">Cutoff {p.approvalCutoff} · Pay {p.payDate}</div>
              </div>
              <Pill tone={PAY_PERIOD_STATUS_PILL[p.status]}>{PAY_PERIOD_STATUS_LABEL[p.status]}</Pill>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => { setPeriodId(p.id); setSelected(new Set()); }}>Review</Button>
              {p.status === 'open' && <Button variant="ghost" size="sm" onClick={() => run(() => toReview.mutateAsync(p.id), 'Moved to review')}>Move to review</Button>}
              {p.status === 'review' && <Button variant="primary" size="sm" onClick={() => run(() => closeP.mutateAsync(p.id), 'Period closed')}>Close &amp; auto-approve</Button>}
              {p.status === 'closed' && can('pay.manage') && <Button variant="ghost" size="sm" onClick={() => run(() => reopenP.mutateAsync(p.id), 'Period reopened')}>Reopen</Button>}
            </div>
          </Card>
        ))}
      </div>

      <Section title={period ? `Entries in ${period.label}` : 'Entries'} eyebrow={`${submitted.length} submitted`}>
        <Card className="p-4 flex flex-wrap items-center gap-3">
          <Field label="Pay period">
            <Select value={periodId} onChange={(e) => { setPeriodId(e.target.value); setSelected(new Set()); }}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </Select>
          </Field>
          <div className="ml-auto text-sm text-gray-600">
            <span className="font-semibold tabular-nums">{fmtMins(totalMin)}</span> · {fmtMoney(billRevenue)} billable
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" disabled={acting.length === 0 || reject.isPending} onClick={() => setRejectOpen(true)}>
              Return {selected.size > 0 ? `(${selected.size})` : '(all)'}
            </Button>
            <Button
              variant="primary"
              disabled={acting.length === 0 || approve.isPending}
              onClick={async () => {
                await run(() => approve.mutateAsync(acting), `${acting.length} approved`);
                setSelected(new Set());
              }}
            >
              Approve {selected.size > 0 ? `(${selected.size})` : '(all)'}
            </Button>
            {period && period.status !== 'closed' && can('pay.manage') && (
              <Button
                variant="outline"
                onClick={() => setReviewOpen(true)}
                title="Review the period summary and close it out"
              >
                Close period…
              </Button>
            )}
          </div>
        </Card>

        {periodEntries.length === 0 ? (
          <Empty title="No entries in this period" />
        ) : (
          <Card>
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
              <thead className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
                <tr>
                  <th className="px-4 py-3 w-10"></th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Who</th>
                  <th className="px-4 py-3">Project</th>
                  <th className="px-4 py-3">Note</th>
                  <th className="px-4 py-3 text-right">Duration</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {periodEntries.map((e) => {
                  const u = users.find((x) => x.id === e.userId);
                  const proj = projects.find((p) => p.id === e.projectId);
                  const selectable = e.status === 'submitted';
                  return (
                    <tr
                      key={e.id}
                      className={`hover:bg-gray-50 ${selectable ? 'cursor-pointer' : ''}`}
                      onClick={() => { if (selectable) toggleRow(e.id); }}
                    >
                      <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                        {selectable && (
                          <input
                            type="checkbox"
                            checked={selected.has(e.id)}
                            onChange={() => toggleRow(e.id)}
                            className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 tabular-nums">
                        <div>{e.startIso.slice(0, 10)}</div>
                        <div className="text-[11px] text-gray-500">{fmtTimeRange(e.startIso, e.endIso)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar user={u} size={20} />
                          <span className="text-gray-700">{u?.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{proj?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-600 max-w-[260px]">
                        <div className="truncate">{e.note}</div>
                        {e.status === 'rejected' && e.rejectionNote && (
                          <div className="text-[11px] text-red-600 mt-0.5 truncate">↩ {e.rejectionNote}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtMins(e.durationMin)}</td>
                      <td className="px-4 py-3"><Pill tone={ENTRY_STATUS_PILL[e.status]}>{ENTRY_STATUS_LABEL[e.status]}</Pill></td>
                      <td className="px-4 py-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                        {e.status === 'approved' && (
                          <Button variant="ghost" size="sm" onClick={() => run(() => reopen.mutateAsync([e.id]), 'Entry reopened')}>Reopen</Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </Card>
        )}
      </Section>

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Return entries for review"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await run(() => reject.mutateAsync({ ids: acting, note: rejectNote }), `${acting.length} returned`);
                setSelected(new Set());
                setRejectOpen(false);
              }}
            >
              Return {acting.length} {acting.length === 1 ? 'entry' : 'entries'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-gray-600">The owner will see the note below alongside each entry.</p>
          <Field label="Note"><Textarea value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></Field>
        </div>
      </Modal>

      {period && (
        <PayrollReviewModal
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          period={period}
          entries={periodEntries}
          users={users}
          projects={projects}
          bookkeeperEmail={settings?.bookkeeperEmail ?? null}
          onCloseOnly={async () => {
            await run(() => closeP.mutateAsync(period.id), `${period.label} closed`);
            setReviewOpen(false);
          }}
          onCloseAndSend={async () => {
            // Atomic-ish: close first (auto-approves submitted), then email
            // the report from the clicking admin's connected Gmail. The
            // bookkeeper sees a single payroll summary per period.
            try {
              await closeP.mutateAsync(period.id);
              await sendBookkeeper.mutateAsync(period.id);
              toast.success(`${period.label} closed · report emailed to bookkeeper`);
              setReviewOpen(false);
            } catch (e) {
              const msg = e instanceof Error ? e.message : 'Action failed';
              if (msg === 'bookkeeper_email_not_set') {
                toast.error('Set a bookkeeper email in Admin → Pay periods first');
              } else {
                toast.error(msg);
              }
            }
          }}
          busy={closeP.isPending || sendBookkeeper.isPending}
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
function PayrollReviewModal({
  open,
  onClose,
  period,
  entries,
  users,
  projects,
  bookkeeperEmail,
  onCloseOnly,
  onCloseAndSend,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  period: PayPeriodRow;
  entries: EntryRow[];
  users: UserRow[];
  projects: ProjectRow[];
  bookkeeperEmail: string | null;
  onCloseOnly: () => Promise<void>;
  onCloseAndSend: () => Promise<void>;
  busy: boolean;
}) {
  // Treat both 'submitted' and 'approved' rows as in-scope since "Close"
  // auto-approves anything still submitted. Closed-period reopens that
  // happen to land in the modal are equivalent.
  const usableStatuses = new Set(['submitted', 'approved']);
  type Row = {
    name: string;
    email: string;
    hours: number;
    revenue: number;
    approverNames: Set<string>;
  };
  const byUser = new Map<string, Row>();
  for (const e of entries) {
    if (!usableStatuses.has(e.status)) continue;
    const u = users.find((x) => x.id === e.userId);
    if (!u) continue;
    let row = byUser.get(e.userId);
    if (!row) {
      row = { name: u.name, email: u.email, hours: 0, revenue: 0, approverNames: new Set() };
      byUser.set(e.userId, row);
    }
    row.hours += e.durationMin / 60;
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

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Close ${period.label}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="outline" onClick={() => void onCloseOnly()} disabled={busy} title="Close the period without emailing the bookkeeper">
            Close period
          </Button>
          <Button
            variant="primary"
            onClick={() => void onCloseAndSend()}
            disabled={busy || !bookkeeperEmail}
            title={bookkeeperEmail ? `Email the report to ${bookkeeperEmail}` : 'Set a bookkeeper email in Admin → Pay periods first'}
          >
            Close &amp; send to bookkeeper
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-gray-900">{period.startDate}</span> – <span className="font-semibold text-gray-900">{period.endDate}</span>
          {' · '}Pay date <span className="font-semibold text-gray-900">{period.payDate}</span>
          {' · '}Status <Pill tone={PAY_PERIOD_STATUS_PILL[period.status]}>{PAY_PERIOD_STATUS_LABEL[period.status]}</Pill>
        </div>

        {!bookkeeperEmail && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
            No bookkeeper email is set. Closing the period will still work; the report just won't go out.
            Add one in <span className="font-semibold">Admin → Pay periods</span>.
          </div>
        )}

        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-widest text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Employee</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-right">Billable</th>
                <th className="px-3 py-2 text-left">Approvers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {summaries.length === 0 ? (
                <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No entries to summarize in this period.</td></tr>
              ) : (
                summaries.map((r) => (
                  <tr key={r.email}>
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
                ))
              )}
            </tbody>
            <tfoot className="bg-gray-50/60">
              <tr>
                <td className="px-3 py-2 font-bold text-gray-900">Totals</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{totalHours.toFixed(2)}h</td>
                <td className="px-3 py-2 text-right tabular-nums font-bold">{fmtMoney(totalRev)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>

        <p className="text-[12px] text-gray-500">
          "Close" auto-approves any remaining submitted entries. "Close &amp; send" additionally emails the
          per-employee table above to <strong>{bookkeeperEmail ?? '—'}</strong> from your connected Gmail.
        </p>
      </div>
    </Modal>
  );
}
