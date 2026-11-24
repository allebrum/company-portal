'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import type { TurnstileSaveInput, TurnstileStatus, TurnstileSyncInput, TurnstileTestResult } from '@allebrum/shared';

export type { TurnstileStatus, TurnstileTestResult };

const KEY = ['turnstileStatus'] as const;

/** Prefer the human message in `details.message` when the API sends one. */
export function turnstileErrorMessage(e: unknown, fallback = 'Action failed'): string {
  if (e instanceof ApiError) {
    const body = e.body as { error?: string; details?: { message?: string } } | undefined;
    if (body?.details?.message) return body.details.message;
    const code = body?.error;
    if (code === 'credentials_not_configured') {
      return "Can't store the secret: the server's CREDENTIALS_KEYS isn't configured.";
    }
    if (code === 'form_turnstile_not_connected') {
      return 'Connect Cloudflare Turnstile under Admin → Integrations first, or add a per-form widget.';
    }
    if (code && code !== 'request_failed') return e.message;
  }
  return e instanceof Error ? e.message : fallback;
}

export function useTurnstileStatus() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => api.get<TurnstileStatus>('/integrations/turnstile/status'),
  });
}

export function useSaveTurnstile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TurnstileSaveInput) => api.put<TurnstileStatus>('/integrations/turnstile', input),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      qc.invalidateQueries({ queryKey: ['formsConfig'] });
    },
  });
}

export function useTestTurnstile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input?: { secret?: string }) => api.post<TurnstileTestResult>('/integrations/turnstile/test', input ?? {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useSyncTurnstileHostnames() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TurnstileSyncInput) => api.post<TurnstileStatus>('/integrations/turnstile/sync-hostnames', input),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
    },
  });
}

export function useDisconnectTurnstile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<TurnstileStatus>('/integrations/turnstile/disconnect'),
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
      qc.invalidateQueries({ queryKey: ['formsConfig'] });
    },
  });
}
