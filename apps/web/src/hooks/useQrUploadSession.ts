'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/queryKeys';

export type QrUploadTarget =
  | { kind: 'space'; scopeKind: 'client' | 'project'; scopeId: string }
  | { kind: 'drive'; folderId: string }
  | { kind: 'todo'; todoId: string }
  | { kind: 'goal'; goalId: string };

export type CreateQrUploadSessionResult = {
  token: string;
  uploadUrl: string;
  label: string;
  expiresAt: string;
};

export type ActiveQrUploadSession = {
  id: string;
  token: string;
  uploadUrl: string;
  label: string;
  targetKind: string;
  targetId: string;
  uploadedCount: number;
  lastUploadedAt: string | null;
  createdAt: string;
  expiresAt: string;
  createdByUserId: string;
  createdByName: string | null;
  createdByEmail: string | null;
};

export type QrUploadSessionFile = {
  id: string;
  sessionId: string;
  uploadTitle: string | null;
  uploadNotes: string | null;
  originalName: string;
  mimeType: string | null;
  sizeBytes: number;
  destinationKind: string;
  destinationId: string;
  storedFileId: string | null;
  storedFileUrl: string | null;
  createdAt: string;
};

export function useCreateQrUploadSession() {
  return useMutation({
    mutationFn: (input: { target: QrUploadTarget; label?: string; expiresInHours?: number }) =>
      api.post<CreateQrUploadSessionResult>('/upload/qr/sessions', input),
  });
}

export function useActiveQrUploadSessions(enabled = true) {
  return useQuery({
    queryKey: [...qk.integrations, 'uploadQrSessions'],
    queryFn: () => api.get<ActiveQrUploadSession[]>('/upload/qr/sessions'),
    enabled,
  });
}

export function useRevokeQrUploadSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/upload/qr/sessions/${id}/revoke`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [...qk.integrations, 'uploadQrSessions'] });
    },
  });
}

export function useQrUploadSessionFiles(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: [...qk.integrations, 'uploadQrSessions', sessionId, 'files'],
    queryFn: () => api.get<QrUploadSessionFile[]>(`/upload/qr/sessions/${sessionId}/files`),
    enabled: enabled && !!sessionId,
  });
}
