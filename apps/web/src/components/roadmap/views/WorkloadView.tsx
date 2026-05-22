'use client';

import { useMemo } from 'react';
import { Card, Empty } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { parseLocalDate, startOfDay, dayDiff } from '@/lib/roadmap';
import type { ViewProps } from '../types';

const MULT: Record<string, number> = { high: 2, medium: 1, low: 0.5 };
const CAPACITY = 5;

const isDone = (status: string, health: string | null) =>
  health === 'done' || ['done', 'shipped', 'launched', 'launch', 'complete', 'closed'].includes(status.toLowerCase());

export function WorkloadView(props: ViewProps) {
  const { goals, users, clients, todos } = props;
  const today = startOfDay(new Date());

  const rows = useMemo(() => {
    return users
      .map((u) => {
        const active = goals.filter((g) => g.ownerId === u.id && !isDone(g.status, g.health));
        if (active.length === 0) return null;
        const weight = active.reduce((s, g) => s + (MULT[g.priority] ?? 1), 0);
        const byClient = new Map<string, number>();
        for (const g of active) byClient.set(g.clientId, (byClient.get(g.clientId) ?? 0) + (MULT[g.priority] ?? 1));
        const segs = Array.from(byClient.entries())
          .map(([cid, w]) => ({ client: clients.find((c) => c.id === cid), w }))
          .sort((a, b) => b.w - a.w);
        const openTodos = todos.filter((t) => t.assigneeId === u.id && t.status === 'open').length;
        const overdue = active.filter((g) => g.endDate && dayDiff(today, parseLocalDate(g.endDate)) < 0).length;
        const atRisk = active.filter((g) => g.health === 'at-risk' || g.health === 'off-track').length;
        return { u, active: active.length, weight, segs, openTodos, overdue, atRisk };
      })
      .filter(Boolean)
      .sort((a, b) => b!.weight - a!.weight) as NonNullable<ReturnType<() => any>>[];
  }, [users, goals, clients, todos]);

  if (rows.length === 0) return <Empty title="No workload to show" description="Assign owners to goals to see capacity." />;

  return (
    <Card className="p-2 divide-y divide-gray-100">
      {rows.map((r) => {
        const pct = Math.round((r.weight / CAPACITY) * 100);
        const overloaded = r.weight > CAPACITY;
        return (
          <div key={r.u.id} className="grid grid-cols-[200px_1fr_140px] gap-4 items-center px-3 py-3">
            <div className="flex items-center gap-2 min-w-0">
              <Avatar user={r.u} size={28} />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-800 truncate">{r.u.name}</div>
                <div className="text-[10px] text-gray-400 truncate">{r.u.email}</div>
              </div>
            </div>
            <div>
              <div className="relative h-5 bg-gray-100 rounded-md overflow-hidden">
                <div className="absolute inset-y-0 left-0 flex">
                  {r.segs.map((s: { client?: { id: string; color: string }; w: number }, i: number) => (
                    <div key={i} style={{ width: `${(s.w / CAPACITY) * 100}%`, backgroundColor: s.client?.color ?? '#9ca3af' }} />
                  ))}
                </div>
                {overloaded && <div className="absolute inset-y-0 bg-red-500/20" style={{ left: '100%', width: `${pct - 100}%` }} />}
                <div className="absolute inset-y-0 w-px bg-gray-400" style={{ left: '100%' }} />
              </div>
              <div className="mt-1 text-[11px] text-gray-500">
                {pct}% capacity · {r.active} active · {r.openTodos} open to-dos
                {r.overdue > 0 && <span className="text-red-600"> · {r.overdue} overdue</span>}
                {r.atRisk > 0 && <span className="text-amber-600"> · {r.atRisk} at-risk</span>}
              </div>
            </div>
            <div className="flex flex-col gap-1 items-end">
              {r.segs.slice(0, 3).map((s: { client?: { id: string; name: string; color: string } }, i: number) => s.client && (
                <span key={i} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                  <span className="truncate max-w-[100px]">{s.client.name}</span>
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.client.color }} />
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </Card>
  );
}
