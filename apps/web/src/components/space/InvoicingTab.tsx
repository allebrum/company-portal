'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, ExternalLink, CheckCircle2, Undo2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Pill } from '@/components/ui/Pill';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import {
  useUsers,
  useProjects,
  useClients,
  type EntryRow,
  type ProjectRow,
  type ClientRow,
  type UserRow,
} from '@/hooks/useResources';
import {
  useInvoicingEntries,
  useMarkInvoiced,
  useUnmarkInvoiced,
  useQboStatus,
  useQboCustomers,
  useQboItems,
  useCreateQboInvoice,
  qboConnectUrl,
} from '@/hooks/useInvoicing';

/**
 * Invoicing tab (client + project scope). Lists tracked hours with their
 * client-billing state, lets a biller (invoices.manage) check entries off as
 * invoiced — with an optional reference — and, when QuickBooks is connected,
 * push the selected hours straight into a QuickBooks invoice. Billing state
 * is orthogonal to the payroll status workflow.
 */

const hrs = (min: number) => (min / 60).toFixed(2);
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

const STATUS_TONE = { draft: 'gray', submitted: 'blue', approved: 'green', rejected: 'red' } as const;
const STATUS_LABEL = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', rejected: 'Rejected' } as const;

type Filter = 'uninvoiced' | 'invoiced' | 'all';
const LAST_RATE_KEY = 'invoicing:lastRate:v1';

export function InvoicingTab({
  scope,
  clientId,
  projectId,
}: {
  scope: { kind: 'client' | 'project'; id: string };
  clientId: string;
  projectId: string | null;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const canManage = can('invoices.manage');

  const query =
    scope.kind === 'project' && projectId ? { projectId } : { clientId };
  const { data: entries = [], isLoading } = useInvoicingEntries(query, canManage);
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const { data: qbo } = useQboStatus(canManage);

  const [filter, setFilter] = useState<Filter>('uninvoiced');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [markOpen, setMarkOpen] = useState(false);
  const [qboOpen, setQboOpen] = useState(false);

  const mark = useMarkInvoiced();
  const unmark = useUnmarkInvoiced();

  const client = clients.find((c) => c.id === clientId) ?? null;
  const userById = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  // Drop stale selections when the underlying list changes (e.g. someone
  // else invoiced them, or the scope switched).
  useEffect(() => {
    setSelected((prev) => {
      const valid = new Set(entries.map((e) => e.id));
      const next = new Set([...prev].filter((id) => valid.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [entries]);

  if (!canManage) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
        <div className="font-semibold text-gray-700">Invoicing access only</div>
        <p className="mt-1 text-sm text-gray-500">
          You need the “{`Mark time invoiced & create client invoices`}” permission to see billing state.
        </p>
      </div>
    );
  }

  const totalMin = entries.reduce((a, e) => a + e.durationMin, 0);
  const invoicedMin = entries.filter((e) => e.invoicedAt).reduce((a, e) => a + e.durationMin, 0);
  const uninvoicedMin = totalMin - invoicedMin;

  const visible = entries.filter((e) =>
    filter === 'all' ? true : filter === 'invoiced' ? !!e.invoicedAt : !e.invoicedAt,
  );

  // Client scope groups by project; project scope is one flat group.
  const groups: Array<{ project: ProjectRow | null; rows: EntryRow[] }> = (() => {
    if (scope.kind === 'project') {
      return visible.length || isLoading ? [{ project: projectId ? projectById.get(projectId) ?? null : null, rows: visible }] : [];
    }
    const byProject = new Map<string, EntryRow[]>();
    for (const e of visible) {
      if (!e.projectId) continue;
      const arr = byProject.get(e.projectId) ?? [];
      arr.push(e);
      byProject.set(e.projectId, arr);
    }
    return [...byProject.entries()]
      .map(([pid, rows]) => ({ project: projectById.get(pid) ?? null, rows }))
      .sort((a, b) => (a.project?.name ?? '').localeCompare(b.project?.name ?? ''));
  })();

  const selectedRows = entries.filter((e) => selected.has(e.id));
  const selectedMin = selectedRows.reduce((a, e) => a + e.durationMin, 0);
  const selectedUninvoiced = selectedRows.filter((e) => !e.invoicedAt);
  const selectedInvoiced = selectedRows.filter((e) => !!e.invoicedAt);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleMany = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const doUnmark = async () => {
    try {
      const r = await unmark.mutateAsync(selectedInvoiced.map((e) => e.id));
      toast.success(`${r.count} ${r.count === 1 ? 'entry' : 'entries'} marked not invoiced`);
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  const qboReady = !!qbo?.configured && !!qbo?.connected;

  return (
    <div className="space-y-4 pb-24">
      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile label="Tracked" value={`${hrs(totalMin)} h`} />
        <SummaryTile label="Not invoiced" value={`${hrs(uninvoicedMin)} h`} tone="amber" />
        <SummaryTile label="Invoiced" value={`${hrs(invoicedMin)} h`} tone="green" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {(['uninvoiced', 'invoiced', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${
                filter === f ? 'bg-brand-600 text-white' : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {f === 'uninvoiced' ? 'Not invoiced' : f === 'invoiced' ? 'Invoiced' : 'All'}
            </button>
          ))}
        </div>
        {qbo?.configured && !qbo.connected && can('integrations.manage') && (
          <div className="text-[12px] text-gray-500">
            QuickBooks isn’t connected —{' '}
            <a className="underline font-semibold" href={qboConnectUrl(window.location.pathname + window.location.search)}>
              connect it
            </a>{' '}
            to create invoices from here.
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="rounded-xl bg-gray-100 animate-pulse h-40" />
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
          <div className="font-semibold text-gray-700">
            {filter === 'uninvoiced' ? 'Nothing waiting to be invoiced' : filter === 'invoiced' ? 'Nothing invoiced yet' : 'No time tracked yet'}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            {filter === 'uninvoiced'
              ? 'Every tracked hour in this scope has been billed. 🎉'
              : 'Tracked hours show up here as soon as time is logged against ' +
                (scope.kind === 'project' ? 'this project.' : "this client's projects.")}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map(({ project, rows }) => {
            const groupMin = rows.reduce((a, e) => a + e.durationMin, 0);
            const allSelected = rows.length > 0 && rows.every((e) => selected.has(e.id));
            return (
              <div key={project?.id ?? 'none'} className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
                <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={(e) => toggleMany(rows.map((r) => r.id), e.target.checked)}
                    aria-label={`Select all entries for ${project?.name ?? 'project'}`}
                  />
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: project?.color ?? '#9ca3af' }}
                  />
                  <span className="text-sm font-bold text-gray-900 truncate">{project?.name ?? 'Project'}</span>
                  {project && !project.billable && <Pill tone="gray">Non-billable</Pill>}
                  <span className="ml-auto text-[12px] font-semibold text-gray-500 tabular-nums">
                    {hrs(groupMin)} h
                  </span>
                </div>
                <ul className="divide-y divide-gray-50">
                  {rows.map((e) => {
                    const u = userById.get(e.userId);
                    return (
                      <li key={e.id} className="flex items-center gap-2.5 px-4 py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(e.id)}
                          onChange={() => toggle(e.id)}
                          aria-label="Select entry"
                        />
                        <span className="text-[12px] text-gray-500 w-24 shrink-0 tabular-nums">{fmtDay(e.startIso)}</span>
                        <span className="text-[12px] font-semibold text-gray-700 w-28 shrink-0 truncate">{u?.name ?? '—'}</span>
                        <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{e.note || <span className="text-gray-400">No note</span>}</span>
                        <Pill tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Pill>
                        {e.invoicedAt && (
                          <Pill tone="green">
                            <span title={`Invoiced ${fmtDay(e.invoicedAt)}`}>
                              {e.invoiceRef ? e.invoiceRef : 'Invoiced'}
                            </span>
                          </Pill>
                        )}
                        <span className="text-sm font-semibold text-gray-900 w-16 text-right tabular-nums shrink-0">
                          {hrs(e.durationMin)} h
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {/* Selection action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[90] rounded-2xl border border-gray-200 bg-white shadow-soft-md px-4 py-3 flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-900 whitespace-nowrap">
            {selected.size} selected · {hrs(selectedMin)} h
          </span>
          {selectedUninvoiced.length > 0 && (
            <Button variant="success" size="sm" onClick={() => setMarkOpen(true)} disabled={mark.isPending}>
              <CheckCircle2 className="w-3.5 h-3.5" /> Mark invoiced
            </Button>
          )}
          {selectedUninvoiced.length > 0 && qboReady && (
            <Button variant="primary" size="sm" onClick={() => setQboOpen(true)}>
              <Receipt className="w-3.5 h-3.5" /> QuickBooks invoice
            </Button>
          )}
          {selectedInvoiced.length > 0 && (
            <Button variant="outline" size="sm" onClick={doUnmark} disabled={unmark.isPending}>
              <Undo2 className="w-3.5 h-3.5" /> Not invoiced
            </Button>
          )}
          <button
            type="button"
            className="text-[12px] text-gray-400 hover:text-gray-700 underline"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      <MarkInvoicedModal
        open={markOpen}
        onClose={() => setMarkOpen(false)}
        count={selectedUninvoiced.length}
        totalMin={selectedUninvoiced.reduce((a, e) => a + e.durationMin, 0)}
        onConfirm={async (ref) => {
          try {
            const r = await mark.mutateAsync({
              ids: selectedUninvoiced.map((e) => e.id),
              invoiceRef: ref || undefined,
            });
            toast.success(`${r.count} ${r.count === 1 ? 'entry' : 'entries'} marked invoiced`);
            setSelected(new Set());
            setMarkOpen(false);
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Update failed');
          }
        }}
        pending={mark.isPending}
      />

      {qboOpen && client && (
        <QboInvoiceModal
          open={qboOpen}
          onClose={() => setQboOpen(false)}
          client={client}
          entries={selectedUninvoiced}
          projectById={projectById}
          userById={userById}
          onCreated={() => setSelected(new Set())}
        />
      )}
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
      <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">{label}</div>
      <div
        className={`mt-0.5 text-lg font-bold tabular-nums ${
          tone === 'green' ? 'text-green-700' : tone === 'amber' ? 'text-amber-600' : 'text-gray-900'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function MarkInvoicedModal({
  open,
  onClose,
  count,
  totalMin,
  onConfirm,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  count: number;
  totalMin: number;
  onConfirm: (ref: string) => void;
  pending: boolean;
}) {
  const [ref, setRef] = useState('');
  useEffect(() => {
    if (open) setRef('');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Mark as invoiced" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-gray-600">
          Mark <span className="font-semibold">{count} {count === 1 ? 'entry' : 'entries'}</span> ({hrs(totalMin)} h)
          as billed to the client.
        </p>
        <Field label="Invoice reference" hint="Optional — e.g. INV-1042 or the QuickBooks number.">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="INV-…" maxLength={200} autoFocus />
        </Field>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="success" onClick={() => onConfirm(ref.trim())} disabled={pending || count === 0}>
            {pending ? 'Saving…' : 'Mark invoiced'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// QuickBooks invoice dialog — one line per project, prefilled from selection.
// ---------------------------------------------------------------------------

type DraftLine = { key: string; description: string; hours: string; rate: string };

function QboInvoiceModal({
  open,
  onClose,
  client,
  entries,
  projectById,
  userById,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  client: ClientRow;
  entries: EntryRow[]; // uninvoiced selection
  projectById: Map<string, ProjectRow>;
  userById: Map<string, UserRow>;
  onCreated: () => void;
}) {
  const toast = useToast();
  const create = useCreateQboInvoice();
  const [customerSearch, setCustomerSearch] = useState('');
  const { data: customers = [], isLoading: customersLoading } = useQboCustomers(customerSearch, open);
  const { data: items = [] } = useQboItems(open);

  // '' = create a new customer named after the client.
  const [customerId, setCustomerId] = useState<string>(client.quickbooksCustomerId ?? '');
  const [itemId, setItemId] = useState<string>('');
  const [memo, setMemo] = useState('');

  const lastRate = (() => {
    try {
      return localStorage.getItem(LAST_RATE_KEY) ?? '';
    } catch {
      return '';
    }
  })();

  const [lines, setLines] = useState<DraftLine[]>([]);
  useEffect(() => {
    if (!open) return;
    // One line per project across the selection. Rate prefills from the
    // entry owners' billable rate when everyone on the line shares one;
    // otherwise the last rate used here.
    const byProject = new Map<string, { min: number; rates: Set<number> }>();
    for (const e of entries) {
      const pid = e.projectId ?? 'none';
      const g = byProject.get(pid) ?? { min: 0, rates: new Set<number>() };
      g.min += e.durationMin;
      const rate = Number(userById.get(e.userId)?.billable);
      if (Number.isFinite(rate) && rate > 0) g.rates.add(rate);
      byProject.set(pid, g);
    }
    setLines(
      [...byProject.entries()].map(([pid, g]) => {
        const p = projectById.get(pid);
        return {
          key: pid,
          description: `${p?.name ?? 'Professional services'} — ${hrs(g.min)} h`,
          hours: hrs(g.min),
          rate: g.rates.size === 1 ? String([...g.rates][0]) : lastRate,
        };
      }),
    );
    setCustomerId(client.quickbooksCustomerId ?? '');
    setMemo('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (items.length > 0 && !itemId) setItemId(items[0]!.id);
  }, [items, itemId]);

  const parsedLines = lines.map((l) => ({
    description: l.description.trim(),
    hours: Number(l.hours),
    rate: Number(l.rate),
  }));
  const valid =
    parsedLines.length > 0 &&
    parsedLines.every((l) => l.description && Number.isFinite(l.hours) && l.hours > 0 && Number.isFinite(l.rate) && l.rate >= 0);
  const total = valid ? parsedLines.reduce((a, l) => a + l.hours * l.rate, 0) : 0;

  const submit = async () => {
    if (!valid) return;
    try {
      const result = await create.mutateAsync({
        clientId: client.id,
        customerId: customerId || undefined,
        customerName: customerId ? undefined : client.name,
        serviceItemId: itemId || undefined,
        lines: parsedLines,
        entryIds: entries.map((e) => e.id),
        memo: memo.trim() || undefined,
      });
      try {
        const r = lines[0]?.rate;
        if (r) localStorage.setItem(LAST_RATE_KEY, r);
      } catch {
        // localStorage unavailable — ignore
      }
      toast.success(
        `QuickBooks invoice ${result.docNumber ? `#${result.docNumber}` : 'created'} · $${result.total.toFixed(2)} · ${result.marked} entries marked invoiced`,
      );
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invoice creation failed');
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create QuickBooks invoice" size="2xl">
      <div className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field
            label="QuickBooks customer"
            hint={customerId ? undefined : `A new customer “${client.name}” will be created.`}
          >
            <div className="space-y-2">
              <Input
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder="Search customers…"
              />
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">{customersLoading ? 'Loading…' : `＋ Create “${client.name}”`}</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.displayName}</option>
                ))}
                {/* Keep the remembered mapping selectable even when the search filters it out. */}
                {client.quickbooksCustomerId &&
                  !customers.some((c) => c.id === client.quickbooksCustomerId) && (
                    <option value={client.quickbooksCustomerId}>Linked customer</option>
                  )}
              </Select>
            </div>
          </Field>
          <Field
            label="Service item"
            hint="The QuickBooks product/service each line bills against."
            error={items.length === 0 ? 'No Service items found — create one in QuickBooks first.' : undefined}
          >
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              {items.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400 mb-2">Invoice lines</div>
          <div className="space-y-2">
            {lines.map((l, idx) => (
              <div key={l.key} className="grid grid-cols-[1fr_90px_110px_90px] gap-2 items-center">
                <Input
                  value={l.description}
                  onChange={(e) =>
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                  }
                  placeholder="Description"
                />
                <Input
                  value={l.hours}
                  onChange={(e) =>
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, hours: e.target.value } : x)))
                  }
                  placeholder="Hours"
                  inputMode="decimal"
                  aria-label="Hours"
                />
                <Input
                  value={l.rate}
                  onChange={(e) =>
                    setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, rate: e.target.value } : x)))
                  }
                  placeholder="Rate $/h"
                  inputMode="decimal"
                  aria-label="Hourly rate"
                />
                <div className="text-sm font-semibold text-gray-900 text-right tabular-nums">
                  {Number.isFinite(Number(l.hours)) && Number.isFinite(Number(l.rate))
                    ? `$${(Number(l.hours) * Number(l.rate)).toFixed(2)}`
                    : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>

        <Field label="Memo" hint="Optional — shows on the invoice as the customer memo.">
          <Textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} maxLength={1000} />
        </Field>

        <div className="flex items-center justify-between gap-3 pt-1 border-t border-gray-100">
          <div className="text-sm text-gray-600">
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} will be marked invoiced with the
            QuickBooks number.
          </div>
          <div className="flex items-center gap-3">
            <span className="text-base font-bold text-gray-900 tabular-nums">${total.toFixed(2)}</span>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={submit} disabled={!valid || !itemId || create.isPending}>
              <ExternalLink className="w-3.5 h-3.5" />
              {create.isPending ? 'Creating…' : 'Create invoice'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
