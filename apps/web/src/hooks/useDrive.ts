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

/**
 * Upload a file directly into a Client or Project Space — the server
 * handles Drive upload + atomic JSONB append to the scope's `spaceFiles`
 * column in one transactional step. Single permission gate
 * (`media.manage`) so admins-with-media-but-not-clients no longer hit
 * the half-write that left files in Drive but invisible in the Files tab.
 *
 * Invalidates both client + project query caches so the parent client's
 * "In sub-projects" aggregation refreshes too.
 */
export function useUploadSpaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      scopeKind: 'client' | 'project';
      scopeId: string;
      file: File;
    }) => {
      const fd = new FormData();
      fd.append('file', args.file);
      const res = await fetch(
        `${API_URL}/api/spaces/${args.scopeKind}/${args.scopeId}/files`,
        { method: 'POST', credentials: 'include', body: fd },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'upload_failed');
      }
      return res.json() as Promise<{ file: unknown; spaceFiles: unknown[] }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['driveList'] });
    },
  });
}

export function useDeleteDriveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/integrations/drive/file/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['driveList'] }),
  });
}

export function useRenameDriveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<DriveEntry>(`/integrations/drive/file/${id}`, { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driveList'] });
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useRenameSpaceFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      scopeKind: 'client' | 'project';
      scopeId: string;
      fileId: string;
      title: string;
      renameInDrive?: boolean;
    }) =>
      api.patch<{ file: unknown; spaceFiles: unknown[] }>(
        `/spaces/${args.scopeKind}/${args.scopeId}/files/${args.fileId}`,
        { title: args.title, renameInDrive: args.renameInDrive },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['driveList'] });
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useRefreshSpaceFileNames() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { scopeKind: 'client' | 'project'; scopeId: string }) =>
      api.post<{ updated: number; spaceFiles: unknown[] }>(
        `/spaces/${args.scopeKind}/${args.scopeId}/files/refresh-drive-names`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['driveList'] });
      qc.invalidateQueries({ queryKey: ['goals'] });
    },
  });
}

export function useDisconnectDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/integrations/drive/disconnect'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driveStatus'] });
      qc.invalidateQueries({ queryKey: ['driveList'] });
      qc.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export type DriveReconciliationReport = {
  clearedMissing: Array<{ scope: 'client' | 'project'; id: string; name: string; staleFolderId: string }>;
  linked: Array<{ scope: 'client' | 'project'; id: string; name: string; folderId: string }>;
  duplicatesDetected: Array<{
    scope: 'client' | 'project'; id: string; name: string; canonicalFolderId: string; duplicateFolderIds: string[];
  }>;
  unlinkedFolders: Array<{ folderId: string; name: string }>;
  unlinkedProjectFolders: Array<{ folderId: string; name: string; clientFolderId: string; clientName: string }>;
};

/**
 * Walks every client/project against Drive, clears dangling pointers,
 * links rows that have a name-matching folder, and reports duplicates +
 * orphans. Idempotent — safe to re-run. Admin clicks "Reconcile Drive
 * folders" in Settings → Integrations to recover from drift.
 */
export function useReconcileDriveFolders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<DriveReconciliationReport>('/integrations/drive/reconcile'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['driveList'] });
      qc.invalidateQueries({ queryKey: ['driveFolders'] });
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
