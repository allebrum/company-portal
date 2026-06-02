'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Briefcase, Clock, CheckSquare, Target, Shield, BarChart3, Settings, FolderOpen, Wrench } from 'lucide-react';
import type { Permission } from '@allebrum/shared';
import { useEntries, useAuthConfig } from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import { Avatar } from '../ui/Avatar';
import { Button } from '../ui/Button';
import { cn } from '@/lib/utils';

const NAV: { id: string; href: string; label: string; Icon: typeof Home; anyPerm?: Permission[] }[] = [
  { id: 'dashboard', href: '/dashboard', label: 'Dashboard', Icon: Home },
  { id: 'clients', href: '/clients', label: 'Clients', Icon: Briefcase },
  { id: 'time', href: '/time', label: 'Time tracking', Icon: Clock },
  { id: 'todos', href: '/todos', label: 'To-dos', Icon: CheckSquare },
  { id: 'roadmap', href: '/roadmap', label: 'Roadmap', Icon: Target },
  { id: 'media', href: '/media', label: 'Media', Icon: FolderOpen, anyPerm: ['media.manage', 'integrations.manage'] },
  { id: 'approvals', href: '/approvals', label: 'Approvals', Icon: Shield },
  { id: 'reports', href: '/reports', label: 'Reports', Icon: BarChart3 },
  { id: 'tools', href: '/tools', label: 'Tools', Icon: Wrench },
  { id: 'admin', href: '/admin', label: 'Admin', Icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { me, can, logout } = useAuth();
  const { data: entries } = useEntries();
  const { data: cfg } = useAuthConfig();
  const pending = (entries ?? []).filter((e) => e.status === 'submitted').length;

  // Branding from the public auth config — cached + auto-invalidated on
  // settings changes, so the sidebar updates within a query refresh after
  // an admin edits Branding settings.
  const portalName = cfg?.portalName ?? 'Allebrum';
  const brandColor = cfg?.brandPrimaryColor ?? '#9333ea';
  const logoDataUrl = cfg?.brandLogoDataUrl ?? null;

  return (
    <aside className="w-60 shrink-0 h-full bg-white border-r border-gray-200 text-gray-700 flex flex-col">
      <div className="px-5 pt-5 pb-4 flex items-center gap-2.5">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md overflow-hidden"
          style={{ backgroundColor: brandColor }}
        >
          {logoDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoDataUrl} alt={`${portalName} logo`} className="w-full h-full object-contain" />
          ) : (
            <span className="text-white text-base font-bold">{portalName.charAt(0).toUpperCase() || 'A'}</span>
          )}
        </div>
        <div className="leading-tight">
          <div className="font-bold text-base tracking-tight text-gray-900">{portalName}</div>
          <div
            className="text-[10px] uppercase tracking-widest font-semibold"
            style={{ color: brandColor }}
          >
            Company portal
          </div>
        </div>
      </div>

      <nav className="px-2 pt-2 pb-4 flex-1 overflow-y-auto">
        {NAV.filter((item) => !item.anyPerm || item.anyPerm.some((p) => can(p))).map((item) => {
          const active = pathname?.startsWith(item.href);
          const showBadge = item.id === 'approvals' && pending > 0 && can('time_entry.approve');
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cn(
                'group w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-semibold transition-colors mb-0.5',
                active
                  ? 'bg-brand-600 text-white shadow-md'
                  : 'text-gray-700 hover:bg-brand-50 hover:text-brand-700',
              )}
            >
              <item.Icon className={cn('w-4 h-4', active ? 'text-white' : 'text-gray-400 group-hover:text-brand-600')} />
              <span className="flex-1">{item.label}</span>
              {showBadge && (
                <span
                  className={cn(
                    'text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full min-w-[20px] text-center',
                    active ? 'bg-white/25 text-white' : 'bg-brand-600 text-white',
                  )}
                >
                  {pending}
                </span>
              )}
            </Link>
          );
        })}
        <div className="mt-6 px-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold mb-2">Shortcuts</div>
          <div className="space-y-2 text-xs text-gray-500">
            <div className="flex items-center justify-between">
              <span>Start timer</span>
              <kbd className="kbd">Cmd/Ctrl+Shift+T</kbd>
            </div>
            <div className="flex items-center justify-between">
              <span>New to-do</span>
              <kbd className="kbd">Cmd/Ctrl+Shift+N</kbd>
            </div>
          </div>
        </div>
      </nav>

      <div className="border-t border-gray-200 p-3 flex items-center gap-2">
        <Link
          href="/security"
          className="flex items-center gap-2 flex-1 min-w-0 rounded-lg p-1 -m-1 hover:bg-gray-50"
          title="Account security"
        >
          <Avatar user={me ?? undefined} size={32} />
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-sm font-semibold text-gray-900 truncate">{me?.name ?? '—'}</div>
            <div className="text-[11px] text-gray-500 truncate">{me?.email}</div>
          </div>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => logout()} title="Sign out">
          Sign out
        </Button>
      </div>
    </aside>
  );
}
