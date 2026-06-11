'use client';

import type { UserRow } from '@/hooks/useResources';

/**
 * S3.3 — horizontal utilization bars (billable share of tracked time), one
 * row per person with tracked time in range. Plain styled divs per the
 * WorkloadView house pattern; display capped at 100%, overflow tinted red.
 */
export function UtilizationBars({
  rows,
}: {
  rows: Array<{ user: UserRow; totalMin: number; billableMin: number }>;
}) {
  const active = rows.filter((r) => r.totalMin > 0);
  if (active.length === 0) {
    return <div className="px-4 py-3 text-sm text-gray-500">No tracked time in this range.</div>;
  }
  return (
    <div className="p-4 space-y-2">
      {active.map((r) => {
        const pct = Math.round((r.billableMin / r.totalMin) * 100);
        return (
          <div key={r.user.id} className="grid grid-cols-[160px_1fr_44px] gap-3 items-center">
            <div className="text-sm text-gray-800 truncate">{r.user.name}</div>
            <div className="relative h-4 bg-gray-100 rounded-md overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-md"
                style={{ width: `${Math.min(100, pct)}%`, backgroundColor: r.user.color || '#9ca3af' }}
              />
              {pct > 100 && (
                <div
                  className="absolute inset-y-0 right-0 bg-red-500/30"
                  style={{ width: `${Math.min(100, pct - 100)}%` }}
                />
              )}
            </div>
            <div className="text-right text-xs text-gray-600 tabular-nums">{pct}%</div>
          </div>
        );
      })}
    </div>
  );
}
