'use client';

import { Users } from 'lucide-react';
import { Avatar, type AvatarUser } from './Avatar';
import { cn } from '@/lib/utils';

/**
 * F25 — single shared cell that renders either a user avatar OR a group
 * pill. Used everywhere we display "who's on this" — ItemComposer,
 * SpaceTodoCard, SpaceGoalCard, todos page rows, the dashboard's flat
 * Your-Plate-Today list, etc.
 *
 * Caller passes a user-OR-group pair (`userId?, groupId?`) plus the
 * resolved row data (so this stays a pure render). One of the two should
 * be set; both null = "unassigned" treatment.
 */

export type AssigneeCellProps = {
  user?: AvatarUser | null;
  group?: { id: string; name: string } | null;
  size?: 'sm' | 'md' | 'lg';
  /** Hide the label and only render the avatar/pill (e.g. on dense rows). */
  iconOnly?: boolean;
  className?: string;
};

/**
 * Stable, hash-derived hue per group id so two unrelated groups don't
 * collide on color. Saturation + lightness fixed for readable contrast
 * against white text. (Groups don't carry a `color` column today; adding
 * one is a follow-up if a manual palette becomes useful.)
 */
function groupColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 55% 42%)`;
}

function groupInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

const AVATAR_SIZES: Record<NonNullable<AssigneeCellProps['size']>, number> = {
  sm: 20,
  md: 24,
  lg: 32,
};

const LABEL_TEXT: Record<NonNullable<AssigneeCellProps['size']>, string> = {
  sm: 'text-[11px]',
  md: 'text-xs',
  lg: 'text-sm',
};

export function AssigneeCell({
  user,
  group,
  size = 'md',
  iconOnly = false,
  className,
}: AssigneeCellProps) {
  const px = AVATAR_SIZES[size];

  // Group branch — render a pill with a Users icon avatar.
  if (group) {
    const color = groupColor(group.id);
    return (
      <span
        className={cn('inline-flex items-center gap-1.5 min-w-0', className)}
        title={`Group · ${group.name}`}
      >
        <span
          className="inline-flex items-center justify-center rounded-full text-white shrink-0"
          style={{ width: px, height: px, backgroundColor: color }}
          aria-label={`Group ${group.name}`}
        >
          <Users style={{ width: px * 0.55, height: px * 0.55 }} />
        </span>
        {!iconOnly && (
          <span
            className={cn('font-semibold truncate', LABEL_TEXT[size])}
            style={{ color }}
          >
            {group.name}
          </span>
        )}
      </span>
    );
  }

  // User branch — Avatar primitive + name.
  if (user) {
    return (
      <span className={cn('inline-flex items-center gap-1.5 min-w-0', className)} title={user.name ?? ''}>
        <Avatar user={user} size={px} />
        {!iconOnly && (
          <span className={cn('font-semibold text-gray-700 truncate', LABEL_TEXT[size])}>
            {user.name ?? '—'}
          </span>
        )}
      </span>
    );
  }

  // Unassigned — neutral dashed circle so it's clear nothing is set.
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-gray-400', className)}>
      <span
        className="inline-flex items-center justify-center rounded-full border-2 border-dashed border-gray-300 shrink-0"
        style={{ width: px, height: px }}
        aria-label="Unassigned"
      />
      {!iconOnly && (
        <span className={cn('italic', LABEL_TEXT[size])}>Unassigned</span>
      )}
    </span>
  );
}

/** Helper for callers that just want the raw group-color used by the cell. */
export function groupAccentColor(groupId: string | null | undefined): string | null {
  return groupId ? groupColor(groupId) : null;
}

/** Small standalone chip — "Team · {groupName}" — for the dashboard list pills, etc. */
export function GroupChip({ group, size = 'sm' }: { group: { id: string; name: string }; size?: 'sm' | 'md' }) {
  const color = groupColor(group.id);
  const px = size === 'sm' ? 14 : 18;
  const cls = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-1';
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-full font-semibold', cls)}
      style={{ backgroundColor: `${color}1a`, color }}
      title={`Group · ${group.name}`}
    >
      <Users style={{ width: px * 0.7, height: px * 0.7 }} />
      <span className="truncate max-w-[120px]">{group.name}</span>
    </span>
  );
}
