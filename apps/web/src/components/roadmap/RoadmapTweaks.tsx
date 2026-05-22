'use client';

import { useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Tweaks } from './types';
import type { ColorBy } from '@/lib/roadmap';

function Seg<T extends string>({
  value, options, onChange, grid = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  grid?: boolean;
}) {
  return (
    <div className={cn('gap-1', grid ? 'grid grid-cols-3' : 'inline-flex bg-gray-100 rounded-lg p-0.5')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors',
            o.value === value ? 'bg-white text-brand-700 shadow-sm border border-gray-200' : 'text-gray-600 hover:text-gray-900',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-gray-700 cursor-pointer">
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!on)}
        className={cn('relative w-9 h-5 rounded-full transition-colors', on ? 'bg-brand-600' : 'bg-gray-300')}
      >
        <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform', on && 'translate-x-4')} />
      </button>
    </label>
  );
}

/** Local "View options" panel (the design spec's postMessage host doesn't
 *  exist in our standalone app, so this is a normal toggle + popover). */
export function RoadmapTweaks({ tw, onChange }: { tw: Tweaks; onChange: (next: Tweaks) => void }) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Tweaks>) => onChange({ ...tw, ...patch });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 hover:bg-gray-50"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" /> View options
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[90]" onClick={() => setOpen(false)} />
          <div className="fixed bottom-6 right-6 z-[95] w-72 bg-white rounded-2xl shadow-2xl border border-gray-200 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-bold text-gray-900">View options</div>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Density</div>
              <Seg value={tw.density} onChange={(v) => set({ density: v })} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }]} />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Color cards by</div>
              <Seg<ColorBy> grid value={tw.colorBy} onChange={(v) => set({ colorBy: v })} options={[
                { value: 'status', label: 'Status' }, { value: 'priority', label: 'Priority' }, { value: 'owner', label: 'Owner' },
                { value: 'client', label: 'Client' }, { value: 'health', label: 'Health' },
              ]} />
            </div>
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Group Kanban by</div>
              <Seg grid value={tw.groupByKanban} onChange={(v) => set({ groupByKanban: v })} options={[
                { value: 'status', label: 'Status' }, { value: 'owner', label: 'Owner' }, { value: 'priority', label: 'Priority' },
                { value: 'epic', label: 'Epic' }, { value: 'client', label: 'Client' },
              ]} />
            </div>
            <div className="space-y-2.5 pt-1 border-t border-gray-100">
              <Toggle label="Show done goals" on={tw.showDone} onChange={(v) => set({ showDone: v })} />
              <Toggle label="Dependencies on Gantt" on={tw.showDependencies} onChange={(v) => set({ showDependencies: v })} />
              <Toggle label="Show milestones" on={tw.showMilestones} onChange={(v) => set({ showMilestones: v })} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
