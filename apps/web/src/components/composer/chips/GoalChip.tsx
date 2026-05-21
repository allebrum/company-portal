'use client';

import { useMemo, useRef, useState } from 'react';
import { Popover } from '@/components/ui/Popover';
import { ChipButton } from './ChipButton';
import { SearchablePicker } from './SearchablePicker';
import type { GoalRow } from '@/hooks/useResources';

export function GoalChip({
  value,
  projectId,
  goals,
  onChange,
  allowClear = true,
}: {
  value: string | null;
  /** Filter to goals belonging to this project. */
  projectId: string | null;
  goals: GoalRow[];
  onChange: (next: string | null) => void;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const scoped = useMemo(
    () => (projectId ? goals.filter((g) => g.projectId === projectId) : []),
    [goals, projectId],
  );
  const current = scoped.find((g) => g.id === value) ?? null;
  const disabled = !projectId;

  return (
    <>
      <ChipButton
        ref={ref}
        variant={current ? 'default' : 'placeholder'}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? 'Pick a project first' : undefined}
      >
        {current ? (
          <span className="truncate max-w-[14rem]">{current.title}</span>
        ) : disabled ? (
          'Pick a project first'
        ) : (
          'Link to a goal'
        )}
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <SearchablePicker
          items={scoped.map((g) => ({ id: g.id, title: g.title }))}
          selectedId={value}
          onSelect={(g) => {
            onChange(g.id);
            setOpen(false);
          }}
          onClear={allowClear ? () => { onChange(null); setOpen(false); } : undefined}
          getLabel={(g) => g.title}
          placeholder="Search goals…"
          clearLabel="— No goal —"
        />
      </Popover>
    </>
  );
}
