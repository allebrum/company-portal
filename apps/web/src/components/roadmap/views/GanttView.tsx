'use client';

import { useMemo } from 'react';
import { Empty } from '@/components/ui';
import { Avatar } from '@/components/ui/Avatar';
import {
  statusesForScope, bucketStatus, toneColor, goalAccent, HEALTH_TONE,
  rollupProgress, parseLocalDate, startOfDay, dayDiff,
} from '@/lib/roadmap';
import type { ViewProps } from '../types';
import type { GoalRow } from '@/hooks/useResources';

const NAME_COL_W = 280;
const HEADER_H = 56;
const LANE_PADDING = 8;

export function GanttView(props: ViewProps) {
  const { goals, scope, projects, tw, onOpenGoal } = props;
  const dayPx = tw.density === 'compact' ? 4.5 : 6.5;
  const ROW_H = tw.density === 'compact' ? 26 : 32;
  const ctx = { clients: props.clients, projects: props.projects, users: props.users, todos: props.todos, epics: props.epics };
  const statuses = useMemo(() => statusesForScope(scope, projects), [scope, projects]);

  const visibleMs = useMemo(() => {
    if (!tw.showMilestones) return [];
    const projIds = new Set(goals.map((g) => g.projectId));
    return props.milestones.filter((m) => projIds.has(m.projectId));
  }, [props.milestones, goals, tw.showMilestones]);

  // ---- date window ----
  const { winStart, totalDays } = useMemo(() => {
    const dates: Date[] = [new Date()];
    for (const g of goals) {
      if (g.startDate) dates.push(parseLocalDate(g.startDate));
      if (g.endDate) dates.push(parseLocalDate(g.endDate));
    }
    for (const m of visibleMs) dates.push(parseLocalDate(m.date));
    const min = new Date(Math.min(...dates.map((d) => d.getTime())));
    const max = new Date(Math.max(...dates.map((d) => d.getTime())));
    const start = startOfDay(min);
    start.setDate(start.getDate() - 7);
    const end = startOfDay(max);
    end.setDate(end.getDate() + 14);
    return { winStart: start, totalDays: Math.max(30, dayDiff(start, end)) };
  }, [goals, visibleMs]);

  const x = (d: Date) => dayDiff(winStart, d) * dayPx;
  const bodyWidth = totalDays * dayPx;

  // ---- layout: lane-pack goals within status swimlanes ----
  const { layout, lanes, bodyHeight } = useMemo(() => {
    const layout = new Map<string, { x: number; w: number; top: number; g: GoalRow }>();
    const lanes: { id: string; label: string; tone: string; top: number; height: number; count: number; rows: GoalRow[][] }[] = [];
    let cursorY = HEADER_H;
    for (const st of statuses) {
      const laneGoals = goals
        .filter((g) => bucketStatus(g.status, statuses) === st.id)
        .sort((a, b) => (a.startDate ?? '0').localeCompare(b.startDate ?? '0'));
      const rows: { goal: GoalRow; s: Date; e: Date }[][] = [];
      for (const g of laneGoals) {
        const s = g.startDate ? parseLocalDate(g.startDate) : new Date();
        const e = g.endDate ? parseLocalDate(g.endDate) : (() => { const d = new Date(s); d.setDate(d.getDate() + 14); return d; })();
        let placed = false;
        for (const row of rows) {
          const last = row[row.length - 1]!;
          if (last.e.getTime() < s.getTime()) { row.push({ goal: g, s, e }); placed = true; break; }
        }
        if (!placed) rows.push([{ goal: g, s, e }]);
      }
      const height = Math.max(1, rows.length) * ROW_H + LANE_PADDING * 2;
      rows.forEach((row, ri) => {
        row.forEach(({ goal, s, e }) => {
          layout.set(goal.id, { x: x(s), w: Math.max(dayPx * 3, dayDiff(s, e) * dayPx), top: cursorY + LANE_PADDING + ri * ROW_H, g: goal });
        });
      });
      lanes.push({ id: st.id, label: st.label, tone: st.tone, top: cursorY, height, count: laneGoals.length, rows: rows.map((r) => r.map((x) => x.goal)) });
      cursorY += height;
    }
    return { layout, lanes, bodyHeight: cursorY };
  }, [goals, statuses, dayPx, ROW_H, winStart]);

  // ---- month bands ----
  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    const cur = new Date(winStart);
    let guard = 0;
    while (dayDiff(winStart, cur) < totalDays && guard++ < 60) {
      const monthStart = new Date(cur.getFullYear(), cur.getMonth(), 1);
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const segStart = Math.max(0, x(monthStart));
      const segEnd = Math.min(bodyWidth, x(next));
      out.push({ label: cur.toLocaleDateString(undefined, { month: 'short' }).toUpperCase() + ' ' + (cur.getMonth() === 0 ? cur.getFullYear() : ''), left: segStart, width: Math.max(0, segEnd - segStart) });
      cur.setMonth(cur.getMonth() + 1);
    }
    return out;
  }, [winStart, totalDays, dayPx]);

  const todayX = x(startOfDay(new Date()));

  if (goals.length === 0) {
    return <Empty title="No goals to chart" description="Adjust scope or filters." />;
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-auto bg-white" style={{ maxHeight: 'calc(100vh - 320px)' }}>
      <div className="relative" style={{ width: NAME_COL_W + bodyWidth, height: bodyHeight }}>
        {/* Left column: status labels + goal titles */}
        <div className="absolute left-0 top-0 bottom-0 bg-white border-r border-gray-200 z-20" style={{ width: NAME_COL_W }}>
          {lanes.map((lane) => (
            <div key={lane.id} className="absolute left-0 right-0 border-b border-gray-100" style={{ top: lane.top, height: lane.height }}>
              <div className="flex items-center gap-2 px-3 pt-2">
                <span className="w-1 h-4 rounded-full" style={{ backgroundColor: toneColor(lane.tone) }} />
                <span className="text-[11px] font-bold uppercase tracking-wide text-gray-700">{lane.label}</span>
                <span className="text-[10px] text-gray-400 font-semibold">{lane.count}</span>
              </div>
              {lane.rows.map((row, ri) =>
                row.map((g) => {
                  const owner = props.users.find((u) => u.id === g.ownerId);
                  return (
                    <div key={g.id} className="absolute right-2 flex items-center gap-1.5 justify-end" style={{ top: LANE_PADDING + ri * ROW_H + 4, maxWidth: NAME_COL_W - 16 }}>
                      <span className="text-[11px] text-gray-600 truncate">{g.title}</span>
                      {owner && <Avatar user={owner} size={18} />}
                    </div>
                  );
                }),
              )}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="absolute top-0 bottom-0" style={{ left: NAME_COL_W, width: bodyWidth }}>
          {/* month header */}
          <div className="absolute top-0 left-0 right-0 border-b border-gray-200 bg-gray-50/60" style={{ height: HEADER_H }}>
            {months.map((m, i) => (
              <div key={i} className="absolute top-0 bottom-0 border-r border-gray-100 px-1.5 pt-1.5" style={{ left: m.left, width: m.width }}>
                <span className="text-[11px] font-bold text-gray-800 uppercase tracking-wider">{m.label}</span>
              </div>
            ))}
          </div>

          {/* lane separators */}
          {lanes.map((lane) => (
            <div key={lane.id} className="absolute left-0 right-0 border-b border-gray-100" style={{ top: lane.top, height: lane.height }} />
          ))}

          {/* today line */}
          {todayX >= 0 && todayX <= bodyWidth && (
            <>
              <div className="absolute top-0 bottom-0 w-px" style={{ left: todayX, backgroundColor: 'rgba(239,68,68,0.5)' }} />
              <div className="absolute text-[9px] font-bold uppercase tracking-widest text-white bg-red-500 px-1.5 py-0.5 rounded -translate-x-1/2" style={{ left: todayX, top: 2 }}>Today</div>
            </>
          )}

          {/* dependency arrows */}
          {tw.showDependencies && (
            <svg className="absolute inset-0 pointer-events-none" width={bodyWidth} height={bodyHeight} style={{ overflow: 'visible' }}>
              <defs>
                <marker id="dep-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#d97706" />
                </marker>
              </defs>
              {goals.map((b) =>
                (b.dependsOn ?? []).map((depId) => {
                  const A = layout.get(depId);
                  const B = layout.get(b.id);
                  if (!A || !B) return null;
                  const x1 = A.x + A.w, yA = A.top + (ROW_H - 8) / 2;
                  const x2 = B.x, yB = B.top + (ROW_H - 8) / 2;
                  const midX = Math.max(x1 + 8, x2 - 8);
                  return (
                    <path key={`${depId}-${b.id}`} d={`M ${x1} ${yA} L ${midX} ${yA} L ${midX} ${yB} L ${x2} ${yB}`}
                      fill="none" stroke="#d97706" strokeWidth="1.25" strokeDasharray="4 3" markerEnd="url(#dep-arrow)" opacity="0.7" />
                  );
                }),
              )}
            </svg>
          )}

          {/* bars */}
          {Array.from(layout.values()).map(({ x: bx, w, top, g }) => {
            const accent = goalAccent(g, tw.colorBy, ctx);
            const pct = rollupProgress(g, props.todos);
            const done = g.status === 'done';
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => onOpenGoal(g)}
                className={`absolute rounded-md shadow-sm flex items-center px-1.5 overflow-hidden ${done ? 'opacity-60' : ''}`}
                style={{ left: bx, top, width: w, height: ROW_H - 8, backgroundColor: accent }}
                title={g.title}
              >
                <span className="absolute left-0 top-0 bottom-0 bg-black/15" style={{ width: `${pct}%` }} />
                {g.health && <span className="relative w-1.5 h-1.5 rounded-full mr-1 ring-1 ring-white shrink-0" style={{ backgroundColor: HEALTH_TONE[g.health]?.color }} />}
                <span className="relative text-[10px] font-semibold text-white truncate">{g.title}</span>
              </button>
            );
          })}

          {/* milestone diamonds */}
          {visibleMs.map((m) => {
            const mx = x(parseLocalDate(m.date));
            if (mx < 0 || mx > bodyWidth) return null;
            return (
              <div key={m.id} className="absolute" style={{ left: mx, top: 0, bottom: 0 }}>
                <div className="absolute top-0 bottom-0 border-l border-dashed" style={{ borderColor: `${m.color}80` }} />
                <div className="absolute w-3 h-3 rotate-45 -translate-x-1/2" style={{ top: 6, backgroundColor: m.color }} title={m.title} />
                <div className="absolute -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold" style={{ top: 20, color: m.color }}>{m.title}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
