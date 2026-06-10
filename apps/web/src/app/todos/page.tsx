'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Lock } from 'lucide-react';
import { qk } from '@/lib/queryKeys';
import { Card, Pill, Section, Empty } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Select } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import { ItemComposer } from '@/components/features/ItemComposer';
import { QuickAddTodo } from '@/components/features/QuickAddTodo';
import { TodoTimerButton } from '@/components/features/TodoTimerButton';
import {
  useTodos,
  useUsers,
  useProjects,
  useClients,
  useGoals,
  useToggleTodo,
  useDeleteTodo,
  type TodoRow,
} from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import { fmtMins, PRIORITY_DOT } from '@/lib/formatters';

export default function TodosPage() {
  const { me, can } = useAuth();
  const toast = useToast();
  const { data: todos = [] } = useTodos();
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const { data: goals = [] } = useGoals();
  const toggle = useToggleTodo();
  const remove = useDeleteTodo();
  const qc = useQueryClient();

  // Undo-able delete: the row leaves the list immediately, but the server
  // DELETE only fires after the undo window closes. "Undo" cancels the
  // timer and refetches (the row was never deleted server-side).
  const pendingDeletes = useRef(new Map<string, number>());
  const deleteWithUndo = (t: TodoRow) => {
    qc.setQueryData<TodoRow[]>(qk.todos, (prev) => prev?.filter((x) => x.id !== t.id));
    const timer = window.setTimeout(() => {
      pendingDeletes.current.delete(t.id);
      remove.mutateAsync(t.id).catch((e) => {
        void qc.invalidateQueries({ queryKey: qk.todos });
        toast.error(e instanceof Error ? e.message : 'Delete failed');
      });
    }, 5000);
    pendingDeletes.current.set(t.id, timer);
    toast.success(`Deleted "${t.title}"`, {
      durationMs: 5000,
      action: {
        label: 'Undo',
        onClick: () => {
          const h = pendingDeletes.current.get(t.id);
          if (h !== undefined) {
            window.clearTimeout(h);
            pendingDeletes.current.delete(t.id);
          }
          void qc.invalidateQueries({ queryKey: qk.todos });
        },
      },
    });
  };

  const [scope, setScope] = useState<'me' | 'all'>('me');
  const [showDone, setShowDone] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TodoRow | null>(null);

  const visible = useMemo(() => {
    let list = todos;
    if (scope === 'me' && me) list = list.filter((t) => t.assigneeId === me.id);
    if (!showDone) list = list.filter((t) => t.status !== 'done');
    return list.slice().sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      return 0;
    });
  }, [todos, scope, showDone, me]);

  // Keyboard shortcut: Cmd/Ctrl+Shift+N opens create
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'n') return;
      e.preventDefault();
      setEditing(null);
      setModalOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (t: TodoRow) => { setEditing(t); setModalOpen(true); };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">To-dos</div>
          <h1 className="text-2xl font-bold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-500">Track and assign work across the team.</p>
        </div>
        <Button variant="primary" onClick={openCreate}><Plus className="w-4 h-4" /> New to-do</Button>
      </div>

      <Card className="p-4 flex flex-wrap items-center gap-3">
        <Field label="Scope">
          <Select value={scope} onChange={(e) => setScope(e.target.value as 'me' | 'all')}>
            <option value="me">Just me</option>
            <option value="all">Everyone</option>
          </Select>
        </Field>
        <Checkbox label="Show completed" checked={showDone} onChange={setShowDone} />
        <div className="ml-auto text-sm text-gray-500">{visible.length} item{visible.length === 1 ? '' : 's'}</div>
      </Card>

      <QuickAddTodo
        context={{ assigneeId: scope === 'me' ? me?.id ?? null : null }}
        onElaborate={openEdit}
      />

      <Section>
        {visible.length === 0 ? (
          <Empty title="Nothing here" description="No matching to-dos." action={<Button variant="primary" onClick={openCreate}>New to-do</Button>} />
        ) : (
          <Card>
            <ul className="divide-y divide-gray-100">
              {visible.map((t) => {
                const u = users.find((x) => x.id === t.assigneeId);
                const proj = projects.find((p) => p.id === t.projectId);
                const cli = proj ? clients.find((c) => c.id === proj.clientId) : null;
                const goal = goals.find((g) => g.id === t.goalId);
                const pri = PRIORITY_DOT[t.priority];
                const canDelete = t.assigneeId === me?.id || can('goals.manage');
                return (
                  <li key={t.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
                    <input
                      type="checkbox"
                      checked={t.status === 'done'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={async () => {
                        try {
                          await toggle.mutateAsync(t.id);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Failed');
                        }
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    />
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pri?.color }} />
                    <button
                      type="button"
                      onClick={() => openEdit(t)}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className={`text-sm font-semibold truncate ${t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{t.title}</div>
                      <div className="text-[12px] text-gray-500 truncate flex items-center gap-2">
                        {cli && <span>{cli.name}</span>}
                        {proj && <span>· {proj.name}</span>}
                        {goal && <span>· goal: {goal.title}</span>}
                        {t.dueDate && <span>· due {t.dueDate}</span>}
                        <span>· est {fmtMins(t.estimateMin)} · logged {fmtMins(t.loggedMin)}</span>
                      </div>
                    </button>
                    {t.private && <Pill tone="purple"><Lock className="w-3 h-3" /> Private</Pill>}
                    {u && <Avatar user={u} size={24} />}
                    <TodoTimerButton todo={t} />
                    {canDelete && (
                      <button
                        onClick={() => deleteWithUndo(t)}
                        className="text-gray-400 hover:text-red-600 transition-colors p-1 -m-1"
                        title="Delete (undo available for 5s)"
                        aria-label={`Delete "${t.title}"`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </Section>

      <ItemComposer mode="todo" open={modalOpen} onClose={() => setModalOpen(false)} todo={editing} />
    </div>
  );
}
