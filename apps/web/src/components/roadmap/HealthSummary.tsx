'use client';

import { useMemo } from 'react';
import { Tile } from '@/components/ui';
import { HEALTH_TONE, rollupProgress } from '@/lib/roadmap';
import type { GoalRow, TodoRow } from '@/hooks/useResources';

const ORDER: (keyof typeof HEALTH_TONE)[] = ['on-track', 'at-risk', 'off-track', 'done'];

export function HealthSummary({ goals, todos }: { goals: GoalRow[]; todos: TodoRow[] }) {
  const { avg, counts, total } = useMemo(() => {
    const counts: Record<string, number> = { 'on-track': 0, 'at-risk': 0, 'off-track': 0, done: 0 };
    let sum = 0;
    for (const g of goals) {
      const h = g.health ?? (g.status === 'done' ? 'done' : 'on-track');
      counts[h] = (counts[h] ?? 0) + 1;
      sum += rollupProgress(g, todos);
    }
    return { avg: goals.length ? Math.round(sum / goals.length) : 0, counts, total: goals.length };
  }, [goals, todos]);

  const onTrackPct = total ? Math.round(((counts['on-track']! + counts.done!) / total) * 100) : 0;
  const R = 25;
  const C = 2 * Math.PI * R;

  return (
    <Tile>
      <div className="flex items-center gap-6 flex-wrap">
        <div className="flex items-center gap-4">
          <svg width="56" height="56" viewBox="0 0 56 56" className="shrink-0">
            <circle cx="28" cy="28" r={R} fill="none" stroke="#e5e7eb" strokeWidth="6" />
            <circle
              cx="28" cy="28" r={R} fill="none" stroke="#9333ea" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={C - (avg / 100) * C}
              transform="rotate(-90 28 28)"
            />
            <text x="28" y="32" textAnchor="middle" className="fill-gray-900 font-bold" fontSize="15">{avg}</text>
          </svg>
          <div>
            <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">Avg progress</div>
            <div className="text-sm text-gray-600">{total} goal{total === 1 ? '' : 's'} tracked</div>
          </div>
        </div>

        <div className="flex-1 min-w-[240px]">
          <div className="flex items-center justify-between mb-1.5">
            <div className="text-[11px] uppercase tracking-widest font-bold text-gray-400">Health</div>
            <div className="text-sm font-semibold text-gray-700">{onTrackPct}% on track</div>
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100">
            {ORDER.map((h) => {
              const w = total ? (counts[h]! / total) * 100 : 0;
              if (w === 0) return null;
              return <div key={h} style={{ width: `${w}%`, backgroundColor: HEALTH_TONE[h]!.color }} title={`${counts[h]} ${HEALTH_TONE[h]!.label}`} />;
            })}
          </div>
          <div className="mt-2 flex items-center gap-4 flex-wrap text-xs text-gray-600">
            {ORDER.map((h) => (
              <span key={h} className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: HEALTH_TONE[h]!.color }} />
                <span className="tabular-nums font-semibold">{counts[h]}</span> {HEALTH_TONE[h]!.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Tile>
  );
}
