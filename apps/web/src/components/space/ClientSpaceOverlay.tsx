'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Layers, Target, CheckSquare, FileText, Play, Square,
  Upload, ExternalLink, Trash2, Link2, Plus, FolderOpen,
} from 'lucide-react';
import { useSpace } from '@/contexts/SpaceContext';
import { useSpaceData, useUpdateSpaceFiles } from '@/hooks/useSpace';
import { useAuth } from '@/hooks/useAuth';
import {
  useGoals, useTodos, useUsers, useProjects, useEpics, useCreateGoal, useCreateTodo,
  useUpdateGoal, useUpdateTodo, useStartTimer, useStopTimer,
  type GoalRow, type TodoRow, type ProjectRow, type ClientRow,
} from '@/hooks/useResources';
import { useDriveStatus, driveConnectUrl } from '@/hooks/useDrive';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useMyTimer } from '@/hooks/useTimer';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Avatar } from '@/components/ui/Avatar';
import { fmtTimer, parseLocalDate, PRIORITY_DOT } from '@/lib/formatters';
import { rollupProgress, HEALTH_TONE } from '@/lib/roadmap';
import type { SpaceFile } from '@allebrum/shared';
import type { Scope } from '@/lib/roadmap';
import { NotesTab } from './NotesTab';
import { EmbedDialog, type EmbedDialogValue } from './pickers/EmbedDialog';

// Narrowed scope (the overlay never opens for 'all').
type OpenScope = Exclude<Scope, { kind: 'all' }>;

type TabKey = 'notes' | 'goals' | 'todos' | 'files';

/**
 * The full-screen Client/Project Space overlay.
 *
 * Mounted unconditionally inside AuthGate's authenticated branch; renders
 * null when `openScope` is null. Composed of:
 *   - SpaceHeader   — scope avatar, breadcrumb, title, header timer, close
 *   - SpaceTabs     — Notes / Goals / To-dos / Files
 *   - ProjectsStrip — only on client scope
 *   - Body          — active tab content
 *
 * ESC closes unless a nested popover/dialog is open (children register via
 * the `data-space-modal-open` body attribute they own).
 */
export function ClientSpaceOverlay() {
  const { openScope, closeSpace } = useSpace();
  const data = useSpaceData(openScope);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [tab, setTab] = useState<TabKey>('notes');
  // Reset to Notes tab whenever the scope changes (e.g. client → project hop).
  useEffect(() => {
    setTab('notes');
  }, [openScope?.kind === 'client' || openScope?.kind === 'project' ? openScope.id : null]);

  useEffect(() => {
    if (!openScope) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A nested popover/dialog can claim ESC by setting this attribute.
      if (document.body.hasAttribute('data-space-modal-open')) return;
      closeSpace();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openScope, closeSpace]);

  if (!openScope || openScope.kind === 'all' || !mounted) return null;
  const narrowed: OpenScope = openScope;

  if (data.loading || !data.clientId) {
    // While the client/project rows are still being fetched on first open,
    // render a minimal scaffold so the overlay doesn't flash empty.
    return createPortal(
      <div className="fixed inset-0 z-[200] bg-white grid place-items-center text-gray-400 text-sm">
        Loading space…
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] bg-white flex flex-col"
      data-screen-label="Project Space"
      role="dialog"
      aria-modal="true"
    >
      <SpaceHeader scope={narrowed} data={data} onClose={closeSpace} />
      <SpaceTabs tab={tab} onTab={setTab} data={data} />
      {narrowed.kind === 'client' && data.client && (
        <ProjectsStrip client={data.client} />
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          {tab === 'notes' && <NotesTab scope={narrowed} />}
          {tab === 'goals' && (
            <GoalsTab scope={narrowed} clientId={data.clientId} projectId={data.projectId} />
          )}
          {tab === 'todos' && (
            <TodosTab scope={narrowed} clientId={data.clientId} projectId={data.projectId} />
          )}
          {tab === 'files' && (
            <FilesTab scope={narrowed} data={data} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ============================================================================
// Header
// ============================================================================

function SpaceHeader({
  scope,
  data,
  onClose,
}: {
  scope: OpenScope;
  data: ReturnType<typeof useSpaceData>;
  onClose: () => void;
}) {
  const { openSpace } = useSpace();
  const { client, project } = data;
  const title = scope.kind === 'project' ? project?.name ?? 'Project' : client?.name ?? 'Client';
  const initials = (client?.name ?? '?').slice(0, 2).toUpperCase();
  return (
    <header className="px-6 py-4 border-b border-gray-100 flex items-center gap-4">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-base font-bold shadow-md shrink-0"
        style={{ backgroundColor: client?.color ?? '#9333ea' }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-400 flex items-center gap-1.5">
          <span>Project space</span>
          <span className="text-gray-300">›</span>
          {scope.kind === 'project' && client ? (
            <button
              type="button"
              onClick={() => openSpace({ kind: 'client', id: client.id })}
              className="hover:text-brand-700"
              title={`Back to ${client.name}'s space`}
            >
              {client.name}
            </button>
          ) : (
            <span>{client?.name ?? '—'}</span>
          )}
          {scope.kind === 'project' && project && (
            <>
              <span className="text-gray-300">›</span>
              <span>{project.name}</span>
            </>
          )}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 leading-tight truncate">{title}</h1>
      </div>
      <SpaceHeaderTimer data={data} />
      <button
        type="button"
        onClick={onClose}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-gray-500 hover:text-gray-900 px-2 py-1.5 rounded-lg hover:bg-gray-100"
        title="Close space (ESC)"
      >
        ESC Close
      </button>
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
    </header>
  );
}

function SpaceHeaderTimer({ data }: { data: ReturnType<typeof useSpaceData> }) {
  const { timer, elapsedSec } = useMyTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const toast = useToast();
  const { data: projects = [] } = useProjects();

  // The header timer "applies to scope" when the running timer's projectId
  // matches the current scope. For client scope, any of the client's
  // projects counts as "in scope".
  const inScope = useMemo(() => {
    if (!timer || !timer.projectId) return false;
    if (data.projectId) return timer.projectId === data.projectId;
    if (data.clientId) {
      const p = projects.find((x) => x.id === timer.projectId);
      return p?.clientId === data.clientId;
    }
    return false;
  }, [timer, data.projectId, data.clientId, projects]);

  const onStart = async () => {
    try {
      if (data.projectId) {
        await start.mutateAsync({
          projectId: data.projectId,
          note: `Working on ${data.project?.name ?? ''}`,
        });
      } else if (data.clientId) {
        // Client scope — pick the first project if there's exactly one, else
        // bail with a hint (the user can use a /timer block in Notes for a
        // proper picker; the header is intentionally one-click).
        const clientProjects = projects.filter((p) => p.clientId === data.clientId);
        if (clientProjects.length === 1) {
          await start.mutateAsync({
            projectId: clientProjects[0]!.id,
            note: `Working on ${data.client?.name ?? ''}`,
          });
        } else {
          toast.error('Pick a project — multiple projects in this client');
          return;
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start timer');
    }
  };

  if (inScope && timer) {
    return (
      <button
        type="button"
        onClick={() => stop.mutate()}
        className="inline-flex items-center gap-2 rounded-full bg-red-600 hover:bg-red-700 px-3 py-1.5 text-white font-semibold text-sm shadow-md"
        title="Stop timer"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
        </span>
        <span className="font-mono tabular-nums">{fmtTimer(elapsedSec)}</span>
        <Square className="w-3.5 h-3.5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onStart}
      disabled={start.isPending}
      className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 px-3 py-1.5 text-white font-semibold text-sm shadow-md disabled:opacity-60"
      title="Start a timer for this space"
    >
      <Play className="w-3.5 h-3.5" />
      Start timer
    </button>
  );
}

// ============================================================================
// Tabs
// ============================================================================

function SpaceTabs({
  tab,
  onTab,
  data,
}: {
  tab: TabKey;
  onTab: (t: TabKey) => void;
  data: ReturnType<typeof useSpaceData>;
}) {
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  const scopedGoals = goals.filter((g) => goalInScope(g, data));
  const scopedOpenTodos = todos.filter((t) => todoInScope(t, data) && t.status === 'open');
  const filesCount = data.spaceFiles.length;

  const Tab = ({ k, label, count, icon: Icon }: { k: TabKey; label: string; count?: number; icon: typeof Target }) => (
    <button
      type="button"
      onClick={() => onTab(k)}
      className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 transition-colors ${
        tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-900'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {typeof count === 'number' && (
        <span className={`ml-1 text-[10px] font-bold rounded-full px-1.5 ${tab === k ? 'bg-brand-100 text-brand-800' : 'bg-gray-100 text-gray-500'}`}>
          {count}
        </span>
      )}
    </button>
  );

  return (
    <div className="px-6 border-b border-gray-100 flex items-center gap-1">
      <Tab k="notes" label="Notes" icon={FileText} />
      <Tab k="goals" label="Goals" icon={Target} count={scopedGoals.length} />
      <Tab k="todos" label="To-dos" icon={CheckSquare} count={scopedOpenTodos.length} />
      <Tab k="files" label="Files" icon={Upload} count={filesCount} />
      <div className="ml-auto text-[11px] text-gray-400 italic">
        Auto-linked to <span className="font-semibold text-gray-600">{data.client?.name ?? '—'}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Projects strip (client scope)
// ============================================================================

function ProjectsStrip({ client }: { client: ClientRow }) {
  const { openSpace } = useSpace();
  const { data: projects = [] } = useProjects();
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();

  const clientProjects = projects.filter((p) => p.clientId === client.id);
  if (clientProjects.length === 0) return null;

  return (
    <div className="px-6 py-3 border-b border-gray-100 bg-gray-50/40">
      <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400 mb-2">
        Projects · {clientProjects.length}
        <span className="ml-2 text-gray-400 normal-case tracking-normal font-normal italic">Click to open this project's own space</span>
      </div>
      <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
        {clientProjects.map((p) => {
          const projGoals = goals.filter((g) => g.projectId === p.id);
          const openTodos = todos.filter((t) => t.projectId === p.id && t.status === 'open').length;
          const avgProgress = projGoals.length
            ? Math.round(projGoals.reduce((s, g) => s + rollupProgress(g, todos), 0) / projGoals.length)
            : 0;
          const hasCustomWorkflow = !!p.statuses && p.statuses.length > 0;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => openSpace({ kind: 'project', id: p.id })}
              className="text-left bg-white border border-gray-200 rounded-xl px-3 py-2.5 hover:border-brand-300 hover:shadow-md transition-all w-64 shrink-0"
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {(p.code || p.name).slice(0, 2).toUpperCase()}
                </span>
                <span className="text-sm font-semibold text-gray-900 truncate flex-1 min-w-0">{p.name}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-0.5"><Target className="w-3 h-3" />{projGoals.length}</span>
                <span className="inline-flex items-center gap-0.5"><CheckSquare className="w-3 h-3" />{openTodos}</span>
                {hasCustomWorkflow && (
                  <span className="inline-flex items-center gap-0.5 text-amber-700"><span className="w-1.5 h-1.5 bg-amber-500 rounded-full" />Custom</span>
                )}
                <span className="ml-auto tabular-nums">{avgProgress}%</span>
              </div>
              <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full" style={{ width: `${avgProgress}%`, backgroundColor: p.color }} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// Goals tab
// ============================================================================

function goalInScope(g: GoalRow, data: ReturnType<typeof useSpaceData>): boolean {
  if (data.projectId) return g.projectId === data.projectId;
  if (data.clientId) return g.clientId === data.clientId;
  return false;
}

function GoalsTab({
  scope,
  clientId,
  projectId,
}: {
  scope: { kind: 'client' | 'project'; id: string };
  clientId: string;
  projectId: string | null;
}) {
  const { data: goals = [] } = useGoals();
  const { data: projects = [] } = useProjects();
  const { data: todos = [] } = useTodos();
  const { data: users = [] } = useUsers();
  const create = useCreateGoal();
  const { me } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState('');

  const scopedGoals = goals.filter((g) =>
    projectId ? g.projectId === projectId : g.clientId === clientId,
  );
  const inflight = scopedGoals.filter((g) => g.status !== 'done' && g.health !== 'done');
  const shipped = scopedGoals.filter((g) => g.status === 'done' || g.health === 'done');

  // Default projectId for client-scope creation: the client's first project.
  const defaultProjectId = projectId ?? projects.find((p) => p.clientId === clientId)?.id ?? null;

  const onCreate = async () => {
    if (!title.trim() || !defaultProjectId) return;
    try {
      await create.mutateAsync({
        clientId,
        projectId: defaultProjectId,
        title: title.trim(),
        ownerId: me?.id ?? null,
        priority: 'medium',
        tag: 'Delivery',
        health: 'on-track',
        progress: 0,
      });
      setTitle('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create goal');
    }
  };

  return (
    <div className="space-y-5">
      <div className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 hover:border-brand-300 transition-colors">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-brand-600" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void onCreate()}
            placeholder="Add a goal for this space…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400"
            disabled={!defaultProjectId}
          />
          <Button variant="primary" size="sm" onClick={onCreate} disabled={!title.trim() || !defaultProjectId || create.isPending}>
            <Plus className="w-3.5 h-3.5" /> Add ↵
          </Button>
        </div>
        {!defaultProjectId && (
          <div className="text-[11px] text-amber-700 mt-1">
            This client has no projects yet — create one first.
          </div>
        )}
      </div>

      <Section title="In flight" count={inflight.length}>
        {inflight.length === 0 ? (
          <Empty icon={Target} hint="No goals in flight for this scope yet." />
        ) : (
          <div className="space-y-2">
            {inflight.map((g) => (
              <SpaceGoalCard key={g.id} goal={g} todos={todos} users={users} />
            ))}
          </div>
        )}
      </Section>

      {shipped.length > 0 && (
        <Section title="Shipped" count={shipped.length}>
          <div className="space-y-2">
            {shipped.map((g) => (
              <SpaceGoalCard key={g.id} goal={g} todos={todos} users={users} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function SpaceGoalCard({ goal, todos, users }: { goal: GoalRow; todos: TodoRow[]; users: any[] }) {
  const owner = users.find((u) => u.id === goal.ownerId);
  const pct = rollupProgress(goal, todos);
  const linked = todos.filter((t) => t.goalId === goal.id);
  const doneCount = linked.filter((t) => t.status === 'done').length;
  return (
    <div className="bg-white border border-gray-200 hover:border-brand-300 hover:shadow-sm transition-all rounded-xl p-3 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{goal.title}</div>
        <div className="mt-1.5 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1 text-[11px] text-gray-500 flex items-center gap-2">
          <span className="tabular-nums">{pct}%</span>
          {linked.length > 0 && <span>· {doneCount}/{linked.length} to-dos</span>}
          {goal.health && (
            <span className="inline-flex items-center gap-1">
              · <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: HEALTH_TONE[goal.health]?.color }} />
              {HEALTH_TONE[goal.health]?.label}
            </span>
          )}
          <span className="ml-1 italic text-gray-400">· Auto-linked</span>
        </div>
      </div>
      {owner && <Avatar user={owner} size={28} />}
    </div>
  );
}

// ============================================================================
// To-dos tab
// ============================================================================

function todoInScope(t: TodoRow, data: ReturnType<typeof useSpaceData>): boolean {
  if (data.projectId) return t.projectId === data.projectId;
  if (data.clientId) return t.clientId === data.clientId;
  return false;
}

function TodosTab({
  scope,
  clientId,
  projectId,
}: {
  scope: { kind: 'client' | 'project'; id: string };
  clientId: string;
  projectId: string | null;
}) {
  const { data: todos = [] } = useTodos();
  const create = useCreateTodo();
  const { me } = useAuth();
  const toast = useToast();
  const [title, setTitle] = useState('');

  const scopedTodos = todos.filter((t) =>
    projectId ? t.projectId === projectId : t.clientId === clientId,
  );
  const open = scopedTodos.filter((t) => t.status === 'open');
  const done = scopedTodos.filter((t) => t.status === 'done');

  const onCreate = async () => {
    if (!title.trim()) return;
    try {
      await create.mutateAsync({
        title: title.trim(),
        clientId,
        projectId: projectId ?? null,
        assigneeId: me?.id ?? null,
        priority: 'medium',
        tags: [],
      });
      setTitle('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create to-do');
    }
  };

  return (
    <div className="space-y-5">
      <div className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-3 hover:border-brand-300 transition-colors">
        <div className="flex items-center gap-2">
          <Plus className="w-4 h-4 text-brand-600" />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void onCreate()}
            placeholder="Add a to-do for this space…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400"
          />
          <Button variant="primary" size="sm" onClick={onCreate} disabled={!title.trim() || create.isPending}>
            Add ↵
          </Button>
        </div>
      </div>

      <Section title="Open" count={open.length}>
        {open.length === 0 ? (
          <Empty icon={CheckSquare} hint="No open to-dos for this scope yet." />
        ) : (
          <div className="space-y-2">
            {open.map((t) => (
              <SpaceTodoCard key={t.id} todo={t} />
            ))}
          </div>
        )}
      </Section>

      {done.length > 0 && (
        <Section title="Done" count={done.length}>
          <div className="space-y-1.5">
            {done.map((t) => (
              <SpaceTodoCard key={t.id} todo={t} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function SpaceTodoCard({ todo }: { todo: TodoRow }) {
  const update = useUpdateTodo();
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const { timer, elapsedSec } = useMyTimer();
  const toast = useToast();
  const running = timer?.todoId === todo.id;
  const isDone = todo.status === 'done';
  const dot = PRIORITY_DOT[todo.priority];

  const toggleDone = () => {
    void update.mutateAsync({
      id: todo.id,
      patch: { status: isDone ? 'open' : 'done' },
    });
  };

  const startStop = async () => {
    try {
      if (running) {
        await stopTimer.mutateAsync();
      } else {
        await startTimer.mutateAsync({
          projectId: todo.projectId ?? null,
          note: todo.title,
          todoId: todo.id,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Timer action failed');
    }
  };

  return (
    <div className={`rounded-xl border px-3 py-2.5 flex items-center gap-3 transition-colors ${
      running
        ? 'bg-red-50 border-red-300'
        : isDone
          ? 'bg-gray-50 border-gray-100'
          : 'bg-white border-gray-200 hover:border-brand-300'
    }`}>
      <input
        type="checkbox"
        checked={isDone}
        onChange={toggleDone}
        className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot?.color }} />
      <div className={`flex-1 min-w-0 text-sm ${isDone ? 'line-through text-gray-400' : 'text-gray-800'}`}>
        {todo.title}
        <div className="text-[11px] text-gray-400 italic">
          Auto-linked
          {todo.loggedMin > 0 && <span> · {(todo.loggedMin / 60).toFixed(1)}h logged</span>}
          {running && <span className="text-red-600 font-semibold not-italic"> · {fmtTimer(elapsedSec)}</span>}
        </div>
      </div>
      {!isDone && (
        <button
          type="button"
          onClick={startStop}
          className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1 border transition-colors ${
            running
              ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
              : 'border-gray-200 text-gray-600 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200'
          }`}
        >
          {running ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          {running ? 'Stop' : 'Start'}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Files tab
// ============================================================================

function FilesTab({
  scope,
  data,
}: {
  scope: { kind: 'client' | 'project'; id: string };
  data: ReturnType<typeof useSpaceData>;
}) {
  const { data: driveStatus } = useDriveStatus();
  const { data: goals = [] } = useGoals();
  const { data: projects = [] } = useProjects();
  const { enqueue } = useUploadManager();
  const setFiles = useUpdateSpaceFiles(scope);
  const toast = useToast();
  const { me } = useAuth();
  const [dragging, setDragging] = useState(false);
  const [embedOpen, setEmbedOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drive folder for this scope — used purely for the "no folder yet" UX
  // gate. The server-side `uploadSpaceFile` will lazy-create the folder
  // via `ensureClientFolder` / `ensureProjectFolder` if it's still null,
  // so we no longer need it for the upload call itself.
  const folderId = data.project?.driveFolderId ?? data.client?.driveFolderId ?? null;
  const driveConnected = !!driveStatus?.connected;

  // Files registered directly in this Space.
  const inSpace = data.spaceFiles;
  // Files attached to in-scope goals (via the existing goalResources path).
  const attachedToGoals = useMemo(() => {
    const scoped = goals.filter((g) => goalInScope(g, data));
    return scoped.flatMap((g) =>
      (g.resources ?? []).map((r) => ({ goal: g, resource: r })),
    );
  }, [goals, data]);
  // At CLIENT scope only: aggregate files from every project under this
  // client so a teammate viewing the client space sees uploads made in
  // sub-project spaces too. The Media dashboard already surfaces these
  // (it walks the folder tree); this surfaces them in the right scope-
  // local UI as well.
  const inSubProjects = useMemo(() => {
    if (scope.kind !== 'client') return [];
    return projects
      .filter((p) => p.clientId === scope.id)
      .flatMap((p) =>
        (p.spaceFiles ?? []).map((file) => ({ project: p, file })),
      );
  }, [scope, projects]);

  // Hand the file(s) to the app-level UploadManager — it owns the queue,
  // concurrency, progress, and per-file errors. The FilesTab no longer
  // awaits or surfaces individual upload results; the tray (mounted in
  // AuthGate) renders them and survives Space-overlay teardown.
  const onUploadFiles = (files: File[]) => {
    if (files.length === 0) return;
    if (!driveConnected) {
      toast.error('Connect Google Drive first');
      return;
    }
    const scopeLabel =
      scope.kind === 'project'
        ? `${data.project?.name ?? 'Project'}${data.client?.name ? ` · ${data.client.name}` : ''}`
        : data.client?.name ?? 'Client';
    enqueue({
      target: { kind: 'space', scopeKind: scope.kind, scopeId: scope.id },
      scopeLabel,
      files,
    });
    toast.success(`${files.length} file${files.length === 1 ? '' : 's'} queued`);
  };

  const onPasteLink = async (v: EmbedDialogValue) => {
    const newFile: SpaceFile = {
      id: crypto.randomUUID(),
      kind: guessKind(v.url),
      title: v.title || v.url,
      url: v.url,
      meta: 'External link',
      source: 'files',
      addedBy: me?.id ?? '',
      addedAt: new Date().toISOString().slice(0, 10),
    };
    if (inSpace.some((f) => f.url === v.url)) {
      toast.error('Already attached');
      return;
    }
    await setFiles([...inSpace, newFile]);
    toast.success('Link attached');
  };

  const onRemove = async (id: string) => {
    await setFiles(inSpace.filter((f) => f.id !== id));
  };

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          if (!driveConnected) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!driveConnected) return;
          onUploadFiles(Array.from(e.dataTransfer.files));
        }}
        className={`rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
          driveConnected
            ? dragging
              ? 'border-brand-500 bg-brand-50'
              : 'border-gray-200 hover:border-brand-300'
            : 'border-amber-200 bg-amber-50/40'
        }`}
      >
        <Upload className="w-5 h-5 mx-auto mb-1.5 text-gray-400" />
        <div className="text-sm text-gray-600">
          {driveConnected ? (
            <>
              Drop files to upload, or{' '}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-brand-700 font-semibold hover:underline"
              >
                browse
              </button>
              {' '}or{' '}
              <button
                type="button"
                onClick={() => setEmbedOpen(true)}
                className="text-brand-700 font-semibold hover:underline"
              >
                paste a link
              </button>
              .
            </>
          ) : (
            <>
              <a href={driveConnectUrl} className="text-amber-700 font-semibold hover:underline">
                Connect Google Drive
              </a>{' '}
              to upload files. You can still{' '}
              <button
                type="button"
                onClick={() => setEmbedOpen(true)}
                className="text-amber-700 font-semibold hover:underline"
              >
                paste a link
              </button>
              .
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            onUploadFiles(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
      </div>

      {folderId && driveConnected && (
        <Section title="Linked Drive folder">
          <a
            href={`https://drive.google.com/drive/folders/${folderId}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2.5 hover:border-brand-300 hover:shadow-sm transition-all"
          >
            <FolderOpen className="w-5 h-5 text-brand-700" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">
                {data.project?.name ?? data.client?.name} · Drive folder
              </div>
              <div className="text-[11px] text-gray-500">Click to open in Google Drive</div>
            </div>
            <ExternalLink className="w-4 h-4 text-gray-400" />
          </a>
        </Section>
      )}

      <Section title="In this space" count={inSpace.length}>
        {inSpace.length === 0 ? (
          <Empty icon={Upload} hint="No files yet — drop one above or paste a link." />
        ) : (
          <ul className="space-y-1.5">
            {inSpace.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 hover:border-brand-300">
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0 text-sm text-gray-800 truncate hover:text-brand-700"
                  title={f.url}
                >
                  {f.title}
                </a>
                {f.source === 'notes' && (
                  <span className="text-[10px] font-bold uppercase tracking-wide bg-brand-100 text-brand-800 px-1.5 py-0.5 rounded">
                    From notes
                  </span>
                )}
                <span className="text-[11px] text-gray-400 truncate max-w-[180px]">{f.meta}</span>
                <button
                  type="button"
                  onClick={() => void onRemove(f.id)}
                  className="text-gray-300 hover:text-red-600"
                  aria-label="Remove"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {scope.kind === 'client' && inSubProjects.length > 0 && (
        <Section title="In sub-projects" count={inSubProjects.length}>
          <ul className="space-y-1.5">
            {inSubProjects.map(({ project, file }) => (
              <li
                key={`${project.id}:${file.id}`}
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 hover:border-brand-300"
              >
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0 text-sm text-gray-800 truncate hover:text-brand-700"
                  title={file.url}
                >
                  {file.title}
                </a>
                <span
                  className="text-[10px] font-bold uppercase tracking-wide bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded"
                  title={`Uploaded in ${project.name}'s space`}
                >
                  {project.name}
                </span>
                <span className="text-[11px] text-gray-400 truncate max-w-[140px]">{file.meta}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {attachedToGoals.length > 0 && (
        <Section title="Attached to goals" count={attachedToGoals.length}>
          <ul className="space-y-1.5">
            {attachedToGoals.map(({ goal, resource }) => (
              <li key={resource.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
                {resource.url ? (
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 min-w-0 text-sm text-gray-800 truncate hover:text-brand-700"
                  >
                    {resource.title}
                  </a>
                ) : (
                  <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{resource.title}</span>
                )}
                <span className="text-[11px] text-gray-500 italic truncate max-w-[200px]">
                  via {goal.title}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <EmbedDialog
        open={embedOpen}
        onClose={() => setEmbedOpen(false)}
        onSubmit={(v) => {
          void onPasteLink(v);
          setEmbedOpen(false);
        }}
        intent="file"
      />
    </div>
  );
}

function guessKind(url: string): SpaceFile['kind'] {
  try {
    const host = new URL(url).host;
    if (host.includes('figma.com')) return 'figma';
    if (host.includes('github.com')) return 'github';
    if (host.includes('docs.google.com')) {
      if (url.includes('/spreadsheets/')) return 'drive-sheet';
      return 'drive-doc';
    }
    if (host.includes('drive.google.com')) return 'drive-folder';
  } catch {
    /* fallthrough */
  }
  return 'link';
}

// ============================================================================
// Generic helpers
// ============================================================================

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">
        {title}
        {typeof count === 'number' && <span className="ml-1 text-gray-300">· {count}</span>}
      </div>
      {children}
    </div>
  );
}

function Empty({ icon: Icon, hint }: { icon: typeof Target; hint: string }) {
  return (
    <div className="text-center py-8 text-gray-400">
      <Icon className="w-6 h-6 mx-auto mb-1.5" />
      <div className="text-sm">{hint}</div>
    </div>
  );
}
