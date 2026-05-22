'use client';

import { useRef, useState } from 'react';
import { Search, Building2, Folder, Flag } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils';
import { toneColor, DEFAULT_STATUSES } from '@/lib/roadmap';
import type { ClientRow, ProjectRow, ProjectStatusRow } from '@/hooks/useResources';

export type RoadmapFilters = {
  client: string | null;
  project: string | null;
  status: string | null;
  q: string;
};

type Opt = { id: string; label: string; color: string };

function FilterChip({
  icon: Icon, label, value, options, onChange,
}: {
  icon: typeof Flag;
  label: string;
  value: string | null;
  options: Opt[];
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.id === value) ?? null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition-colors',
          current ? 'bg-brand-50 border-brand-200 text-brand-800' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50',
        )}
      >
        {current ? <span className="w-2 h-2 rounded-full" style={{ backgroundColor: current.color }} /> : <Icon className="w-3.5 h-3.5" />}
        <span className="truncate max-w-[10rem]">{current ? current.label : label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={224}>
        <div className="w-56 max-h-72 overflow-y-auto py-1">
          <button type="button" onClick={() => { onChange(null); setOpen(false); }} className={cn('w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50', value === null ? 'text-brand-700 font-semibold' : 'text-gray-500')}>
            Any {label.toLowerCase()}
          </button>
          {options.map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange(o.id); setOpen(false); }} className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50', o.id === value ? 'text-brand-700 font-semibold' : 'text-gray-800')}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: o.color }} />
              <span className="truncate">{o.label}</span>
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

export function FilterBar({
  filters, onChange, clients, projects, statuses,
}: {
  filters: RoadmapFilters;
  onChange: (f: RoadmapFilters) => void;
  clients: ClientRow[];
  projects: ProjectRow[];
  statuses: ProjectStatusRow[];
}) {
  const set = (patch: Partial<RoadmapFilters>) => onChange({ ...filters, ...patch });
  const active = filters.client || filters.project || filters.status || filters.q;
  const statusOpts = (statuses.length ? statuses : DEFAULT_STATUSES).map((s) => ({ id: s.id, label: s.label, color: toneColor(s.tone) }));

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          placeholder="Search goals…"
          className="w-[200px] pl-8 pr-2 py-1.5 text-xs rounded-lg border border-gray-200 outline-none focus:border-brand-400"
        />
      </div>
      <FilterChip icon={Building2} label="Client" value={filters.client} onChange={(v) => set({ client: v })}
        options={clients.map((c) => ({ id: c.id, label: c.name, color: c.color }))} />
      <FilterChip icon={Folder} label="Project" value={filters.project} onChange={(v) => set({ project: v })}
        options={projects.map((p) => ({ id: p.id, label: p.name, color: '#9ca3af' }))} />
      <FilterChip icon={Flag} label="Status" value={filters.status} onChange={(v) => set({ status: v })} options={statusOpts} />
      {active && (
        <button type="button" onClick={() => onChange({ client: null, project: null, status: null, q: '' })} className="text-xs font-medium text-gray-400 hover:text-gray-700">
          Clear
        </button>
      )}
    </div>
  );
}
