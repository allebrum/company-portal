'use client';

import { cn } from '@/lib/utils';

type TodoStatus = 'open' | 'done';
type GoalStatus = 'backlog' | 'in-progress' | 'review' | 'done';

const TODO_OPTIONS: { value: TodoStatus; label: string; dot: string }[] = [
  { value: 'open', label: 'Open', dot: '#9ca3af' },
  { value: 'done', label: 'Done', dot: '#16a34a' },
];

const GOAL_OPTIONS: { value: GoalStatus; label: string; dot: string }[] = [
  { value: 'backlog', label: 'Backlog', dot: '#9ca3af' },
  { value: 'in-progress', label: 'In progress', dot: '#9333ea' },
  { value: 'review', label: 'In review', dot: '#f59e0b' },
  { value: 'done', label: 'Shipped', dot: '#16a34a' },
];

/**
 * Single segmented control inline in the header. Different option set
 * depending on whether we're composing a to-do or a goal.
 */
export function StatusChip(
  props:
    | { mode: 'todo'; value: TodoStatus; onChange: (next: TodoStatus) => void }
    | { mode: 'goal'; value: GoalStatus; onChange: (next: GoalStatus) => void },
) {
  const options = props.mode === 'todo' ? TODO_OPTIONS : GOAL_OPTIONS;
  return (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
      {options.map((opt, i) => {
        const active = opt.value === props.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => {
              // Narrowed via discriminated union — both branches typecheck.
              if (props.mode === 'todo') props.onChange(opt.value as TodoStatus);
              else props.onChange(opt.value as GoalStatus);
            }}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 font-medium transition-colors',
              i > 0 && 'border-l border-gray-200',
              active
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: active ? '#fff' : opt.dot }}
            />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
