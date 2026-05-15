'use client';

import { Play, Square } from 'lucide-react';
import { useStartTimer, useStopTimer, type TodoRow } from '@/hooks/useResources';
import { useMyTimer } from '@/hooks/useTimer';
import { useToast } from '@/components/ui/Toast';
import { fmtTimer } from '@/lib/formatters';

/**
 * One-click start/stop timer for a single to-do. Safe to drop into any list/card
 * where a to-do is shown — it stops click propagation so it won't trigger row
 * navigation or modal openers, and stays in sync with the global TimerBar via
 * the shared `useMyTimer` state.
 */
export function TodoTimerButton({ todo, size = 'sm' }: { todo: TodoRow; size?: 'sm' | 'xs' }) {
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const { timer: myTimer, elapsedSec } = useMyTimer();
  const toast = useToast();

  if (todo.status === 'done') return null;

  const running = myTimer?.todoId === todo.id;
  const pad = size === 'xs' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs';
  const icon = size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  const stop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await stopTimer.mutateAsync();
      toast.success('Timer stopped');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not stop timer');
    }
  };

  const start = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!todo.projectId) return;
    try {
      await startTimer.mutateAsync({ projectId: todo.projectId, note: todo.title, todoId: todo.id });
      toast.success(`Timer started — ${todo.title}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start timer');
    }
  };

  if (running) {
    return (
      <button
        onClick={stop}
        className={`inline-flex items-center gap-1.5 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 ${pad}`}
        title="Stop timer"
      >
        <Square className={icon} />
        <span className="font-mono tabular-nums">{fmtTimer(elapsedSec)}</span>
      </button>
    );
  }

  return (
    <button
      onClick={start}
      disabled={!todo.projectId || startTimer.isPending}
      className={`inline-flex items-center gap-1.5 rounded-lg border border-gray-200 text-gray-600 font-semibold hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-gray-600 disabled:hover:border-gray-200 ${pad}`}
      title={todo.projectId ? 'Start timer for this task' : 'Add a project to this to-do to track time'}
    >
      <Play className={icon} />
      Start
    </button>
  );
}
