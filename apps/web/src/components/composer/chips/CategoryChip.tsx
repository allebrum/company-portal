'use client';

import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { ChipButton } from './ChipButton';

const PRESETS = ['Delivery', 'Ops', 'Growth', 'Hiring', 'R&D', 'Support'];

/**
 * Goal category — free-text but presented as quick-pick presets with an
 * "Other" inline input. Stored on the row as `tag` (single string).
 */
export function CategoryChip({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [custom, setCustom] = useState('');

  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      <ChipButton
        ref={ref}
        variant={value ? 'default' : 'placeholder'}
        onClick={() => setOpen((o) => !o)}
      >
        <Sparkles className="w-3.5 h-3.5" />
        {value || 'Category'}
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <div className="w-56 p-2">
          <div className="grid grid-cols-2 gap-1 mb-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => choose(p)}
                className={`px-2 py-1.5 text-sm rounded hover:bg-gray-50 ${
                  p === value ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-700'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-1 pt-1 border-t border-gray-100">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom category"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && custom.trim()) {
                  e.preventDefault();
                  choose(custom.trim());
                }
              }}
              className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-brand-400"
            />
            <button
              type="button"
              onClick={() => custom.trim() && choose(custom.trim())}
              className="text-sm font-medium text-brand-700 hover:text-brand-800 px-1"
            >
              Set
            </button>
          </div>
        </div>
      </Popover>
    </>
  );
}
