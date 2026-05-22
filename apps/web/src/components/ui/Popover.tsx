'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Lightweight controlled popover. Pass a `trigger` that renders the
 * anchor element (must be a single React element that accepts a ref and
 * onClick), and `children` for the popover contents. Open state is owned
 * by the parent — keeps the chip components in control of when to close.
 *
 * Positions just below the anchor, flips to above if there isn't room.
 * Closes on Escape and on clicks outside both the anchor and the panel.
 * Portals to document.body so the panel escapes any ancestor with a
 * containing block (matches the Modal pattern).
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  children,
  width = 'auto',
  align = 'start',
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  children: ReactNode;
  /** Min-width for the panel; "auto" lets content drive it. */
  width?: 'auto' | number;
  /** Horizontal alignment relative to the anchor. */
  align?: 'start' | 'end';
}) {
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'below' | 'above' }>({
    top: 0,
    left: 0,
    placement: 'below',
  });

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !mounted) return;
    const measure = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const a = anchor.getBoundingClientRect();
      const panelH = panelRef.current?.offsetHeight ?? 0;
      const panelW = panelRef.current?.offsetWidth ?? Math.max(typeof width === 'number' ? width : 0, a.width);
      const spaceBelow = window.innerHeight - a.bottom;
      const placement: 'below' | 'above' = spaceBelow < panelH + 12 && a.top > panelH + 12 ? 'above' : 'below';
      const top = placement === 'below' ? a.bottom + 6 : a.top - panelH - 6;
      const left = align === 'end' ? Math.max(8, a.right - panelW) : Math.min(window.innerWidth - panelW - 8, a.left);
      setPos({ top, left, placement });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, anchorRef, mounted, width, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    // mousedown so we react before any click on the new outside element.
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: typeof width === 'number' ? width : undefined }}
      className="z-[140] bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden"
    >
      {children}
    </div>,
    document.body,
  );
}
