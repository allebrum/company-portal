'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { qk } from '@/lib/queryKeys';
import { EV, type ActivityPayload, type TimerPayload } from '@modernzen/shared';
import { AuthProvider } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { SpaceProvider } from '@/contexts/SpaceContext';
import { UploadManagerProvider } from '@/contexts/UploadManagerContext';
import { PostHogBindings } from '@/components/analytics/PostHogBindings';

function LiveEventBindings(): null {
  const qc = useQueryClient();
  useEffect(() => {
    const s = getSocket();
    // Realtime disabled (serverless deploy with no Socket.IO server) — skip all
    // live bindings; data stays fresh via TanStack Query refetching.
    if (!s) return;

    const invalidate = (keys: ReadonlyArray<readonly unknown[]>) => {
      for (const k of keys) qc.invalidateQueries({ queryKey: k as unknown[] });
    };

    s.on(EV.USER_CREATED, () => invalidate([qk.users]));
    s.on(EV.USER_UPDATED, () => invalidate([qk.users, qk.bootstrap]));
    s.on(EV.USER_DELETED, () => invalidate([qk.users]));
    s.on(EV.GROUP_UPDATED, () => invalidate([qk.groups, qk.bootstrap]));
    s.on(EV.SETTINGS_UPDATED, () => invalidate([['settings'], ['authConfig']]));

    s.on(EV.CLIENT_CREATED, () => invalidate([qk.clients]));
    s.on(EV.CLIENT_UPDATED, () => invalidate([qk.clients]));
    s.on(EV.PROJECT_CREATED, () => invalidate([qk.projects]));
    s.on(EV.PROJECT_UPDATED, () => invalidate([qk.projects]));

    s.on(EV.GOAL_CREATED, () => invalidate([qk.goals]));
    s.on(EV.GOAL_UPDATED, () => invalidate([qk.goals]));
    s.on(EV.GOAL_MOVED, () => invalidate([qk.goals]));
    s.on(EV.GOAL_RESOURCE_ADDED, () => invalidate([qk.goals]));
    s.on(EV.GOAL_RESOURCE_REMOVED, () => invalidate([qk.goals]));

    s.on(EV.TODO_CREATED, () => invalidate([qk.todos]));
    s.on(EV.TODO_UPDATED, () => invalidate([qk.todos]));
    s.on(EV.TODO_DELETED, () => invalidate([qk.todos]));

    s.on(EV.TICKET_CREATED, () => invalidate([qk.tickets]));
    s.on(EV.TICKET_UPDATED, () => invalidate([qk.tickets, qk.todos]));
    s.on(EV.TICKET_MESSAGE, () => invalidate([qk.tickets]));

    s.on(EV.ENTRY_CREATED, () => invalidate([['entries']]));
    s.on(EV.ENTRY_UPDATED, () => invalidate([['entries']]));
    s.on(EV.ENTRY_DELETED, () => invalidate([['entries']]));
    s.on(EV.ENTRY_SUBMITTED, () => invalidate([['entries']]));
    s.on(EV.ENTRY_APPROVED, () => invalidate([['entries']]));
    s.on(EV.ENTRY_REJECTED, () => invalidate([['entries']]));
    s.on(EV.ENTRY_REOPENED, () => invalidate([['entries']]));

    const onTimerStart = (p: TimerPayload) => {
      qc.setQueryData(qk.timers, (prev: TimerPayload[] | undefined) => {
        const others = (prev ?? []).filter((t) => t.userId !== p.userId);
        return [...others, p];
      });
    };
    const onTimerStop = (p: TimerPayload) => {
      qc.setQueryData(qk.timers, (prev: TimerPayload[] | undefined) =>
        (prev ?? []).filter((t) => t.userId !== p.userId),
      );
      invalidate([['entries']]);
    };
    s.on(EV.TIMER_STARTED, onTimerStart);
    s.on(EV.TIMER_STOPPED, onTimerStop);

    s.on(EV.PAY_PERIOD_GENERATED, () => invalidate([qk.payPeriods]));
    s.on(EV.PAY_PERIOD_UPDATED, () => invalidate([qk.payPeriods]));
    s.on(EV.PAY_PERIOD_CLOSED, () => invalidate([qk.payPeriods, ['entries']]));
    s.on(EV.PAY_CONFIG_UPDATED, () => invalidate([qk.payConfig]));

    s.on(EV.INTEGRATION_UPDATED, () => invalidate([qk.integrations]));
    s.on(EV.DRIVE_FOLDER_LINKED, () => invalidate([qk.driveFolders]));
    s.on(EV.DRIVE_FOLDER_UNLINKED, () => invalidate([qk.driveFolders]));

    s.on(EV.ACTIVITY_APPENDED, (row: ActivityPayload) => {
      qc.setQueryData<ActivityPayload[]>(qk.activity, (prev) => [row, ...(prev ?? [])].slice(0, 60));
    });

    return () => {
      // Clean handler removal on hot-reload
      s.removeAllListeners();
    };
  }, [qc]);

  useEffect(() => () => disconnectSocket(), []);

  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ConfirmProvider>
        <AuthProvider>
          <SpaceProvider>
            <UploadManagerProvider>
              <LiveEventBindings />
              <PostHogBindings />
              {children}
            </UploadManagerProvider>
          </SpaceProvider>
        </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
