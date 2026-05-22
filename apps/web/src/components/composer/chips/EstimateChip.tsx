'use client';

import { useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { ChipButton } from './ChipButton';

function format(minutes: number): string {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

const PRESETS = [15, 30, 60, 90, 120, 240];

/**
 * Estimate in minutes; tap to open a popover with quick presets plus a
 * free-text minutes input for arbitrary values.
 */
export function EstimateChip({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const [custom, setCustom] = useState('');

  const choose = (mins: number) => {
    onChange(mins);
    setOpen(false);
  };

  return (
    <>
      <ChipButton ref={ref} onClick={() => setOpen((o) => !o)}>
        <Clock className="w-3.5 h-3.5" />
        {format(value)}
      </ChipButton>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref}>
        <div className="w-56 p-2">
          <div className="grid grid-cols-3 gap-1 mb-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => choose(p)}
                className={`px-2 py-1.5 text-sm rounded hover:bg-gray-50 ${
                  p === value ? 'bg-brand-50 text-brand-700 font-semibold' : 'text-gray-700'
                }`}
              >
                {format(p)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 px-1 pt-1 border-t border-gray-100">
            <input
              type="number"
              min={0}
              max={10_000}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom minutes"
              className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded outline-none focus:border-brand-400"
            />
            <button
              type="button"
              onClick={() => {
                const n = Number(custom);
                if (Number.isFinite(n) && n >= 0) choose(n);
              }}
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
