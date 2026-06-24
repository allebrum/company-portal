'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { getSupabase } from '@/lib/supabase';
import type { Permission } from '@modernzen/shared';

/** One workspace the user belongs to (for the switcher). */
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
  // The active workspace + the user's full membership list.
  tenantId: string;
  workspaces: Workspace[];
};

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  can: (perm: Permission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  switchWorkspace: (tenantId: string) => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Load the app identity from /auth/me. api.ts attaches the Supabase JWT as a
  // Bearer token; no session → 401 → not signed in.
  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const u = await api.get<Me>('/auth/me');
      setMe(u);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setMe(null);
      } else {
        setError(e instanceof Error ? e.message : 'failed_to_load');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Track whether we currently hold an identity, read inside the auth-change
  // handler without making it an effect dependency.
  const hasIdentityRef = useRef(false);
  useEffect(() => {
    hasIdentityRef.current = me !== null;
  }, [me]);

  // Initial load + a DELIBERATELY MINIMAL reaction to Supabase auth changes.
  // We do NOT refresh on TOKEN_REFRESHED or INITIAL_SESSION, and only on a
  // genuinely new SIGNED_IN (when no identity is held yet). Reason: api.ts calls
  // getSession() on every request, which re-emits these events; refreshing on
  // them re-enters /auth/me and loops — pathologically so when a same-origin
  // iframe (the staff Portal-tab preview) runs a second Supabase client over the
  // shared session. The mount refresh() + login() cover initial/explicit loads.
  useEffect(() => {
    void refresh();
    const { data: sub } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setMe(null);
        setLoading(false);
      } else if (event === 'SIGNED_IN' && !hasIdentityRef.current) {
        void refresh();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const { error: err } = await getSupabase().auth.signInWithPassword({ email, password });
      if (err) throw new ApiError(401, err.message);
      await refresh();
      setError(null);
    },
    [refresh],
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await getSupabase().auth.signOut();
    } finally {
      setMe(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const can = useCallback((perm: Permission) => !!me?.permissions?.includes(perm), [me]);

  const switchWorkspace = useCallback(
    async (tenantId: string): Promise<void> => {
      // The active workspace travels as an `x-tenant-id` header the API derives
      // tenant context from; persist it so api.ts can attach it.
      if (typeof window !== 'undefined') window.localStorage.setItem('active-tenant', tenantId);
      await api.post('/auth/switch-workspace', { tenantId });
      queryClient.clear();
      await refresh();
    },
    [queryClient, refresh],
  );

  const value = useMemo<AuthState>(
    () => ({ me, loading, error, can, login, logout, refresh, switchWorkspace }),
    [me, loading, error, can, login, logout, refresh, switchWorkspace],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
