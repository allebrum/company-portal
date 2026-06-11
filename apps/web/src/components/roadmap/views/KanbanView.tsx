'use client';

import { useMemo, useState } from 'react';
import { useMoveGoal } from '@/hooks/useResources';
import { useToast } from '@/components/ui/Toast';
import { statusesForScope, bucketStatus, toneColor } from '@/lib/roadmap';
import { PRIORITY_DOT } from '@/lib/formatters';
import { GoalCard } from '../GoalCard';
import type { ViewProps } from '../types';
import type { GoalRow } from '@/hooks/useResources';

type Col = { id: string; label: string; color: string };

export function KanbanView(props: ViewProps) {
  const { goals, scope, projects, tw, onOpenGoal } = props;
  const move = useMoveGoal();
  const toast = useToast();
  const [dragId, setDragId] = useState<string | null>(null);
  const ctx = { clients: props.clients, projects: props.projects, users: props.users, todos: props.todos, epics: props.epics };

  const statuses = useMemo(() => statusesForScope(scope, projects), [scope, projects]);
  const byStatus = tw.groupByKanban === 'status';

  const columns: Col[] = useMemo(() => {
    switch (tw.groupByKanban) {
      case 'priority':
        return [
          { id: 'high', label: 'High', color: PRIORITY_DOT.high!.color },
          { id: 'medium', label: 'Medium', color: PRIORITY_DOT.medium!.color },
          { id: 'low', label: 'Low', color: PRIORITY_DOT.low!.color },
        ];
      case 'owner': {
        const ids = Array.from(new Set(goals.map((g) => g.ownerId ?? 'none')));
        return ids.map((id) => ({
          id,
          label: id === 'none' ? 'Unassigned' : props.users.find((u) => u.id === id)?.name ?? 'Unknown',
          color: id === 'none' ? '#9ca3af' : props.users.find((u) => u.id === id)?.color ?? '#9ca3af',
        }));
      }
      case 'epic': {
        const ids = Array.from(new Set(goals.map((g) => g.epicId ?? 'none')));
        return ids.map((id) => ({
          id,
          label: id === 'none' ? 'No epic' : props.epics.find((e) => e.id === id)?.title ?? 'Epic',
          color: id === 'none' ? '#9ca3af' : props.epics.find((e) => e.id === id)?.color ?? '#9ca3af',
        }));
      }
      case 'client': {
        // null clientId = workspace-level goal → its own "Workspace" column.
        const ids = Array.from(new Set(goals.map((g) => g.clientId ?? 'none')));
        return ids.map((id) => ({
          id,
          label: id === 'none' ? 'Workspace' : props.clients.find((c) => c.id === id)?.name ?? 'Client',
          color: id === 'none' ? '#9ca3af' : props.clients.find((c) => c.id === id)?.color ?? '#9ca3af',
        }));
      }
      case 'status':
      default:
        return statuses.map((s) => ({ id: s.id, label: s.label, color: toneColor(s.tone) }));
    }
  }, [tw.groupByKanban, goals, statuses, props.users, props.epics, props.clients]);

  const keyOf = (g: GoalRow): string => {
    switch (tw.groupByKanban) {
      case 'priority': return g.priority;
      case 'owner': return g.ownerId ?? 'none';
      case 'epic': return g.epicId ?? 'none';
      case 'client': return g.clientId ?? 'none';
      case 'status':
      default: return bucketStatus(g.status, statuses);
    }
  };

  const onDrop = async (colId: string) => {
    if (!byStatus || !dragId) return;
    const id = dragId;
    setDragId(null);
    try {
      await move.mutateAsync({ id, status: colId });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move goal');
    }
  };

  return (
    <div>
      {!byStatus && (
        <div className="text-xs text-gray-500 mb-2">Switch grouping to Status to drag cards between columns.</div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((col) => {
          const cards = goals.filter((g) => keyOf(g) === col.id);
          return (
            <div
              key={col.id}
              className="w-72 shrink-0 bg-gray-50/80 rounded-xl border border-gray-100"
              onDragOver={(e) => byStatus && e.preventDefault()}
              onDrop={() => onDrop(col.id)}
            >
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="w-1.5 h-4 rounded-full" style={{ backgroundColor: col.color }} />
                <span className="text-xs font-bold uppercase tracking-wide text-gray-700 truncate">{col.label}</span>
                <span className="ml-auto text-[11px] font-semibold text-gray-500 bg-white border border-gray-200 rounded-full px-1.5">{cards.length}</span>
              </div>
              <div className={`p-2 pt-0 space-y-2 overflow-y-auto max-h-[calc(100vh-360px)]${byStatus ? ' [&>div[draggable]]:cursor-grab [&>div[draggable]]:active:cursor-grabbing' : ''}`}>
                {cards.map((g) => (
                  <GoalCard
                    key={g.id}
                    goal={g}
                    ctx={ctx}
                    tw={tw}
                    onOpen={onOpenGoal}
                    draggable={byStatus || undefined}
                    onDragStart={byStatus ? () => setDragId(g.id) : undefined}
                  />
                ))}
                {cards.length === 0 && <div className="text-[11px] text-gray-400 px-1 py-3 text-center">—</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
