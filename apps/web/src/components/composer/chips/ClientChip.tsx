'use client';

import { useRef, useState } from 'react';
import { Popover } from '@/components/ui/Popover';
import { ChipButton } from './ChipButton';
import { SearchablePicker } from './SearchablePicker';
import { useCreateClient, type ClientRow } from '@/hooks/useResources';
import { useToast } from '@/components/ui/Toast';

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
  const createClient = useCreateClient();
  const toast = useToast();

  const onCreate = async (name: string) => {
    try {
      const row = await createClient.mutateAsync({ name });
      onChange(row.id);
      setOpen(false);
      toast.success(`Client "${row.name}" created`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create client');
    }
  };

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
          onCreate={onCreate}
          creating={createClient.isPending}
          getLabel={(c) => c.name}
          placeholder="Search or create a client…"
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
