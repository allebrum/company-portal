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
const SPACE_PARAM = 'space';
const SPACE_TAB_PARAM = 'spaceTab';

const Ctx = createContext<SpaceCtx | null>(null);

function toUrlScope(scope: Scope): string | null {
  if (scope.kind === 'all') return null;
  return `${scope.kind}:${scope.id}`;
}

function fromUrlScope(raw: string | null): Scope | null {
  if (!raw) return null;
  const [kind, id] = raw.split(':');
  if ((kind !== 'client' && kind !== 'project') || !id) return null;
  return { kind, id } as Scope;
}

function readScopeFromUrl(): Scope | null {
  const url = new URL(window.location.href);
  return fromUrlScope(url.searchParams.get(SPACE_PARAM));
}

function writeScopeToUrl(scope: Scope | null, mode: 'push' | 'replace'): void {
  const url = new URL(window.location.href);
  if (!scope || scope.kind === 'all') {
    url.searchParams.delete(SPACE_PARAM);
    url.searchParams.delete(SPACE_TAB_PARAM);
  } else {
    url.searchParams.set(SPACE_PARAM, `${scope.kind}:${scope.id}`);
    // Opening a new scope starts on Notes by default.
    url.searchParams.set(SPACE_TAB_PARAM, 'notes');
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === 'push') window.history.pushState(window.history.state, '', next);
  else window.history.replaceState(window.history.state, '', next);
}

export function SpaceProvider({ children }: { children: ReactNode }) {
  const [openScope, setOpenScope] = useState<Scope | null>(null);
  const [recentSpaces, setRecentSpaces] = useState<Scope[]>([]);

  const rememberRecent = useCallback((scope: Scope) => {
    if (scope.kind === 'all') return;
    setRecentSpaces((prev) => {
      const without = prev.filter((s) => !(s.kind === scope.kind && 'id' in s && 'id' in scope && s.id === scope.id));
      return [scope, ...without].slice(0, RECENTS_MAX);
    });
  }, []);

  const openSpace = useCallback((scope: Scope) => {
    // The "All clients" scope has no space — refuse it defensively.
    if (scope.kind === 'all') return;
    const isSame =
      openScope &&
      openScope.kind !== 'all' &&
      openScope.kind === scope.kind &&
      openScope.id === scope.id;
    setOpenScope(scope);
    // Update recents LRU — push to front, dedupe by (kind, id), cap.
    rememberRecent(scope);
    if (!isSame) writeScopeToUrl(scope, 'push');
  }, [openScope, rememberRecent]);

  const closeSpace = useCallback(() => {
    if (!openScope) return;
    setOpenScope(null);
    writeScopeToUrl(null, 'push');
  }, [openScope]);

  // Initial URL restore + back/forward sync.
  useEffect(() => {
    const initial = readScopeFromUrl();
    if (initial && initial.kind !== 'all') {
      setOpenScope(initial);
      rememberRecent(initial);
    }

    const onPopState = () => {
      const next = readScopeFromUrl();
      setOpenScope(next);
      if (next && next.kind !== 'all') rememberRecent(next);
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [rememberRecent]);

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
