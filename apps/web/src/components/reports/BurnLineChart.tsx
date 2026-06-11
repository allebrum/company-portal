'use client';

import { useMemo } from 'react';
import type { EntryRow, ProjectRow } from '@/hooks/useResources';
import { isoDate } from '@/lib/formatters';
import { dateMD } from '@/lib/roadmap';

const VB_W = 700;
const VB_H = 220;
const PAD = { top: 18, right: 12, bottom: 22, left: 12 };
const PLOT_W = VB_W - PAD.left - PAD.right;
const PLOT_H = VB_H - PAD.top - PAD.bottom;

/**
 * S3.3 — compact cumulative-burn line chart: tracked hours accumulating over
 * the selected window for the top 5 projects by hours, one project-colored
 * polyline each. Hand-rolled SVG (no chart deps); pure render-time math from
 * the already-filtered entries. Entries bucket by LOCAL day of `startIso` so
 * the X axis matches what users see elsewhere in the app.
 */
export function BurnLineChart({
  entries,
  projects,
  fromDay,
  toDay,
}: {
  entries: EntryRow[];
  projects: ProjectRow[];
  fromDay: Date;
  toDay: Date;
}) {
  const { days, series, maxY } = useMemo(() => {
    // Local-day buckets spanning the window (inclusive).
    const days: string[] = [];
    const cursor = new Date(fromDay);
    while (cursor <= toDay) {
      days.push(isoDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    // Top 5 projects by tracked minutes in range.
    const totals = new Map<string, number>();
    for (const e of entries) {
      if (e.projectId) totals.set(e.projectId, (totals.get(e.projectId) ?? 0) + e.durationMin);
    }
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => projects.find((p) => p.id === id))
      .filter((p): p is ProjectRow => p != null);
    const series = top.map((project) => {
      const byDay = new Map<string, number>();
      for (const e of entries) {
        if (e.projectId !== project.id) continue;
        const key = isoDate(new Date(e.startIso));
        byDay.set(key, (byDay.get(key) ?? 0) + e.durationMin / 60);
      }
      let acc = 0;
      const cum = days.map((d) => {
        acc += byDay.get(d) ?? 0;
        return acc;
      });
      return { project, cum };
    });
    const maxY = series.reduce((m, s) => Math.max(m, s.cum[s.cum.length - 1] ?? 0), 0);
    return { days, series, maxY };
  }, [entries, projects, fromDay, toDay]);

  // Never render a broken empty SVG — a one-line muted note instead.
  if (series.length === 0 || maxY <= 0) {
    return <div className="px-4 py-3 text-sm text-gray-500">No project time in this range.</div>;
  }

  const xAt = (i: number) => PAD.left + (i / Math.max(1, days.length - 1)) * PLOT_W;
  const yAt = (v: number) => PAD.top + (1 - v / maxY) * PLOT_H;
  // Single-day window: a one-point polyline is invisible — draw it flat.
  const pointsFor = (cum: number[]) =>
    days.length === 1
      ? `${PAD.left},${yAt(cum[0] ?? 0).toFixed(1)} ${VB_W - PAD.right},${yAt(cum[0] ?? 0).toFixed(1)}`
      : cum.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');

  return (
    <div className="p-4">
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Cumulative tracked hours by project"
      >
        <line x1={PAD.left} y1={PAD.top} x2={VB_W - PAD.right} y2={PAD.top} stroke="#f3f4f6" strokeDasharray="4 4" />
        <line x1={PAD.left} y1={VB_H - PAD.bottom} x2={VB_W - PAD.right} y2={VB_H - PAD.bottom} stroke="#e5e7eb" />
        {series.map((s) => (
          <polyline
            key={s.project.id}
            fill="none"
            stroke={s.project.color || '#9ca3af'}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={pointsFor(s.cum)}
          />
        ))}
        <text x={PAD.left} y={PAD.top - 6} fontSize="10" fill="#9ca3af">{maxY.toFixed(1)}h</text>
        <text x={PAD.left} y={VB_H - 7} fontSize="10" fill="#9ca3af">{dateMD(fromDay)}</text>
        <text x={VB_W - PAD.right} y={VB_H - 7} fontSize="10" fill="#9ca3af" textAnchor="end">{dateMD(toDay)}</text>
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {series.map((s) => (
          <span key={s.project.id} className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.project.color || '#9ca3af' }} />
            <span className="truncate max-w-[160px]">{s.project.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
