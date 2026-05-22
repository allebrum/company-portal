'use client';

import { LayoutGrid, GanttChartSquare, List, Calendar, Users, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type RoadmapView = 'kanban' | 'gantt' | 'list' | 'calendar' | 'lanes' | 'workload';

const TABS: { id: RoadmapView; label: string; Icon: typeof List }[] = [
  { id: 'kanban', label: 'Kanban', Icon: LayoutGrid },
  { id: 'gantt', label: 'Gantt', Icon: GanttChartSquare },
  { id: 'list', label: 'List', Icon: List },
  { id: 'calendar', label: 'Calendar', Icon: Calendar },
  { id: 'lanes', label: 'By owner', Icon: Users },
  { id: 'workload', label: 'Workload', Icon: BarChart3 },
];

export function ViewSwitch({ view, onChange }: { view: RoadmapView; onChange: (v: RoadmapView) => void }) {
  return (
    <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
      {TABS.map((t) => {
        const active = t.id === view;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onChange(t.id)}
            className={cn(
              'px-2.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors',
              active ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600 hover:text-gray-900',
            )}
          >
            <t.Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}
