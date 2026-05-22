'use client';

import { Calendar, CheckSquare, Link2, Layers } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { PRIORITY_DOT, parseLocalDate } from '@/lib/formatters';
import { goalAccent, HEALTH_TONE, rollupProgress, dateMD } from '@/lib/roadmap';
import type {
  GoalRow, ClientRow, ProjectRow, UserRow, TodoRow, EpicRow,
} from '@/hooks/useResources';
import type { Tweaks } from './types';

export type GoalCardCtx = {
  clients: ClientRow[];
  projects: ProjectRow[];
  users: UserRow[];
  todos: TodoRow[];
  epics: EpicRow[];
};

export function GoalCard({
  goal,
  ctx,
  tw,
  onOpen,
  draggable,
  onDragStart,
}: {
  goal: GoalRow;
  ctx: GoalCardCtx;
  tw: Tweaks;
  onOpen: (g: GoalRow) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
}) {
  const epic = goal.epicId ? ctx.epics.find((e) => e.id === goal.epicId) ?? null : null;
  const owner = ctx.users.find((u) => u.id === goal.ownerId) ?? null;
  const pct = rollupProgress(goal, ctx.todos);
  const linked = ctx.todos.filter((t) => t.goalId === goal.id);
  const doneCount = linked.filter((t) => t.status === 'done').length;
  const accent = goalAccent(goal, tw.colorBy, ctx);
  const pri = PRIORITY_DOT[goal.priority];
  const deps = goal.dependsOn?.length ?? 0;
  const due = goal.endDate ? parseLocalDate(goal.endDate) : null;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={() => onOpen(goal)}
      className="relative bg-white rounded-lg border border-gray-200 hover:border-gray-300 hover:shadow-md transition-all cursor-pointer overflow-hidden"
    >
      <span className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: accent }} />
      <div className={`pl-3.5 pr-3 ${tw.density === 'compact' ? 'py-2' : 'py-2.5'}`}>
        <div className="flex items-center gap-2 mb-1">
          {epic && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold max-w-[60%] truncate"
              style={{ backgroundColor: `${epic.color}15`, color: epic.color }}
            >
              <Layers className="w-3 h-3 shrink-0" />
              <span className="truncate">{epic.title}</span>
            </span>
          )}
          <span className="ml-auto inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pri?.color ?? '#9ca3af' }} title={pri?.label} />
        </div>
        <div className="text-[13px] font-semibold leading-snug text-gray-900 line-clamp-2">{goal.title}</div>
        {pct > 0 && (
          <div className="mt-1.5 h-px bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full" style={{ width: `${pct}%`, backgroundColor: accent }} />
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-2.5 text-[11px] text-gray-500">
          {due && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {dateMD(due)}
            </span>
          )}
          {linked.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <CheckSquare className="w-3 h-3" />
              {doneCount}/{linked.length}
            </span>
          )}
          {deps > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Link2 className="w-3 h-3" />
              {deps}
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1.5">
            {goal.health && (
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: HEALTH_TONE[goal.health]?.color }} title={HEALTH_TONE[goal.health]?.label} />
            )}
            {owner && <Avatar user={owner} size={20} />}
          </span>
        </div>
      </div>
    </div>
  );
}
