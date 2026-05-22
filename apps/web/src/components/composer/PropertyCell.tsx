'use client';

import { type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * One cell in the composer's 3-column property grid: tiny uppercase label
 * with an icon on the top row, chip slot below. Empty chip slots still
 * occupy `min-h-[32px]` so the grid doesn't collapse around them.
 */
export function PropertyCell({
  icon: Icon,
  label,
  span = 1,
  children,
}: {
  icon: LucideIcon;
  label: string;
  span?: 1 | 2 | 3;
  children: ReactNode;
}) {
  const spanCls =
    span === 2 ? 'sm:col-span-2' : span === 3 ? 'sm:col-span-2 lg:col-span-3' : '';
  return (
    <div className={`flex flex-col gap-2 min-w-0 ${spanCls}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400">
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 min-h-[32px]">{children}</div>
    </div>
  );
}
