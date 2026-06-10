'use client';

import { useEffect, useMemo, useState } from 'react';
import { Mail, FolderOpen, Users, Check, X, Sparkles, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useGmailStatus } from '@/hooks/useGmail';
import { useDriveStatus } from '@/hooks/useDrive';
import { useUsers } from '@/hooks/useResources';
import { useIntegrationGate } from '@/components/shell/IntegrationGate';
import { UserFormModal } from '@/components/features/UserFormModal';

const DISMISS_KEY = 'onboardingChecklist:dismissed:v1';

type Item = {
  key: string;
  label: string;
  icon: LucideIcon;
  done: boolean;
  cta: string;
  onClick: () => void;
};

/**
 * First-run "finish setting up" card, pinned bottom-right. Tracks the three
 * setup steps (connect Gmail, connect Drive, invite teammates), auto-checking
 * each as React Query status updates — so connecting an integration anywhere
 * (incl. via the IntegrationGate modal) ticks it off here. Each open step links
 * straight into its connect/invite modal. Dismissible (persisted in
 * localStorage); only shown to workspace admins, and only while steps remain.
 */
export function OnboardingChecklist() {
  const { can } = useAuth();
  const gate = useIntegrationGate();
  const { data: gmail } = useGmailStatus();
  const { data: drive } = useDriveStatus();
  const { data: users } = useUsers();
  const [inviteOpen, setInviteOpen] = useState(false);
  // Hidden until the localStorage read resolves, to avoid a flash for users
  // who already dismissed it.
  const [dismissed, setDismissed] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  const canInvite = can('users.manage');
  const canDrive = can('media.manage') || can('integrations.manage');
  const isWorkspaceAdmin = canInvite || canDrive;

  // Only decide visibility once status + users have loaded, so an already
  // set-up workspace never flashes an "incomplete" card.
  const ready = gmail !== undefined && drive !== undefined && users !== undefined;

  const items = useMemo<Item[]>(() => {
    const list: Item[] = [
      {
        key: 'gmail',
        label: 'Connect Gmail',
        icon: Mail,
        done: !!gmail?.connected,
        cta: 'Connect',
        onClick: () => gate.openConnect('gmail'),
      },
    ];
    if (canDrive) {
      list.push({
        key: 'drive',
        label: 'Connect Google Drive',
        icon: FolderOpen,
        done: !!drive?.connected,
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
  }, [gmail, drive, users, canDrive, canInvite, gate]);

  const doneCount = items.filter((i) => i.done).length;
  const allDone = items.length > 0 && doneCount === items.length;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode / quota — fine, just won't persist */
    }
  };

  const showCard = mounted && isWorkspaceAdmin && ready && !dismissed && !allDone;

  return (
    <>
      {showCard && (
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
              onClick={dismiss}
              aria-label="Dismiss setup checklist"
              className="text-gray-400 hover:text-gray-700 -mt-1 -mr-1 p-1"
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
                      it.done ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400',
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
                  {!it.done && (
                    <button
                      onClick={it.onClick}
                      className="text-xs font-semibold text-brand-700 hover:text-brand-800 px-2.5 py-1 rounded-lg hover:bg-brand-50"
                    >
                      {it.cta}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canInvite && <UserFormModal open={inviteOpen} onClose={() => setInviteOpen(false)} />}
    </>
  );
}
