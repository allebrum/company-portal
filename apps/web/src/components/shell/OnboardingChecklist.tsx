'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Mail, FolderOpen, Users, Check, X, Sparkles, Briefcase, Clock, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useGmailStatus } from '@/hooks/useGmail';
import { useDriveStatus } from '@/hooks/useDrive';
import { useUsers, useClients, useEntries } from '@/hooks/useResources';
import { useIntegrationGate } from '@/components/shell/IntegrationGate';
import { useToast } from '@/components/ui/Toast';
import { UserFormModal } from '@/components/features/UserFormModal';
import { ClientFormModal } from '@/components/features/ClientFormModal';

// v1 stored '1' for "dismissed" — migrated to 'hidden' below.
const DISMISS_KEY = 'onboardingChecklist:dismissed:v1';
// 'open' = full card · 'pill' = compact progress pill (the "resume setup"
// affordance; also the mobile default since the card covers ~27% of a phone
// viewport) · 'hidden' = fully dismissed.
type Display = 'open' | 'pill' | 'hidden';

type Item = {
  key: string;
  label: string;
  icon: LucideIcon;
  done: boolean;
  cta: string;
  /** Either an action or a destination — exactly one is set. */
  onClick?: () => void;
  href?: string;
};

/**
 * First-run "finish setting up" card, pinned bottom-right. Tracks the setup
 * steps (connect Gmail, connect Drive, invite teammates), auto-checking each
 * as React Query status updates. Integration steps only render when the
 * instance has Google OAuth configured — on a self-host without it, the
 * connect buttons would dead-end in a JSON error. Dismissing the card
 * collapses it to a small pill first (so setup is resumable); dismissing the
 * pill hides it for good.
 */
export function OnboardingChecklist() {
  const { can } = useAuth();
  const gate = useIntegrationGate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: gmail } = useGmailStatus();
  const { data: drive } = useDriveStatus();
  const { data: users } = useUsers();
  const { data: clients } = useClients();
  const { data: entries } = useEntries();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);

  // One-click demo data (clearly named "Sample — …"), one-click removal.
  const sampleExists = (clients ?? []).some((c) => c.name.startsWith('Sample — '));
  const sampleData = useMutation({
    mutationFn: async (mode: 'create' | 'remove') => {
      if (mode === 'create') await api.post('/onboarding/sample-data');
      else await api.del('/onboarding/sample-data');
    },
    onSuccess: (_d, mode) => {
      void qc.invalidateQueries(); // clients/projects/goals/todos/bootstrap all change
      toast.success(mode === 'create' ? 'Sample data added — look around!' : 'Sample data removed');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Sample data failed'),
  });
  // Start hidden until the localStorage read resolves, to avoid a flash for
  // users who already dismissed it.
  const [display, setDisplay] = useState<Display>('hidden');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = window.localStorage.getItem(DISMISS_KEY);
      if (stored === '1' || stored === 'hidden') setDisplay('hidden');
      else if (stored === 'pill') setDisplay('pill');
      // No stored preference: compact pill on phones, full card otherwise.
      else setDisplay(window.matchMedia('(max-width: 639px)').matches ? 'pill' : 'open');
    } catch {
      setDisplay('open');
    }
  }, []);

  const setAndPersist = (next: Display) => {
    setDisplay(next);
    try {
      if (next === 'open') window.localStorage.removeItem(DISMISS_KEY);
      else window.localStorage.setItem(DISMISS_KEY, next);
    } catch {
      /* private mode / quota — fine, just won't persist */
    }
  };

  const canInvite = can('users.manage');
  const canDrive = can('media.manage') || can('integrations.manage');
  const canClients = can('clients.manage');
  const isWorkspaceAdmin = canInvite || canDrive || canClients;

  // Only decide visibility once status + data have loaded, so an already
  // set-up workspace never flashes an "incomplete" card.
  const ready =
    gmail !== undefined && drive !== undefined && users !== undefined &&
    clients !== undefined && entries !== undefined;

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [];
    // Core loop first — these are the steps that make the product real.
    if (canClients) {
      list.push({
        key: 'client',
        label: 'Create your first client',
        icon: Briefcase,
        done: (clients?.length ?? 0) > 0,
        cta: 'Create',
        onClick: () => setClientOpen(true),
      });
    }
    list.push({
      key: 'hour',
      label: 'Log your first hour',
      icon: Clock,
      done: (entries?.length ?? 0) > 0,
      cta: 'Log time',
      href: '/time',
    });
    if (gmail?.configured) {
      list.push({
        key: 'gmail',
        label: 'Connect Gmail',
        icon: Mail,
        done: !!gmail.connected,
        cta: 'Connect',
        onClick: () => gate.openConnect('gmail'),
      });
    }
    if (canDrive && drive?.configured) {
      list.push({
        key: 'drive',
        label: 'Connect Google Drive',
        icon: FolderOpen,
        done: !!drive.connected,
        cta: 'Connect',
        onClick: () => gate.openConnect('drive'),
      });
    }
    if (canInvite) {
      list.push({
        key: 'team',
        label: 'Invite your teammates',
        icon: Users,
        done: (users?.length ?? 0) > 1,
        cta: 'Invite',
        onClick: () => setInviteOpen(true),
      });
    }
    return list;
  }, [gmail, drive, users, clients, entries, canDrive, canInvite, canClients, gate]);

  const doneCount = items.filter((i) => i.done).length;
  const allDone = items.length === 0 || doneCount === items.length;

  const show = mounted && isWorkspaceAdmin && ready && !allDone && display !== 'hidden';

  return (
    <>
      {show && display === 'pill' && (
        <div className="fixed bottom-6 right-6 z-40 group flex items-center">
          <button
            onClick={() => setAndPersist('open')}
            className="flex items-center gap-2 rounded-full bg-white border border-gray-200 shadow-lg pl-3 pr-3.5 py-2 hover:shadow-xl hover:border-brand-300"
            aria-label={`Resume setup — ${doneCount} of ${items.length} steps done`}
          >
            <Sparkles className="w-4 h-4 text-brand-600" />
            <span className="text-xs font-bold text-gray-800 tabular-nums">
              {doneCount}/{items.length}
            </span>
          </button>
          <button
            onClick={() => setAndPersist('hidden')}
            aria-label="Hide setup checklist permanently"
            className="ml-1 w-6 h-6 rounded-full bg-white border border-gray-200 shadow items-center justify-center text-gray-500 hover:text-gray-700 hidden group-hover:flex"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {show && display === 'open' && (
        <div className="fixed bottom-6 right-6 z-40 w-80 max-w-[calc(100vw-2rem)] rounded-2xl bg-white border border-gray-200 shadow-xl">
          <div className="flex items-start justify-between gap-2 px-4 pt-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-brand-50 text-brand-600 grid place-items-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <div className="text-sm font-bold text-gray-900">Finish setting up</div>
                <div className="text-[12px] text-gray-500">
                  {doneCount} of {items.length} done
                </div>
              </div>
            </div>
            <button
              onClick={() => setAndPersist('pill')}
              aria-label="Minimize setup checklist"
              title="Minimize — resume any time from the pill"
              className="text-gray-500 hover:text-gray-700 -mt-1 -mr-1 p-1.5"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-4 mt-3">
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className="h-full bg-brand-600 transition-all duration-500"
                style={{ width: `${items.length ? (doneCount / items.length) * 100 : 0}%` }}
              />
            </div>
          </div>

          <ul className="px-2 py-2">
            {items.map((it) => {
              const Icon = it.icon;
              return (
                <li
                  key={it.key}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-gray-50"
                >
                  <span
                    className={cn(
                      'w-7 h-7 rounded-full grid place-items-center shrink-0',
                      it.done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500',
                    )}
                  >
                    {it.done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </span>
                  <span
                    className={cn(
                      'flex-1 text-sm',
                      it.done ? 'text-gray-400 line-through' : 'text-gray-800 font-medium',
                    )}
                  >
                    {it.label}
                  </span>
                  {!it.done &&
                    (it.href ? (
                      <Link
                        href={it.href}
                        className="text-xs font-semibold text-brand-700 hover:text-brand-800 px-2.5 py-1 rounded-lg hover:bg-brand-50"
                      >
                        {it.cta}
                      </Link>
                    ) : (
                      <button
                        onClick={it.onClick}
                        className="text-xs font-semibold text-brand-700 hover:text-brand-800 px-2.5 py-1 rounded-lg hover:bg-brand-50"
                      >
                        {it.cta}
                      </button>
                    ))}
                </li>
              );
            })}
          </ul>

          {/* Sample data: offered while the workspace is empty; removable
              once loaded. Server marks it by name ("Sample — …"). */}
          {canClients && (
            <div className="px-4 pb-3 -mt-1">
              {!sampleExists && (clients?.length ?? 0) === 0 && (
                <button
                  onClick={() => sampleData.mutate('create')}
                  disabled={sampleData.isPending}
                  className="text-[12px] text-gray-500 hover:text-brand-700 underline decoration-gray-300 hover:decoration-brand-400 disabled:opacity-60"
                >
                  {sampleData.isPending ? 'Loading sample data…' : 'Or explore with sample data'}
                </button>
              )}
              {sampleExists && (
                <button
                  onClick={() => sampleData.mutate('remove')}
                  disabled={sampleData.isPending}
                  className="text-[12px] text-gray-500 hover:text-red-600 underline decoration-gray-300 hover:decoration-red-300 disabled:opacity-60"
                >
                  {sampleData.isPending ? 'Removing…' : 'Remove sample data'}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {canInvite && <UserFormModal open={inviteOpen} onClose={() => setInviteOpen(false)} />}
      {canClients && <ClientFormModal open={clientOpen} onClose={() => setClientOpen(false)} />}
    </>
  );
}
