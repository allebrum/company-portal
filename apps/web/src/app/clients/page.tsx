'use client';

import { useMemo } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Layers } from 'lucide-react';
import { Card, Section, Empty } from '@/components/ui';
import { AvatarStack, type AvatarUser } from '@/components/ui/Avatar';
import {
  useClients,
  useProjects,
  useGoals,
  useTodos,
  useEntries,
  useUsers,
  type ClientRow,
  type ProjectRow,
  type GoalRow,
  type TodoRow,
  type EntryRow,
  type UserRow,
} from '@/hooks/useResources';
import { useSpace } from '@/contexts/SpaceContext';
import type { Scope } from '@/lib/roadmap';
import { fmtMins, startOfWeek } from '@/lib/formatters';

/**
 * Top-level **Clients** directory — the canonical entry point into
 * Client/Project Spaces. Replaces the older idea of a sidebar
 * Workspaces tree; the spec records the decision to ship a flat
 * browse-and-jump destination instead.
 *
 * Every client is a card with a 4-stat strip and a projects list, and
 * every card / project row opens the F7 Space overlay via
 * `useSpace().openSpace`.
 */

const CLIENT_KIND: Record<string, { label: string; color: string }> = {
  gov: { label: 'Government', color: '#7e22ce' },
  edu: { label: 'Education', color: '#2563eb' },
  agency: { label: 'Agency', color: '#db2777' },
  finance: { label: 'Finance', color: '#0d9488' },
  internal: { label: 'Internal', color: '#4b5563' },
};
function kindFor(k: string): { label: string; color: string } {
  return CLIENT_KIND[k] ?? { label: k || 'Client', color: '#6b7280' };
}

function initials(name: string, count = 2): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, count).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default function ClientsPage() {
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  const { data: entries = [] } = useEntries();
  const { data: users = [] } = useUsers();

  const sortedClients = useMemo(
    () => [...clients].sort((a, b) => a.name.localeCompare(b.name)),
    [clients],
  );

  return (
    <div className="space-y-7">
      <div>
        <div className="eyebrow">Workspaces</div>
        <h1 className="text-3xl font-bold text-gray-900">Clients</h1>
        <p className="mt-1 text-sm text-gray-500">
          {clients.length} {clients.length === 1 ? 'client' : 'clients'} · {projects.length}{' '}
          {projects.length === 1 ? 'project' : 'projects'} · open any card to jump into its space.
        </p>
      </div>

      <RecentsRow clients={clients} projects={projects} />

      {sortedClients.length === 0 ? (
        <Empty
          title="No clients yet"
          description="Create your first client in Admin → Clients & Projects to get started."
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {sortedClients.map((c) => (
            <ClientCard
              key={c.id}
              client={c}
              projects={projects}
              goals={goals}
              todos={todos}
              entries={entries}
              users={users}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Recents row ------------------------------------------------------

function RecentsRow({ clients, projects }: { clients: ClientRow[]; projects: ProjectRow[] }) {
  const { recentSpaces, openSpace } = useSpace();
  if (recentSpaces.length === 0) return null;

  return (
    <div>
      <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400 mb-2">
        Jump back in
      </div>
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {recentSpaces.map((s) => {
          // recentSpaces only contains client | project (openSpace refuses 'all').
          const sid = 'id' in s ? s.id : '';
          const isProject = s.kind === 'project';
          const project = isProject ? projects.find((p) => p.id === sid) : null;
          const client = isProject
            ? project
              ? clients.find((c) => c.id === project.clientId)
              : null
            : clients.find((c) => c.id === sid);
          const name = isProject ? project?.name : client?.name;
          if (!name) return null;
          const color = isProject ? project?.color ?? '#6b7280' : client?.color ?? '#6b7280';
          return (
            <button
              key={`${s.kind}-${sid}`}
              type="button"
              onClick={() => openSpace(s)}
              className="shrink-0 inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white pl-1 pr-3 py-1 text-sm hover:border-brand-300 hover:shadow-sm transition-all"
            >
              <span
                className="w-6 h-6 rounded-full text-white text-[10px] font-bold flex items-center justify-center"
                style={{ backgroundColor: color }}
              >
                {initials(name, 1)}
              </span>
              <span className="font-semibold text-gray-900 truncate max-w-[140px]">{name}</span>
              <span className="text-[10px] uppercase tracking-wider font-bold text-gray-400">
                {isProject ? 'Project' : 'Client'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- Client card ------------------------------------------------------

function ClientCard({
  client,
  projects,
  goals,
  todos,
  entries,
  users,
}: {
  client: ClientRow;
  projects: ProjectRow[];
  goals: GoalRow[];
  todos: TodoRow[];
  entries: EntryRow[];
  users: UserRow[];
}) {
  const { openSpace } = useSpace();
  const kind = kindFor(client.kind);

  // All rollups in one memo — recomputes only when the relevant slices
  // for this client change. Avoids work on every todo toggle elsewhere.
  const roll = useMemo(() => {
    const cProjects = projects.filter((p) => p.clientId === client.id);
    const projectIdSet = new Set(cProjects.map((p) => p.id));
    const activeGoals = goals.filter(
      (g) => g.clientId === client.id && g.status !== 'done' && g.health !== 'done',
    );
    const openTodos = todos.filter((t) => t.clientId === client.id && t.status === 'open');
    const atRisk = goals.filter(
      (g) =>
        g.clientId === client.id && (g.health === 'at-risk' || g.health === 'off-track'),
    );
    const weekStart = startOfWeek(new Date()).getTime();
    const minThisWeek = entries.reduce((s, e) => {
      if (!e.projectId || !projectIdSet.has(e.projectId)) return s;
      if (new Date(e.startIso).getTime() < weekStart) return s;
      return s + e.durationMin;
    }, 0);
    // Unique people: union of goal owners (for goals in scope) + open-todo assignees
    const personIds = new Set<string>();
    for (const g of goals) {
      if (g.clientId === client.id && g.ownerId) personIds.add(g.ownerId);
    }
    for (const t of openTodos) {
      if (t.assigneeId) personIds.add(t.assigneeId);
    }
    const people = [...personIds]
      .map((id) => users.find((u) => u.id === id))
      .filter((u): u is UserRow => !!u);
    return { cProjects, activeGoals, openTodos, atRisk, minThisWeek, people };
  }, [client.id, projects, goals, todos, entries, users]);

  const goToClient = () => openSpace({ kind: 'client', id: client.id } as Scope);

  return (
    <Card className="overflow-hidden">
      {/* Header band */}
      <div className="flex items-start gap-3.5 p-5 pb-4">
        <button
          type="button"
          onClick={goToClient}
          className="w-11 h-11 rounded-xl text-white text-[15px] font-bold flex items-center justify-center shrink-0 shadow-sm hover:opacity-90 transition-opacity"
          style={{ backgroundColor: client.color }}
          aria-label={`Open ${client.name} space`}
        >
          {initials(client.name)}
        </button>
        <div className="flex-1 min-w-0">
          <button
            type="button"
            onClick={goToClient}
            className="text-[17px] font-bold text-gray-900 hover:text-brand-700 transition-colors truncate block max-w-full text-left"
            title={client.name}
          >
            {client.name}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-700"
              title={kind.label}
            >
              <span
                className="w-1.5 h-1.5 rounded-full inline-block"
                style={{ backgroundColor: kind.color }}
              />
              {kind.label}
            </span>
            {roll.atRisk.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
                <AlertTriangle className="w-3 h-3" />
                {roll.atRisk.length} at risk
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={goToClient}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-brand-600 to-brand-700 hover:from-brand-700 hover:to-brand-800 px-3 py-1.5 text-white font-semibold text-sm shadow-md transition-colors"
        >
          <Layers className="w-4 h-4" />
          Open space
        </button>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-4 divide-x divide-gray-100 border-y border-gray-100 bg-gray-50/60">
        <Stat label="Projects" value={roll.cProjects.length.toString()} />
        <Stat label="Active goals" value={roll.activeGoals.length.toString()} />
        <Stat label="Open to-dos" value={roll.openTodos.length.toString()} />
        <Stat
          label="This week"
          value={roll.minThisWeek > 0 ? fmtMins(roll.minThisWeek) : '—'}
        />
      </div>

      {/* Projects list */}
      <div className="p-3 space-y-0.5">
        {roll.cProjects.length === 0 ? (
          <div className="text-[12px] text-gray-400 italic px-2.5 py-2">No active projects</div>
        ) : (
          roll.cProjects.map((p) => (
            <ProjectRow key={p.id} project={p} goals={goals} todos={todos} />
          ))
        )}
      </div>

      {/* People footer */}
      {roll.people.length > 0 && (
        <div className="border-t border-gray-100 px-5 py-3 flex items-center justify-between gap-3">
          <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">
            On the account
          </div>
          <AvatarStack users={roll.people as AvatarUser[]} max={5} size={26} />
        </div>
      )}
    </Card>
  );
}

// ---- Stat cell --------------------------------------------------------

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center py-3 px-2">
      <div className="text-[19px] font-bold text-gray-900 tabular-nums leading-tight">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-widest font-semibold text-gray-400">
        {label}
      </div>
    </div>
  );
}

// ---- Project row ------------------------------------------------------

function ProjectRow({
  project,
  goals,
  todos,
}: {
  project: ProjectRow;
  goals: GoalRow[];
  todos: TodoRow[];
}) {
  const { openSpace } = useSpace();
  const projectGoals = goals.filter((g) => g.projectId === project.id);
  const openTodos = todos.filter((t) => t.projectId === project.id && t.status === 'open').length;
  const avgProgress = projectGoals.length
    ? Math.round(
        projectGoals.reduce((s, g) => s + (g.progress ?? 0), 0) / projectGoals.length,
      )
    : 0;

  return (
    <button
      type="button"
      onClick={() => openSpace({ kind: 'project', id: project.id } as Scope)}
      className="group w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-brand-50 transition-colors text-left"
    >
      <span
        className="w-7 h-7 rounded-md text-white text-[10px] font-bold flex items-center justify-center shrink-0"
        style={{ backgroundColor: project.color }}
        title={project.name}
      >
        {(project.code || initials(project.name)).slice(0, 2).toUpperCase()}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-gray-900 group-hover:text-brand-700 transition-colors truncate">
          {project.name}
        </div>
        <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${avgProgress}%`, backgroundColor: project.color }}
          />
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-2 text-[11px] text-gray-500">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <CheckCircle2 className="w-3 h-3" />
          {openTodos}
        </span>
        <span className="text-gray-300">·</span>
        <span className="tabular-nums">{avgProgress}%</span>
        <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-700 transition-colors" />
      </div>
    </button>
  );
}
