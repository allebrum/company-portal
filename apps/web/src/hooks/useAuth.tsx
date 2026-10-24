'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, onUnauthorized, setSessionLost } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';
import type { Permission } from '@allebrum/shared';

/** Hoppa: one workspace the user belongs to (for the switcher). */
export type Workspace = { id: string; name: string; slug: string; isOwner: boolean };

export type Me = {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  billable: number;
  permissions: Permission[];
  groupIds: string[];
  // Hoppa: the active workspace + the user's full membership list.
  tenantId: string;
  workspaces: Workspace[];
};

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  can: (perm: Permission) => boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Hoppa: switch the active workspace, clear caches, refetch everything. */
  switchWorkspace: (tenantId: string) => Promise<void>;
  /** True after the session ended on its own (expired/revoked) rather than by logout. */
  sessionExpired: boolean;
  /** End the session after a 401: one state change, one redirect (idempotent). */
  expire: () => void;
};

/** Re-check the session at most this often when the tab regains focus. */
const REVALIDATE_MIN_MS = 30_000;

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const queryClient = useQueryClient();
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const expiredRef = useRef(false);
  const lastCheckRef = useRef(0);

  const signedIn = useCallback((u: Me) => {
    expiredRef.current = false;
    lastCheckRef.current = Date.now();
    setSessionLost(false);
    setSessionExpired(false);
    setMe(u);
  }, []);

  // The session ended underneath an open page. Do it exactly once: mark the
  // session lost (staff requests now fail fast), stop the socket, drop the
  // cache (it belongs to the old session and holds the 401 errors that
  // used to bounce /login ↔ /dashboard), and clear `me`. AuthGate then
  // redirects once to /login?next=…&expired=1. Unsaved Notes are stashed
  // by useUpdateSpaceBlocks, which listens for the same 401.
  const expire = useCallback(() => {
    if (expiredRef.current || !meRef.current) return;
    expiredRef.current = true;
    setSessionLost(true);
    disconnectSocket();
    setSessionExpired(true);
    setMe(null);
    // After the shell unmounts, so no mounted query observer refetches.
    setTimeout(() => {
      void queryClient.cancelQueries();
      queryClient.clear();
    }, 0);
  }, [queryClient]);

  useEffect(() => onUnauthorized(() => expire()), [expire]);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const u = await api.get<Me>('/auth/me');
      signedIn(u);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        if (meRef.current) expire();
        else setMe(null);
      } else {
        setError(e instanceof Error ? e.message : 'failed_to_load');
      }
    } finally {
      setLoading(false);
    }
  }, [signedIn, expire]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Returning to a tab that sat open past its session: check /auth/me
  // quietly (no loading state, so an open editor is never unmounted) and
  // end the session cleanly before anything else on the page notices.
  useEffect(() => {
    const check = () => {
      if (!meRef.current || expiredRef.current) return;
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastCheckRef.current < REVALIDATE_MIN_MS) return;
      lastCheckRef.current = Date.now();
      api.get<Me>('/auth/me').catch((e) => {
        if (e instanceof ApiError && e.status === 401) expire();
      });
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
    };
  }, [expire]);

  const login = useCallback(
    async (email: string, password: string): Promise<{ mfaRequired: boolean }> => {
      const res = await api.post<{ user?: Me; mfaRequired?: boolean }>('/auth/login', { email, password });
      if (res.mfaRequired) return { mfaRequired: true };
      // The login response carries permissions but not the workspace fields;
      // refresh from /auth/me to load the full Me (tenantId + workspaces).
      await refresh();
      setError(null);
      return { mfaRequired: false };
    },
    [refresh],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } finally {
      setSessionExpired(false);
      setMe(null);
      disconnectSocket();
      // The next person to sign in on this tab must not see this cache.
      setTimeout(() => queryClient.clear(), 0);
    }
  }, [queryClient]);

  const can = useCallback(
    (perm: Permission) => !!me?.permissions?.includes(perm),
    [me],
  );

  const switchWorkspace = useCallback(
    async (tenantId: string): Promise<void> => {
      await api.post('/auth/switch-workspace', { tenantId });
      // Drop every cached query so no prior workspace's data lingers, then
      // refetch identity (new permissions/branding) + everything else.
      queryClient.clear();
      await refresh();
    },
    [queryClient, refresh],
  );

  const value = useMemo<AuthState>(
    () => ({ me, loading, error, can, login, logout, refresh, switchWorkspace, sessionExpired, expire }),
    [me, loading, error, can, login, logout, refresh, switchWorkspace, sessionExpired, expire],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
