'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Permission } from '@allebrum/shared';

export type Me = {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  billable: number;
  permissions: Permission[];
  groupIds: string[];
};

type AuthState = {
  me: Me | null;
  loading: boolean;
  error: string | null;
  can: (perm: Permission) => boolean;
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      if (res.user) setMe(res.user);
      setError(null);
      return { mfaRequired: false };
    },
    [],
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

  const value = useMemo<AuthState>(
    () => ({ me, loading, error, can, login, logout, refresh }),
    [me, loading, error, can, login, logout, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
