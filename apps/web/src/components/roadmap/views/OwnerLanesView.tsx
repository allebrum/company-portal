'use client';

import { useMemo } from 'react';
import { Empty } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import { goalAccent, HEALTH_TONE, rollupProgress, parseLocalDate, startOfDay, dayDiff } from '@/lib/roadmap';
import type { ViewProps } from '../types';
import type { GoalRow } from '@/hooks/useResources';

const NAME_COL_W = 200;
const HEADER_H = 56;
const LANE_PADDING = 8;

export function OwnerLanesView(props: ViewProps) {
  const { goals, tw, onOpenGoal } = props;
  const dayPx = tw.density === 'compact' ? 4.5 : 6.5;
  const ROW_H = tw.density === 'compact' ? 26 : 32;
  const ctx = { clients: props.clients, projects: props.projects, users: props.users, todos: props.todos, epics: props.epics };

  const { winStart, totalDays } = useMemo(() => {
    const dates: Date[] = [new Date()];
    for (const g of goals) {
      if (g.startDate) dates.push(parseLocalDate(g.startDate));
      if (g.endDate) dates.push(parseLocalDate(g.endDate));
    }
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    const start = startOfDay(min); start.setDate(start.getDate() - 7);
    const end = startOfDay(max); end.setDate(end.getDate() + 14);
    return { winStart: start, totalDays: Math.max(30, dayDiff(start, end)) };
  }, [goals]);

  const x = (d: Date) => dayDiff(winStart, d) * dayPx;
  const bodyWidth = totalDays * dayPx;
  const todayX = x(startOfDay(new Date()));

  const { lanes, layout, bodyHeight } = useMemo(() => {
    const ownerIds = Array.from(new Set(goals.map((g) => g.ownerId ?? 'none')));
    const layout = new Map<string, { x: number; w: number; top: number; g: GoalRow }>();
    const lanes: { id: string; top: number; height: number; rows: GoalRow[][]; count: number }[] = [];
    let cursorY = HEADER_H;
    for (const oid of ownerIds) {
      const og = goals.filter((g) => (g.ownerId ?? 'none') === oid).sort((a, b) => (a.startDate ?? '0').localeCompare(b.startDate ?? '0'));
      const rows: { goal: GoalRow; s: Date; e: Date }[][] = [];
      for (const g of og) {
        const s = g.startDate ? parseLocalDate(g.startDate) : new Date();
        const e = g.endDate ? parseLocalDate(g.endDate) : (() => { const d = new Date(s); d.setDate(d.getDate() + 14); return d; })();
        let placed = false;
        for (const row of rows) { const last = row[row.length - 1]!; if (last.e.getTime() < s.getTime()) { row.push({ goal: g, s, e }); placed = true; break; } }
        if (!placed) rows.push([{ goal: g, s, e }]);
      }
      const height = Math.max(1, rows.length) * ROW_H + LANE_PADDING * 2;
      rows.forEach((row, ri) => row.forEach(({ goal, s, e }) => layout.set(goal.id, { x: x(s), w: Math.max(dayPx * 3, dayDiff(s, e) * dayPx), top: cursorY + LANE_PADDING + ri * ROW_H, g: goal })));
      lanes.push({ id: oid, top: cursorY, height, rows: rows.map((r) => r.map((x) => x.goal)), count: og.length });
      cursorY += height;
    }
    return { lanes, layout, bodyHeight: cursorY };
  }, [goals, dayPx, ROW_H, winStart]);

  if (goals.length === 0) return <Empty title="No goals to chart" description="Adjust scope or filters." />;

  return (
    <div className="border border-gray-200 rounded-xl overflow-auto bg-white" style={{ maxHeight: 'calc(100vh - 320px)' }}>
      <div className="relative" style={{ width: NAME_COL_W + bodyWidth, height: bodyHeight }}>
        <div className="absolute left-0 top-0 bottom-0 bg-white border-r border-gray-200 z-20" style={{ width: NAME_COL_W }}>
          {lanes.map((lane) => {
            const u = props.users.find((x) => x.id === lane.id);
            return (
              <div key={lane.id} className="absolute left-0 right-0 border-b border-gray-100 flex items-center gap-2 px-3" style={{ top: lane.top, height: lane.height }}>
                <Avatar user={u ?? undefined} size={28} />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-gray-800 truncate">{u?.name ?? 'Unassigned'}</div>
                  <div className="text-[10px] text-gray-400">{lane.count} goal{lane.count === 1 ? '' : 's'}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="absolute top-0 bottom-0" style={{ left: NAME_COL_W, width: bodyWidth }}>
          <div className="absolute top-0 left-0 right-0 border-b border-gray-200 bg-gray-50/60" style={{ height: HEADER_H }} />
          {lanes.map((lane) => <div key={lane.id} className="absolute left-0 right-0 border-b border-gray-100" style={{ top: lane.top, height: lane.height }} />)}
          {todayX >= 0 && todayX <= bodyWidth && <div className="absolute top-0 bottom-0 w-px" style={{ left: todayX, backgroundColor: 'rgba(239,68,68,0.5)' }} />}
          {Array.from(layout.values()).map(({ x: bx, w, top, g }) => {
            const accent = goalAccent(g, tw.colorBy, ctx);
            const pct = rollupProgress(g, props.todos);
            return (
              <button key={g.id} type="button" onClick={() => onOpenGoal(g)} className={`absolute rounded-md shadow-sm flex items-center px-1.5 overflow-hidden ${g.status === 'done' ? 'opacity-60' : ''}`} style={{ left: bx, top, width: w, height: ROW_H - 8, backgroundColor: accent }} title={g.title}>
                <span className="absolute left-0 top-0 bottom-0 bg-black/15" style={{ width: `${pct}%` }} />
                {g.health && <span className="relative w-1.5 h-1.5 rounded-full mr-1 ring-1 ring-white shrink-0" style={{ backgroundColor: HEALTH_TONE[g.health]?.color }} />}
                <span className="relative text-[10px] font-semibold text-white truncate">{g.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
