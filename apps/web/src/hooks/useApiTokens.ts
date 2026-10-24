'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiTokenSummary, CreateApiTokenInput, CreatedApiToken } from '@allebrum/shared';

const KEY = ['apiTokens'] as const;

export function useApiTokens() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<ApiTokenSummary[]>('/api-tokens') });
}

export function useCreateApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiTokenInput) => api.post<CreatedApiToken>('/api-tokens', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useRevokeApiToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<unknown>(`/api-tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
