'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api } from '@/lib/api';
import type { TwoFactorStatus, TwoFactorChallenge } from '@allebrum/shared';

// ---- Login second-step (uses the pending session) ----
export function useTwoFactorChallenge(enabled: boolean) {
  return useQuery({
    queryKey: ['2faChallenge'] as const,
    enabled,
    queryFn: () => api.get<TwoFactorChallenge>('/auth/2fa/challenge'),
    staleTime: 0,
  });
}

export async function verifyTotpStep(code: string) {
  return api.post<{ user: unknown }>('/auth/2fa/totp', { code });
}

export async function verifyPasskeyStep() {
  const options = await api.get<Record<string, unknown>>('/auth/2fa/webauthn/options');
  const assertion = await startAuthentication({ optionsJSON: options as never });
  return api.post<{ user: unknown }>('/auth/2fa/webauthn/verify', { response: assertion });
}

// ---- Enrollment / management (authenticated) ----
export function useTwoFactorStatus() {
  return useQuery({
    queryKey: ['2faStatus'] as const,
    queryFn: () => api.get<TwoFactorStatus>('/auth/2fa/status'),
  });
}

export function useStartTotpSetup() {
  return useMutation({
    mutationFn: () => api.post<{ otpauthUrl: string; qrDataUrl: string }>('/auth/2fa/totp/setup'),
  });
}

export function useEnableTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.post<{ recoveryCodes: string[] }>('/auth/2fa/totp/enable', { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['2faStatus'] }),
  });
}

export function useDisableTotp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del<{ ok: true }>('/auth/2fa/totp'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['2faStatus'] }),
  });
}

export function useRegenerateRecoveryCodes() {
  return useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery/regenerate'),
  });
}

export function useRegisterPasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const options = await api.get<Record<string, unknown>>('/auth/2fa/webauthn/register/options');
      const attestation = await startRegistration({ optionsJSON: options as never });
      return api.post<{ ok: true }>('/auth/2fa/webauthn/register/verify', { response: attestation, name });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['2faStatus'] }),
  });
}

export function useDeletePasskey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/auth/2fa/webauthn/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['2faStatus'] }),
  });
}
