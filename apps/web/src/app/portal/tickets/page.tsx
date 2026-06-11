'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, MessageSquare, Plus } from 'lucide-react';
import {
  usePortalMe,
  usePortalTickets,
  usePortalTicket,
  usePortalProjects,
  useCreatePortalTicket,
  useReplyPortalTicket,
  type PortalTicketRow,
} from '@/hooks/usePortal';
import { PortalHeader } from '@/components/portal/PortalHeader';

/**
 * Sprint 4 — the portal Tickets tab. List + new-ticket form + detail thread,
 * all on one static-export page; the open ticket rides the `?ticket=` query
 * param so refresh and back/forward keep working.
 */

const STATUS_META: Record<PortalTicketRow['status'], { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-blue-50 text-blue-700' },
  in_progress: { label: 'In progress', cls: 'bg-purple-50 text-purple-700' },
  waiting_on_client: { label: 'Waiting on you', cls: 'bg-yellow-50 text-yellow-800' },
  resolved: { label: 'Resolved', cls: 'bg-green-50 text-green-700' },
  closed: { label: 'Closed', cls: 'bg-gray-100 text-gray-600' },
};

function StatusPill({ status }: { status: PortalTicketRow['status'] }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.label}
    </span>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const whenFull = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---- New ticket form ----------------------------------------------------

function NewTicketForm({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const projects = usePortalProjects();
  const create = useCreatePortalTicket();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const t = await create.mutateAsync({
        title: title.trim(),
        body: body.trim(),
        ...(projectId ? { projectId } : {}),
      });
      onDone(t.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    }
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
      <h2 className="text-lg font-bold text-gray-900">New ticket</h2>
      <label className="block">
        <span className="block text-xs font-semibold text-gray-600 mb-1">What do you need?</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
          autoFocus
          placeholder="e.g. Update the homepage hero copy"
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </label>
      <label className="block">
        <span className="block text-xs font-semibold text-gray-600 mb-1">Details</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          maxLength={5000}
          rows={4}
          placeholder="Anything that helps the team act on this — links, context, deadlines."
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
      </label>
      {(projects.data?.length ?? 0) > 0 && (
        <label className="block">
          <span className="block text-xs font-semibold text-gray-600 mb-1">Project (optional)</span>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            <option value="">No specific project</option>
            {projects.data!.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={create.isPending || !title.trim() || !body.trim()}
          className="rounded-lg bg-gray-900 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
        >
          {create.isPending ? 'Sending…' : 'Open ticket'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-800 px-2 py-2">
          Cancel
        </button>
      </div>
    </form>
  );
}

// ---- Detail / thread ----------------------------------------------------

function TicketDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const detail = usePortalTicket(id);
  const reply = useReplyPortalTicket();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  const t = detail.data;

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await reply.mutateAsync({ id, body: draft.trim() });
      setDraft('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send. Try again.');
    }
  };

  if (detail.isLoading) return <div className="rounded-xl bg-gray-100 animate-pulse h-40" />;
  if (!t) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
        <div className="font-semibold text-gray-700">Ticket not found</div>
        <button type="button" onClick={onBack} className="mt-2 text-sm text-gray-500 hover:text-gray-800">
          Back to tickets
        </button>
      </div>
    );
  }

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
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-gray-900">{t.title}</h1>
          <StatusPill status={t.status} />
        </div>
        <p className="text-[12px] text-gray-500 mt-1">
          Opened {when(t.createdAt)}{t.openedBy ? ` by ${t.openedBy}` : ''}
        </p>
        <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{t.body}</p>
      </div>

      {t.messages.length > 0 && (
        <ol className="space-y-3">
          {t.messages.map((m) => (
            <li
              key={m.id}
              className={`rounded-2xl border p-4 ${
                m.authorKind === 'staff' ? 'border-purple-100 bg-purple-50/50' : 'border-gray-200 bg-white'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[12px] font-semibold text-gray-700">
                  {m.authorName ?? (m.authorKind === 'staff' ? 'The team' : 'You')}
                  {m.authorKind === 'staff' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-purple-600">Team</span>}
                </span>
                <span className="text-[11px] text-gray-400">{whenFull(m.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ol>
      )}

      {t.status === 'closed' ? (
        <p className="text-center text-sm text-gray-500 py-2">
          This ticket is closed. Open a new one if you need anything else.
        </p>
      ) : (
        <form onSubmit={send} className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            required
            maxLength={5000}
            rows={3}
            placeholder={t.status === 'resolved' ? 'Replying reopens this ticket.' : 'Write a reply…'}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={reply.isPending || !draft.trim()}
            className="rounded-lg bg-gray-900 text-white text-sm font-semibold px-4 py-2 disabled:opacity-50"
          >
            {reply.isPending ? 'Sending…' : 'Send reply'}
          </button>
        </form>
      )}
    </div>
  );
}

// ---- Page ---------------------------------------------------------------

function Inner() {
  const search = useSearchParams();
  const slug = search?.get('slug') ?? '';
  const openTicketId = search?.get('ticket');
  const router = useRouter();
  const meQuery = usePortalMe();
  const me = meQuery.data ?? null;
  const tickets = usePortalTickets(!!me);
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    if (!meQuery.isLoading && !me) {
      router.replace(`/portal/login?slug=${encodeURIComponent(slug)}`);
    }
  }, [meQuery.isLoading, me, slug, router]);

  const q = `?slug=${encodeURIComponent(slug)}`;
  const openTicket = (id: string) => router.push(`/portal/tickets${q}&ticket=${id}`);
  const backToList = () => router.push(`/portal/tickets${q}`);

  return (
    <>
      <PortalHeader slug={slug} me={me} active="tickets" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {openTicketId ? (
          <TicketDetailView id={openTicketId} onBack={backToList} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 mb-6">
              <div>
                <h1 className="text-2xl font-bold text-gray-900 mb-1">Tickets</h1>
                <p className="text-sm text-gray-500">Requests and questions for the team, answered in one place.</p>
              </div>
              {!composing && (
                <button
                  type="button"
                  onClick={() => setComposing(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-900 text-white text-sm font-semibold px-3.5 py-2 shrink-0"
                >
                  <Plus className="w-4 h-4" /> New ticket
                </button>
              )}
            </div>

            {composing && (
              <div className="mb-6">
                <NewTicketForm
                  onDone={(id) => { setComposing(false); openTicket(id); }}
                  onCancel={() => setComposing(false)}
                />
              </div>
            )}

            {!tickets.data ? (
              <div className="rounded-xl bg-gray-100 animate-pulse h-40" />
            ) : tickets.data.length === 0 ? (
              !composing && (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
                  <div className="font-semibold text-gray-700">Need something from the team?</div>
                  <p className="mt-1 text-sm text-gray-500">Open a ticket and it lands straight on their board.</p>
                  <button
                    type="button"
                    onClick={() => setComposing(true)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-gray-900 text-white text-sm font-semibold px-3.5 py-2"
                  >
                    <Plus className="w-4 h-4" /> Open a ticket
                  </button>
                </div>
              )
            ) : (
              <ul className="space-y-2">
                {tickets.data.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => openTicket(t.id)}
                      className="w-full text-left rounded-2xl border border-gray-200 bg-white p-4 hover:border-gray-300 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-gray-900 truncate">{t.title}</span>
                        <StatusPill status={t.status} />
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-[12px] text-gray-500">
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
          </>
        )}
      </div>
    </>
  );
}

export default function PortalTicketsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-500 p-8 text-center">Loading…</div>}>
      <Inner />
    </Suspense>
  );
}
