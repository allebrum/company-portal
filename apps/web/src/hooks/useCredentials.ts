'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreateCredentialInput,
  CredentialAccess,
  CredentialAccessLogRow,
  CredentialAllowlistResponse,
  CredentialListResponse,
  CredentialReveal,
  CredentialRow,
  UpdateCredentialInput,
} from '@allebrum/shared';

/**
 * Project / client credentials vault.
 *
 * Only METADATA goes through the react-query cache. Revealed values come
 * from `revealCredential()` (a plain call, never cached) and live only in
 * the component state of the row that asked for them, for ~30 seconds.
 */
export type CredScope = { kind: 'client' | 'project'; id: string };

const qs = (s: CredScope) => (s.kind === 'client' ? `clientId=${s.id}` : `projectId=${s.id}`);
const ROOT = ['credentials'] as const;

export function useCredentialAccess(scope: CredScope | null) {
  return useQuery({
    queryKey: [...ROOT, 'access', scope?.kind ?? '', scope?.id ?? ''],
    queryFn: () => api.get<CredentialAccess>(`/credentials/access?${qs(scope!)}`),
    enabled: !!scope,
    retry: false,
    staleTime: 60_000,
  });
}

export function useCredentials(scope: CredScope | null, enabled: boolean) {
  return useQuery({
    queryKey: [...ROOT, 'list', scope?.kind ?? '', scope?.id ?? ''],
    queryFn: () => api.get<CredentialListResponse>(`/credentials?${qs(scope!)}`),
    enabled: !!scope && enabled,
    retry: false,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ROOT });
}

export function useCreateCredential() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateCredentialInput) => api.post<CredentialRow>('/credentials', input),
    onSuccess: invalidate,
  });
}

export function useUpdateCredential() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateCredentialInput }) =>
      api.patch<CredentialRow>(`/credentials/${id}`, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteCredential() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/credentials/${id}`),
    onSuccess: invalidate,
  });
}

/** Uncached on purpose — see the module comment. */
export function revealCredential(id: string): Promise<CredentialReveal> {
  return api.post<CredentialReveal>(`/credentials/${id}/reveal`);
}

export function useCredentialAllowlist(clientId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...ROOT, 'allowlist', clientId ?? ''],
    queryFn: () => api.get<CredentialAllowlistResponse>(`/credentials/clients/${clientId}/allowlist`),
    enabled: !!clientId && enabled,
    retry: false,
  });
}

export function useSetCredentialAllowlist() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ clientId, entries }: { clientId: string; entries: { userId: string; canManage: boolean }[] }) =>
      api.put<CredentialAllowlistResponse>(`/credentials/clients/${clientId}/allowlist`, { entries }),
    onSuccess: invalidate,
  });
}

export function useCredentialAccessLog(clientId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: [...ROOT, 'log', clientId ?? ''],
    queryFn: () => api.get<CredentialAccessLogRow[]>(`/credentials/access-log?clientId=${clientId}&limit=200`),
    enabled: !!clientId && enabled,
    retry: false,
    staleTime: 0,
  });
}
