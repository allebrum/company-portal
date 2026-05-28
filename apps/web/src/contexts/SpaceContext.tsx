'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Scope } from '@/lib/roadmap';

/**
 * Pure-UI state owner for the Client/Project Spaces overlay.
 *
 * Server-side state (notes blocks, file attachments, the actual goals /
 * todos shown in tabs) lives in TanStack Query — this context only knows
 * *which* scope's overlay is open. Body scroll is locked while open so
 * the page underneath doesn't scroll-jack.
 */
type SpaceCtx = {
  openScope: Scope | null;
  /**
   * LRU of recently-opened Spaces — newest first, deduped by (kind, id),
   * capped at 6. In-memory only (no persistence across reload). Powers
   * the Clients directory's "Jump back in" row.
   */
  recentSpaces: Scope[];
  openSpace: (scope: Scope) => void;
  closeSpace: () => void;
};

const RECENTS_MAX = 6;

const Ctx = createContext<SpaceCtx | null>(null);

export function SpaceProvider({ children }: { children: ReactNode }) {
  const [openScope, setOpenScope] = useState<Scope | null>(null);
  const [recentSpaces, setRecentSpaces] = useState<Scope[]>([]);

  const openSpace = useCallback((scope: Scope) => {
    // The "All clients" scope has no space — refuse it defensively.
    if (scope.kind === 'all') return;
    setOpenScope(scope);
    // Update recents LRU — push to front, dedupe by (kind, id), cap.
    setRecentSpaces((prev) => {
      const without = prev.filter((s) => !(s.kind === scope.kind && 'id' in s && 'id' in scope && s.id === scope.id));
      return [scope, ...without].slice(0, RECENTS_MAX);
    });
  }, []);
  const closeSpace = useCallback(() => setOpenScope(null), []);

  // Body-scroll lock while open so the underlying page doesn't drift when
  // the overlay's own scroll container reaches an edge. We capture the
  // previous overflow so a host that already pinned scroll for some other
  // reason isn't permanently broken on overlay close.
  useEffect(() => {
    if (!openScope) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [openScope]);

  return (
    <Ctx.Provider value={{ openScope, recentSpaces, openSpace, closeSpace }}>{children}</Ctx.Provider>
  );
}

export function useSpace(): SpaceCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSpace must be used inside <SpaceProvider>');
  return v;
}
