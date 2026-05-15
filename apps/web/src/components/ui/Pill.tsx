'use client';

import { type HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type Tone = 'gray' | 'purple' | 'blue' | 'green' | 'yellow' | 'red' | 'orange' | 'pink' | 'teal';

const TONE_CLS: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  purple: 'bg-brand-100 text-brand-700',
  blue: 'bg-blue-100 text-blue-700',
  green: 'bg-green-100 text-green-700',
  yellow: 'bg-yellow-100 text-yellow-800',
  red: 'bg-red-100 text-red-700',
  orange: 'bg-orange-100 text-orange-700',
  pink: 'bg-pink-100 text-pink-700',
  teal: 'bg-teal-100 text-teal-700',
};

export function Pill({
  tone = 'gray',
  className,
  ...rest
}: { tone?: Tone } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        TONE_CLS[tone],
        className,
      )}
      {...rest}
    />
  );
}

export function Dot({ color, label }: { color: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
