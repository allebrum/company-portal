'use client';

import { useMemo, useState } from 'react';
import { Card, Pill } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { GoalFormModal } from '@/components/features/GoalFormModal';
import {
  useGoals,
  useUsers,
  useProjects,
  useClients,
  useMoveGoal,
  useRemoveResource,
  type GoalRow,
} from '@/hooks/useResources';
import { STATUS_LABEL, STATUS_ORDER, PRIORITY_DOT, parseLocalDate } from '@/lib/formatters';
import type { ResourceKind } from '@allebrum/shared';
import {
  Plus,
  Link as LinkIcon,
  FileText,
  Folder,
  Github,
  KeyRound,
  StickyNote,
  Sheet,
  Columns3,
  List as ListIcon,
  GanttChartSquare,
} from 'lucide-react';

const KIND_ICON: Record<ResourceKind, typeof LinkIcon> = {
  'drive-folder': Folder,
  'drive-doc': FileText,
  'drive-sheet': Sheet,
  figma: FileText,
  github: Github,
  link: LinkIcon,
  key: KeyRound,
  note: StickyNote,
};

const STATUS_TONE: Record<GoalRow['status'], 'gray' | 'purple' | 'yellow' | 'green'> = {
  backlog: 'gray',
  'in-progress': 'purple',
  review: 'yellow',
  done: 'green',
};

type View = 'kanban' | 'list' | 'gantt';

export default function RoadmapPage() {
  const toast = useToast();
  const { data: goals = [] } = useGoals();
  const { data: users = [] } = useUsers();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const move = useMoveGoal();
  const removeRes = useRemoveResource();

  const [view, setView] = useState<View>('kanban');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<GoalRow | null>(null);

  const lanes = useMemo(() => {
    const m: Record<string, GoalRow[]> = { backlog: [], 'in-progress': [], review: [], done: [] };
    for (const g of goals) m[g.status]?.push(g);
    return m;
  }, [goals]);

  const onDrop = async (status: string, e: React.DragEvent) => {
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    try {
      await move.mutateAsync({ id, status: status as GoalRow['status'] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Move failed');
    }
  };

  const openCreate = () => { setEditing(null); setModalOpen(true); };
  const openEdit = (g: GoalRow) => { setEditing(g); setModalOpen(true); };

  const ctx = { users, projects, clients };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Roadmap</div>
          <h1 className="text-2xl font-bold text-gray-900">Q2 / Q3 goals</h1>
          <p className="text-sm text-gray-500">Kanban, list, or timeline — click any goal to edit.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {([
              ['kanban', Columns3, 'Board'],
              ['list', ListIcon, 'List'],
              ['gantt', GanttChartSquare, 'Timeline'],
            ] as const).map(([v, Icon, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${
                  view === v ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" /> {label}
              </button>
            ))}
          </div>
          <Button variant="primary" onClick={openCreate}><Plus className="w-4 h-4" /> New goal</Button>
        </div>
      </div>

      {view === 'kanban' && (
        <KanbanView lanes={lanes} {...ctx} onDrop={onDrop} openEdit={openEdit} removeRes={removeRes} toast={toast} />
      )}
      {view === 'list' && <ListView goals={goals} {...ctx} openEdit={openEdit} />}
      {view === 'gantt' && <GanttView goals={goals} {...ctx} openEdit={openEdit} />}

      <GoalFormModal open={modalOpen} onClose={() => setModalOpen(false)} goal={editing} />
    </div>
  );
}

type Ctx = {
  users: { id: string; name: string; initials: string; color: string }[];
  projects: { id: string; clientId: string; name: string }[];
  clients: { id: string; name: string }[];
};

function ownerOf(ctx: Ctx, g: GoalRow) {
  return ctx.users.find((u) => u.id === g.ownerId);
}
function projClient(ctx: Ctx, g: GoalRow) {
  const proj = ctx.projects.find((p) => p.id === g.projectId);
  const cli = proj ? ctx.clients.find((c) => c.id === proj.clientId) : null;
  return { proj, cli };
}

// ---- Kanban (existing behavior) ----
function KanbanView({
  lanes,
  openEdit,
  onDrop,
  removeRes,
  toast,
  ...ctx
}: Ctx & {
  lanes: Record<string, GoalRow[]>;
  openEdit: (g: GoalRow) => void;
  onDrop: (status: string, e: React.DragEvent) => void;
  removeRes: ReturnType<typeof useRemoveResource>;
  toast: ReturnType<typeof useToast>;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {STATUS_ORDER.map((status) => (
        <div key={status} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(status, e)} className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="text-sm font-bold text-gray-900">{STATUS_LABEL[status]}</div>
            <span className="text-[11px] text-gray-400">{lanes[status]?.length ?? 0}</span>
          </div>
          <div className="space-y-2 min-h-[80px]">
            {(lanes[status] ?? []).map((g) => {
              const owner = ownerOf(ctx, g);
              const { proj, cli } = projClient(ctx, g);
              const pri = PRIORITY_DOT[g.priority];
              return (
                <Card
                  key={g.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', g.id)}
                  onClick={() => openEdit(g)}
                  className="p-3 cursor-pointer hover:shadow-md transition-shadow"
                >
                  <div className="flex items-start gap-2">
                    <span className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0" style={{ backgroundColor: pri?.color }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900">{g.title}</div>
                      <div className="text-[11px] text-gray-500">{cli?.name} · {proj?.name}</div>
                      <div className="mt-2 flex items-center gap-2">
                        <Pill tone="gray">{g.tag}</Pill>
                        {g.startDate && g.endDate && (
                          <span className="text-[11px] text-gray-500 tabular-nums">{g.startDate.slice(5)} → {g.endDate.slice(5)}</span>
                        )}
                      </div>
                      {g.resources.length > 0 && (
                        <ul className="mt-2 space-y-1">
                          {g.resources.slice(0, 4).map((r) => {
                            const Ic = KIND_ICON[r.kind as ResourceKind] ?? LinkIcon;
                            return (
                              <li key={r.id} className="flex items-center gap-1.5 text-[11px] text-gray-700">
                                <Ic className="w-3 h-3 text-brand-600 shrink-0" />
                                <span className="truncate">{r.title}</span>
                                <button
                                  onClick={async (ev) => {
                                    ev.stopPropagation();
                                    try {
                                      await removeRes.mutateAsync({ goalId: g.id, resourceId: r.id });
                                      toast.success('Resource removed');
                                    } catch (e) {
                                      toast.error(e instanceof Error ? e.message : 'Failed');
                                    }
                                  }}
                                  className="ml-auto text-gray-300 hover:text-red-600"
                                  title="Remove"
                                >×</button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      <div className="mt-2 flex items-center justify-between">
                        <Avatar user={owner} size={20} />
                        <button
                          onClick={(ev) => { ev.stopPropagation(); openEdit(g); }}
                          className="text-[11px] text-brand-600 font-semibold hover:underline inline-flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" /> Resource
                        </button>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
            {(lanes[status] ?? []).length === 0 && (
              <div className="text-[11px] text-gray-400 px-2 py-3">Drop goals here.</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- List ----
type SortKey = 'title' | 'status' | 'priority' | 'startDate' | 'endDate';

function ListView({ goals, openEdit, ...ctx }: Ctx & { goals: GoalRow[]; openEdit: (g: GoalRow) => void }) {
  const [sortKey, setSortKey] = useState<SortKey>('startDate');
  const [asc, setAsc] = useState(true);

  const sorted = useMemo(() => {
    const arr = [...goals];
    const dir = asc ? 1 : -1;
    arr.sort((a, b) => {
      const av = (a[sortKey] ?? '') as string;
      const bv = (b[sortKey] ?? '') as string;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
    return arr;
  }, [goals, sortKey, asc]);

  const head = (key: SortKey, label: string) => (
    <th
      className="px-4 py-3 cursor-pointer select-none hover:text-gray-700"
      onClick={() => (sortKey === key ? setAsc((v) => !v) : (setSortKey(key), setAsc(true)))}
    >
      {label}
      {sortKey === key && <span className="ml-1">{asc ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <Card>
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
        <thead className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
          <tr>
            {head('title', 'Goal')}
            <th className="px-4 py-3">Client / Project</th>
            <th className="px-4 py-3">Owner</th>
            {head('status', 'Status')}
            {head('priority', 'Priority')}
            {head('startDate', 'Start')}
            {head('endDate', 'End')}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((g) => {
            const owner = ownerOf(ctx, g);
            const { proj, cli } = projClient(ctx, g);
            const pri = PRIORITY_DOT[g.priority];
            return (
              <tr key={g.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => openEdit(g)}>
                <td className="px-4 py-3 font-semibold text-gray-900">{g.title}</td>
                <td className="px-4 py-3 text-gray-600">{cli?.name}{proj && ` · ${proj.name}`}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Avatar user={owner} size={20} />
                    <span className="text-gray-700">{owner?.name ?? '—'}</span>
                  </div>
                </td>
                <td className="px-4 py-3"><Pill tone={STATUS_TONE[g.status]}>{STATUS_LABEL[g.status]}</Pill></td>
                <td className="px-4 py-3">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pri?.color }} />
                    {pri?.label}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{g.startDate ?? '—'}</td>
                <td className="px-4 py-3 tabular-nums text-gray-600">{g.endDate ?? '—'}</td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No goals yet.</td></tr>
          )}
        </tbody>
      </table></div>
    </Card>
  );
}

// ---- Gantt (lightweight, month-scaled) ----
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function GanttView({ goals, openEdit, ...ctx }: Ctx & { goals: GoalRow[]; openEdit: (g: GoalRow) => void }) {
  const dated = goals.filter((g) => g.startDate && g.endDate);

  const range = useMemo(() => {
    if (dated.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const g of dated) {
      const s = parseLocalDate(g.startDate)!.getTime();
      const e = parseLocalDate(g.endDate)!.getTime();
      if (s < min) min = s;
      if (e > max) max = e;
    }
    const start = startOfMonth(new Date(min));
    const endExclusive = addMonths(startOfMonth(new Date(max)), 1);
    const months: Date[] = [];
    for (let m = new Date(start); m < endExclusive; m = addMonths(m, 1)) months.push(new Date(m));
    return { start, end: endExclusive, span: endExclusive.getTime() - start.getTime(), months };
  }, [dated]);

  if (!range) {
    return (
      <Card className="p-8 text-center text-gray-500 text-sm">
        No goals with both a start and end date. Add dates via a goal's edit dialog to see the timeline.
      </Card>
    );
  }

  const pct = (t: number) => ((t - range.start.getTime()) / range.span) * 100;

  return (
    <Card className="p-4 overflow-x-auto">
      <div className="min-w-[720px]">
        {/* Month header */}
        <div className="flex border-b border-gray-200 pb-2 mb-2">
          <div className="w-56 shrink-0 text-[11px] uppercase tracking-wide text-gray-400 font-semibold">Goal</div>
          <div className="flex-1 relative h-5">
            {range.months.map((m) => (
              <div
                key={m.toISOString()}
                className="absolute top-0 text-[11px] text-gray-500 border-l border-gray-100 pl-1"
                style={{ left: `${pct(m.getTime())}%` }}
              >
                {m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
              </div>
            ))}
          </div>
        </div>
        {/* Rows */}
        <div className="space-y-1.5">
          {dated.map((g) => {
            const s = parseLocalDate(g.startDate)!.getTime();
            const e = parseLocalDate(g.endDate)!.getTime();
            const left = pct(s);
            const width = Math.max(1.5, pct(e) - left);
            const { cli } = projClient(ctx, g);
            return (
              <div
                key={g.id}
                className="flex items-center group cursor-pointer"
                onClick={() => openEdit(g)}
              >
                <div className="w-56 shrink-0 pr-3 truncate">
                  <div className="text-sm font-semibold text-gray-900 truncate">{g.title}</div>
                  <div className="text-[11px] text-gray-500 truncate">{cli?.name}</div>
                </div>
                <div className="flex-1 relative h-7">
                  {range.months.map((m) => (
                    <div
                      key={m.toISOString()}
                      className="absolute top-0 bottom-0 border-l border-gray-100"
                      style={{ left: `${pct(m.getTime())}%` }}
                    />
                  ))}
                  <div
                    className="absolute top-1 h-5 rounded-md flex items-center px-2 text-[11px] font-semibold text-white shadow-sm group-hover:brightness-110"
                    style={{
                      left: `${left}%`,
                      width: `${width}%`,
                      backgroundColor:
                        g.status === 'done'
                          ? '#22c55e'
                          : g.status === 'review'
                          ? '#eab308'
                          : g.status === 'in-progress'
                          ? '#9333ea'
                          : '#9ca3af',
                    }}
                    title={`${g.title} · ${g.startDate} → ${g.endDate}`}
                  >
                    <span className="truncate">{STATUS_LABEL[g.status]}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}
