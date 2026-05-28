'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/env';
import { qk } from '@/lib/queryKeys';

/**
 * Background upload manager — owns the queue, runs an XHR pipeline with a
 * concurrency cap, exposes progress + cancel/retry/dismiss via context.
 *
 * Why this exists: F17 made the per-file upload atomic on the server,
 * but the FilesTab still awaited each one inline. Multi-file drops
 * blocked the UI, closing the Space overlay killed the toasts, and
 * there was no progress feedback. This provider lifts the upload
 * lifecycle out of the FilesTab into a shell-level singleton so users
 * can keep working (or close the Space, or navigate to /todos) while
 * uploads keep moving.
 *
 * Why XHR not fetch: `fetch()` can't surface upload-byte progress
 * without ReadableStream-on-request-body plumbing that isn't broadly
 * supported. XHR's `upload.onprogress` is the standard way and lets us
 * draw real per-file progress bars.
 *
 * Why not a literal Web Worker: uploads are I/O-bound, not CPU-bound. A
 * Worker would add a postMessage layer per progress event for no
 * benefit. The "worker" pattern here is a job-runner: queue + N slots +
 * pump loop, all main-thread.
 */

const MAX_CONCURRENT = 3;
// Mirror the server's `multer` cap (100MB) so we can preflight oversized
// files without paying the upload round-trip. Keep this in sync with
// `apps/api/src/routes/spaces.ts` if the server limit ever changes.
const MAX_FILE_BYTES = 100 * 1024 * 1024;

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'failed' | 'cancelled';

export type UploadItem = {
  id: string;
  scopeKind: 'client' | 'project';
  scopeId: string;
  /** Display label captured at enqueue time; survives Space-overlay teardown. */
  scopeLabel: string;
  file: File;
  status: UploadStatus;
  /** 0..1 — only meaningful while `status === 'uploading'`. */
  progress: number;
  error?: string;
  /** Drive file ID returned by the server on success. */
  driveFileId?: string;
  startedAt?: number;
  finishedAt?: number;
};

type EnqueueArgs = {
  scopeKind: 'client' | 'project';
  scopeId: string;
  scopeLabel: string;
  files: File[];
};

type UploadCtx = {
  items: UploadItem[];
  enqueue: (args: EnqueueArgs) => void;
  cancel: (id: string) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  clearCompleted: () => void;
};

const Ctx = createContext<UploadCtx | null>(null);

// ---- Reducer ------------------------------------------------------------

type Action =
  | { type: 'enqueue'; items: UploadItem[] }
  | { type: 'start'; id: string; startedAt: number }
  | { type: 'progress'; id: string; value: number }
  | { type: 'done'; id: string; driveFileId?: string; finishedAt: number }
  | { type: 'fail'; id: string; error: string; finishedAt: number }
  | { type: 'cancel'; id: string; finishedAt: number }
  | { type: 'reset_for_retry'; id: string }
  | { type: 'remove'; id: string }
  | { type: 'clear_completed' };

function reducer(state: UploadItem[], action: Action): UploadItem[] {
  switch (action.type) {
    case 'enqueue':
      return [...state, ...action.items];
    case 'start':
      return state.map((it) =>
        it.id === action.id
          ? { ...it, status: 'uploading' as const, progress: 0, startedAt: action.startedAt }
          : it,
      );
    case 'progress':
      return state.map((it) =>
        it.id === action.id ? { ...it, progress: action.value } : it,
      );
    case 'done':
      return state.map((it) =>
        it.id === action.id
          ? {
              ...it,
              status: 'done' as const,
              progress: 1,
              driveFileId: action.driveFileId,
              finishedAt: action.finishedAt,
            }
          : it,
      );
    case 'fail':
      return state.map((it) =>
        it.id === action.id
          ? { ...it, status: 'failed' as const, error: action.error, finishedAt: action.finishedAt }
          : it,
      );
    case 'cancel':
      return state.map((it) =>
        it.id === action.id
          ? { ...it, status: 'cancelled' as const, finishedAt: action.finishedAt }
          : it,
      );
    case 'reset_for_retry':
      return state.map((it) =>
        it.id === action.id
          ? {
              ...it,
              status: 'queued' as const,
              progress: 0,
              error: undefined,
              startedAt: undefined,
              finishedAt: undefined,
            }
          : it,
      );
    case 'remove':
      return state.filter((it) => it.id !== action.id);
    case 'clear_completed':
      return state.filter(
        (it) => it.status !== 'done' && it.status !== 'cancelled' && it.status !== 'failed',
      );
    default:
      return state;
  }
}

// ---- Provider ----------------------------------------------------------

let seq = 0;
const nextId = () => `up-${Date.now()}-${++seq}`;

export function UploadManagerProvider({ children }: { children: ReactNode }) {
  const [items, dispatch] = useReducer(reducer, [] as UploadItem[]);
  const qc = useQueryClient();
  // XHRs need to be addressable by id for cancel. Refs (not state) — we
  // never render the XHRs and updating state for them would cause spurious
  // renders.
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const startUpload = useCallback(
    (item: UploadItem) => {
      const xhr = new XMLHttpRequest();
      xhrs.current.set(item.id, xhr);
      const url = `${API_URL}/api/spaces/${item.scopeKind}/${item.scopeId}/files`;

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          dispatch({ type: 'progress', id: item.id, value: e.loaded / e.total });
        }
      };
      xhr.onload = () => {
        xhrs.current.delete(item.id);
        if (xhr.status >= 200 && xhr.status < 300) {
          let driveFileId: string | undefined;
          try {
            const body = JSON.parse(xhr.responseText) as { file?: { url?: string; meta?: string } };
            // Server stores `Drive · <id>` in meta. Optional, just for display.
            const match = body?.file?.meta?.match(/Drive · (\S+)/);
            driveFileId = match?.[1];
          } catch {
            /* ignore parse failure — success status is the source of truth */
          }
          dispatch({ type: 'done', id: item.id, driveFileId, finishedAt: Date.now() });
          // Refresh the Space query so the new file shows up in the Files tab.
          qc.invalidateQueries({ queryKey: qk.clients });
          qc.invalidateQueries({ queryKey: qk.projects });
          qc.invalidateQueries({ queryKey: ['driveList'] });
        } else {
          let errMsg = `HTTP ${xhr.status}`;
          try {
            const body = JSON.parse(xhr.responseText) as { error?: string };
            if (body?.error) errMsg = body.error;
          } catch {
            /* keep generic */
          }
          dispatch({ type: 'fail', id: item.id, error: errMsg, finishedAt: Date.now() });
        }
      };
      xhr.onerror = () => {
        xhrs.current.delete(item.id);
        dispatch({ type: 'fail', id: item.id, error: 'network_error', finishedAt: Date.now() });
      };
      xhr.onabort = () => {
        xhrs.current.delete(item.id);
        dispatch({ type: 'cancel', id: item.id, finishedAt: Date.now() });
      };

      xhr.open('POST', url);
      xhr.withCredentials = true;

      const fd = new FormData();
      fd.append('file', item.file);
      dispatch({ type: 'start', id: item.id, startedAt: Date.now() });
      xhr.send(fd);
    },
    [qc],
  );

  // Pump loop — runs after every state change. Cheap (O(items)) and
  // idempotent: if nothing is queued or all slots are full, it's a no-op.
  useEffect(() => {
    const inFlight = items.filter((it) => it.status === 'uploading').length;
    if (inFlight >= MAX_CONCURRENT) return;
    const slotsFree = MAX_CONCURRENT - inFlight;
    const next = items.filter((it) => it.status === 'queued').slice(0, slotsFree);
    next.forEach(startUpload);
  }, [items, startUpload]);

  const enqueue = useCallback(({ scopeKind, scopeId, scopeLabel, files }: EnqueueArgs) => {
    if (files.length === 0) return;
    const newItems: UploadItem[] = files.map((file) => {
      // Preflight the size cap so we don't waste bytes only to be 413'd.
      if (file.size > MAX_FILE_BYTES) {
        return {
          id: nextId(),
          scopeKind,
          scopeId,
          scopeLabel,
          file,
          status: 'failed' as const,
          progress: 0,
          error: `Too large (${(file.size / (1024 * 1024)).toFixed(0)} MB · ${MAX_FILE_BYTES / (1024 * 1024)} MB max)`,
          finishedAt: Date.now(),
        };
      }
      return {
        id: nextId(),
        scopeKind,
        scopeId,
        scopeLabel,
        file,
        status: 'queued' as const,
        progress: 0,
      };
    });
    dispatch({ type: 'enqueue', items: newItems });
  }, []);

  const cancel = useCallback((id: string) => {
    const item = itemsRef.current.find((it) => it.id === id);
    if (!item) return;
    if (item.status === 'uploading') {
      // abort fires xhr.onabort → reducer transitions the row
      xhrs.current.get(id)?.abort();
    } else if (item.status === 'queued') {
      dispatch({ type: 'cancel', id, finishedAt: Date.now() });
    }
    // For terminal states (done/failed/cancelled), cancel is a no-op.
  }, []);

  const retry = useCallback((id: string) => {
    const item = itemsRef.current.find((it) => it.id === id);
    if (!item || item.status !== 'failed') return;
    dispatch({ type: 'reset_for_retry', id });
    // The pump effect picks it back up on the next render.
  }, []);

  const dismiss = useCallback((id: string) => {
    dispatch({ type: 'remove', id });
  }, []);

  const clearCompleted = useCallback(() => {
    dispatch({ type: 'clear_completed' });
  }, []);

  // beforeunload warning while uploads are in-flight or queued. Without
  // this, an accidental close/refresh silently drops the queue.
  useEffect(() => {
    const active = items.some((it) => it.status === 'uploading' || it.status === 'queued');
    if (!active) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // returnValue must be set for the browser dialog to show; the
      // string is largely ignored by modern browsers but kept for compat.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [items]);

  return (
    <Ctx.Provider value={{ items, enqueue, cancel, retry, dismiss, clearCompleted }}>
      {children}
    </Ctx.Provider>
  );
}

export function useUploadManager(): UploadCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUploadManager must be used inside <UploadManagerProvider>');
  return v;
}
