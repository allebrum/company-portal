'use client';

import { useState } from 'react';
import { ArrowLeft, MessageSquare, Send } from 'lucide-react';
import type { TicketStatus } from '@allebrum/shared';
import { useTickets, useTicket, useUpdateTicket, useReplyTicket } from '@/hooks/useTickets';
import { useProjects, type ClientRow } from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Pill } from '@/components/ui/Pill';

/**
 * Sprint 4 — the staff Tickets tab inside a client's Space. List + detail
 * with the message thread; status/priority changes are visible to everyone
 * but only enabled with `tickets.manage` (the server enforces it too).
 * Status changes mirror into the linked triage to-do automatically.
 */

const STATUS_TONE: Record<TicketStatus, 'blue' | 'purple' | 'yellow' | 'green' | 'gray'> = {
  open: 'blue',
  in_progress: 'purple',
  waiting_on_client: 'yellow',
  resolved: 'green',
  closed: 'gray',
};
const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_on_client: 'Waiting on client',
  resolved: 'Resolved',
  closed: 'Closed',
};
const STATUSES = Object.keys(STATUS_LABEL) as TicketStatus[];
const PRIORITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const whenFull = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function TicketDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const detail = useTicket(id);
  const update = useUpdateTicket();
  const reply = useReplyTicket();
  const { data: projects = [] } = useProjects();
  const [draft, setDraft] = useState('');
  const canManage = can('tickets.manage');

  const t = detail.data;
  if (detail.isLoading) return <div className="rounded-xl bg-gray-100 animate-pulse h-40" />;
  if (!t) {
    return (
      <div className="text-sm text-gray-500">
        Ticket not found.{' '}
        <button type="button" className="underline" onClick={onBack}>Back</button>
      </div>
    );
  }

  const project = t.projectId ? projects.find((p) => p.id === t.projectId) : null;

  const setStatus = (status: TicketStatus) => {
    update.mutate(
      { id: t.id, status },
      {
        onSuccess: () => toast.success(`Ticket ${STATUS_LABEL[status].toLowerCase()}`),
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Update failed'),
      },
    );
  };

  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    reply.mutate(
      { id: t.id, body: draft.trim() },
      {
        onSuccess: () => setDraft(''),
        onError: (err) => toast.error(err instanceof Error ? err.message : 'Reply failed'),
      },
    );
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> All tickets
      </button>

      <div className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900">{t.title}</h2>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Opened {when(t.createdAt)}{t.openedBy ? ` by ${t.openedBy}` : ''}
              {project ? ` · ${project.name}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={t.status}
              disabled={!canManage || update.isPending}
              onChange={(e) => setStatus(e.target.value as TicketStatus)}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white disabled:opacity-60"
              aria-label="Ticket status"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            <select
              value={t.priority}
              disabled={!canManage || update.isPending}
              onChange={(e) =>
                update.mutate(
                  { id: t.id, priority: e.target.value as 'low' | 'medium' | 'high' },
                  { onError: (err) => toast.error(err instanceof Error ? err.message : 'Update failed') },
                )
              }
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white disabled:opacity-60"
              aria-label="Ticket priority"
            >
              {(['low', 'medium', 'high'] as const).map((p) => (
                <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{t.body}</p>
      </div>

      {t.messages.length > 0 && (
        <ol className="space-y-3">
          {t.messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-2xl border p-4 ${
                m.authorKind === 'staff' ? 'border-brand-100 bg-brand-50/40' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] font-semibold text-gray-700">
                  {m.authorName ?? (m.authorKind === 'staff' ? 'Staff' : 'Client contact')}
                  <span className="ml-1.5 text-[10px] uppercase tracking-wide text-gray-400">
                    {m.authorKind === 'staff' ? 'Team' : 'Client'}
                  </span>
                </span>
                <span className="text-[11px] text-gray-400">{whenFull(m.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      )}

      {t.status === 'closed' ? (
        <p className="text-sm text-gray-500">This ticket is closed — reopen it to keep the conversation going.</p>
      ) : (
        <form onSubmit={send} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={5000}
            rows={3}
            placeholder="Reply to the client… (they'll see this in their portal)"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <div className="flex items-center justify-end">
            <Button type="submit" variant="primary" size="sm" disabled={reply.isPending || !draft.trim()}>
              <Send className="w-3.5 h-3.5" /> {reply.isPending ? 'Sending…' : 'Reply'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export function TicketsTab({ client }: { client: ClientRow }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const tickets = useTickets({ clientId: client.id });

  if (openId) return <TicketDetail id={openId} onBack={() => setOpenId(null)} />;

  const rows = (tickets.data ?? []).filter(
    (t) => showAll || (t.status !== 'resolved' && t.status !== 'closed'),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Requests from {client.name}'s portal. Each ticket has a linked triage to-do — completing
          the to-do resolves the ticket.
        </p>
        <label className="flex items-center gap-1.5 text-[12px] text-gray-500 shrink-0">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show resolved
        </label>
      </div>

      {tickets.isLoading ? (
        <div className="rounded-xl bg-gray-100 animate-pulse h-32" />
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
          <div className="font-semibold text-gray-700">No {showAll ? '' : 'active '}tickets</div>
          <p className="mt-1 text-sm text-gray-500">
            When {client.name} opens a ticket in their portal, it shows up here and on the to-do board.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setOpenId(t.id)}
                className="w-full text-left rounded-xl border border-gray-200 bg-white px-4 py-3 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-gray-900 truncate">{t.title}</span>
                  <span className="flex items-center gap-2 shrink-0">
                    {t.priority === 'high' && <Pill tone="red">High</Pill>}
                    <Pill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill>
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-3 text-[12px] text-gray-500">
                  {t.openedBy && <span>{t.openedBy}</span>}
                  <span>Updated {when(t.updatedAt)}</span>
                  {t.messageCount > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> {t.messageCount}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
