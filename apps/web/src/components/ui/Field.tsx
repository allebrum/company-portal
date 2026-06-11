'use client';

import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label?: string;
  hint?: string;
  /** Inline validation message — renders red below the input (replacing the
   *  hint) so failures persist instead of living only in a 3.5s toast. */
  error?: string;
  /** Marks the label with a red asterisk so users know before submitting. */
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      {label && (
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          {label}
          {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="text-[11px] text-red-600 font-medium block" role="alert">{error}</span>
      ) : (
        hint && <span className="text-[11px] text-gray-500 block">{hint}</span>
      )}
    </label>
  );
}

const BASE_INPUT =
  'block w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50';
// Red border + ring when the field has a validation error.
const INVALID_INPUT = 'border-red-300 focus:ring-red-400';

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }
>(function Input({ className, invalid, ...rest }, ref) {
  return (
    <input ref={ref} aria-invalid={invalid || undefined} className={cn(BASE_INPUT, invalid && INVALID_INPUT, className)} {...rest} />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(function Select({ className, invalid, children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(BASE_INPUT, 'pr-9 appearance-none bg-no-repeat', invalid && INVALID_INPUT, className)}
      {...rest}
    >
      {children}
    </select>
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(function Textarea({ className, invalid, ...rest }, ref) {
  return (
    <textarea ref={ref} rows={4} aria-invalid={invalid || undefined} className={cn(BASE_INPUT, 'resize-y', invalid && INVALID_INPUT, className)} {...rest} />
  );
});

export function Checkbox({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none text-sm text-gray-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
      />
      {label}
    </label>
  );
}
