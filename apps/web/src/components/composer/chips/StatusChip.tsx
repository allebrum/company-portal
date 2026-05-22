'use client';

import { cn } from '@/lib/utils';
import { DEFAULT_STATUSES, toneColor } from '@/lib/roadmap';
import type { ProjectStatusRow } from '@/hooks/useResources';

type TodoStatus = 'open' | 'done';

const TODO_OPTIONS: { value: TodoStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: '#9ca3af' },
  { value: 'done', label: 'Done', color: '#16a34a' },
];

/**
 * Segmented status control. To-do mode is a fixed open/done pair. Goal mode
 * renders whatever workflow it's given (`statuses` — a project's custom
 * workflow or the default 4) so the same chip works for any project.
 */
export function StatusChip(
  props:
    | { mode: 'todo'; value: TodoStatus; onChange: (next: TodoStatus) => void }
    | { mode: 'goal'; value: string; onChange: (next: string) => void; statuses?: ProjectStatusRow[] },
) {
  if (props.mode === 'todo') {
    return (
      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
        {TODO_OPTIONS.map((opt, i) => {
          const active = opt.value === props.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => props.onChange(opt.value)}
              className={cn(
                'flex items-center gap-1.5 px-2.5 py-1 font-medium transition-colors',
                i > 0 && 'border-l border-gray-200',
                active ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
              )}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: active ? '#fff' : opt.color }} />
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  const statuses = props.statuses && props.statuses.length > 0 ? props.statuses : DEFAULT_STATUSES;
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-gray-200 overflow-hidden text-xs">
      {statuses.map((opt, i) => {
        const active = opt.id === props.value;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => props.onChange(opt.id)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1 font-medium transition-colors',
              i > 0 && 'border-l border-gray-200',
              active ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: active ? '#fff' : toneColor(opt.tone) }} />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
