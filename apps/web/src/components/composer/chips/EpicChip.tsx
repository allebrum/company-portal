'use client';

import { useMemo, useRef, useState } from 'react';
import { Layers } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { ChipButton } from './ChipButton';
import { SearchablePicker } from './SearchablePicker';
import { useCreateEpic, type EpicRow } from '@/hooks/useResources';
import { useToast } from '@/components/ui/Toast';

export function EpicChip({
  value, projectId, clientId, epics, onChange,
}: {
  value: string | null;
  projectId: string | null;
  clientId: string | null;
  epics: EpicRow[];
  onChange: (next: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const create = useCreateEpic();
  const toast = useToast();
  const scoped = useMemo(() => (projectId ? epics.filter((e) => e.projectId === projectId) : []), [epics, projectId]);
  const current = scoped.find((e) => e.id === value) ?? null;
  const disabled = !projectId || !clientId;

  const onCreate = async (title: string) => {
    if (!projectId || !clientId) return;
    try {
      const row = await create.mutateAsync({ projectId, clientId, title });
      onChange(row.id);
      setOpen(false);
      toast.success(`Epic "${row.title}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create epic');
    }
  };

  return (
    <>
      <ChipButton
        ref={ref}
        variant={current ? 'default' : 'placeholder'}
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
        title={disabled ? 'Pick a project first' : undefined}
        style={current ? { color: current.color } : undefined}
      >
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate max-w-[12rem]">{current ? current.title : disabled ? 'Pick a project first' : 'No epic'}</span>
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <SearchablePicker
          items={scoped.map((e) => ({ id: e.id, title: e.title }))}
          selectedId={value}
          onSelect={(e) => { onChange(e.id); setOpen(false); }}
          onClear={() => { onChange(null); setOpen(false); }}
          onCreate={onCreate}
          creating={create.isPending}
          getLabel={(e) => e.title}
          placeholder="Search or create an epic…"
          clearLabel="— No epic —"
        />
      </Popover>
    </>
  );
}
