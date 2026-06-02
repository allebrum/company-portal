'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, Upload, XCircle } from 'lucide-react';
import { API_URL } from '@/lib/env';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

type UploadMeta = {
  token: string;
  label: string;
  expiresAt: string;
  uploadedCount: number;
};

type UploadResponse = {
  uploaded: Array<{ name: string; id?: string; url?: string }>;
  failed: Array<{ name: string; error: string }>;
};

type UploadMetaFields = {
  uploadTitle?: string;
  uploadNotes?: string;
};

function sanitizeTitleForFilename(input: string): string {
  const compact = input.trim().replace(/\s+/g, ' ');
  const safe = compact.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
  return safe.replace(/\s+/g, '-');
}

function getFileExtension(file: File): string {
  const fromName = file.name.includes('.') ? file.name.split('.').pop() ?? '' : '';
  if (fromName) return fromName.toLowerCase();
  if (file.type === 'image/jpeg') return 'jpg';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  if (file.type === 'image/heic') return 'heic';
  return 'jpg';
}

function renameFilesWithTitle(files: FileList | File[], title: string, notes?: string): File[] {
  const list = Array.from(files);
  const baseRaw = `${title.trim()} ${notes?.trim() ?? ''}`.trim();
  const base = (sanitizeTitleForFilename(baseRaw) || 'photo').slice(0, 90);
  const total = list.length;
  return list.map((f, idx) => {
    const ext = getFileExtension(f);
    const suffix = total > 1 ? `-${idx + 1}` : '';
    const fileName = `${base}${suffix}.${ext}`;
    return new File([f], fileName, {
      type: f.type,
      lastModified: f.lastModified,
    });
  });
}

export default function UploadQrPage() {
  const [token, setToken] = useState('');
  const [isProbablyMobile, setIsProbablyMobile] = useState(false);

  const [meta, setMeta] = useState<UploadMeta | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photoMetaOpen, setPhotoMetaOpen] = useState(false);
  const [pendingPhotoFiles, setPendingPhotoFiles] = useState<File[]>([]);
  const [photoTitle, setPhotoTitle] = useState('photo');
  const [photoNotes, setPhotoNotes] = useState('');
  const [photoTitleError, setPhotoTitleError] = useState<string | null>(null);

  const pickRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('token') ?? '';
    setToken(raw.trim());

    const ua = navigator.userAgent || '';
    const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
    setIsProbablyMobile(mobile);
  }, []);

  const stopCamera = () => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    setCameraOpen(false);
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!token) {
      setLoadingMeta(false);
      setMetaError('invalid_upload_link');
      setMeta(null);
      return () => {
        cancelled = true;
      };
    }

    setLoadingMeta(true);
    setMetaError(null);
    setMeta(null);

    void fetch(`${API_URL}/api/upload/qr/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? 'invalid_upload_link');
        if (!cancelled) setMeta(body as UploadMeta);
      })
      .catch((e) => {
        if (!cancelled) setMetaError(e instanceof Error ? e.message : 'invalid_upload_link');
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  const onFiles = (files: FileList | null, metaFields?: UploadMetaFields) => {
    if (!files || files.length === 0 || !token || uploading) return;

    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('files', f));
    if (metaFields?.uploadTitle?.trim()) fd.append('uploadTitle', metaFields.uploadTitle.trim());
    if (metaFields?.uploadNotes?.trim()) fd.append('uploadNotes', metaFields.uploadNotes.trim());

    const xhr = new XMLHttpRequest();
    setUploading(true);
    setProgress(0);
    setResult(null);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) {
        setProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== XMLHttpRequest.DONE) return;
      setUploading(false);
      if (xhr.status < 200 || xhr.status >= 300) {
        const body = JSON.parse(xhr.responseText || '{}');
        setResult({ uploaded: [], failed: [{ name: 'Upload', error: body.error ?? 'upload_failed' }] });
        return;
      }
      const body = JSON.parse(xhr.responseText || '{}') as UploadResponse;
      setResult(body);
      void fetch(`${API_URL}/api/upload/qr/${encodeURIComponent(token)}`)
        .then((r) => r.json())
        .then((m) => setMeta(m as UploadMeta))
        .catch(() => undefined);
    };

    xhr.open('POST', `${API_URL}/api/upload/qr/${encodeURIComponent(token)}/files`);
    xhr.send(fd);
  };

  const onNamedFiles = (files: File[], metaFields?: UploadMetaFields) => {
    if (files.length === 0 || !token || uploading) return;
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(f));
    onFiles(dt.files, metaFields);
  };

  const openPhotoMetaModal = (files: File[]) => {
    if (files.length === 0) return;
    setPendingPhotoFiles(files);
    setPhotoTitle('photo');
    setPhotoNotes('');
    setPhotoTitleError(null);
    setPhotoMetaOpen(true);
  };

  const closePhotoMetaModal = () => {
    setPhotoMetaOpen(false);
    setPendingPhotoFiles([]);
    setPhotoTitle('photo');
    setPhotoNotes('');
    setPhotoTitleError(null);
  };

  const confirmPhotoMeta = () => {
    const title = photoTitle.trim();
    if (!title) {
      setPhotoTitleError('Please enter a title.');
      return;
    }
    const renamed = renameFilesWithTitle(pendingPhotoFiles, title, photoNotes);
    closePhotoMetaModal();
    onNamedFiles(renamed, {
      uploadTitle: title,
      uploadNotes: photoNotes,
    });
  };

  const openDesktopCamera = async () => {
    if (uploading) return;
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        void video.play().catch(() => undefined);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not access camera';
      setCameraError(msg);
    }
  };

  const captureDesktopPhoto = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth <= 0 || video.videoHeight <= 0) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (!blob) return;

    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
    stopCamera();
    openPhotoMetaModal([file]);
  };

  const onTakePhotoClick = () => {
    if (
      !isProbablyMobile &&
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function'
    ) {
      void openDesktopCamera();
      return;
    }
    cameraRef.current?.click();
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white px-4 py-8">
      <div className="mx-auto max-w-xl space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Mobile Upload</h1>
          <p className="text-sm text-gray-500">Upload photos or files directly into the workspace.</p>
        </div>

        {loadingMeta ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">Loading upload link…</div>
        ) : metaError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            This upload link is invalid or expired.
          </div>
        ) : (
          <>
            <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-2">
              <div className="text-sm text-gray-500">Destination</div>
              <div className="text-lg font-semibold text-gray-900">{meta?.label || 'Workspace upload'}</div>
              <div className="text-xs text-gray-500">Uploaded so far: {meta?.uploadedCount ?? 0}</div>
            </div>

            <div
              onDragEnter={(e) => {
                e.preventDefault();
                if (!uploading) setDragActive(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!uploading) setDragActive(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDragActive(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                onFiles(e.dataTransfer.files);
              }}
              className={`rounded-2xl border-2 border-dashed bg-white p-6 text-center space-y-4 transition-colors ${
                dragActive ? 'border-brand-500 bg-brand-50/40' : 'border-gray-300'
              }`}
            >
              <Upload className="w-8 h-8 mx-auto text-gray-400" />
              <div className="text-sm text-gray-600">Choose or drag one or more files/photos, or take a photo now.</div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => pickRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  disabled={uploading}
                >
                  <Upload className="w-4 h-4" /> Choose files/photos
                </button>
                <button
                  type="button"
                  onClick={onTakePhotoClick}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-brand-700 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-800 disabled:opacity-60"
                  disabled={uploading}
                >
                  <Camera className="w-4 h-4" /> Take photo
                </button>
              </div>
              {cameraError && <div className="text-xs text-red-600">Camera: {cameraError}</div>}
              <input
                ref={pickRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  onFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    openPhotoMetaModal(Array.from(files));
                  }
                  e.target.value = '';
                }}
              />
            </div>

            <Modal
              open={photoMetaOpen}
              onClose={closePhotoMetaModal}
              title="Name Photo Upload"
              footer={(
                <>
                  <Button variant="ghost" onClick={closePhotoMetaModal}>Cancel</Button>
                  <Button variant="primary" onClick={confirmPhotoMeta} disabled={uploading}>Upload</Button>
                </>
              )}
            >
              <div className="space-y-3">
                <p className="text-sm text-gray-600">
                  Add a meaningful file name for {pendingPhotoFiles.length} photo{pendingPhotoFiles.length === 1 ? '' : 's'}.
                </p>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">Title</label>
                  <input
                    value={photoTitle}
                    onChange={(e) => {
                      setPhotoTitle(e.target.value);
                      if (photoTitleError) setPhotoTitleError(null);
                    }}
                    placeholder="e.g. front-entrance"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                  {photoTitleError && <div className="mt-1 text-xs text-red-600">{photoTitleError}</div>}
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-widest text-gray-500 mb-1">Notes (optional)</label>
                  <input
                    value={photoNotes}
                    onChange={(e) => setPhotoNotes(e.target.value)}
                    placeholder="e.g. north-side-window"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
                  />
                  <div className="mt-1 text-[11px] text-gray-500">Notes are stored in upload audit details and appended to the file name.</div>
                </div>
              </div>
            </Modal>

            {cameraOpen && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                <div className="text-sm font-semibold text-gray-800">Camera preview</div>
                <video ref={videoRef} className="w-full rounded-lg bg-black" playsInline muted autoPlay />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={stopCamera}
                    className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void captureDesktopPhoto()}
                    className="inline-flex items-center gap-1 rounded-lg bg-brand-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-800"
                    disabled={uploading}
                  >
                    <Camera className="w-4 h-4" /> Capture and upload
                  </button>
                </div>
                <canvas ref={canvasRef} className="hidden" />
              </div>
            )}

            {uploading && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-2">
                <div className="text-sm font-semibold text-gray-700">Uploading… {progress}%</div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-600 transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {result && (
              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                {result.uploaded.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" /> Uploaded ({result.uploaded.length})
                    </div>
                    <ul className="mt-1 text-sm text-gray-700 list-disc pl-5">
                      {result.uploaded.map((u, i) => (
                        <li key={`${u.name}-${i}`}>{u.name}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {result.failed.length > 0 && (
                  <div>
                    <div className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
                      <XCircle className="w-4 h-4" /> Failed ({result.failed.length})
                    </div>
                    <ul className="mt-1 text-sm text-gray-700 list-disc pl-5">
                      {result.failed.map((f, i) => (
                        <li key={`${f.name}-${i}`}>{f.name}: {f.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
