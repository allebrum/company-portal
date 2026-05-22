'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card, Section, Tile, Pill, Empty } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
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
  useActivity,
  type TodoRow,
  type GoalRow,
} from '@/hooks/useResources';
import { fmtMins, fmtMoney, relativeFromIso, PRIORITY_DOT } from '@/lib/formatters';

function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
  const out = new Date(d);
  out.setDate(d.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

export default function DashboardPage() {
  const { me } = useAuth();
  const { data: entries = [] } = useEntries();
  const { data: todos = [] } = useTodos();
  const { data: goals = [] } = useGoals();
  const { data: projects = [] } = useProjects();
  const { data: clients = [] } = useClients();
  const { data: users = [] } = useUsers();
  const { data: activity = [] } = useActivity();

  const [todoModal, setTodoModal] = useState<TodoRow | null>(null);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [goalModal, setGoalModal] = useState<GoalRow | null>(null);
  const [goalModalOpen, setGoalModalOpen] = useState(false);

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

  const liveGoals = goals.filter((g) => g.status === 'in-progress' || g.status === 'review').slice(0, 5);

  const hoursByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of week) {
      map.set(e.projectId, (map.get(e.projectId) ?? 0) + e.durationMin);
    }
    const arr = [...map.entries()].map(([projectId, mins]) => {
      const p = projects.find((x) => x.id === projectId);
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
          {myTodos.length === 0 ? (
            <Empty title="All clear" description="No open to-dos assigned to you." />
          ) : (
            <Card>
              <ul className="divide-y divide-gray-100">
                {myTodos.map((t) => {
                  const proj = projects.find((p) => p.id === t.projectId);
                  const cli = proj ? clients.find((c) => c.id === proj.clientId) : null;
                  const pri = PRIORITY_DOT[t.priority];
                  return (
                    <li key={t.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pri?.color }} />
                      <button
                        type="button"
                        onClick={() => { setTodoModal(t); setTodoModalOpen(true); }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="font-semibold text-sm text-gray-900 truncate">{t.title}</div>
                        <div className="text-[12px] text-gray-500 truncate">
                          {cli?.name}{proj && ` · ${proj.name}`} · est {fmtMins(t.estimateMin)}
                        </div>
                      </button>
                      {t.private && <Pill tone="purple">Private</Pill>}
                      <TodoTimerButton todo={t} />
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
          </div>
        </Section>

        <Section title="Live goals">
          {liveGoals.length === 0 ? (
            <Empty title="No live goals" />
          ) : (
            <div className="space-y-2">
              {liveGoals.map((g) => {
                const owner = users.find((u) => u.id === g.ownerId);
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => { setGoalModal(g); setGoalModalOpen(true); }}
                    className="w-full text-left"
                  >
                    <Tile className="!p-3 hover:shadow-md transition-shadow">
                      <div className="flex items-start gap-2">
                        <Avatar user={owner} size={24} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">{g.title}</div>
                          <div className="text-[11px] text-gray-500 capitalize">{g.status.replace('-', ' ')} · {g.tag}</div>
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
