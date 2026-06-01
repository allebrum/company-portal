'use client';

import { useMemo, useRef, useState } from 'react';
import { Users } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { Avatar } from '@/components/ui/Avatar';
import { ChipButton } from './ChipButton';
import { SearchablePicker } from './SearchablePicker';
import { groupAccentColor } from '@/components/ui/AssigneeCell';
import type { UserRow, GroupRow } from '@/hooks/useResources';

/**
 * F25 — unified assignee/owner picker. Lists users AND groups in a single
 * searchable popover; selecting either writes the matching id and clears
 * the other. The server's XOR CHECK on `todos` / `goals` rejects mixed
 * pairs at the database layer, but we clear locally too so the UI can
 * never construct one in the first place.
 *
 * Groups are shown with a `Users` icon avatar (hash-derived color) so
 * they're visually distinct from people at a glance.
 */

export type AssigneePickerValue = { userId: string | null; groupId: string | null };

type ComboItem =
  | { id: string; kind: 'user'; label: string; user: UserRow }
  | { id: string; kind: 'group'; label: string; group: GroupRow };

export function AssigneeChip({
  value,
  users,
  groups,
  onChange,
  placeholder = 'Unassigned',
  allowClear = true,
}: {
  value: AssigneePickerValue;
  users: UserRow[];
  groups: GroupRow[];
  onChange: (next: AssigneePickerValue) => void;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const currentUser = value.userId ? users.find((u) => u.id === value.userId) ?? null : null;
  const currentGroup = value.groupId ? groups.find((g) => g.id === value.groupId) ?? null : null;

  // Combine into one searchable list. Users first (most common selection),
  // then groups; the SearchablePicker's filter operates on `getLabel`.
  const items: ComboItem[] = useMemo(
    () => [
      ...users.map<ComboItem>((u) => ({ id: `u:${u.id}`, kind: 'user', label: u.name, user: u })),
      ...groups.map<ComboItem>((g) => ({ id: `g:${g.id}`, kind: 'group', label: g.name, group: g })),
    ],
    [users, groups],
  );

  // SearchablePicker's `selectedId` is single-valued — encode whichever
  // side is set so the row highlights correctly.
  const selectedComboId = value.userId
    ? `u:${value.userId}`
    : value.groupId
      ? `g:${value.groupId}`
      : null;

  return (
    <>
      <ChipButton
        ref={ref}
        variant={currentUser || currentGroup ? 'default' : 'placeholder'}
        onClick={() => setOpen((o) => !o)}
      >
        {currentUser ? (
          <>
            <Avatar user={currentUser} size={20} />
            <span className="truncate max-w-[12rem]">{currentUser.name}</span>
          </>
        ) : currentGroup ? (
          <>
            <span
              className="inline-flex items-center justify-center rounded-full text-white"
              style={{ width: 20, height: 20, backgroundColor: groupAccentColor(currentGroup.id) ?? '#6b7280' }}
            >
              <Users className="w-3 h-3" />
            </span>
            <span
              className="truncate max-w-[12rem]"
              style={{ color: groupAccentColor(currentGroup.id) ?? '#374151' }}
            >
              {currentGroup.name}
            </span>
          </>
        ) : (
          placeholder
        )}
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <SearchablePicker
          items={items}
          selectedId={selectedComboId}
          getLabel={(it) => it.label}
          placeholder="Search teammates or groups…"
          onSelect={(it) => {
            if (it.kind === 'user') {
              onChange({ userId: it.user.id, groupId: null });
            } else {
              onChange({ userId: null, groupId: it.group.id });
            }
            setOpen(false);
          }}
          onClear={allowClear ? () => { onChange({ userId: null, groupId: null }); setOpen(false); } : undefined}
          renderRow={(it) => {
            if (it.kind === 'user') {
              return (
                <span className="inline-flex items-center gap-2">
                  <Avatar user={it.user} size={18} />
                  <span className="truncate">{it.user.name}</span>
                </span>
              );
            }
            const color = groupAccentColor(it.group.id) ?? '#6b7280';
            return (
              <span className="inline-flex items-center gap-2">
                <span
                  className="inline-flex items-center justify-center rounded-full text-white"
                  style={{ width: 18, height: 18, backgroundColor: color }}
                >
                  <Users className="w-2.5 h-2.5" />
                </span>
                <span className="truncate" style={{ color }}>
                  {it.group.name}
                </span>
                <span className="text-[10px] uppercase tracking-wider text-gray-400 ml-auto">Group</span>
              </span>
            );
          }}
        />
      </Popover>
    </>
  );
}
