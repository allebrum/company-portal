'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  CreateWebsiteInput,
  UpdateWebsiteInput,
  WebsiteCredentialsRow,
  WebsiteRow,
} from '@allebrum/shared';

const WEBSITES_KEY = ['websites'] as const;

export function useWebsites() {
  return useQuery({
    queryKey: WEBSITES_KEY,
    queryFn: () => api.get<WebsiteRow[]>('/websites'),
  });
}

export function useCreateWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebsiteInput) => api.post<WebsiteRow>('/websites', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: WEBSITES_KEY }),
  });
}

export function useUpdateWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateWebsiteInput }) =>
      api.patch<WebsiteRow>(`/websites/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: WEBSITES_KEY }),
  });
}

export function useDeleteWebsite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/websites/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: WEBSITES_KEY }),
  });
}

export function useWebsiteCredentials(id: string | null) {
  return useQuery({
    queryKey: ['websiteCredentials', id ?? ''],
    queryFn: () => api.get<WebsiteCredentialsRow>(`/websites/${id}/credentials`),
    enabled: !!id,
    retry: false,
  });
}
