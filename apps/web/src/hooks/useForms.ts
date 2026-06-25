'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/env';
import type {
  CreateFormInput,
  FormRow,
  FormSubmissionRow,
  UpdateFormInput,
} from '@allebrum/shared';

const FORMS_KEY = ['forms'] as const;

export function useForms(filters?: { clientId?: string | null; projectId?: string | null; enabled?: boolean }) {
  const clientId = filters?.clientId ?? null;
  const projectId = filters?.projectId ?? null;
  const enabled = filters?.enabled ?? true;
  return useQuery({
    queryKey: [...FORMS_KEY, clientId ?? '', projectId ?? ''] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (projectId) params.set('projectId', projectId);
      const qs = params.toString();
      return api.get<FormRow[]>(`/forms${qs ? `?${qs}` : ''}`);
    },
    enabled,
  });
}

export function useCreateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFormInput) => api.post<FormRow>('/forms', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: FORMS_KEY }),
  });
}

export function useUpdateForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateFormInput }) =>
      api.patch<FormRow>(`/forms/${id}`, patch),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: FORMS_KEY });
      qc.invalidateQueries({ queryKey: ['formSubmissions', vars.id] });
      qc.invalidateQueries({ queryKey: ['formEmbedSnippet', vars.id] });
    },
  });
}

export function useDeleteForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/forms/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: FORMS_KEY }),
  });
}

export function useFormSubmissions(id: string | null) {
  return useQuery({
    queryKey: ['formSubmissions', id ?? ''],
    queryFn: () => api.get<FormSubmissionRow[]>(`/forms/${id}/submissions`),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

export function useFormEmbedSnippet(id: string | null) {
  return useQuery({
    queryKey: ['formEmbedSnippet', id ?? ''],
    queryFn: () => api.get<{ token: string; snippet: string; apiOrigin: string; webOrigin: string }>(`/forms/${id}/embed-snippet`),
    enabled: !!id,
  });
}

export function formSubmissionsCsvUrl(id: string): string {
  return `${API_URL}/api/forms/${id}/submissions.csv`;
}
