'use client';

import { useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase';
import { REALTIME_ENABLED } from '@/lib/env';
import { qk } from '@/lib/queryKeys';
import { EV, type ActivityPayload, type TimerPayload, type EventName } from '@modernzen/shared';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/ConfirmDialog';
import { SpaceProvider } from '@/contexts/SpaceContext';
import { UploadManagerProvider } from '@/contexts/UploadManagerContext';
import { PostHogBindings } from '@/components/analytics/PostHogBindings';

function LiveEventBindings(): null {
  const qc = useQueryClient();
  const { me } = useAuth();
  const tenantId = me?.tenantId ?? null;
  const userId = me?.id ?? null;
  const canApprove = !!me?.permissions?.includes('time_entry.approve');

  useEffect(() => {
    // Realtime requires a Supabase session (staff). The client portal has no
    // Supabase JWT, so it stays refetch-only. Off entirely when the flag is
    // unset, and never inside an iframe (the staff Portal-tab preview embeds the
    // app — a second subscription there is pointless).
    const inIframe = typeof window !== 'undefined' && window.self !== window.top;
    if (!REALTIME_ENABLED || !tenantId || !userId || inIframe) return;

    const invalidate = (keys: ReadonlyArray<readonly unknown[]>) => {
      for (const k of keys) qc.invalidateQueries({ queryKey: k as unknown[] });
    };

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

    // The event → action map, identical to the Socket.IO era. Handlers are
    // idempotent invalidations / merges, so registering the full map on every
    // channel is safe (each event is only broadcast to its own topic).
    const handlers: Array<[EventName, (payload: unknown) => void]> = [
      [EV.USER_CREATED, () => invalidate([qk.users])],
      [EV.USER_UPDATED, () => invalidate([qk.users, qk.bootstrap])],
      [EV.USER_DELETED, () => invalidate([qk.users])],
      [EV.GROUP_UPDATED, () => invalidate([qk.groups, qk.bootstrap])],
      [EV.SETTINGS_UPDATED, () => invalidate([['settings'], ['authConfig']])],
      [EV.CLIENT_CREATED, () => invalidate([qk.clients])],
      [EV.CLIENT_UPDATED, () => invalidate([qk.clients])],
      [EV.PROJECT_CREATED, () => invalidate([qk.projects])],
      [EV.PROJECT_UPDATED, () => invalidate([qk.projects])],
      [EV.GOAL_CREATED, () => invalidate([qk.goals])],
      [EV.GOAL_UPDATED, () => invalidate([qk.goals])],
      [EV.GOAL_MOVED, () => invalidate([qk.goals])],
      [EV.GOAL_RESOURCE_ADDED, () => invalidate([qk.goals])],
      [EV.GOAL_RESOURCE_REMOVED, () => invalidate([qk.goals])],
      [EV.TODO_CREATED, () => invalidate([qk.todos])],
      [EV.TODO_UPDATED, () => invalidate([qk.todos])],
      [EV.TODO_DELETED, () => invalidate([qk.todos])],
      [EV.TICKET_CREATED, () => invalidate([qk.tickets])],
      [EV.TICKET_UPDATED, () => invalidate([qk.tickets, qk.todos])],
      [EV.TICKET_MESSAGE, () => invalidate([qk.tickets])],
      [EV.ENTRY_CREATED, () => invalidate([['entries']])],
      [EV.ENTRY_UPDATED, () => invalidate([['entries']])],
      [EV.ENTRY_DELETED, () => invalidate([['entries']])],
      [EV.ENTRY_SUBMITTED, () => invalidate([['entries']])],
      [EV.ENTRY_APPROVED, () => invalidate([['entries']])],
      [EV.ENTRY_REJECTED, () => invalidate([['entries']])],
      [EV.ENTRY_REOPENED, () => invalidate([['entries']])],
      [EV.TIMER_STARTED, (p) => onTimerStart(p as TimerPayload)],
      [EV.TIMER_STOPPED, (p) => onTimerStop(p as TimerPayload)],
      [EV.PAY_PERIOD_GENERATED, () => invalidate([qk.payPeriods])],
      [EV.PAY_PERIOD_UPDATED, () => invalidate([qk.payPeriods])],
      [EV.PAY_PERIOD_CLOSED, () => invalidate([qk.payPeriods, ['entries']])],
      [EV.PAY_CONFIG_UPDATED, () => invalidate([qk.payConfig])],
      [EV.INTEGRATION_UPDATED, () => invalidate([qk.integrations])],
      [EV.DRIVE_FOLDER_LINKED, () => invalidate([qk.driveFolders])],
      [EV.DRIVE_FOLDER_UNLINKED, () => invalidate([qk.driveFolders])],
      [EV.ACTIVITY_APPENDED, (row) =>
        qc.setQueryData<ActivityPayload[]>(qk.activity, (prev) =>
          [row as ActivityPayload, ...(prev ?? [])].slice(0, 60),
        )],
    ];

    const supa = getSupabase();
    const channels: RealtimeChannel[] = [];
    let cancelled = false;

    void (async () => {
      const { data } = await supa.auth.getSession();
      if (cancelled || !data.session) return;
      // Private channels enforce RLS on realtime.messages against this JWT.
      supa.realtime.setAuth(data.session.access_token);

      const topics = [`tenant:${tenantId}`, `user:${userId}`];
      if (canApprove) topics.push(`approvers:${tenantId}`);

      for (const topic of topics) {
        const ch = supa.channel(topic, { config: { private: true } });
        for (const [event, handler] of handlers) {
          ch.on('broadcast', { event }, (msg) => handler((msg as { payload?: unknown }).payload));
        }
        ch.subscribe();
        channels.push(ch);
      }
    })();

    return () => {
      cancelled = true;
      for (const ch of channels) void supa.removeChannel(ch);
    };
  }, [qc, tenantId, userId, canApprove]);

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
