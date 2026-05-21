'use client';

import { useState } from 'react';
import { Tag, X } from 'lucide-react';

/**
 * Multi-tag chip: renders each tag as its own removable pill plus an
 * inline input. Enter or comma adds the current input as a new tag.
 * Storage is just a `string[]`.
 */
export function TagsChip({
  value,
  onChange,
}: {
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const t = draft.trim();
    if (!t || value.includes(t)) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white min-h-[32px] w-full max-w-md">
      <Tag className="w-3.5 h-3.5 text-gray-400" />
      {value.map((t) => (
        <span
          key={t}
          className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium"
        >
          {t}
          <button
            type="button"
            onClick={() => remove(t)}
            className="text-gray-400 hover:text-gray-700"
            aria-label={`Remove tag ${t}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length > 0) {
            remove(value[value.length - 1]!);
          }
        }}
        onBlur={add}
        placeholder={value.length === 0 ? 'Add tags…' : ''}
        className="flex-1 min-w-[60px] bg-transparent outline-none text-sm placeholder:text-gray-400 py-0.5"
      />
    </div>
  );
}
