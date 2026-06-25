'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/env';
import type {
  CreateQrInput,
  UpdateQrInput,
  QrCodeRow,
  QrScanSummary,
} from '@allebrum/shared';

/** F24 — hooks for the QR Code Generator tool. */

const QR_KEY = ['qrCodes'] as const;

export function useQrCodes(filters?: { clientId?: string | null; projectId?: string | null }) {
  const clientId = filters?.clientId ?? null;
  const projectId = filters?.projectId ?? null;
  return useQuery({
    queryKey: [...QR_KEY, clientId ?? '', projectId ?? ''] as const,
    queryFn: () => {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (projectId) params.set('projectId', projectId);
      const qs = params.toString();
      return api.get<QrCodeRow[]>(`/qr${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useCreateQrCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateQrInput) => api.post<QrCodeRow>('/qr', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: QR_KEY }),
  });
}

export function useUpdateQrCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateQrInput }) =>
      api.patch<QrCodeRow>(`/qr/${id}`, patch),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: QR_KEY });
      qc.invalidateQueries({ queryKey: ['qrScans', vars.id] });
    },
  });
}

export function useDeleteQrCode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/qr/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: QR_KEY }),
  });
}

export function useQrScans(id: string | null) {
  return useQuery({
    queryKey: ['qrScans', id ?? ''],
    queryFn: () => api.get<QrScanSummary>(`/qr/${id}/scans`),
    enabled: !!id,
    refetchInterval: 30_000,
  });
}

/** Direct URL to the server-rendered PNG (for `<a download>` or `<img src>`). */
export function qrImagePngUrl(id: string): string {
  return `${API_URL}/api/qr/${id}/image.png`;
}

/** Direct URL to the CSV scans export. */
export function qrScansCsvUrl(id: string): string {
  return `${API_URL}/api/qr/${id}/scans.csv`;
}

/** The public tracking URL the QR encodes. */
export function trackingUrlFor(shortCode: string): string {
  // Same origin as the staff app since both ship in the same static
  // export. API_URL is e.g. https://rc.allebrum.com/api → strip /api.
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/api/q/${shortCode}`;
  }
  return `${API_URL}/q/${shortCode}`;
}
