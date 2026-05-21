'use client';

import { useMemo, useRef, useState } from 'react';
import { Popover } from '@/components/ui/Popover';
import { ChipButton } from './ChipButton';
import { SearchablePicker } from './SearchablePicker';
import type { ProjectRow } from '@/hooks/useResources';

export function ProjectChip({
  value,
  clientId,
  projects,
  onChange,
  allowClear = true,
}: {
  value: string | null;
  /** Filter to projects belonging to this client. */
  clientId: string | null;
  projects: ProjectRow[];
  onChange: (next: string | null) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const scoped = useMemo(
    () => (clientId ? projects.filter((p) => p.clientId === clientId) : []),
    [projects, clientId],
  );
  const current = scoped.find((p) => p.id === value) ?? null;
  const disabled = !clientId;

  return (
    <>
      <ChipButton
        ref={ref}
        variant={current ? 'default' : 'placeholder'}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? 'Pick a client first' : undefined}
      >
        {current ? (
          <span className="truncate max-w-[14rem]">{current.name}</span>
        ) : disabled ? (
          'Pick a client first'
        ) : (
          'Pick a project'
        )}
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <SearchablePicker
          items={scoped}
          selectedId={value}
          onSelect={(p) => {
            onChange(p.id);
            setOpen(false);
          }}
          onClear={allowClear ? () => { onChange(null); setOpen(false); } : undefined}
          getLabel={(p) => p.name}
          placeholder="Search projects…"
          renderRow={(p) => (
            <span className="inline-flex items-center gap-2">
              <span className="truncate">{p.name}</span>
              {p.code && <span className="text-xs text-gray-400 ml-auto pl-2 shrink-0">{p.code}</span>}
            </span>
          )}
        />
      </Popover>
    </>
  );
}
