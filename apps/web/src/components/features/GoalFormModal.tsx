'use client';

import { useEffect, useRef, useState } from 'react';
import { Trash2, Plus, Play, Square, ExternalLink, Link2, Upload } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useCreateGoal,
  useUpdateGoal,
  useAddResource,
  useRemoveResource,
  useUploadGoalResource,
  useUsers,
  useClients,
  useProjects,
  useTodos,
  useCreateTodo,
  useUpdateTodo,
  useStartTimer,
  useStopTimer,
  type GoalRow,
  type TodoRow,
} from '@/hooks/useResources';
import { useMyTimer } from '@/hooks/useTimer';
import { PRIORITY_DOT } from '@/lib/formatters';
import { TodoFormModal } from '@/components/features/TodoFormModal';
import type { ResourceKind } from '@allebrum/shared';

const STATUSES: { value: GoalRow['status']; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'review', label: 'In review' },
  { value: 'done', label: 'Shipped' },
];

export function GoalFormModal({
  open,
  onClose,
  goal,
}: {
  open: boolean;
  onClose: () => void;
  goal?: GoalRow | null;
}) {
  const isEdit = !!goal;
  const toast = useToast();
  const { data: users = [] } = useUsers();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const addRes = useAddResource();
  const removeRes = useRemoveResource();
  const uploadRes = useUploadGoalResource();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const { data: todos = [] } = useTodos();
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const { timer: myTimer } = useMyTimer();

  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [status, setStatus] = useState<GoalRow['status']>('backlog');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [tag, setTag] = useState('Delivery');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [rKind, setRKind] = useState<ResourceKind>('link');
  const [rTitle, setRTitle] = useState('');
  const [rUrl, setRUrl] = useState('');
  const [rMeta, setRMeta] = useState('');

  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [pickedTodoId, setPickedTodoId] = useState('');
  const [editingTodo, setEditingTodo] = useState<TodoRow | null>(null);

  useEffect(() => {
    if (!open) return;
    if (goal) {
      setTitle(goal.title);
      setClientId(goal.clientId);
      setProjectId(goal.projectId);
      setOwnerId(goal.ownerId ?? '');
      setStatus(goal.status);
      setPriority(goal.priority);
      setTag(goal.tag);
      setStartDate(goal.startDate ?? '');
      setEndDate(goal.endDate ?? '');
    } else {
      setTitle('');
      setClientId('');
      setProjectId('');
      setOwnerId('');
      setStatus('backlog');
      setPriority('medium');
      setTag('Delivery');
      setStartDate('');
      setEndDate('');
    }
    setNewTodoTitle('');
    setPickedTodoId('');
    setEditingTodo(null);
  }, [open, goal]);

  const projectsForClient = projects.filter((p) => p.clientId === clientId);

  // Linked to-dos for this goal, sorted: open before done, then high→low
  // priority, then earliest due date first.
  const priorityRank = (p: 'low' | 'medium' | 'high') => (p === 'high' ? 0 : p === 'medium' ? 1 : 2);
  const linkedTodos: TodoRow[] = goal
    ? todos
        .filter((t) => t.goalId === goal.id)
        .slice()
        .sort((a, b) => {
          if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
          const pr = priorityRank(a.priority) - priorityRank(b.priority);
          if (pr !== 0) return pr;
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          return 0;
        })
    : [];
  // To-dos on the same project that haven't been linked to any goal yet —
  // candidates for the "Attach existing" picker.
  const attachableTodos: TodoRow[] = goal
    ? todos.filter((t) => t.goalId == null && t.projectId === goal.projectId)
    : [];

  const onSave = async () => {
    if (!title.trim() || !clientId || !projectId) {
      toast.error('Title, client and project are required');
      return;
    }
    try {
      const payload = {
        clientId,
        projectId,
        title: title.trim(),
        status,
        ownerId: ownerId || null,
        priority,
        tag,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      if (isEdit && goal) {
        await update.mutateAsync({ id: goal.id, patch: payload });
        toast.success('Goal updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Goal created');
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onAddRes = async () => {
    if (!goal || !rTitle.trim()) return;
    try {
      await addRes.mutateAsync({ goalId: goal.id, input: { kind: rKind, title: rTitle.trim(), url: rUrl, meta: rMeta } });
      toast.success('Resource attached');
      setRTitle('');
      setRUrl('');
      setRMeta('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    }
  };

  const onUploadFiles = async (files: File[]) => {
    if (!goal) return;
    for (const file of files) {
      try {
        await uploadRes.mutateAsync({ goalId: goal.id, file });
        toast.success(`Uploaded ${file.name}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Upload failed';
        toast.error(
          msg === 'drive_not_connected'
            ? `Connect Google Drive first to upload ${file.name}`
            : `${file.name}: ${msg}`,
        );
      }
    }
  };

  const onCreateLinkedTodo = async () => {
    if (!goal || !newTodoTitle.trim()) return;
    try {
      await createTodo.mutateAsync({
        title: newTodoTitle.trim(),
        goalId: goal.id,
        clientId: goal.clientId,
        projectId: goal.projectId,
        assigneeId: goal.ownerId,
        priority: 'medium',
        estimateMin: 60,
        tags: [],
        private: false,
      });
      setNewTodoTitle('');
      toast.success('To-do added');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add to-do');
    }
  };

  const onAttachTodo = async () => {
    if (!goal || !pickedTodoId) return;
    try {
      await updateTodo.mutateAsync({ id: pickedTodoId, patch: { goalId: goal.id } });
      setPickedTodoId('');
      toast.success('To-do attached');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    }
  };

  const onDetachTodo = async (t: TodoRow) => {
    try {
      await updateTodo.mutateAsync({ id: t.id, patch: { goalId: null } });
      toast.success('Detached from goal');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to detach');
    }
  };

  const onStartTodoTimer = async (t: TodoRow) => {
    if (!t.projectId) {
      toast.error('Add a project to this to-do first');
      return;
    }
    try {
      await startTimer.mutateAsync({ projectId: t.projectId, note: t.title, todoId: t.id });
      toast.success(`Timer started — ${t.title}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Timer action failed');
    }
  };

  const onStopTodoTimer = async () => {
    try {
      await stopTimer.mutateAsync();
      toast.success('Timer stopped');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to stop');
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <>
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit goal' : 'New goal'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onSave} disabled={busy}>
            {isEdit ? 'Save changes' : 'Create goal'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(''); }}>
              <option value="">— Pick a client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
              <option value="">— Pick a project —</option>
              {projectsForClient.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as GoalRow['status'])}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
          <Field label="Start"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="End"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
        <Field label="Tag"><Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Delivery, Ops, Growth…" /></Field>

        {isEdit && goal && (
          <div className="pt-2 border-t border-gray-100">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">To-dos</div>
            <ul className="space-y-1 mb-3">
              {linkedTodos.length === 0 && <li className="text-sm text-gray-500">No to-dos attached yet.</li>}
              {linkedTodos.map((t) => {
                const pri = PRIORITY_DOT[t.priority];
                const running = myTimer?.todoId === t.id;
                return (
                  <li key={t.id} className="flex items-center gap-2 text-sm py-1">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: pri?.color ?? '#9ca3af' }}
                      title={pri?.label ?? ''}
                    />
                    <span
                      className={`flex-1 truncate ${t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}
                    >
                      {t.title}
                    </span>
                    {t.status === 'done' ? (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">done</span>
                    ) : running ? (
                      <button
                        onClick={() => void onStopTodoTimer()}
                        title="Stop timer"
                        className="text-red-600 hover:text-red-700"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => void onStartTodoTimer(t)}
                        disabled={!t.projectId}
                        title={t.projectId ? 'Start timer' : 'Add a project to track time'}
                        className="text-gray-400 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <Play className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setEditingTodo(t)}
                      title="Open"
                      className="text-gray-400 hover:text-brand-700"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => void onDetachTodo(t)}
                      title="Detach from goal"
                      className="text-gray-300 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-2 mb-2">
              <Input
                value={newTodoTitle}
                onChange={(e) => setNewTodoTitle(e.target.value)}
                placeholder="New to-do title"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void onCreateLinkedTodo();
                  }
                }}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={onCreateLinkedTodo}
                disabled={!newTodoTitle.trim() || createTodo.isPending}
              >
                <Plus className="w-4 h-4" /> Add
              </Button>
            </div>
            {attachableTodos.length > 0 && (
              <div className="flex items-center gap-2">
                <Select value={pickedTodoId} onChange={(e) => setPickedTodoId(e.target.value)}>
                  <option value="">— Attach existing to-do —</option>
                  {attachableTodos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAttachTodo}
                  disabled={!pickedTodoId || updateTodo.isPending}
                >
                  <Link2 className="w-4 h-4" /> Attach
                </Button>
              </div>
            )}
          </div>
        )}

        {isEdit && goal && (
          <div className="pt-2 border-t border-gray-100">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Resources</div>

            {/* Drag-drop / click upload zone: pushes the file straight into
                the goal's project Drive folder (lazily creates client +
                project folders if missing). */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const files = Array.from(e.dataTransfer.files);
                if (files.length) void onUploadFiles(files);
              }}
              onClick={() => fileRef.current?.click()}
              className={`mb-3 border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors ${
                dragging
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Upload className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
              {uploadRes.isPending ? 'Uploading…' : 'Drop files here, or click to upload'}
              <div className="text-[11px] text-gray-400 mt-0.5">Goes straight to the project's Drive folder.</div>
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length) void onUploadFiles(files);
                  e.target.value = '';
                }}
              />
            </div>

            <ul className="space-y-1 mb-3">
              {goal.resources.length === 0 && <li className="text-sm text-gray-500">No resources yet.</li>}
              {goal.resources.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{r.title} <span className="text-gray-400">({r.kind})</span></span>
                  <button
                    onClick={async () => {
                      try {
                        await removeRes.mutateAsync({ goalId: goal.id, resourceId: r.id });
                        toast.success('Resource removed');
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed');
                      }
                    }}
                    className="text-gray-300 hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <Select value={rKind} onChange={(e) => setRKind(e.target.value as ResourceKind)}>
                <option value="link">Web link</option>
                <option value="figma">Figma file</option>
                <option value="drive-doc">Google Doc</option>
                <option value="drive-sheet">Google Sheet</option>
                <option value="drive-folder">Drive folder</option>
                <option value="github">GitHub</option>
                <option value="key">Encrypted key</option>
                <option value="note">Note</option>
              </Select>
              <Input value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="Title" />
              <Input value={rUrl} onChange={(e) => setRUrl(e.target.value)} placeholder="URL" />
              <Input value={rMeta} onChange={(e) => setRMeta(e.target.value)} placeholder="Meta (optional)" />
            </div>
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={onAddRes} disabled={!rTitle.trim() || addRes.isPending}>
                <Plus className="w-4 h-4" /> Attach resource
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
    <TodoFormModal
      open={!!editingTodo}
      onClose={() => setEditingTodo(null)}
      todo={editingTodo}
    />
    </>
  );
}
