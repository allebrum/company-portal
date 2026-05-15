'use client';

import { cn } from '@/lib/utils';

export type AvatarUser = {
  id?: string;
  name?: string;
  initials?: string;
  color?: string;
};

export function Avatar({
  user,
  size = 32,
  className,
}: {
  user?: AvatarUser | null;
  size?: number;
  className?: string;
}) {
  const initials = user?.initials ?? (user?.name ? user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase() : '?');
  const bg = user?.color ?? '#6b7280';
  return (
    <div
      className={cn('inline-flex items-center justify-center rounded-full font-semibold text-white', className)}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
      aria-label={user?.name ?? 'User'}
    >
      {initials}
    </div>
  );
}

export function AvatarStack({ users, size = 24, max = 4 }: { users: AvatarUser[]; size?: number; max?: number }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <div className="flex items-center -space-x-2">
      {shown.map((u, i) => (
        <div key={u.id ?? i} className="ring-2 ring-white rounded-full">
          <Avatar user={u} size={size} />
        </div>
      ))}
      {rest > 0 && (
        <div
          className="ring-2 ring-white rounded-full bg-gray-200 text-gray-700 inline-flex items-center justify-center text-[10px] font-semibold"
          style={{ width: size, height: size }}
        >
          +{rest}
        </div>
      )}
    </div>
  );
}
