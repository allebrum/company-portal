'use client';

import { useMemo, useState } from 'react';
import { Tag, X } from 'lucide-react';

/**
 * Multi-tag chip: renders each tag as its own removable pill plus an
 * inline input. Enter or comma adds the current input as a new tag.
 * `suggestions` (existing tags from across the workspace) drive an
 * autocomplete dropdown so people reuse tags instead of duplicating.
 */
export function TagsChip({
  value,
  onChange,
  suggestions = [],
}: {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
}) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);

  const add = (tag: string) => {
    const t = tag.trim();
    if (!t || value.includes(t)) {
      setDraft('');
      return;
    }
    onChange([...value, t]);
    setDraft('');
  };

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const matches = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !value.includes(s) && (!needle || s.toLowerCase().includes(needle)))
      .slice(0, 8);
  }, [draft, suggestions, value]);

  const showSuggest = focused && matches.length > 0;

  return (
    <div className="relative w-full max-w-md">
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 bg-white min-h-[32px]">
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
          onFocus={() => setFocused(true)}
          onBlur={() => {
            // Delay so a click on a suggestion registers before close.
            setTimeout(() => setFocused(false), 120);
            add(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length > 0) {
              remove(value[value.length - 1]!);
            }
          }}
          placeholder={value.length === 0 ? 'Add tags…' : ''}
          className="flex-1 min-w-[60px] bg-transparent outline-none text-sm placeholder:text-gray-400 py-0.5"
        />
      </div>
      {showSuggest && (
        <div className="absolute z-[140] mt-1 left-0 right-0 bg-white rounded-lg border border-gray-200 shadow-lg py-1 max-h-44 overflow-y-auto">
          {matches.map((s) => (
            <button
              key={s}
              type="button"
              // onMouseDown (not onClick) so it fires before the input blur.
              onMouseDown={(e) => {
                e.preventDefault();
                add(s);
              }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
