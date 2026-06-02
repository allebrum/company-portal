'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
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
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      setMe(null);
    }
  }, []);

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
