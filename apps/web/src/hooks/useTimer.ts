'use client';

import { useEffect, useState } from 'react';
import { useAuth } from './useAuth';
import { useActiveTimers } from './useResources';
import type { TimerPayload } from '@allebrum/shared';

export function useMyTimer(): { timer: TimerPayload | null; elapsedSec: number } {
  const { me } = useAuth();
  const { data: timers } = useActiveTimers();
  const mine = me ? (timers ?? []).find((t) => t.userId === me.id) ?? null : null;

  const [, tick] = useState(0);
  useEffect(() => {
    if (!mine) return;
    const id = window.setInterval(() => tick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [mine?.startedAt, mine?.userId]);

  const elapsedSec = mine ? Math.max(0, Math.floor((Date.now() - new Date(mine.startedAt).getTime()) / 1000)) : 0;
  return { timer: mine, elapsedSec };
}
