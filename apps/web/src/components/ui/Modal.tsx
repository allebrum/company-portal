'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Portal target only exists on the client (app is a static export).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    // Lock background scroll while the dialog is open.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const widths = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-2xl',
  };

  // Rendered into <body> so it escapes any ancestor that establishes a
  // containing block for fixed elements (e.g. the TimerBar's backdrop-filter)
  // or clips overflow. This keeps modals viewport-centered everywhere.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative w-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)]',
          widths[size],
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="text-sm font-bold text-gray-900">{title}</div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 flex-1 min-h-0 overflow-y-auto overscroll-contain">{children}</div>
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-gray-100 bg-gray-50 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
