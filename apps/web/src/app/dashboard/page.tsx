'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity as ActivityIcon, CheckSquare, Target as TargetIcon, Users as UsersIcon } from 'lucide-react';
import { Card, Section, Tile, Pill, Empty } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { GroupChip } from '@/components/ui/AssigneeCell';
import { ItemComposer } from '@/components/features/ItemComposer';
import { QuickAddTodo } from '@/components/features/QuickAddTodo';
import { TodoTimerButton } from '@/components/features/TodoTimerButton';
import { useAuth } from '@/hooks/useAuth';
import {
  useEntries,
  useTodos,
  useGoals,
  useProjects,
  useClients,
  useUsers,
  useGroups,
  useActivity,
  type TodoRow,
  type GoalRow,
} from '@/hooks/useResources';
import type { ActivityPayload } from '@allebrum/shared';
import { fmtMins, fmtMoney, relativeFromIso, startOfWeek, PRIORITY_DOT } from '@/lib/formatters';

/**
 * F25 — "Your Plate Today" is one flat list (no sub-blocks). Each row is
 * tagged with a small kind pill: `Todo` / `Goal` / `Team` / `Activity`.
 * The list is sorted by urgency (overdue → due-today → due-this-week
 * → undated), then recency.
 */
type PlateItem =
  | { kind: 'todo'; tone: 'mine' | 'team'; sort: number; todo: TodoRow; group?: { id: string; name: string } | null }
  | { kind: 'goal'; tone: 'mine' | 'team'; sort: number; goal: GoalRow; group?: { id: string; name: string } | null }
  | { kind: 'activity'; sort: number; activity: ActivityPayload };

const PLATE_MAX = 12;

function todoSort(t: TodoRow): number {
  // Lower is higher priority (sorts first).
  // Overdue   → 0
  // Today     → 1
  // This week → 2
  // Undated   → 3
  // Sorted within bucket by dueDate ASC (so closer dates first).
  if (!t.dueDate) return 30_000;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${t.dueDate}T00:00:00`);
  const diffDays = Math.floor((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 0 + (1000 + diffDays);  // overdue: more overdue = even higher
  if (diffDays === 0) return 10_000;
  if (diffDays <= 7) return 20_000 + diffDays;
  return 30_000 + diffDays;
}

function goalSort(g: GoalRow): number {
  // Goals slot just below "due this week" todos by default; an at-risk or
  // off-track goal bumps to today's urgency band.
  if (g.health === 'off-track') return 5_000;
  if (g.health === 'at-risk') return 15_000;
  return 22_000;
}


export default function DashboardPage() {
  const { me } = useAuth();
  const { data: entries = [] } = useEntries();
  const { data: todos = [] } = useTodos();
  const { data: goals = [] } = useGoals();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const { data: users = [] } = useUsers();
  const { data: groups = [] } = useGroups();
  const { data: activity = [] } = useActivity();

  const [todoModal, setTodoModal] = useState<TodoRow | null>(null);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [goalModal, setGoalModal] = useState<GoalRow | null>(null);
  const [goalModalOpen, setGoalModalOpen] = useState(false);
  // F25 — Live Goals: Yours / Team tab toggle.
  const [liveGoalsTab, setLiveGoalsTab] = useState<'mine' | 'team'>('mine');

  const myGroupIds = me?.groupIds ?? [];

  const week = useMemo(() => {
    const start = startOfWeek(new Date()).getTime();
    return entries.filter((e) => new Date(e.startIso).getTime() >= start);
  }, [entries]);

  const teamHrs = week.reduce((s, e) => s + e.durationMin, 0) / 60;
  const myHrs = me ? week.filter((e) => e.userId === me.id).reduce((s, e) => s + e.durationMin, 0) / 60 : 0;
  const billable = week.filter((e) => projects.find((p) => p.id === e.projectId)?.billable);
  const billHrs = billable.reduce((s, e) => s + e.durationMin, 0) / 60;
  const billRevenue = billable.reduce((s, e) => {
    const u = users.find((x) => x.id === e.userId);
    const rate = u ? Number(u.billable) : 0;
    return s + (e.durationMin / 60) * rate;
  }, 0);

  const myTodos = me ? todos.filter((t) => t.assigneeId === me.id && t.status === 'open').slice(0, 5) : [];

  // F25 — Live Goals: split by who owns the goal.
  //  Yours = goals I personally own (ownerId === me).
  //  Team  = goals owned by a group I'm in (ownerGroupId ∈ myGroupIds),
  //          PLUS goals personally owned by other people who are in my
  //          groups (catches the historical case where group membership
  //          existed but ownership was set on the individual).
  const usersInMyGroups = useMemo(() => {
    if (myGroupIds.length === 0) return new Set<string>();
    // No direct user→groups map on the client; the bootstrap doesn't expose
    // it per-user. Approximation: pull from the activity-related metadata
    // via the `users` list — we treat anyone listed in users as a teammate
    // and rely on `ownerGroupId ∈ myGroupIds` as the primary signal.
    return new Set(users.map((u) => u.id));
  }, [myGroupIds, users]);

  const liveGoalsActive = goals.filter(
    (g) => g.status !== 'done' && g.health !== 'done',
  );
  const liveGoalsMine = me
    ? liveGoalsActive.filter((g) => g.ownerId === me.id)
    : [];
  const liveGoalsTeam = liveGoalsActive.filter(
    (g) =>
      (g.ownerGroupId && myGroupIds.includes(g.ownerGroupId)) ||
      (!g.ownerGroupId && g.ownerId && g.ownerId !== me?.id && usersInMyGroups.has(g.ownerId)),
  );
  const liveGoals = (liveGoalsTab === 'mine' ? liveGoalsMine : liveGoalsTeam).slice(0, 6);

  // F25 — Your Plate Today: build one merged feed, then sort by urgency.
  const plate = useMemo<PlateItem[]>(() => {
    if (!me) return [];
    const out: PlateItem[] = [];

    // My open todos.
    for (const t of todos) {
      if (t.status !== 'open' || t.assigneeId !== me.id) continue;
      out.push({ kind: 'todo', tone: 'mine', sort: todoSort(t), todo: t });
    }

    // My in-flight goals (personal ownership).
    for (const g of liveGoalsMine) {
      out.push({ kind: 'goal', tone: 'mine', sort: goalSort(g), goal: g });
    }

    // Team items I'm responsible for via a group.
    for (const t of todos) {
      if (t.status !== 'open') continue;
      if (!t.assigneeGroupId || !myGroupIds.includes(t.assigneeGroupId)) continue;
      const group = groups.find((g) => g.id === t.assigneeGroupId) ?? null;
      out.push({ kind: 'todo', tone: 'team', sort: todoSort(t) - 100, todo: t, group });
    }
    for (const g of goals) {
      if (g.status === 'done' || g.health === 'done') continue;
      if (!g.ownerGroupId || !myGroupIds.includes(g.ownerGroupId)) continue;
      const group = groups.find((gr) => gr.id === g.ownerGroupId) ?? null;
      out.push({ kind: 'goal', tone: 'team', sort: goalSort(g) - 100, goal: g, group });
    }

    // Recent activity touching me — last 5 events whoId = me OR target
    // mentions my name/email. Activity rows don't carry structured subject
    // metadata yet, so this is a heuristic. createdAt drives the sort.
    const meName = me.name?.toLowerCase() ?? '';
    const meEmail = me.email?.toLowerCase() ?? '';
    const recentMine = activity
      .filter(
        (a) =>
          a.whoId === me.id ||
          (meName && a.target?.toLowerCase().includes(meName)) ||
          (meEmail && a.target?.toLowerCase().includes(meEmail)),
      )
      .slice(0, 5);
    for (const a of recentMine) {
      // Activity always slots toward the bottom of the urgency stack
      // unless the row is fresh; offset by negative recency so newer
      // events float up among undated todos.
      const ageMin = Math.max(
        0,
        (Date.now() - new Date(a.createdAt).getTime()) / 60_000,
      );
      out.push({ kind: 'activity', sort: 32_000 + ageMin / 5, activity: a });
    }

    out.sort((a, b) => a.sort - b.sort);
    return out.slice(0, PLATE_MAX);
  }, [me, todos, goals, groups, activity, myGroupIds, liveGoalsMine]);

  const hoursByProject = useMemo(() => {
    // Bucket entries by project; null projectId (project-less entries)
    // collapse into a single "No project" bucket so the dashboard still
    // accounts for that time without skipping it.
    const map = new Map<string, number>();
    const NO_PROJECT = '__none__';
    for (const e of week) {
      const key = e.projectId ?? NO_PROJECT;
      map.set(key, (map.get(key) ?? 0) + e.durationMin);
    }
    const arr = [...map.entries()].map(([projectId, mins]) => {
      const p = projectId === NO_PROJECT ? undefined : projects.find((x) => x.id === projectId);
      return { project: p, mins };
    });
    arr.sort((a, b) => b.mins - a.mins);
    return arr.slice(0, 6);
  }, [week, projects]);
  const maxMins = Math.max(1, ...hoursByProject.map((r) => r.mins));

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <div className="eyebrow">Dashboard</div>
          <h1 className="text-2xl font-bold text-gray-900">Hi {me?.name?.split(' ')[0]} — here's the week</h1>
          <p className="text-sm text-gray-500">A snapshot of where the team is spending time.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/time"><Button variant="outline">Log time</Button></Link>
          <Link href="/todos"><Button variant="primary">New to-do</Button></Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile>
          <div className="eyebrow">Team hours</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{teamHrs.toFixed(1)}h</div>
          <div className="text-xs text-gray-500">across {users.length} people</div>
        </Tile>
        <Tile>
          <div className="eyebrow">Your hours</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{myHrs.toFixed(1)}h</div>
          <div className="text-xs text-gray-500">this week</div>
        </Tile>
        <Tile>
          <div className="eyebrow">Billable hours</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{billHrs.toFixed(1)}h</div>
          <div className="text-xs text-gray-500">{week.length ? `${Math.round((billable.length / week.length) * 100)}% of week` : 'no entries yet'}</div>
        </Tile>
        <Tile>
          <div className="eyebrow">Billable revenue</div>
          <div className="text-3xl font-bold text-gray-900 tabular-nums">{fmtMoney(billRevenue)}</div>
          <div className="text-xs text-gray-500">at user rates</div>
        </Tile>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Section title="Your plate today" className="lg:col-span-2">
          <div className="space-y-3">
            <QuickAddTodo
              context={{ assigneeId: me?.id ?? null }}
              onElaborate={(t) => { setTodoModal(t); setTodoModalOpen(true); }}
            />
            {plate.length === 0 ? (
              <Empty title="All clear" description="Nothing on your plate right now — add a to-do above to get started." />
            ) : (
              <Card>
                <ul className="divide-y divide-gray-100">
                  {plate.map((item) => (
                    <PlateRow
                      key={
                        item.kind === 'todo'
                          ? `t-${item.todo.id}`
                          : item.kind === 'goal'
                            ? `g-${item.goal.id}`
                            : `a-${item.activity.id}`
                      }
                      item={item}
                      projects={projects}
                      clients={clients}
                      users={users}
                      onOpenTodo={(t) => { setTodoModal(t); setTodoModalOpen(true); }}
                      onOpenGoal={(g) => { setGoalModal(g); setGoalModalOpen(true); }}
                    />
                  ))}
                </ul>
              </Card>
            )}
            {/* F25 — "See all" surfaces when the unfiltered combined count
                exceeded the cap. We approximate with myTodos.length>5 or
                liveGoalsMine.length>4 since the merged source is virtual. */}
            {(myTodos.length > 5 || liveGoalsMine.length > 4) && (
              <div className="text-right">
                <Link href="/todos" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
                  See all →
                </Link>
              </div>
            )}
          </div>
        </Section>

        <Section
          title="Live goals"
          action={
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-[11px] font-semibold">
              <button
                type="button"
                onClick={() => setLiveGoalsTab('mine')}
                className={`px-2.5 py-1 ${liveGoalsTab === 'mine' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Yours · {liveGoalsMine.length}
              </button>
              <button
                type="button"
                onClick={() => setLiveGoalsTab('team')}
                className={`px-2.5 py-1 border-l border-gray-200 ${liveGoalsTab === 'team' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Team · {liveGoalsTeam.length}
              </button>
            </div>
          }
        >
          {liveGoals.length === 0 ? (
            <Empty title={liveGoalsTab === 'mine' ? 'No live goals' : "Your team has no live goals"} />
          ) : (
            <div className="space-y-2">
              {liveGoals.map((g) => {
                const owner = g.ownerId ? users.find((u) => u.id === g.ownerId) : null;
                const ownerGroup = g.ownerGroupId ? groups.find((x) => x.id === g.ownerGroupId) ?? null : null;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setGoalModal(g); setGoalModalOpen(true); }}
                    className="w-full text-left"
                  >
                    <Tile className="!p-3 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-2">
                        {ownerGroup ? (
                          <span
                            className="inline-flex items-center justify-center rounded-full text-white shrink-0"
                            style={{ width: 24, height: 24, backgroundColor: '#6b7280' }}
                            title={`Group · ${ownerGroup.name}`}
                          >
                            <UsersIcon className="w-3.5 h-3.5" />
                          </span>
                        ) : (
                          <Avatar user={owner ?? undefined} size={24} />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{g.title}</div>
                          <div className="text-[11px] text-gray-500 capitalize">
                            {g.status.replace('-', ' ')} · {g.tag}
                            {ownerGroup && <> · <span className="text-amber-700">{ownerGroup.name}</span></>}
                          </div>
                        </div>
                      </div>
                    </Tile>
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Section title="Hours by project" className="lg:col-span-2">
          <Card className="p-5">
            {hoursByProject.length === 0 ? (
              <Empty title="No time logged this week" />
            ) : (
              <div className="space-y-3">
                {hoursByProject.map((r) => (
                  <div key={r.project?.id ?? 'unknown'} className="">
                    <div className="flex justify-between text-xs text-gray-600">
                      <span className="font-semibold text-gray-800">{r.project?.name ?? 'Unknown'}</span>
                      <span className="tabular-nums">{(r.mins / 60).toFixed(1)}h</span>
                    </div>
                    <div className="mt-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(r.mins / maxMins) * 100}%`,
                          background: r.project?.color ?? '#9333ea',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </Section>

        <Section title="Activity">
          <Card>
            <ul className="divide-y divide-gray-100">
              {activity.slice(0, 8).map((a) => {
                const u = users.find((x) => x.id === a.whoId);
                return (
                  <li key={a.id} className="px-5 py-3 flex items-start gap-3">
                    <Avatar user={u} size={24} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-800 truncate">{a.target}</div>
                      <div className="text-[11px] text-gray-500">{u?.name ?? 'Unknown'} · {relativeFromIso(a.createdAt)}</div>
                    </div>
                  </li>
                );
              })}
              {activity.length === 0 && <li className="px-5 py-3 text-sm text-gray-500">No activity yet.</li>}
            </ul>
          </Card>
        </Section>
      </div>

      <ItemComposer mode="todo" open={todoModalOpen} onClose={() => setTodoModalOpen(false)} todo={todoModal} />
      <ItemComposer mode="goal" open={goalModalOpen} onClose={() => setGoalModalOpen(false)} goal={goalModal} />
    </div>
  );
}

/**
 * F25 — one row in the flat "Your plate today" feed. Renders all four
 * kinds (Todo / Goal / Team-tagged variants of either / Activity) through
 * a single shape: tag pill on the left, title in the middle, meta below,
 * priority/timer/group chip on the right.
 */
function PlateRow({
  item,
  projects,
  clients,
  users,
  onOpenTodo,
  onOpenGoal,
}: {
  item: PlateItem;
  projects: ReturnType<typeof useProjects>['data'];
  clients: ReturnType<typeof useClients>['data'];
  users: ReturnType<typeof useUsers>['data'];
  onOpenTodo: (t: TodoRow) => void;
  onOpenGoal: (g: GoalRow) => void;
}) {
  if (item.kind === 'todo') {
    const t = item.todo;
    const proj = projects?.find((p) => p.id === t.projectId);
    const cli = proj ? clients?.find((c) => c.id === proj.clientId) : null;
    const pri = PRIORITY_DOT[t.priority];
    const isTeam = item.tone === 'team';
    return (
      <li className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
        <KindPill kind={isTeam ? 'team' : 'todo'} />
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pri?.color }} />
        <button
          type="button"
          onClick={() => onOpenTodo(t)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="font-semibold text-sm text-gray-900 truncate">{t.title}</div>
          <div className="text-[12px] text-gray-500 truncate">
            {cli?.name}
            {proj && ` · ${proj.name}`}
            {t.dueDate && ` · due ${t.dueDate}`}
            {` · est ${fmtMins(t.estimateMin)}`}
          </div>
        </button>
        {isTeam && item.group && <GroupChip group={item.group} />}
        {t.private && <Pill tone="purple">Private</Pill>}
        <TodoTimerButton todo={t} />
      </li>
    );
  }
  if (item.kind === 'goal') {
    const g = item.goal;
    const isTeam = item.tone === 'team';
    return (
      <li className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
        <KindPill kind={isTeam ? 'team' : 'goal'} />
        <button
          type="button"
          onClick={() => onOpenGoal(g)}
          className="flex-1 min-w-0 text-left"
        >
          <div className="font-semibold text-sm text-gray-900 truncate">{g.title}</div>
          <div className="text-[12px] text-gray-500 truncate capitalize">
            {g.status.replace('-', ' ')} · {g.tag}
            {g.health && ` · ${g.health}`}
            {g.progress != null && ` · ${g.progress}%`}
          </div>
        </button>
        {isTeam && item.group && <GroupChip group={item.group} />}
      </li>
    );
  }
  // Activity row
  const a = item.activity;
  const u = users?.find((x) => x.id === a.whoId);
  return (
    <li className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
      <KindPill kind="activity" />
      <Avatar user={u} size={20} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-700 truncate">{a.target}</div>
        <div className="text-[11px] text-gray-500">{u?.name ?? 'Someone'} · {relativeFromIso(a.createdAt)}</div>
      </div>
    </li>
  );
}

/**
 * Tag pill rendered on every PlateRow. Colors match the dashboard's
 * existing palette so the row reads as a single coherent line.
 */
function KindPill({ kind }: { kind: 'todo' | 'goal' | 'team' | 'activity' }) {
  const config = {
    todo: { label: 'Todo', tone: 'bg-brand-50 text-brand-700', Icon: CheckSquare },
    goal: { label: 'Goal', tone: 'bg-emerald-50 text-emerald-700', Icon: TargetIcon },
    team: { label: 'Team', tone: 'bg-amber-50 text-amber-700', Icon: UsersIcon },
    activity: { label: 'Activity', tone: 'bg-gray-100 text-gray-600', Icon: ActivityIcon },
  }[kind];
  const { Icon } = config;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest shrink-0 ${config.tone}`}
    >
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}
