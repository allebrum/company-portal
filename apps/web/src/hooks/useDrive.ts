'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/env';

export type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  iconLink?: string | null;
  webViewLink?: string | null;
  modifiedTime?: string | null;
  size?: string | null;
};
export type DriveStatus = {
  configured: boolean;
  connected: boolean;
  account: string | null;
  sharedFolderId: string | null;
  lastConnectedAt: string | null;
};
export type DriveListing = {
  folderId: string;
  path: { id: string; name: string }[];
  entries: DriveEntry[];
};

export const driveConnectUrl = `${API_URL}/api/integrations/drive/connect`;
export const driveDownloadUrl = (id: string) => `${API_URL}/api/integrations/drive/file/${id}/download`;

export function useDriveStatus() {
  return useQuery({
    queryKey: ['driveStatus'] as const,
    queryFn: () => api.get<DriveStatus>('/integrations/drive/status'),
  });
}

export function useDriveList(folderId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['driveList', folderId ?? 'root'] as const,
    enabled,
    queryFn: () =>
      api.get<DriveListing>(`/integrations/drive/list${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`),
  });
}

export function useCreateDriveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ parentId, name }: { parentId: string; name: string }) =>
      api.post<DriveEntry>('/integrations/drive/folders', { parentId, name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driveList'] }),
  });
}

export function useUploadDriveFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ parentId, file }: { parentId: string; file: File }) => {
      const fd = new FormData();
      fd.append('parentId', parentId);
      fd.append('file', file);
      const res = await fetch(`${API_URL}/api/integrations/drive/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'upload_failed');
      return res.json() as Promise<DriveEntry>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driveList'] }),
  });
}

export function useDeleteDriveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/integrations/drive/file/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driveList'] }),
  });
}

export function useDisconnectDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/integrations/drive/disconnect'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driveStatus'] });
      qc.invalidateQueries({ queryKey: ['driveList'] });
    },
  });
}

/** Embeddable preview URL for Google-native docs and PDFs/images. */
export function previewUrl(e: DriveEntry): string | null {
  if (e.mimeType.startsWith('application/vnd.google-apps.')) {
    const kind = e.mimeType.includes('spreadsheet')
      ? 'spreadsheets'
      : e.mimeType.includes('presentation')
        ? 'presentation'
        : 'document';
    const seg = kind === 'spreadsheets' ? 'spreadsheets' : kind === 'presentation' ? 'presentation' : 'document';
    return `https://docs.google.com/${seg}/d/${e.id}/preview`;
  }
  if (e.mimeType === 'application/pdf' || e.mimeType.startsWith('image/') || e.mimeType.startsWith('video/')) {
    return `https://drive.google.com/file/d/${e.id}/preview`;
  }
  return null;
}
