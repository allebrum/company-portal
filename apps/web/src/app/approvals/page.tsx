'use client';

import { useMemo, useState } from 'react';
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
  const approve = useApproveEntries();
  const reject = useRejectEntries();
  const reopen = useReopenEntries();
  const closeP = useClosePeriod();
  const toReview = useMovePeriodToReview();
  const reopenP = useReopenPeriod();

  const initialPeriod = periods.find((p) => p.status === 'review')?.id ?? periods[0]?.id ?? '';
  const [periodId, setPeriodId] = useState<string>(initialPeriod);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState('Please double-check duration and resubmit.');

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
          </div>
        </Card>

        {periodEntries.length === 0 ? (
          <Empty title="No entries in this period" />
        ) : (
          <Card>
            <table className="w-full text-sm">
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
            </table>
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
    </div>
  );
}
