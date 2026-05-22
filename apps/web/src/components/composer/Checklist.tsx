'use client';

import { useState } from 'react';
import { Plus, X, Check } from 'lucide-react';
import type { ChecklistItemRow } from '@/hooks/useResources';

/**
 * Inline checklist editor: list of {id, text, done} rows with toggle,
 * inline rename, delete, and an "+ Add item" affordance. Caller controls
 * the array via `onChange` — server stores the whole thing as JSONB and
 * does a full replace on update, so no diffing needed here.
 */
export function Checklist({
  items,
  onChange,
}: {
  items: ChecklistItemRow[];
  onChange: (next: ChecklistItemRow[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const addItem = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([
      ...items,
      { id: crypto.randomUUID(), text, done: false },
    ]);
    setDraft('');
  };

  const updateItem = (id: string, patch: Partial<ChecklistItemRow>) =>
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  const removeItem = (id: string) => onChange(items.filter((it) => it.id !== id));

  return (
    <div className="space-y-1">
      {items.map((it) => (
        <div key={it.id} className="group flex items-center gap-2 px-1 py-1 rounded hover:bg-gray-50">
          <button
            type="button"
            onClick={() => updateItem(it.id, { done: !it.done })}
            className={`shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
              it.done
                ? 'bg-brand-600 border-brand-600 text-white'
                : 'bg-white border-gray-300 hover:border-brand-400'
            }`}
            aria-label={it.done ? 'Mark as not done' : 'Mark as done'}
          >
            {it.done && <Check className="w-3 h-3" />}
          </button>
          <input
            value={it.text}
            onChange={(e) => updateItem(it.id, { text: e.target.value })}
            className={`flex-1 bg-transparent outline-none text-sm ${
              it.done ? 'line-through text-gray-400' : 'text-gray-800'
            }`}
          />
          <button
            type="button"
            onClick={() => removeItem(it.id)}
            className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-opacity"
            aria-label="Remove item"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2 px-1 py-1">
        <Plus className="w-4 h-4 text-gray-300" />
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Add item — press Enter"
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-gray-400"
        />
      </div>
    </div>
  );
}
