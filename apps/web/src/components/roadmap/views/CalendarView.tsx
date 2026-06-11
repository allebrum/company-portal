'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { goalAccent, parseLocalDate, startOfDay, dayDiff } from '@/lib/roadmap';
import type { ViewProps } from '../types';
import type { GoalRow } from '@/hooks/useResources';

const BARS_TOP = 26;
const BAR_LANE_H = 18;
const MAX_LANES = 4;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarView(props: ViewProps) {
  const { goals, tw, onOpenGoal } = props;
  const ctx = { clients: props.clients, projects: props.projects, users: props.users, todos: props.todos, epics: props.epics };
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));

  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = startOfDay(new Date(monthStart));
  gridStart.setDate(gridStart.getDate() - monthStart.getDay());

  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let w = 0; w < 6; w++) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d++) {
        const day = new Date(gridStart);
        day.setDate(gridStart.getDate() + w * 7 + d);
        row.push(day);
      }
      out.push(row);
    }
    return out;
  }, [gridStart.getTime()]);

  const today = startOfDay(new Date());

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronLeft className="w-4 h-4" /></button>
          <div className="text-sm font-bold text-gray-900 w-36 text-center">{cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>
          <button type="button" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="p-1 rounded hover:bg-gray-100 text-gray-500"><ChevronRight className="w-4 h-4" /></button>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rotate-45 bg-brand-500" /> Milestone</span>
          <span className="inline-flex items-center gap-1"><span className="w-4 h-2 rounded bg-brand-500" /> Goal range</span>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-gray-100">
        {WEEKDAYS.map((d) => <div key={d} className="px-2 py-1.5 text-[10px] uppercase tracking-widest font-bold text-gray-500">{d}</div>)}
      </div>
      <div>
        {weeks.map((week, wi) => {
          const weekStart = week[0]!;
          const weekEnd = week[6]!;
          // lane-pack goals overlapping this week
          const segs = goals
            .map((g) => {
              const s = g.startDate ? parseLocalDate(g.startDate) : null;
              const e = g.endDate ? parseLocalDate(g.endDate) : s;
              if (!s || !e) return null;
              if (e.getTime() < weekStart.getTime() || s.getTime() > weekEnd.getTime()) return null;
              const startCol = Math.max(0, dayDiff(weekStart, s));
              const endCol = Math.min(6, dayDiff(weekStart, e));
              return { g, startCol, span: endCol - startCol + 1 };
            })
            .filter(Boolean) as { g: GoalRow; startCol: number; span: number }[];
          segs.sort((a, b) => a.startCol - b.startCol || b.span - a.span);
          const lanes: { endCol: number }[] = [];
          const placed: { seg: typeof segs[number]; lane: number }[] = [];
          const overflowByDay: Record<number, number> = {};
          for (const seg of segs) {
            let lane = lanes.findIndex((l) => l.endCol < seg.startCol);
            if (lane === -1) { lane = lanes.length; lanes.push({ endCol: seg.startCol + seg.span - 1 }); }
            else lanes[lane] = { endCol: seg.startCol + seg.span - 1 };
            if (lane >= MAX_LANES) {
              for (let c = seg.startCol; c < seg.startCol + seg.span; c++) overflowByDay[c] = (overflowByDay[c] ?? 0) + 1;
            } else placed.push({ seg, lane });
          }
          const usedLanes = Math.min(MAX_LANES, lanes.length);
          const minH = Math.max(110, BARS_TOP + usedLanes * BAR_LANE_H + 24);
          return (
            <div key={wi} className="grid grid-cols-7 relative border-b border-gray-100" style={{ minHeight: minH }}>
              {week.map((day, di) => {
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = day.getTime() === today.getTime();
                const dayMs = props.milestones.filter((m) => parseLocalDate(m.date).getTime() === day.getTime() && goals.some((g) => g.projectId === m.projectId));
                return (
                  <div key={di} className={`border-r border-gray-50 px-1.5 py-1 ${inMonth ? '' : 'bg-gray-50/40'}`}>
                    <div className={`text-[11px] font-bold ${isToday ? 'bg-brand-600 text-white w-5 h-5 rounded-full flex items-center justify-center' : inMonth ? 'text-gray-700' : 'text-gray-300'}`}>{day.getDate()}</div>
                    {dayMs.map((m) => (
                      <div
                        key={m.id}
                        className="mt-0.5 inline-flex items-center gap-1 px-1 py-0.5 rounded text-[9px] font-semibold truncate max-w-full"
                        style={{ backgroundColor: `${m.color}15`, color: m.color }}
                        title={m.signedOffAt ? `Client approved${m.signOffComment ? ` — “${m.signOffComment}”` : ''}` : m.title}
                      >
                        <span className="w-1.5 h-1.5 rotate-45 shrink-0" style={{ backgroundColor: m.color }} /> {m.title}
                        {m.signedOffAt && <span aria-label="Client approved" className="shrink-0 font-bold">✓</span>}
                      </div>
                    ))}
                    {overflowByDay[di] ? <div className="mt-0.5 text-[9px] text-gray-400">+{overflowByDay[di]} more</div> : null}
                  </div>
                );
              })}
              {/* bars overlay */}
              {placed.map(({ seg, lane }) => (
                <button
                  key={seg.g.id}
                  type="button"
                  onClick={() => onOpenGoal(seg.g)}
                  className="absolute h-4 rounded-md text-[9px] font-semibold text-white truncate px-1 shadow-sm"
                  style={{
                    top: BARS_TOP + lane * BAR_LANE_H,
                    left: `calc(${(seg.startCol / 7) * 100}% + 4px)`,
                    width: `calc(${(seg.span / 7) * 100}% - 8px)`,
                    backgroundColor: goalAccent(seg.g, tw.colorBy, ctx),
                  }}
                  title={seg.g.title}
                >
                  {seg.g.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
