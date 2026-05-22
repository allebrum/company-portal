'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  useGoals, useEpics, useMilestones, useClients, useProjects, useUsers, useTodos,
  type GoalRow,
} from '@/hooks/useResources';
import { ItemComposer } from '@/components/features/ItemComposer';
import { ScopeSwitcher } from '@/components/roadmap/ScopeSwitcher';
import { HealthSummary } from '@/components/roadmap/HealthSummary';
import { ViewSwitch, type RoadmapView } from '@/components/roadmap/ViewSwitch';
import { FilterBar, type RoadmapFilters } from '@/components/roadmap/FilterBar';
import { RoadmapTweaks } from '@/components/roadmap/RoadmapTweaks';
import { DEFAULT_TWEAKS, type Tweaks, type ViewProps } from '@/components/roadmap/types';
import { statusesForScope, bucketStatus, type Scope } from '@/lib/roadmap';
import { KanbanView } from '@/components/roadmap/views/KanbanView';
import { GanttView } from '@/components/roadmap/views/GanttView';
import { ListView } from '@/components/roadmap/views/ListView';
import { CalendarView } from '@/components/roadmap/views/CalendarView';
import { OwnerLanesView } from '@/components/roadmap/views/OwnerLanesView';
import { WorkloadView } from '@/components/roadmap/views/WorkloadView';

export default function RoadmapPage() {
  const { data: goals = [] } = useGoals();
  const { data: epics = [] } = useEpics();
  const { data: milestones = [] } = useMilestones();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: users = [] } = useUsers();
  const { data: todos = [] } = useTodos();

  const [view, setView] = useState<RoadmapView>('kanban');
  const [scope, setScope] = useState<Scope>({ kind: 'all' });
  const [filters, setFilters] = useState<RoadmapFilters>({ client: null, project: null, status: null, q: '' });
  const [tw, setTw] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [composerOpen, setComposerOpen] = useState(false);
  const [editing, setEditing] = useState<GoalRow | null>(null);

  const statuses = useMemo(() => statusesForScope(scope, projects), [scope, projects]);

  const visible = useMemo(() => {
    let arr = goals;
    if (scope.kind === 'client') arr = arr.filter((g) => g.clientId === scope.id);
    if (scope.kind === 'project') arr = arr.filter((g) => g.projectId === scope.id);
    if (filters.client) arr = arr.filter((g) => g.clientId === filters.client);
    if (filters.project) arr = arr.filter((g) => g.projectId === filters.project);
    if (filters.status) arr = arr.filter((g) => bucketStatus(g.status, statuses) === filters.status);
    if (filters.q) arr = arr.filter((g) => g.title.toLowerCase().includes(filters.q.toLowerCase()));
    if (!tw.showDone) arr = arr.filter((g) => bucketStatus(g.status, statuses) !== 'done' && g.health !== 'done');
    return arr;
  }, [goals, scope, filters, tw.showDone, statuses]);

  const viewProps: ViewProps = {
    goals: visible, clients, projects, users, todos, epics, milestones, scope, tw,
    onOpenGoal: (g) => { setEditing(g); setComposerOpen(true); },
  };

  const scopeLabel =
    scope.kind === 'all' ? 'Workspace'
      : scope.kind === 'client' ? (clients.find((c) => c.id === scope.id)?.name ?? 'Client')
        : (projects.find((p) => p.id === scope.id)?.name ?? 'Project');

  const createDefaults = useMemo(() => {
    if (scope.kind === 'project') {
      const p = projects.find((x) => x.id === scope.id);
      return p ? { projectId: p.id, clientId: p.clientId } : undefined;
    }
    if (scope.kind === 'client') return { clientId: scope.id };
    return undefined;
  }, [scope, projects]);

  // Render the active view inline (NOT as a nested component) so that parent
  // re-renders — e.g. typing in the FilterBar search or toggling View options —
  // update the view in place instead of remounting it. Remounting would reset
  // each view's internal state (Calendar's month cursor, Kanban drag, scroll).
  const renderBody = () => {
    switch (view) {
      case 'gantt': return <GanttView {...viewProps} />;
      case 'list': return <ListView {...viewProps} />;
      case 'calendar': return <CalendarView {...viewProps} />;
      case 'lanes': return <OwnerLanesView {...viewProps} />;
      case 'workload': return <WorkloadView {...viewProps} />;
      case 'kanban':
      default: return <KanbanView {...viewProps} />;
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] font-bold text-gray-400">Roadmap › {scopeLabel}</div>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-3xl font-bold text-gray-900 leading-tight">The bigger picture</h1>
            <ScopeSwitcher scope={scope} onChange={setScope} clients={clients} projects={projects} />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {visible.length} goal{visible.length === 1 ? '' : 's'} · {epics.length} epic{epics.length === 1 ? '' : 's'} · {milestones.length} milestone{milestones.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button variant="primary" onClick={() => { setEditing(null); setComposerOpen(true); }}>
          <Plus className="w-4 h-4" /> New goal
        </Button>
      </div>

      <HealthSummary goals={visible} todos={todos} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ViewSwitch view={view} onChange={setView} />
        <FilterBar filters={filters} onChange={setFilters} clients={clients} projects={projects} statuses={statuses} />
      </div>

      {renderBody()}

      <ItemComposer
        mode="goal"
        open={composerOpen}
        goal={editing}
        onClose={() => setComposerOpen(false)}
        defaults={editing ? undefined : createDefaults}
      />

      <RoadmapTweaks tw={tw} onChange={setTw} />
    </div>
  );
}
