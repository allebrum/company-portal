'use client';

import { useRef } from 'react';
import { Calendar, X } from 'lucide-react';
import { ChipButton } from './ChipButton';

/**
 * Date chip that delegates the picker to the platform's native
 * `<input type="date">`. The chip itself is a styled button that
 * invokes `showPicker()` on click (so we get a real calendar UI on
 * supported browsers and a sensible fallback elsewhere).
 */
export function DateChip({
  value,
  onChange,
  placeholder = 'Pick a date',
}: {
  /** ISO YYYY-MM-DD or empty string. */
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const display = (() => {
    if (!value) return placeholder;
    // Pretty short form: e.g. "May 21" or "May 21, 2026" if different year.
    try {
      const d = new Date(value + 'T00:00:00');
      const sameYear = d.getFullYear() === new Date().getFullYear();
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
      });
    } catch {
      return value;
    }
  })();

  return (
    <div className="inline-flex items-center gap-1">
      <ChipButton
        variant={value ? 'default' : 'placeholder'}
        onClick={() => {
          // Some browsers gate showPicker behind a user gesture (which this
          // click is) and need the element to be visible. We keep the input
          // mounted but `sr-only` for accessibility.
          ref.current?.showPicker?.();
          // Fallback: focus so users can type via keyboard.
          ref.current?.focus();
        }}
      >
        <Calendar className="w-3.5 h-3.5" />
        {display}
      </ChipButton>
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-gray-300 hover:text-gray-500"
          aria-label="Clear date"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
      <input
        ref={ref}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
    </div>
  );
}
