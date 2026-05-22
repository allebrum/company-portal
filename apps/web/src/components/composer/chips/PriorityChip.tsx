'use client';

import { cn } from '@/lib/utils';
import { PRIORITY_DOT } from '@/lib/formatters';

type Priority = 'low' | 'medium' | 'high';

/**
 * Three inline buttons; the active one inverts to the priority's accent
 * color so the choice is obvious without opening a popover.
 */
export function PriorityChip({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (next: Priority) => void;
}) {
  const options: Priority[] = ['low', 'medium', 'high'];
  return (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
      {options.map((p, i) => {
        const dot = PRIORITY_DOT[p];
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium transition-colors',
              i > 0 && 'border-l border-gray-200',
              active
                ? 'bg-gray-900 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50',
            )}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ backgroundColor: active ? '#fff' : dot?.color ?? '#9ca3af' }}
            />
            {dot?.label ?? p}
          </button>
        );
      })}
    </div>
  );
}
