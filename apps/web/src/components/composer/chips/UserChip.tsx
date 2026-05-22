'use client';

import { useRef, useState } from 'react';
import { Popover } from '@/components/ui/Popover';
import { Avatar } from '@/components/ui/Avatar';
import { ChipButton } from './ChipButton';
import { SearchablePicker } from './SearchablePicker';
import type { UserRow } from '@/hooks/useResources';

export function UserChip({
  value,
  users,
  onChange,
  placeholder = 'Unassigned',
  allowClear = true,
}: {
  value: string | null;
  users: UserRow[];
  onChange: (next: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = users.find((u) => u.id === value) ?? null;

  return (
    <>
      <ChipButton
        ref={ref}
        variant={current ? 'default' : 'placeholder'}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? (
          <>
            <Avatar user={current} size={20} />
            <span className="truncate max-w-[12rem]">{current.name}</span>
          </>
        ) : (
          placeholder
        )}
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <SearchablePicker
          items={users}
          selectedId={value}
          onSelect={(u) => {
            onChange(u.id);
            setOpen(false);
          }}
          onClear={allowClear ? () => { onChange(null); setOpen(false); } : undefined}
          getLabel={(u) => u.name}
          placeholder="Search teammates…"
          renderRow={(u) => (
            <span className="inline-flex items-center gap-2">
              <Avatar user={u} size={18} />
              <span className="truncate">{u.name}</span>
            </span>
          )}
        />
      </Popover>
    </>
  );
}
