'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Field';
import { Avatar } from '@/components/ui/Avatar';
import { useUsers } from '@/hooks/useResources';

/**
 * Teammate picker for the `/mention` slash command. Appends "@FirstName "
 * to the active block's content; doesn't create a notification or any
 * persistent reference today (the spec calls that out as out-of-scope).
 */
export function MentionPicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (name: string) => void;
}) {
  const { data: users = [] } = useUsers();
  const [q, setQ] = useState('');

  useEffect(() => {
    if (open) {
      setQ('');
      document.body.setAttribute('data-space-modal-open', '1');
    } else {
      document.body.removeAttribute('data-space-modal-open');
    }
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [open]);

  const filtered = useMemo(() => {
    if (!q) return users;
    const needle = q.toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle));
  }, [users, q]);

  return (
    <Modal open={open} onClose={onClose} title="Mention a teammate" size="sm">
      <div className="space-y-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter…"
          autoFocus
        />
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {filtered.length === 0 && (
            <div className="text-[12px] text-gray-400 px-1">No matches.</div>
          )}
          {filtered.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => onPick(u.name)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-brand-50 text-left"
            >
              <Avatar user={u} size={24} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-gray-900 font-semibold truncate">{u.name}</span>
                <span className="block text-[11px] text-gray-500 truncate">{u.email}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
