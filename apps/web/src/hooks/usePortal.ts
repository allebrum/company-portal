'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/**
 * F23 — hooks for the public client portal. Mirrors the shape of the
 * staff `useAuth` + `useResources` patterns but talks to /api/portal/*
 * and is keyed by `portal:slug:*` so the caches don't collide with the
 * staff app if both are open in the same tab (rare, but cheap to be
 * safe).
 */

export type PortalMe = {
  contact: { id: string; name: string; email: string; role: 'primary' | 'viewer' };
  client: { id: string; name: string; color: string; slug: string };
};

export type PortalLookup = { name: string; color: string; slug: string };

/** Public — slug → branding + client name (404 when unpublished). */
export function usePortalLookup(slug: string | null) {
  return useQuery({
    queryKey: ['portal', 'lookup', slug ?? ''],
    queryFn: () => api.get<PortalLookup>(`/portal/lookup?slug=${encodeURIComponent(slug ?? '')}`),
    enabled: !!slug,
    retry: false,
  });
}

/** Session-gated — returns null while loading or unauth, populated when signed in. */
export function usePortalMe() {
  return useQuery({
    queryKey: ['portal', 'me'],
    queryFn: async () => {
      try {
        return await api.get<PortalMe>('/portal/me');
      } catch (e) {
        // 401 from the API surfaces as a thrown error; downstream
        // treats `data === null` as "not signed in".
        if (e instanceof Error && /unauthorized|session_invalidated/.test(e.message)) {
          return null;
        }
        throw e;
      }
    },
    retry: false,
    staleTime: 5_000,
  });
}

export function useRequestPortalAccess() {
  return useMutation({
    mutationFn: ({ slug, email }: { slug: string; email: string }) =>
      api.post<{ ok: true }>(`/portal/request-access`, { slug, email }),
  });
}

export function useExchangePortalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, token }: { slug: string; token: string }) =>
      api.post<{ ok: true; slug: string }>(`/portal/exchange`, { slug, token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal', 'me'] });
    },
  });
}

export function useLogoutPortal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>(`/portal/logout`),
    onSuccess: () => {
      qc.setQueryData(['portal', 'me'], null);
      qc.invalidateQueries({ queryKey: ['portal'] });
    },
  });
}

// ---- Phase 2B read endpoints (light typings to be extended) ----------

export type PortalProjectRow = {
  id: string;
  name: string;
  code: string;
  color: string;
  goalCount: number;
  openTodoCount: number;
  avgProgress: number;
};
export type PortalGoalRow = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  progress: number | null;
  dueDate: string | null;
};
export type PortalMilestoneRow = {
  id: string;
  projectId: string;
  title: string;
  date: string;
  kind: 'release' | 'review' | 'deadline' | 'phase';
};
export type PortalFileRow = {
  id: string;
  title: string;
  url: string;
  meta?: string;
  addedAt: string;
};
export type PortalOverview = {
  client: PortalMe['client'];
  projects: PortalProjectRow[];
  inFlightGoals: PortalGoalRow[];
  upcomingMilestones: PortalMilestoneRow[];
  fileCount: number;
};

export function usePortalOverview(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'overview'],
    queryFn: () => api.get<PortalOverview>('/portal/overview'),
    enabled,
    retry: false,
  });
}

export function usePortalProjects(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'projects'],
    queryFn: () => api.get<PortalProjectRow[]>('/portal/projects'),
    enabled,
    retry: false,
  });
}

export function usePortalFiles(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'files'],
    queryFn: () => api.get<PortalFileRow[]>('/portal/files'),
    enabled,
    retry: false,
  });
}
