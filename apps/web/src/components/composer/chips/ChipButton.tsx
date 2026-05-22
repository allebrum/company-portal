'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared "chip" button used by every composer chip. Three states:
 * - default — value present, neutral white card.
 * - active  — strongly selected (e.g. "Private", "High"); inverts to dark.
 * - placeholder — empty value, dashed gray border, italic-ish color.
 */
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  variant?: 'default' | 'placeholder';
};

export const ChipButton = forwardRef<HTMLButtonElement, Props>(function ChipButton(
  { active, variant = 'default', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      {...rest}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm font-medium transition-colors max-w-full',
        active
          ? 'bg-gray-900 text-white border-gray-900 hover:bg-gray-800'
          : variant === 'placeholder'
            ? 'bg-white border-dashed border-gray-300 text-gray-400 hover:bg-gray-50 hover:text-gray-600'
            : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50',
        className,
      )}
    >
      {children}
    </button>
  );
});
