'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Generic searchable-list panel rendered inside a Popover. Used by every
 * chip that picks one row from a high-cardinality list (users, clients,
 * projects, goals). Autofocuses the search input on mount; case-insensitive
 * label match by default; consumers can override with a custom `search`.
 */
export function SearchablePicker<T extends { id: string }>({
  items,
  selectedId,
  onSelect,
  onClear,
  getLabel,
  renderRow,
  placeholder = 'Search…',
  clearLabel,
}: {
  items: T[];
  selectedId: string | null;
  onSelect: (item: T) => void;
  /** Provided → renders an "unassigned" row at the top. */
  onClear?: () => void;
  getLabel: (item: T) => string;
  renderRow?: (item: T, selected: boolean) => ReactNode;
  placeholder?: string;
  clearLabel?: string;
}) {
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => getLabel(it).toLowerCase().includes(needle));
  }, [q, items, getLabel]);

  return (
    <div className="w-72">
      <div className="p-2 border-b border-gray-100">
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="w-full px-2 py-1.5 text-sm outline-none placeholder:text-gray-400"
        />
      </div>
      <div className="max-h-64 overflow-y-auto py-1">
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
              selectedId === null ? 'bg-brand-50 text-brand-700' : 'text-gray-500'
            }`}
          >
            {clearLabel ?? '— Unassigned —'}
          </button>
        )}
        {filtered.length === 0 && (
          <div className="px-3 py-2 text-sm text-gray-400">No matches.</div>
        )}
        {filtered.map((it) => {
          const selected = it.id === selectedId;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onSelect(it)}
              className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 ${
                selected ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-800'
              }`}
            >
              {renderRow ? renderRow(it, selected) : getLabel(it)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
