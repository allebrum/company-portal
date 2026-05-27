'use client';

import { useMemo, useState } from 'react';
import { Card, Section, Pill, Empty } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { EntryFormModal } from '@/components/features/EntryFormModal';
import {
  useEntries,
  useUsers,
  useProjects,
  useClients,
  useSubmitEntries,
  usePayPeriods,
  type EntryRow,
} from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import { fmtMins, fmtMoney, fmtTimeRange, ENTRY_STATUS_LABEL, ENTRY_STATUS_PILL } from '@/lib/formatters';

export default function TimePage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const { data: entries = [] } = useEntries();
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const { data: periods = [] } = usePayPeriods();
  const submit = useSubmitEntries();

  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [periodId, setPeriodId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EntryRow | null>(null);

  const isAdmin = can('time_entry.edit');

  const filtered = useMemo(() => {
    let list = entries;
    if (scope === 'me' && me) list = list.filter((e) => e.userId === me.id);
    if (periodId) list = list.filter((e) => e.payPeriodId === periodId);
    if (statusFilter !== 'all') list = list.filter((e) => e.status === statusFilter);
    return list.slice().sort((a, b) => (a.startIso < b.startIso ? 1 : -1));
  }, [entries, scope, periodId, statusFilter, me]);

  const totalMin = filtered.reduce((s, e) => s + e.durationMin, 0);
  const billRevenue = filtered.reduce((s, e) => {
    const proj = projects.find((p) => p.id === e.projectId);
    if (!proj?.billable) return s;
    const u = users.find((x) => x.id === e.userId);
    const rate = u ? Number(u.billable) : 0;
    return s + (e.durationMin / 60) * rate;
  }, 0);

  const draftIds = filtered.filter((e) => e.status === 'draft').map((e) => e.id);
  const selectedDraftIds = [...selected].filter((id) => filtered.find((e) => e.id === id)?.status === 'draft');
  const canSubmit = (selected.size > 0 ? selectedDraftIds : draftIds).length > 0;

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (e: EntryRow) => {
    // Any owned entry opens — the modal handles the edit-vs-delete-only
    // shape internally (fields locked when not draft/rejected, but the
    // Delete button is always available so users can retract submitted
    // or approved entries they need to correct).
    const canOpen = e.userId === me?.id || isAdmin;
    if (!canOpen) return;
    setEditing(e);
    setModalOpen(true);
  };

  const onSubmitSelected = async () => {
    const ids = selected.size > 0 ? selectedDraftIds : draftIds;
    if (ids.length === 0) return;
    try {
      const { count } = await submit.mutateAsync(ids);
      toast.success(`${count} ${count === 1 ? 'entry' : 'entries'} submitted`);
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Submit failed');
    }
  };

  const onResubmit = async (id: string) => {
    try {
      await submit.mutateAsync([id]);
      toast.success('Entry resubmitted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Resubmit failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Time tracking</div>
          <h1 className="text-2xl font-bold text-gray-900">All entries</h1>
          <p className="text-sm text-gray-500">Filter, review, edit, and submit time for approval.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={openCreate}>Add manual entry</Button>
          <Button variant="primary" disabled={!canSubmit || submit.isPending} onClick={onSubmitSelected}>
            Submit {selected.size > 0 ? `${selectedDraftIds.length} selected` : 'all drafts'}
          </Button>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Field label="Scope">
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'me' | 'all')}>
            <option value="me">Just me</option>
            <option value="all">Everyone</option>
          </Select>
        </Field>
        <Field label="Pay period">
          <Select value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            <option value="">All periods</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </Select>
        </Field>
        <div className="ml-auto text-sm text-gray-600">
          <span className="font-semibold tabular-nums">{fmtMins(totalMin)}</span> · {fmtMoney(billRevenue)} billable
        </div>
      </Card>

      <Section>
        {filtered.length === 0 ? (
          <Empty title="No entries match" />
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
                {filtered.map((e) => {
                  const u = users.find((x) => x.id === e.userId);
                  const proj = projects.find((p) => p.id === e.projectId);
                  const cli = proj ? clients.find((c) => c.id === proj.clientId) : null;
                  const editable = (e.userId === me?.id && (e.status === 'draft' || e.status === 'rejected')) || isAdmin;
                  return (
                    <tr
                      key={e.id}
                      className={`hover:bg-gray-50 ${editable ? 'cursor-pointer' : ''}`}
                      onClick={() => openEdit(e)}
                    >
                      <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                        <input
                          type="checkbox"
                          disabled={e.status !== 'draft'}
                          checked={selected.has(e.id)}
                          onChange={(ev) => {
                            const next = new Set(selected);
                            if (ev.target.checked) next.add(e.id);
                            else next.delete(e.id);
                            setSelected(next);
                          }}
                          className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        />
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
                      <td className="px-4 py-3 text-gray-700">
                        <div className="font-semibold text-gray-900 truncate max-w-[200px]">{proj?.name ?? '—'}</div>
                        <div className="text-[11px] text-gray-500">{cli?.name}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[260px]">
                        <div className="truncate">{e.note}</div>
                        {e.status === 'rejected' && e.rejectionNote && (
                          <div className="text-[11px] text-red-600 mt-0.5 truncate">↩ {e.rejectionNote}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{fmtMins(e.durationMin)}</td>
                      <td className="px-4 py-3">
                        <Pill tone={ENTRY_STATUS_PILL[e.status]}>{ENTRY_STATUS_LABEL[e.status]}</Pill>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(ev) => ev.stopPropagation()}>
                        {e.status === 'rejected' && e.userId === me?.id && (
                          <Button variant="ghost" size="sm" onClick={() => onResubmit(e.id)}>Resubmit</Button>
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

      <EntryFormModal open={modalOpen} onClose={() => setModalOpen(false)} entry={editing} />
    </div>
  );
}
