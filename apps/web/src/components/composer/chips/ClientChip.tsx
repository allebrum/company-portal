'use client';

import { useRef, useState } from 'react';
import { Popover } from '@/components/ui/Popover';
import { ChipButton } from './ChipButton';
import { SearchablePicker } from './SearchablePicker';
import type { ClientRow } from '@/hooks/useResources';

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

export function ClientChip({
  value,
  clients,
  onChange,
  placeholder = 'Pick a client',
  allowClear = true,
}: {
  value: string | null;
  clients: ClientRow[];
  onChange: (next: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = clients.find((c) => c.id === value) ?? null;

  return (
    <>
      <ChipButton
        ref={ref}
        variant={current ? 'default' : 'placeholder'}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? (
          <>
            <Dot color={current.color} />
            <span className="truncate max-w-[12rem]">{current.name}</span>
          </>
        ) : (
          placeholder
        )}
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <SearchablePicker
          items={clients}
          selectedId={value}
          onSelect={(c) => {
            onChange(c.id);
            setOpen(false);
          }}
          onClear={allowClear ? () => { onChange(null); setOpen(false); } : undefined}
          getLabel={(c) => c.name}
          placeholder="Search clients…"
          renderRow={(c) => (
            <span className="inline-flex items-center gap-2">
              <Dot color={c.color} />
              <span className="truncate">{c.name}</span>
            </span>
          )}
        />
      </Popover>
    </>
  );
}
