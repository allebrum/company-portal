'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

let modalLayerCounter = 0;

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  size = 'md',
  layerBase = 100,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'screen';
  layerBase?: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  // Portal target only exists on the client (app is a static export).
  const [mounted, setMounted] = useState(false);
  const [layerZ, setLayerZ] = useState<number>(layerBase);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => setMounted(true), []);

  // Focus management: move focus into the dialog on open (unless something
  // inside — e.g. an autoFocus input — already took it) and restore it to
  // the trigger element on close, so keyboard/screen-reader users aren't
  // dropped at the top of the page.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel || panel.contains(document.activeElement)) return;
      const first = panel.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? panel).focus();
    }, 0);
    return () => {
      window.clearTimeout(t);
      prev?.focus?.();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Monotonic layer assignment means the latest-opened modal always sits on top.
    modalLayerCounter += 1;
    setLayerZ(layerBase + modalLayerCounter);
  }, [open, layerBase]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // Focus trap: keep Tab cycling inside the dialog.
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (!panel.contains(active)) {
          e.preventDefault();
          first.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        }
      }
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
    '2xl': 'max-w-3xl',
    '3xl': 'max-w-4xl',
    '4xl': 'max-w-5xl',
    // Near-full-page for review surfaces — entries tables, payroll review,
    // anything that needs to feel like its own page while still being a
    // modal. Caps at 1400px so it doesn't sprawl on ultrawide.
    screen: 'max-w-[1400px]',
  };

  // Rendered into <body> so it escapes any ancestor that establishes a
  // containing block for fixed elements (e.g. the TimerBar's backdrop-filter)
  // or clips overflow. This keeps modals viewport-centered everywhere.
  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center p-4 sm:p-6" style={{ zIndex: layerZ }}>
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={cn(
          'relative w-full bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100dvh-2rem)] sm:max-h-[calc(100dvh-3rem)] outline-none',
          widths[size],
        )}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div id={titleId} className="text-sm font-bold text-gray-900">{title}</div>
          <button
            onClick={onClose}
            className="w-9 h-9 -my-2 -mr-2.5 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100"
            aria-label="Close"
          >
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
