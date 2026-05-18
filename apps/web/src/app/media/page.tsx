'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Folder,
  FileText,
  FolderPlus,
  Upload,
  Download,
  Trash2,
  ExternalLink,
  Eye,
  Plug,
  ChevronRight,
} from 'lucide-react';
import { Card, Section, Empty, Pill } from '@/components/ui';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import {
  useDriveStatus,
  useDriveList,
  useCreateDriveFolder,
  useUploadDriveFile,
  useDeleteDriveEntry,
  useDisconnectDrive,
  driveConnectUrl,
  driveDownloadUrl,
  previewUrl,
  type DriveEntry,
} from '@/hooks/useDrive';

export default function MediaPage() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: status, isLoading: statusLoading } = useDriveStatus();
  const [folderId, setFolderId] = useState<string | null>(null);
  const connected = !!status?.connected;
  const { data: listing, isFetching } = useDriveList(folderId, connected);
  const createFolder = useCreateDriveFolder();
  const uploadFile = useUploadDriveFile();
  const delEntry = useDeleteDriveEntry();
  const disconnect = useDisconnectDrive();

  const [newFolder, setNewFolder] = useState('');
  const [preview, setPreview] = useState<DriveEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const handledDriveParam = useRef(false);

  useEffect(() => {
    if (handledDriveParam.current) return;
    const url = new URL(window.location.href);
    const p = url.searchParams.get('drive');
    if (!p) return;
    handledDriveParam.current = true;
    if (p === 'connected') toast.success('Google Drive connected');
    else if (p === 'bad_state') toast.error('Drive connection expired — try again');
    else if (p === 'error') toast.error('Drive connection failed');
    // Remove the param so a refresh/remount can't re-fire the toast.
    url.searchParams.delete('drive');
    window.history.replaceState({}, '', url.pathname + url.search);
  }, [toast]);

  const canUseDrive = can('media.manage') || can('integrations.manage');
  if (!canUseDrive) {
    return <Empty title="No access" description="You don't have permission to use the media manager." />;
  }

  const currentParent = listing?.folderId ?? null;

  const onCreateFolder = async () => {
    if (!newFolder.trim() || !currentParent) return;
    try {
      await createFolder.mutateAsync({ parentId: currentParent, name: newFolder.trim() });
      setNewFolder('');
      toast.success('Folder created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create folder');
    }
  };

  const onUpload = async (file: File) => {
    if (!currentParent) return;
    try {
      await uploadFile.mutateAsync({ parentId: currentParent, file });
      toast.success(`Uploaded ${file.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="eyebrow">Workspace</div>
          <h1 className="text-2xl font-bold text-gray-900">Media manager</h1>
          <p className="text-sm text-gray-500">The shared Allebrum Portal Drive folder.</p>
        </div>
        {connected && canUseDrive && (
          <Button
            variant="ghost"
            onClick={async () => {
              try {
                await disconnect.mutateAsync();
                toast.success('Drive disconnected');
              } catch {
                toast.error('Could not disconnect');
              }
            }}
          >
            Disconnect Drive
          </Button>
        )}
      </div>

      {statusLoading ? (
        <Card className="p-8 text-center text-gray-500 text-sm">Checking Drive connection…</Card>
      ) : !status?.configured ? (
        <Card className="p-8 text-center">
          <Empty
            title="Drive not configured"
            description="Set GOOGLE_OAUTH_CLIENT_ID / SECRET and (optionally) DRIVE_OAUTH_REDIRECT_URL on the API, and enable the Drive API in Google Cloud."
          />
        </Card>
      ) : !connected ? (
        <Card className="p-8 text-center space-y-4">
          <Empty title="Google Drive not connected" description="Connect a Google account to browse and manage the shared portal folder." />
          {canUseDrive ? (
            <a href={driveConnectUrl} className="inline-block">
              <Button variant="primary" size="lg">
                <Plug className="w-4 h-4" /> Connect Google Drive
              </Button>
            </a>
          ) : (
            <p className="text-sm text-gray-500">Ask an administrator to connect Google Drive.</p>
          )}
        </Card>
      ) : (
        <>
          {/* Breadcrumb + actions */}
          <Card className="p-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 text-sm min-w-0 flex-1 flex-wrap">
              {(listing?.path ?? []).map((c, i) => (
                <span key={c.id} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
                  <button
                    onClick={() => setFolderId(c.id)}
                    className={`truncate hover:text-brand-700 ${
                      i === (listing!.path.length - 1) ? 'font-semibold text-gray-900' : 'text-gray-500'
                    }`}
                  >
                    {i === 0 ? 'Shared' : c.name}
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <Input
                className="w-40"
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                placeholder="New folder"
              />
              <Button variant="outline" size="sm" onClick={onCreateFolder} disabled={!newFolder.trim() || createFolder.isPending}>
                <FolderPlus className="w-4 h-4" /> Create
              </Button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onUpload(f);
                  e.target.value = '';
                }}
              />
              <Button variant="primary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadFile.isPending}>
                <Upload className="w-4 h-4" /> {uploadFile.isPending ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
          </Card>

          <Section>
            <Card>
              {isFetching && !listing ? (
                <div className="p-8 text-center text-gray-500 text-sm">Loading…</div>
              ) : (listing?.entries.length ?? 0) === 0 ? (
                <div className="p-8">
                  <Empty title="Empty folder" description="Create a sub-folder or upload a file." />
                </div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {listing!.entries.map((e) => {
                    const pv = !e.isFolder ? previewUrl(e) : null;
                    return (
                      <li key={e.id} className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50">
                        {e.isFolder ? (
                          <Folder className="w-5 h-5 text-brand-600 shrink-0" />
                        ) : (
                          <FileText className="w-5 h-5 text-gray-400 shrink-0" />
                        )}
                        <button
                          className="flex-1 min-w-0 text-left"
                          onClick={() => (e.isFolder ? setFolderId(e.id) : pv ? setPreview(e) : window.open(e.webViewLink ?? '#', '_blank'))}
                        >
                          <div className="text-sm font-semibold text-gray-900 truncate">{e.name}</div>
                          <div className="text-[11px] text-gray-500">
                            {e.isFolder ? 'Folder' : e.mimeType.replace('application/vnd.google-apps.', 'Google ')}
                            {e.modifiedTime && ` · ${e.modifiedTime.slice(0, 10)}`}
                          </div>
                        </button>
                        {!e.isFolder && pv && (
                          <button onClick={() => setPreview(e)} className="text-gray-400 hover:text-brand-700" title="Preview">
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                        {e.webViewLink && (
                          <a
                            href={e.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gray-400 hover:text-brand-700"
                            title="Open in Google"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        {!e.isFolder && (
                          <a
                            href={driveDownloadUrl(e.id)}
                            className="text-gray-400 hover:text-brand-700"
                            title="Download"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}
                        <button
                          onClick={async () => {
                            try {
                              await delEntry.mutateAsync(e.id);
                              toast.success('Moved to trash');
                            } catch {
                              toast.error('Delete failed');
                            }
                          }}
                          className="text-gray-300 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </Section>
        </>
      )}

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.name} size="xl">
        {preview && (
          <div className="space-y-3">
            <iframe
              src={previewUrl(preview) ?? ''}
              className="w-full h-[65vh] rounded-lg border border-gray-200"
              title={preview.name}
            />
            <div className="flex justify-end gap-2">
              {preview.webViewLink && (
                <a href={preview.webViewLink} target="_blank" rel="noreferrer">
                  <Button variant="outline" size="sm">
                    <ExternalLink className="w-4 h-4" /> Open & edit in Google
                  </Button>
                </a>
              )}
              <a href={driveDownloadUrl(preview.id)}>
                <Button variant="ghost" size="sm">
                  <Download className="w-4 h-4" /> Download
                </Button>
              </a>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
