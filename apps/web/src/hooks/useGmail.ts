'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/env';

export type GmailStatus = {
  configured: boolean;
  connected: boolean;
  lastConnectedAt: string | null;
};

export type ConnectedGmailUser = {
  id: string;
  name: string;
  email: string;
  color: string;
};

/**
 * Build the consent-redirect URL for connecting Gmail. `returnTo` is an
 * optional same-origin path the server will bounce the browser back to
 * after consent — used by the just-in-time invite modal so the user lands
 * back in the invite UI with a `?gmail=connected` flag the modal can read.
 */
export const gmailConnectUrl = (returnTo?: string): string => {
  const base = `${API_URL}/api/integrations/gmail/connect`;
  return returnTo ? `${base}?return_to=${encodeURIComponent(returnTo)}` : base;
};

export function useGmailStatus() {
  return useQuery({
    queryKey: ['gmailStatus'] as const,
    queryFn: () => api.get<GmailStatus>('/integrations/gmail/status'),
  });
}

export function useConnectedGmailUsers(enabled: boolean = true) {
  return useQuery({
    queryKey: ['gmailConnectedUsers'] as const,
    enabled,
    queryFn: () => api.get<ConnectedGmailUser[]>('/integrations/gmail/connected-users'),
  });
}

export function useDisconnectGmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/integrations/gmail/disconnect'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gmailStatus'] });
      qc.invalidateQueries({ queryKey: ['gmailConnectedUsers'] });
    },
  });
}
