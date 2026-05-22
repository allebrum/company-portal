'use client';

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { Plus, CornerDownLeft } from 'lucide-react';
import { useToast } from '@/components/ui/Toast';
import { useCreateTodo, type TodoRow } from '@/hooks/useResources';
import { cn } from '@/lib/utils';

export type QuickAddContext = {
  clientId?: string | null;
  projectId?: string | null;
  goalId?: string | null;
  assigneeId?: string | null;
};

/**
 * Fast inline to-do creator. Type a title and:
 *  - Enter        → create with the given context, clear, keep focus (rapid entry)
 *  - Shift+Enter  → create, then onElaborate(todo) so the host can open the
 *                   full composer to add details
 * The host owns composer opening (via onElaborate) so we never stack a
 * second composer instance from inside one.
 *
 * Forwards a ref to the input so a host can make a blank area click-to-focus.
 */
export const QuickAddTodo = forwardRef<HTMLInputElement, {
  context?: QuickAddContext;
  placeholder?: string;
  autoFocus?: boolean;
  onCreated?: (todo: TodoRow) => void;
  onElaborate?: (todo: TodoRow) => void;
  className?: string;
}>(function QuickAddTodo(
  { context = {}, placeholder, autoFocus, onCreated, onElaborate, className },
  ref,
) {
  const toast = useToast();
  const create = useCreateTodo();
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  const submit = async (elaborate: boolean) => {
    const t = title.trim();
    if (!t || create.isPending) return;
    try {
      const todo = await create.mutateAsync({
        title: t,
        clientId: context.clientId ?? null,
        projectId: context.projectId ?? null,
        goalId: context.goalId ?? null,
        assigneeId: context.assigneeId ?? null,
      });
      setTitle('');
      onCreated?.(todo);
      if (elaborate) onElaborate?.(todo);
      else inputRef.current?.focus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create to-do');
    }
  };

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-2 rounded-lg border border-dashed border-gray-200 hover:border-gray-300 focus-within:border-brand-400 focus-within:bg-white transition-colors',
        className,
      )}
    >
      <Plus className="w-4 h-4 text-gray-300 shrink-0" />
      <input
        ref={inputRef}
        autoFocus={autoFocus}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit(e.shiftKey);
          }
        }}
        placeholder={placeholder ?? 'Add a to-do — Enter to create, ⇧Enter for details'}
        className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-gray-400"
      />
      {title.trim() && (
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={create.isPending}
          title="Create & open details (⇧Enter)"
          className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium text-gray-400 hover:text-brand-700 disabled:opacity-50"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
          details
        </button>
      )}
    </div>
  );
});
