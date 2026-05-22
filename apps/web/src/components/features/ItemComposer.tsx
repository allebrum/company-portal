'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, User, Building2, Folder, Target, Flag, Calendar, Clock,
  Sparkles, Shield, Tag, Check, Trash2, Plus, Play, Square,
  Upload, ExternalLink, Link2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import {
  useUsers, useClients, useProjects, useGoals, useTodos, useEpics,
  useCreateTodo, useUpdateTodo, useDeleteTodo,
  useCreateGoal, useUpdateGoal, useMoveGoal,
  useAddResource, useRemoveResource, useUploadGoalResource,
  useStartTimer, useStopTimer,
  type TodoRow, type GoalRow, type ChecklistItemRow, type GoalHealth,
} from '@/hooks/useResources';
import { useMyTimer } from '@/hooks/useTimer';
import { fmtTimer, PRIORITY_DOT } from '@/lib/formatters';
import { QuickAddTodo } from '@/components/features/QuickAddTodo';
import { statusesForScope, HEALTH_TONE } from '@/lib/roadmap';
import { EpicChip } from '@/components/composer/chips/EpicChip';
import { Activity, Gauge, Layers } from 'lucide-react';
import { PropertyCell } from '@/components/composer/PropertyCell';
import { Checklist } from '@/components/composer/Checklist';
import { UserChip } from '@/components/composer/chips/UserChip';
import { ClientChip } from '@/components/composer/chips/ClientChip';
import { ProjectChip } from '@/components/composer/chips/ProjectChip';
import { GoalChip } from '@/components/composer/chips/GoalChip';
import { PriorityChip } from '@/components/composer/chips/PriorityChip';
import { StatusChip } from '@/components/composer/chips/StatusChip';
import { DateChip } from '@/components/composer/chips/DateChip';
import { EstimateChip } from '@/components/composer/chips/EstimateChip';
import { CategoryChip } from '@/components/composer/chips/CategoryChip';
import { TagsChip } from '@/components/composer/chips/TagsChip';
import { VisibilityChip } from '@/components/composer/chips/VisibilityChip';
import type { ResourceKind } from '@allebrum/shared';

// ---------- types ----------

type CommonDefaults = { clientId?: string; projectId?: string };

export type ItemComposerProps =
  | {
      mode: 'todo';
      open: boolean;
      onClose: () => void;
      todo?: TodoRow | null;
      defaults?: CommonDefaults & { goalId?: string; assigneeId?: string };
    }
  | {
      mode: 'goal';
      open: boolean;
      onClose: () => void;
      goal?: GoalRow | null;
      defaults?: CommonDefaults & { ownerId?: string };
    };

// ---------- main component ----------

export function ItemComposer(props: ItemComposerProps) {
  const { mode, open, onClose } = props;
  const isEdit = mode === 'todo' ? !!props.todo : !!props.goal;
  // Stable identity of the item being edited (null in create mode). Used as
  // an effect dependency so the reset only fires on open / item change.
  const editItemId = props.mode === 'todo' ? (props.todo?.id ?? null) : (props.goal?.id ?? null);
  const toast = useToast();
  const { me } = useAuth();

  // Shared lookups (one set of hooks for everything in the composer).
  const { data: users = [] } = useUsers();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  const { data: epics = [] } = useEpics();

  // Mutations.
  const createTodo = useCreateTodo();
  const updateTodo = useUpdateTodo();
  const deleteTodo = useDeleteTodo();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const moveGoal = useMoveGoal();
  const addRes = useAddResource();
  const removeRes = useRemoveResource();
  const uploadRes = useUploadGoalResource();
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const { timer: myTimer, elapsedSec } = useMyTimer();

  // ----- state (covers both modes; we only read the fields that apply) -----
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [checklist, setChecklist] = useState<ChecklistItemRow[]>([]);

  // todo-specific
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState('');
  const [estimateMin, setEstimateMin] = useState(60);
  const [tags, setTags] = useState<string[]>([]);
  const [priv, setPriv] = useState(false);
  const [todoStatus, setTodoStatus] = useState<'open' | 'done'>('open');

  // goal-specific
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [goalCategory, setGoalCategory] = useState('Delivery');
  const [goalStatus, setGoalStatus] = useState<string>('backlog');
  const [goalHealth, setGoalHealth] = useState<GoalHealth | null>(null);
  const [goalProgress, setGoalProgress] = useState<number | null>(null);
  const [goalEpicId, setGoalEpicId] = useState<string | null>(null);

  // goal-edit nested-modal state (open a linked todo in another composer)
  const [editingTodo, setEditingTodo] = useState<TodoRow | null>(null);

  // goal-edit resource inline form + upload state
  const [rKind, setRKind] = useState<ResourceKind>('link');
  const [rTitle, setRTitle] = useState('');
  const [rUrl, setRUrl] = useState('');
  const [rMeta, setRMeta] = useState('');
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // goal-edit linked-todos inline form
  const [pickedTodoId, setPickedTodoId] = useState('');

  // ----- reset state on open -----
  useEffect(() => {
    if (!open) return;
    if (mode === 'todo') {
      const t = props.todo ?? null;
      const d = props.defaults ?? {};
      setTitle(t?.title ?? '');
      setDescription(t?.description ?? '');
      setClientId(t?.clientId ?? d.clientId ?? null);
      setProjectId(t?.projectId ?? d.projectId ?? null);
      setGoalId(t?.goalId ?? d.goalId ?? null);
      setAssigneeId(t?.assigneeId ?? d.assigneeId ?? me?.id ?? null);
      setDueDate(t?.dueDate ?? new Date().toISOString().slice(0, 10));
      setEstimateMin(t?.estimateMin ?? 60);
      setPriority(t?.priority ?? 'medium');
      setTags(t?.tags ?? []);
      setPriv(t?.private ?? false);
      setTodoStatus(t?.status ?? 'open');
      setChecklist(t?.checklist ?? []);
    } else {
      const g = props.goal ?? null;
      const d = props.defaults ?? {};
      setTitle(g?.title ?? '');
      setDescription(g?.description ?? '');
      setClientId(g?.clientId ?? d.clientId ?? null);
      setProjectId(g?.projectId ?? d.projectId ?? null);
      setOwnerId(g?.ownerId ?? d.ownerId ?? null);
      setStartDate(g?.startDate ?? '');
      setEndDate(g?.endDate ?? '');
      setPriority(g?.priority ?? 'medium');
      setGoalCategory(g?.tag ?? 'Delivery');
      setGoalStatus(g?.status ?? 'backlog');
      setChecklist(g?.checklist ?? []);
      setGoalHealth(g?.health ?? null);
      setGoalProgress(g?.progress ?? null);
      setGoalEpicId(g?.epicId ?? null);
    }
    // reset transient form-y state
    setRKind('link');
    setRTitle('');
    setRUrl('');
    setRMeta('');
    setPickedTodoId('');
    setEditingTodo(null);
    setDragging(false);
    // Only re-initialise when the modal opens or the edited item changes —
    // NOT on every parent re-render (which happens whenever a background
    // query refetches, e.g. after inline-creating a client). Depending on
    // the whole `props` object here used to wipe in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, editItemId, me?.id]);

  // ----- derived data -----
  const client = clients.find((c) => c.id === clientId) ?? null;
  const project = projects.find((p) => p.id === projectId) ?? null;
  const typeLabel = mode === 'goal' ? 'Roadmap goal' : priv ? 'Private to-do' : 'To-do';

  const linkedTodos: TodoRow[] = useMemo(() => {
    if (mode !== 'goal' || !props.goal) return [];
    return todos
      .filter((t) => t.goalId === props.goal!.id)
      .slice()
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
        const rank = (p: 'low' | 'medium' | 'high') => (p === 'high' ? 0 : p === 'medium' ? 1 : 2);
        const r = rank(a.priority) - rank(b.priority);
        if (r !== 0) return r;
        if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return 0;
      });
  }, [mode, props, todos]);

  const attachableTodos: TodoRow[] = useMemo(() => {
    if (mode !== 'goal' || !props.goal) return [];
    return todos.filter((t) => t.goalId == null && t.projectId === props.goal!.projectId);
  }, [mode, props, todos]);

  // Distinct tags across all to-dos — feeds the TagsChip autocomplete.
  const tagSuggestions = useMemo(
    () => Array.from(new Set(todos.flatMap((t) => t.tags))).sort(),
    [todos],
  );

  // ----- submit -----
  const onSave = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    try {
      if (mode === 'todo') {
        const payload = {
          title: title.trim(),
          description: description.trim() || null,
          assigneeId: priv ? me?.id ?? null : assigneeId,
          clientId,
          projectId,
          goalId: priv ? null : goalId,
          dueDate: dueDate || undefined,
          estimateMin,
          priority,
          tags,
          private: priv,
          checklist,
        };
        if (props.todo) {
          await updateTodo.mutateAsync({
            id: props.todo.id,
            patch: { ...payload, status: todoStatus },
          });
          toast.success('To-do updated');
        } else {
          await createTodo.mutateAsync(payload);
          toast.success('To-do created');
        }
      } else {
        if (!clientId || !projectId) {
          toast.error('Pick a client and project');
          return;
        }
        const payload = {
          clientId,
          projectId,
          title: title.trim(),
          description: description.trim() || null,
          status: goalStatus,
          ownerId,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          priority,
          tag: goalCategory,
          checklist,
          health: goalHealth,
          progress: goalProgress,
          epicId: goalEpicId,
        };
        if (props.goal) {
          await updateGoal.mutateAsync({ id: props.goal.id, patch: payload });
          toast.success('Goal updated');
        } else {
          await createGoal.mutateAsync(payload);
          toast.success('Goal created');
        }
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  // ----- todo-edit handlers (timer, delete) -----
  const isTimerOnThisTodo =
    mode === 'todo' && props.todo ? myTimer?.todoId === props.todo.id : false;

  const onToggleTimer = async () => {
    if (mode !== 'todo' || !props.todo) return;
    try {
      if (isTimerOnThisTodo) {
        await stopTimer.mutateAsync();
        toast.success('Timer stopped');
      } else {
        if (!props.todo.projectId) {
          toast.error('Add a project to this to-do to track time');
          return;
        }
        await startTimer.mutateAsync({
          projectId: props.todo.projectId,
          note: props.todo.title,
          todoId: props.todo.id,
        });
        toast.success(`Timer started — ${props.todo.title}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Timer action failed');
    }
  };

  const onDelete = async () => {
    if (mode !== 'todo' || !props.todo) return;
    if (!confirm(`Delete "${props.todo.title}"?`)) return;
    try {
      await deleteTodo.mutateAsync(props.todo.id);
      toast.success('To-do deleted');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const onMarkShipped = async () => {
    if (mode !== 'goal' || !props.goal) return;
    try {
      await moveGoal.mutateAsync({ id: props.goal.id, status: 'done' });
      toast.success('Goal shipped');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    }
  };

  // ----- goal-edit: resources upload + linked todos -----
  const onUploadFiles = async (files: File[]) => {
    if (mode !== 'goal' || !props.goal) return;
    for (const file of files) {
      try {
        await uploadRes.mutateAsync({ goalId: props.goal.id, file });
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

  const onAddResource = async () => {
    if (mode !== 'goal' || !props.goal || !rTitle.trim()) return;
    try {
      await addRes.mutateAsync({
        goalId: props.goal.id,
        input: { kind: rKind, title: rTitle.trim(), url: rUrl, meta: rMeta },
      });
      toast.success('Resource attached');
      setRTitle('');
      setRUrl('');
      setRMeta('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    }
  };

  const onAttachTodo = async () => {
    if (mode !== 'goal' || !props.goal || !pickedTodoId) return;
    try {
      await updateTodo.mutateAsync({ id: pickedTodoId, patch: { goalId: props.goal.id } });
      setPickedTodoId('');
      toast.success('To-do attached');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    }
  };

  const onDetachLinkedTodo = async (t: TodoRow) => {
    try {
      await updateTodo.mutateAsync({ id: t.id, patch: { goalId: null } });
      toast.success('Detached from goal');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to detach');
    }
  };

  const onStartLinkedTimer = async (t: TodoRow) => {
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

  // ----- shell: portal, scrim, panel, key handling -----
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        void onSave();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, title, description, /* deps for onSave */ clientId, projectId, mode]);

  if (!open || !mounted) return null;

  const submitting =
    createTodo.isPending || updateTodo.isPending || createGoal.isPending || updateGoal.isPending;

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[120] flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
      >
        <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden">
          {/* HEADER BAND */}
          <header className="px-8 pt-6 pb-6 border-b border-gray-100">
            <div className="flex items-center gap-3 flex-wrap">
              {mode === 'todo' ? (
                <StatusChip mode="todo" value={todoStatus} onChange={setTodoStatus} />
              ) : (
                <StatusChip
                  mode="goal"
                  value={goalStatus}
                  onChange={setGoalStatus}
                  statuses={statusesForScope(projectId ? { kind: 'project', id: projectId } : { kind: 'all' }, projects)}
                />
              )}
              <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap min-w-0">
                {client && (
                  <>
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ backgroundColor: client.color }}
                    />
                    <span className="truncate">{client.name}</span>
                  </>
                )}
                {client && project && <span className="text-gray-300">/</span>}
                {project && <span className="truncate">{project.name}</span>}
                {project?.code && (
                  <span className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px] font-mono">
                    {project.code}
                  </span>
                )}
              </div>
              <div className="flex-1" />
              <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">
                {typeLabel}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={mode === 'goal' ? 'What are we shipping?' : 'What needs to happen?'}
              className="w-full mt-5 text-3xl font-bold text-gray-900 placeholder:text-gray-300 bg-transparent outline-none leading-tight"
            />

            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Add a description — context, links, acceptance criteria. Anything that helps the next person pick this up cold."
              className="w-full mt-3 resize-y border-0 bg-transparent px-0 py-0 shadow-none focus:ring-0 focus:outline-none text-[15px] leading-relaxed text-gray-700 placeholder:text-gray-400"
            />
          </header>

          {/* BODY */}
          <div className="px-8 py-6 space-y-6 flex-1 min-h-0 overflow-y-auto">
            {/* Properties grid */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-5">
              <PropertyCell icon={User} label={priv ? 'Owner' : mode === 'goal' ? 'Owner' : 'Assignee'}>
                <UserChip
                  value={mode === 'goal' ? ownerId : assigneeId}
                  users={users}
                  onChange={mode === 'goal' ? setOwnerId : setAssigneeId}
                  placeholder="Unassigned"
                />
              </PropertyCell>

              <PropertyCell icon={Building2} label="Client">
                <ClientChip
                  value={clientId}
                  clients={clients}
                  onChange={(v) => {
                    setClientId(v);
                    setProjectId(null);
                    if (mode === 'todo') setGoalId(null);
                  }}
                />
              </PropertyCell>

              <PropertyCell icon={Folder} label="Project">
                <ProjectChip
                  value={projectId}
                  clientId={clientId}
                  projects={projects}
                  onChange={(v) => {
                    setProjectId(v);
                    if (mode === 'todo') setGoalId(null);
                  }}
                />
              </PropertyCell>

              {mode === 'todo' && !priv && (
                <PropertyCell icon={Target} label="Goal">
                  <GoalChip value={goalId} projectId={projectId} goals={goals} onChange={setGoalId} />
                </PropertyCell>
              )}

              <PropertyCell icon={Flag} label="Priority">
                <PriorityChip value={priority} onChange={setPriority} />
              </PropertyCell>

              {mode === 'goal' ? (
                <PropertyCell icon={Calendar} label="Timeline" span={2}>
                  <DateChip value={startDate} onChange={setStartDate} placeholder="Start" />
                  <span className="text-gray-300 px-0.5">→</span>
                  <DateChip value={endDate} onChange={setEndDate} placeholder="Target" />
                </PropertyCell>
              ) : (
                <PropertyCell icon={Calendar} label="Due">
                  <DateChip value={dueDate} onChange={setDueDate} />
                </PropertyCell>
              )}

              {mode === 'todo' && (
                <PropertyCell icon={Clock} label="Estimate">
                  <EstimateChip value={estimateMin} onChange={setEstimateMin} />
                </PropertyCell>
              )}

              {mode === 'goal' && (
                <PropertyCell icon={Sparkles} label="Category">
                  <CategoryChip value={goalCategory} onChange={setGoalCategory} />
                </PropertyCell>
              )}

              {mode === 'goal' && (
                <PropertyCell icon={Layers} label="Epic">
                  <EpicChip value={goalEpicId} projectId={projectId} clientId={clientId} epics={epics} onChange={setGoalEpicId} />
                </PropertyCell>
              )}

              {mode === 'goal' && (
                <PropertyCell icon={Activity} label="Health">
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
                    {(['on-track', 'at-risk', 'off-track'] as const).map((h, i) => {
                      const active = goalHealth === h;
                      return (
                        <button
                          key={h}
                          type="button"
                          onClick={() => setGoalHealth(active ? null : h)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 font-medium transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${active ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                        >
                          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: active ? '#fff' : HEALTH_TONE[h]!.color }} />
                          {HEALTH_TONE[h]!.label}
                        </button>
                      );
                    })}
                  </div>
                </PropertyCell>
              )}

              {mode === 'goal' && (
                <PropertyCell icon={Gauge} label="Progress">
                  <div className="inline-flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={goalProgress ?? ''}
                      onChange={(e) => setGoalProgress(e.target.value === '' ? null : Math.max(0, Math.min(100, Number(e.target.value))))}
                      placeholder="auto"
                      className="w-20 px-2 py-1.5 text-sm border border-gray-200 rounded-lg outline-none focus:border-brand-400"
                    />
                    <span className="text-xs text-gray-400">{goalProgress == null ? 'rolled up from to-dos' : '% override'}</span>
                  </div>
                </PropertyCell>
              )}

              {mode === 'todo' && (
                <PropertyCell icon={Tag} label="Tags" span={2}>
                  <TagsChip value={tags} onChange={setTags} suggestions={tagSuggestions} />
                </PropertyCell>
              )}

              {mode === 'todo' && (
                <PropertyCell icon={Shield} label="Visibility">
                  <VisibilityChip
                    value={priv}
                    onChange={(v) => {
                      setPriv(v);
                      if (v && me?.id) setAssigneeId(me.id);
                    }}
                  />
                </PropertyCell>
              )}
            </div>

            {/* Checklist */}
            <SectionHeader icon={Check} title="Checklist" count={checklist.length || undefined} />
            <Checklist items={checklist} onChange={setChecklist} />

            {/* Goal-edit sections: Resources + Linked to-dos */}
            {mode === 'goal' && props.goal && (
              <>
                <SectionHeader icon={Upload} title="Resources" count={props.goal.resources.length || undefined} />

                {/* Drag-drop upload zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length) void onUploadFiles(files);
                  }}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-lg p-4 text-center text-sm cursor-pointer transition-colors ${
                    dragging
                      ? 'border-brand-500 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Upload className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                  {uploadRes.isPending ? 'Uploading…' : 'Drop files here, or click to upload'}
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Goes straight to the project's Drive folder.
                  </div>
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

                {/* Attached resources */}
                <ul className="space-y-1">
                  {props.goal.resources.length === 0 && (
                    <li className="text-sm text-gray-500">No resources yet.</li>
                  )}
                  {props.goal.resources.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-sm py-1">
                      <span className="flex-1 min-w-0 truncate">
                        {r.url ? (
                          <a
                            href={r.url}
                            target="_blank"
                            rel="noreferrer"
                            className="hover:text-brand-700"
                          >
                            {r.title}
                          </a>
                        ) : (
                          r.title
                        )}
                        <span className="text-gray-400 ml-1">({r.kind})</span>
                      </span>
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-gray-400 hover:text-brand-700"
                          aria-label="Open"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await removeRes.mutateAsync({ goalId: props.goal!.id, resourceId: r.id });
                            toast.success('Resource removed');
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : 'Failed');
                          }
                        }}
                        className="text-gray-300 hover:text-red-600"
                        aria-label="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>

                {/* URL-bookmark add row */}
                <details className="border border-gray-100 rounded-lg">
                  <summary className="cursor-pointer px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg">
                    Attach a URL or external link
                  </summary>
                  <div className="grid grid-cols-2 gap-2 p-3 pt-1">
                    <select
                      value={rKind}
                      onChange={(e) => setRKind(e.target.value as ResourceKind)}
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-brand-400"
                    >
                      <option value="link">Web link</option>
                      <option value="figma">Figma file</option>
                      <option value="drive-doc">Google Doc</option>
                      <option value="drive-sheet">Google Sheet</option>
                      <option value="drive-folder">Drive folder</option>
                      <option value="github">GitHub</option>
                      <option value="key">Encrypted key</option>
                      <option value="note">Note</option>
                    </select>
                    <input
                      value={rTitle}
                      onChange={(e) => setRTitle(e.target.value)}
                      placeholder="Title"
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-brand-400"
                    />
                    <input
                      value={rUrl}
                      onChange={(e) => setRUrl(e.target.value)}
                      placeholder="URL"
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-brand-400"
                    />
                    <input
                      value={rMeta}
                      onChange={(e) => setRMeta(e.target.value)}
                      placeholder="Meta (optional)"
                      className="px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-brand-400"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onAddResource}
                      disabled={!rTitle.trim() || addRes.isPending}
                    >
                      <Plus className="w-4 h-4" /> Attach
                    </Button>
                  </div>
                </details>

                {/* Linked to-dos */}
                <SectionHeader icon={Target} title="Linked to-dos" count={linkedTodos.length || undefined} />
                <ul className="space-y-1">
                  {linkedTodos.length === 0 && (
                    <li className="text-sm text-gray-500">No to-dos attached yet.</li>
                  )}
                  {linkedTodos.map((t) => {
                    const dot = PRIORITY_DOT[t.priority];
                    const running = myTimer?.todoId === t.id;
                    return (
                      <li key={t.id} className="flex items-center gap-2 text-sm py-1">
                        <span
                          className="inline-block w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: dot?.color ?? '#9ca3af' }}
                          title={dot?.label ?? ''}
                        />
                        <span
                          className={`flex-1 min-w-0 truncate ${
                            t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'
                          }`}
                        >
                          {t.title}
                        </span>
                        {t.status !== 'done' && (
                          <>
                            {running ? (
                              <button
                                type="button"
                                onClick={() => void stopTimer.mutateAsync()}
                                className="text-red-500 hover:text-red-700"
                                title="Stop timer"
                              >
                                <Square className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onStartLinkedTimer(t)}
                                disabled={!t.projectId}
                                className="text-gray-400 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
                                title={t.projectId ? 'Start timer' : 'Project required'}
                              >
                                <Play className="w-4 h-4" />
                              </button>
                            )}
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setEditingTodo(t)}
                          className="text-gray-400 hover:text-brand-700"
                          title="Open"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDetachLinkedTodo(t)}
                          className="text-gray-300 hover:text-red-600"
                          title="Detach"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>

                {/* Inline quick-create (Enter) / create-and-elaborate (⇧Enter) */}
                <QuickAddTodo
                  context={{
                    goalId: props.goal.id,
                    clientId: props.goal.clientId,
                    projectId: props.goal.projectId,
                    assigneeId: props.goal.ownerId,
                  }}
                  placeholder="Add a linked to-do — Enter, or ⇧Enter for details"
                  onElaborate={setEditingTodo}
                />
                {attachableTodos.length > 0 && (
                  <div className="flex items-center gap-2">
                    <select
                      value={pickedTodoId}
                      onChange={(e) => setPickedTodoId(e.target.value)}
                      className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-brand-400"
                    >
                      <option value="">— Attach existing to-do —</option>
                      {attachableTodos.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
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
              </>
            )}

            {/* Activity stub (edit-mode only) */}
            {isEdit && (
              <div className="pt-4 border-t border-gray-100 text-xs text-gray-400">
                Activity log coming soon.
              </div>
            )}
          </div>

          {/* FOOTER */}
          <footer className="px-8 py-4 border-t border-gray-100 flex items-center justify-between gap-2 bg-gray-50/50 rounded-b-2xl">
            <div className="flex items-center gap-2">
              {mode === 'todo' && props.todo && todoStatus !== 'done' && (
                isTimerOnThisTodo ? (
                  <Button variant="danger" onClick={onToggleTimer}>
                    <Square className="w-4 h-4" />
                    <span className="font-mono tabular-nums">{fmtTimer(elapsedSec)}</span> Stop
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    onClick={onToggleTimer}
                    disabled={!props.todo.projectId || startTimer.isPending}
                    title={
                      props.todo.projectId
                        ? 'Start timer for this task'
                        : 'Add a project to this to-do to track time'
                    }
                  >
                    <Play className="w-4 h-4" /> Start timer
                  </Button>
                )
              )}
              {mode === 'todo' && props.todo && (
                <Button variant="ghost" onClick={onDelete}>
                  <Trash2 className="w-4 h-4" /> Delete
                </Button>
              )}
              {mode === 'goal' && props.goal && goalStatus !== 'done' && (
                <Button variant="outline" onClick={onMarkShipped}>
                  <Check className="w-4 h-4" /> Mark shipped
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 hidden sm:inline">⌘ Enter to save</span>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" onClick={onSave} disabled={!title.trim() || submitting}>
                <Check className="w-4 h-4" />
                {isEdit ? 'Save changes' : mode === 'goal' ? 'Create goal' : 'Create to-do'}
              </Button>
            </div>
          </footer>
        </div>
      </div>

      {/* Nested composer: opening a linked to-do from a goal modal */}
      {mode === 'goal' && editingTodo && (
        <ItemComposer
          mode="todo"
          open={!!editingTodo}
          todo={editingTodo}
          onClose={() => setEditingTodo(null)}
        />
      )}
    </>,
    document.body,
  );
}

// ---------- small inline section header ----------

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Check;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-1.5 pt-2 border-t border-gray-100 mt-2">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">
        {title}
      </span>
      {typeof count === 'number' && (
        <span className="text-[11px] font-semibold text-gray-400">· {count}</span>
      )}
    </div>
  );
}

