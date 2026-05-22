'use client';

import { useRef, useState } from 'react';
import { ChevronDown, FolderTree, Check } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import type { Scope } from '@/lib/roadmap';
import type { ClientRow, ProjectRow } from '@/hooks/useResources';

export function ScopeSwitcher({
  scope, onChange, clients, projects,
}: {
  scope: Scope;
  onChange: (s: Scope) => void;
  clients: ClientRow[];
  projects: ProjectRow[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const label =
    scope.kind === 'all'
      ? 'All clients'
      : scope.kind === 'client'
        ? clients.find((c) => c.id === scope.id)?.name ?? 'Client'
        : projects.find((p) => p.id === scope.id)?.name ?? 'Project';
  const dot =
    scope.kind === 'client'
      ? clients.find((c) => c.id === scope.id)?.color
      : scope.kind === 'project'
        ? clients.find((c) => c.id === projects.find((p) => p.id === scope.id)?.clientId)?.color
        : undefined;

  const pick = (s: Scope) => { onChange(s); setOpen(false); };

  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm font-semibold text-gray-800 hover:bg-gray-50"
      >
        {dot ? <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dot }} /> : <FolderTree className="w-3.5 h-3.5 text-gray-400" />}
        {label}
        <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} width={320}>
        <div className="w-80 max-h-[70vh] overflow-y-auto py-1">
          <button
            type="button"
            onClick={() => pick({ kind: 'all' })}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50"
          >
            <FolderTree className="w-4 h-4 text-gray-400" />
            <span className="flex-1 text-left font-medium">All clients</span>
            {scope.kind === 'all' && <Check className="w-4 h-4 text-brand-600" />}
          </button>
          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-400">By client</div>
          {clients.map((c) => {
            const cps = projects.filter((p) => p.clientId === c.id);
            return (
              <div key={c.id}>
                <button
                  type="button"
                  onClick={() => pick({ kind: 'client', id: c.id })}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                  <span className="flex-1 text-left font-medium truncate">{c.name}</span>
                  <span className="text-[11px] text-gray-400">{cps.length}</span>
                  {scope.kind === 'client' && scope.id === c.id && <Check className="w-4 h-4 text-brand-600" />}
                </button>
                {cps.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => pick({ kind: 'project', id: p.id })}
                    className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-sm hover:bg-gray-50 text-gray-600"
                  >
                    <span className="flex-1 text-left truncate">{p.name}</span>
                    {p.statuses && p.statuses.length > 0 && (
                      <span className="text-[10px] font-semibold text-brand-700 bg-brand-50 px-1.5 py-0.5 rounded">Custom</span>
                    )}
                    {scope.kind === 'project' && scope.id === p.id && <Check className="w-4 h-4 text-brand-600" />}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </Popover>
    </>
  );
}
