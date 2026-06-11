'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Trash2, Sparkles, Play, Square, Target, CheckCircle, Link as LinkIcon, ExternalLink, Image as EmbedIcon, Upload, Camera, QrCode, FolderOpen, Copy } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { SlashMenu, type SlashCommandId } from './SlashMenu';
import { EmbedDialog, type EmbedDialogValue } from './pickers/EmbedDialog';
import { LinkPicker } from './pickers/LinkPicker';
import { MentionPicker } from './pickers/MentionPicker';
import {
  useGoals, useTodos, useUsers, useProjects, useCreateGoal, useCreateTodo,
  useStartTimer, useStopTimer,
  type GoalRow, type TodoRow,
} from '@/hooks/useResources';
import { useMyTimer } from '@/hooks/useTimer';
import { useAuth } from '@/hooks/useAuth';
import { useSpaceData, useUpdateSpaceBlocks, useUpdateSpaceFiles } from '@/hooks/useSpace';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useCreateQrUploadSession, useQrUploadSessionFiles } from '@/hooks/useQrUploadSession';
import { QrExpiryCountdown } from '@/components/upload/QrUploadModal';
import { useToast } from '@/components/ui/Toast';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { API_URL } from '@/lib/env';
import { fmtTimer, PRIORITY_DOT } from '@/lib/formatters';
import { rollupProgress } from '@/lib/roadmap';
import type { SpaceBlock, SpaceFile } from '@allebrum/shared';
import type { Scope } from '@/lib/roadmap';

// ============================================================================
// Reducer
// ============================================================================

type Action =
  | { type: 'init'; blocks: SpaceBlock[] }
  | { type: 'replace'; blocks: SpaceBlock[] }
  | { type: 'insert'; after: string | null; block: SpaceBlock }
  | { type: 'remove'; id: string }
  | { type: 'patch'; id: string; patch: Partial<SpaceBlock> };

function reducer(state: SpaceBlock[], action: Action): SpaceBlock[] {
  switch (action.type) {
    case 'init':
    case 'replace':
      return action.blocks;
    case 'insert': {
      const next = [...state];
      const i = action.after == null ? -1 : next.findIndex((b) => b.id === action.after);
      next.splice(i + 1, 0, action.block);
      return next;
    }
    case 'remove':
      return state.filter((b) => b.id !== action.id);
    case 'patch':
      return state.map((b) => (b.id === action.id ? { ...b, ...action.patch } : b));
    default:
      return state;
  }
}

const blockId = () => Math.random().toString(36).slice(2, 11);
const emptyText = (): SpaceBlock => ({ id: blockId(), type: 'text', content: '' });

// ============================================================================
// NotesTab — the canvas
// ============================================================================

export function NotesTab({ scope }: { scope: Scope }) {
  const data = useSpaceData(scope);
  const save = useUpdateSpaceBlocks(scope);
  const saveFiles = useUpdateSpaceFiles(scope);
  const { me } = useAuth();
  const toast = useToast();
  const uploadMgr = useUploadManager();
  const [blocks, dispatch] = useReducer(reducer, [] as SpaceBlock[]);
  const initialized = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [insertAssetOpen, setInsertAssetOpen] = useState(false);
  const [insertAssetTab, setInsertAssetTab] = useState<'computer' | 'qr' | 'space'>('computer');
  const [insertAnchorId, setInsertAnchorId] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [spaceFileQuery, setSpaceFileQuery] = useState('');
  const createQrSession = useCreateQrUploadSession();
  const [qrInsertSession, setQrInsertSession] = useState<{
    id: string;
    uploadUrl: string;
    expiresAt: string;
    anchorId: string;
  } | null>(null);
  const [seenQrInsertIds, setSeenQrInsertIds] = useState<string[]>([]);
  const [pendingUploadLinks, setPendingUploadLinks] = useState<Array<{
    uploadId: string;
    afterBlockId: string;
    fileName: string;
    isImage: boolean;
  }>>([]);

  // Sync from server on first load + scope change. After that, the local
  // reducer is the source of truth and we push out via debounced save.
  useEffect(() => {
    const scopeKey = scope.kind === 'all' ? null : scope.id;
    initialized.current = false;
    if (scope.kind === 'all') return;
    if (data.loading) return;
    if (data.spaceBlocks.length === 0) {
      // First open — seed welcome blocks.
      const scopeName = data.project?.name ?? data.client?.name ?? 'this space';
      const seed: SpaceBlock[] = [
        { id: blockId(), type: 'h1', content: scopeName },
        { id: blockId(), type: 'callout', content: `Type "/" anywhere to insert a to-do, goal, heading, list, link, embed, or @mention. Anything you create here is auto-linked to ${data.client?.name ?? scopeName}.` },
        emptyText(),
      ];
      dispatch({ type: 'init', blocks: seed });
      save(seed);
    } else {
      dispatch({ type: 'init', blocks: data.spaceBlocks });
    }
    initialized.current = true;
    // The scope.id key is what changes on client→project hop; data.loading
    // changes on first arrival. We deliberately depend only on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind === 'all' ? null : scope.id, data.loading]);

  // Push reducer state out to the server after edits — but only after the
  // initial load has settled so the initial dispatch doesn't double-write.
  useEffect(() => {
    if (!initialized.current) return;
    save(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // ----- slash menu -----
  const [slash, setSlash] = useState<{ blockId: string; rect: { x: number; y: number } | null; query: string } | null>(null);
  const [linkOpen, setLinkOpen] = useState<{ blockId: string } | null>(null);
  const [mentionOpen, setMentionOpen] = useState<{ blockId: string } | null>(null);
  const [embedOpen, setEmbedOpen] = useState<{ blockId: string } | null>(null);
  const qrSessionFiles = useQrUploadSessionFiles(qrInsertSession?.id ?? null, !!qrInsertSession?.id);

  const openInsertAssetModal = (anchorId: string, tab: 'computer' | 'qr' | 'space' = 'computer') => {
    setInsertAnchorId(anchorId);
    setInsertAssetTab(tab);
    setInsertAssetOpen(true);
  };

  const stopCamera = () => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraOpen(false);
    setCameraStarting(false);
  };

  const startCamera = async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('This browser does not support direct camera capture.');
      return;
    }
    try {
      setCameraStarting(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setCameraStarting(false);
    } catch {
      setCameraStarting(false);
      setCameraError('Camera permission was denied or unavailable. You can still choose a file or use QR upload.');
    }
  };

  // ----- block ops -----
  const insertAfter = (afterId: string | null, b?: Partial<SpaceBlock>) => {
    const block: SpaceBlock = { id: blockId(), type: 'text', content: '', ...b };
    dispatch({ type: 'insert', after: afterId, block });
    requestAnimationFrame(() => focusBlock(block.id));
  };
  const removeBlock = (id: string) => {
    if (blocks.length <= 1) return;
    const idx = blocks.findIndex((b) => b.id === id);
    dispatch({ type: 'remove', id });
    const prev = blocks[idx - 1];
    if (prev) requestAnimationFrame(() => focusBlock(prev.id));
  };
  const convertBlock = (id: string, patch: Partial<SpaceBlock>) => {
    dispatch({ type: 'patch', id, patch });
  };
  const setContent = (id: string, content: string) => {
    dispatch({ type: 'patch', id, patch: { content } });
  };

  // ----- slash command handling -----
  const onPickSlash = async (cmd: SlashCommandId) => {
    if (!slash) return;
    const target = blocks.find((b) => b.id === slash.blockId);
    if (!target) {
      setSlash(null);
      return;
    }
    setSlash(null);
    // Strip the trailing "/{query}" from the target's content so the visible
    // text doesn't show the slash residue when the user picks a command.
    const trimmed = (target.content ?? '').replace(/(^|\s)\/[^\s/]*$/, '$1');
    convertBlock(target.id, { content: trimmed });

    if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3' || cmd === 'text' ||
        cmd === 'bullet' || cmd === 'numbered' || cmd === 'checkbox' ||
        cmd === 'quote' || cmd === 'callout') {
      convertBlock(target.id, { type: cmd });
      requestAnimationFrame(() => focusBlock(target.id));
      return;
    }
    if (cmd === 'divider') {
      convertBlock(target.id, { type: 'divider', content: '' });
      // Always append a fresh text block after a divider so the canvas
      // keeps growing.
      insertAfter(target.id);
      return;
    }
    if (cmd === 'todo') {
      // Convert the current block into a todo placeholder, then create the
      // real to-do async and patch in the resulting id.
      convertBlock(target.id, { type: 'todo', content: 'New to-do' });
      if (!data.clientId) return;
      try {
        const created = await createTodoForBlock(target.id);
        if (created) convertBlock(target.id, { todoId: created.id, content: created.title });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not create to-do');
      }
      return;
    }
    if (cmd === 'goal') {
      convertBlock(target.id, { type: 'goal', content: 'New goal' });
      if (!data.clientId) return;
      try {
        const created = await createGoalForBlock(target.id);
        if (created) convertBlock(target.id, { goalId: created.id, content: created.title });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not create goal');
      }
      return;
    }
    if (cmd === 'timer') {
      const pid = data.projectId
        ?? (data.clientId
          ? (projectsForClient[0]?.id ?? null)
          : null);
      convertBlock(target.id, {
        type: 'timer',
        content: data.project?.name ?? data.client?.name ?? 'Working',
        projectId: pid ?? null,
      });
      return;
    }
    if (cmd === 'link') {
      setLinkOpen({ blockId: target.id });
      return;
    }
    if (cmd === 'mention') {
      setMentionOpen({ blockId: target.id });
      return;
    }
    if (cmd === 'embed') {
      setEmbedOpen({ blockId: target.id });
      return;
    }
    if (cmd === 'upload') {
      openInsertAssetModal(target.id, 'computer');
      return;
    }
  };

  const queueUploads = (list: File[], afterOverride?: string | null) => {
    if (list.length === 0) return;
    if (scope.kind !== 'client' && scope.kind !== 'project') {
      toast.error('Open a client or project space to upload files.');
      return;
    }
    const afterBlockId = afterOverride ?? insertAnchorId ?? blocks[blocks.length - 1]?.id ?? blockId();
    const scopeLabel = scope.kind === 'project'
      ? `${data.project?.name ?? 'Project'}${data.client?.name ? ` · ${data.client.name}` : ''}`
      : data.client?.name ?? 'Client';
    const ids = uploadMgr.enqueue({
      target: { kind: 'space', scopeKind: scope.kind, scopeId: scope.id },
      scopeLabel,
      files: list,
    });
    const refs = ids.map((uploadId, idx) => ({
      uploadId,
      afterBlockId,
      fileName: list[idx]?.name ?? 'file',
      isImage: (list[idx]?.type ?? '').startsWith('image/'),
    }));
    setPendingUploadLinks((prev) => [...prev, ...refs]);
    toast.success(`${list.length} file${list.length === 1 ? '' : 's'} queued`);
  };

  const onUploadPicked = (files: FileList | null, afterOverride?: string | null) => {
    if (!files || files.length === 0) return;
    queueUploads(Array.from(files), afterOverride);
  };

  const captureFromCamera = async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError('Camera is not ready yet. Try again in a moment.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setCameraError('Could not capture image from camera.');
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      setCameraError('Could not capture image from camera.');
      return;
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = new File([blob], `photo-${ts}.jpg`, { type: 'image/jpeg' });
    queueUploads([file], insertAnchorId);
    stopCamera();
    setInsertAssetOpen(false);
  };

  useEffect(() => {
    if (!cameraOpen) return;
    const el = videoRef.current;
    const stream = streamRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => undefined);
  }, [cameraOpen]);

  useEffect(() => {
    if (insertAssetTab !== 'computer') stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertAssetTab]);

  useEffect(() => {
    if (insertAssetOpen) return;
    stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertAssetOpen]);

  useEffect(() => () => {
    stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createQrInsertSession = async () => {
    if (scope.kind !== 'client' && scope.kind !== 'project') {
      toast.error('Open a client or project space to use QR uploads.');
      return;
    }
    const anchorId = insertAnchorId ?? blocks[blocks.length - 1]?.id ?? blockId();
    try {
      const out = await createQrSession.mutateAsync({
        target: { kind: 'space', scopeKind: scope.kind, scopeId: scope.id },
        label: scope.kind === 'project' ? (data.project?.name ?? 'Project notes') : (data.client?.name ?? 'Client notes'),
        expiresInHours: 24,
      });
      setQrInsertSession({
        id: out.id,
        uploadUrl: out.uploadUrl,
        expiresAt: out.expiresAt,
        anchorId,
      });
      setSeenQrInsertIds([]);
      toast.success('QR upload session ready');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create QR session');
    }
  };

  const insertSpaceFile = (file: SpaceFile) => {
    const afterBlockId = insertAnchorId ?? blocks[blocks.length - 1]?.id ?? blockId();
    const inserted: SpaceBlock = {
      id: blockId(),
      type: 'embed',
      content: file.title,
      embedUrl: file.url,
      embedKind: guessEmbedKind(file.url),
    };
    dispatch({ type: 'insert', after: afterBlockId, block: inserted });
    if (isLikelyImage(file.title, file.url)) {
      dispatch({ type: 'insert', after: inserted.id, block: emptyText() });
    }
    setInsertAssetOpen(false);
  };

  const copyQrLink = async () => {
    if (!qrInsertSession?.uploadUrl) return;
    try {
      await navigator.clipboard.writeText(qrInsertSession.uploadUrl);
      toast.success('Upload link copied');
    } catch {
      toast.error('Could not copy upload link');
    }
  };

  useEffect(() => {
    if (pendingUploadLinks.length === 0) return;
    const completed: string[] = [];
    for (const pending of pendingUploadLinks) {
      const item = uploadMgr.items.find((x) => x.id === pending.uploadId);
      if (!item) continue;
      if (item.status === 'done' && item.driveFileId) {
        const url = `https://drive.google.com/file/d/${item.driveFileId}/view`;
        const inserted: SpaceBlock = {
          id: blockId(),
          type: 'embed',
          content: pending.fileName,
          embedUrl: url,
          embedKind: 'drive',
        };
        dispatch({ type: 'insert', after: pending.afterBlockId, block: inserted });
        if (pending.isImage) {
          dispatch({ type: 'insert', after: inserted.id, block: emptyText() });
        }
        completed.push(pending.uploadId);
      } else if (item.status === 'failed' || item.status === 'cancelled') {
        completed.push(pending.uploadId);
        if (item.status === 'failed') {
          toast.error(item.error || `Upload failed: ${pending.fileName}`);
        }
      }
    }
    if (completed.length > 0) {
      setPendingUploadLinks((prev) => prev.filter((x) => !completed.includes(x.uploadId)));
    }
  }, [pendingUploadLinks, uploadMgr.items, toast]);

  useEffect(() => {
    if (!qrInsertSession?.id) return;
    const rows = qrSessionFiles.data ?? [];
    if (rows.length === 0) return;
    const seen = new Set(seenQrInsertIds);
    const toInsert = [...rows].reverse().filter((r) => !seen.has(r.id) && !!r.storedFileUrl);
    if (toInsert.length === 0) return;

    let cursor = qrInsertSession.anchorId;
    for (const row of toInsert) {
      const inserted: SpaceBlock = {
        id: blockId(),
        type: 'embed',
        content: row.uploadTitle?.trim() || row.originalName,
        embedUrl: row.storedFileUrl!,
        embedKind: 'drive',
      };
      dispatch({ type: 'insert', after: cursor, block: inserted });
      cursor = inserted.id;
      if ((row.mimeType ?? '').startsWith('image/') || isLikelyImage(row.originalName, row.storedFileUrl ?? undefined)) {
        const spacer = emptyText();
        dispatch({ type: 'insert', after: cursor, block: spacer });
        cursor = spacer.id;
      }
    }
    setSeenQrInsertIds((prev) => [...prev, ...toInsert.map((r) => r.id)]);
    toast.success(`Inserted ${toInsert.length} QR upload${toInsert.length === 1 ? '' : 's'} into notes`);
  }, [qrInsertSession, qrSessionFiles.data, seenQrInsertIds, toast]);

  // ----- "create real" helpers -----
  const createTodo = useCreateTodo();
  const createGoal = useCreateGoal();
  const { data: allProjects = [] } = useProjects();
  const projectsForClient = useMemo(
    () => allProjects.filter((p) => p.clientId === data.clientId),
    [allProjects, data.clientId],
  );
  const createTodoForBlock = async (_blockId: string) => {
    if (!data.clientId) return null;
    return createTodo.mutateAsync({
      title: 'New to-do',
      clientId: data.clientId,
      projectId: data.projectId ?? null,
      assigneeId: me?.id ?? null,
      priority: 'medium',
      tags: [],
    });
  };
  const createGoalForBlock = async (_blockId: string) => {
    if (!data.clientId) return null;
    const projectId = data.projectId ?? projectsForClient[0]?.id ?? null;
    if (!projectId) {
      toast.error('Add a project to this client first');
      return null;
    }
    return createGoal.mutateAsync({
      clientId: data.clientId,
      projectId,
      title: 'New goal',
      ownerId: me?.id ?? null,
      priority: 'medium',
      tag: 'Delivery',
      health: 'on-track',
      progress: 0,
    });
  };

  // ----- modal pick handlers -----
  const onLinkPicked = (kind: 'goal' | 'todo' | 'file', refId: string) => {
    if (!linkOpen) return;
    convertBlock(linkOpen.blockId, { type: 'link', linkType: kind, linkRefId: refId, content: '' });
    setLinkOpen(null);
  };
  const onMentionPicked = (name: string) => {
    if (!mentionOpen) return;
    const b = blocks.find((x) => x.id === mentionOpen.blockId);
    if (b) {
      const trimmed = (b.content ?? '').replace(/(^|\s)\/[^\s/]*$/, '$1');
      convertBlock(b.id, { content: `${trimmed}@${name.split(' ')[0]} ` });
    }
    setMentionOpen(null);
  };
  const onEmbedSubmitted = async (v: EmbedDialogValue) => {
    if (!embedOpen) return;
    const kind = guessEmbedKind(v.url);
    convertBlock(embedOpen.blockId, {
      type: 'embed',
      embedUrl: v.url,
      embedKind: kind,
      content: v.title || v.url,
    });
    // Also register as a Space file with the "from Notes" badge — de-dupe by URL.
    const existing = data.spaceFiles.find((f) => f.url === v.url);
    if (!existing) {
      const f: SpaceFile = {
        id: blockId(),
        kind: kind === 'figma' ? 'figma' : kind === 'github' ? 'github' : kind === 'drive' ? 'drive-doc' : 'link',
        title: v.title || v.url,
        url: v.url,
        meta: 'Embedded from notes',
        source: 'notes',
        addedBy: me?.id ?? '',
        addedAt: new Date().toISOString().slice(0, 10),
      };
      await saveFiles([...data.spaceFiles, f]);
    }
    setEmbedOpen(null);
  };

  if (data.loading || scope.kind === 'all') return null;

  const filteredSpaceFiles = data.spaceFiles.filter((f) => {
    const q = spaceFileQuery.trim().toLowerCase();
    if (!q) return true;
    return f.title.toLowerCase().includes(q) || f.url.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-3xl mx-auto">
      {blocks.map((b, i) => (
        <BlockRow
          key={b.id}
          block={b}
          index={i}
          blocks={blocks}
          onRemove={() => removeBlock(b.id)}
          onConvert={(patch) => convertBlock(b.id, patch)}
          onChangeContent={(c) => setContent(b.id, c)}
          onInsertSibling={(typeOverride) =>
            insertAfter(b.id, typeOverride ? { type: typeOverride } : undefined)
          }
          onOpenSlash={(next) => {
            if (!next) {
              setSlash((prev) => (prev?.blockId === b.id ? null : prev));
              return;
            }
            setSlash({ blockId: b.id, rect: next.rect, query: next.query });
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => insertAfter(blocks[blocks.length - 1]?.id ?? null)}
        className="w-full text-left text-sm text-gray-400 hover:text-gray-600 py-3 px-2 rounded-lg hover:bg-gray-50"
      >
        Click to write, or press <kbd className="font-mono text-[11px] bg-gray-100 px-1 rounded">/</kbd> for commands…
      </button>

      <input
        ref={uploadInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onUploadPicked(e.target.files);
          setInsertAssetOpen(false);
          e.target.value = '';
        }}
      />
      <Modal
        open={insertAssetOpen}
        onClose={() => {
          setInsertAssetOpen(false);
          stopCamera();
        }}
        title="Insert image or file"
        size="lg"
        layerBase={145}
      >
        <div className="space-y-4">
          <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
            <button
              type="button"
              onClick={() => setInsertAssetTab('computer')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md ${insertAssetTab === 'computer' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              From computer
            </button>
            <button
              type="button"
              onClick={() => setInsertAssetTab('qr')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md ${insertAssetTab === 'qr' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              QR / phone
            </button>
            <button
              type="button"
              onClick={() => setInsertAssetTab('space')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-md ${insertAssetTab === 'space' ? 'bg-white text-brand-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
            >
              From space files
            </button>
          </div>

          {insertAssetTab === 'computer' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => uploadInputRef.current?.click()}
                className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-brand-300 hover:shadow-sm"
              >
                <Upload className="w-5 h-5 text-brand-700 mb-2" />
                <div className="text-sm font-semibold text-gray-900">Choose files</div>
                <div className="text-xs text-gray-500 mt-1">Pick images or documents from your computer.</div>
              </button>
              <button
                type="button"
                onClick={() => void startCamera()}
                className="rounded-xl border border-gray-200 bg-white p-4 text-left hover:border-brand-300 hover:shadow-sm"
              >
                <Camera className="w-5 h-5 text-brand-700 mb-2" />
                <div className="text-sm font-semibold text-gray-900">Take photo</div>
                <div className="text-xs text-gray-500 mt-1">Open live camera preview and capture directly into notes.</div>
              </button>
            </div>
          )}

          {insertAssetTab === 'computer' && (cameraOpen || cameraStarting || cameraError) && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
              {cameraStarting && (
                <div className="text-sm text-gray-600">Opening camera…</div>
              )}
              {cameraOpen && (
                <>
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full max-h-80 rounded-lg bg-black object-contain"
                  />
                  <div className="flex items-center gap-2">
                    <Button variant="primary" onClick={() => void captureFromCamera()}>
                      <Camera className="w-4 h-4" /> Capture
                    </Button>
                    <Button variant="outline" onClick={stopCamera}>Cancel camera</Button>
                  </div>
                </>
              )}
              {cameraError && (
                <div className="text-xs text-red-600">{cameraError}</div>
              )}
            </div>
          )}

          {insertAssetTab === 'qr' && (
            <div className="space-y-3">
              {!qrInsertSession ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="text-sm text-gray-700 mb-3">Generate a QR upload session to send photos/files from your phone into this notes thread.</div>
                  <Button variant="primary" onClick={() => void createQrInsertSession()} disabled={createQrSession.isPending}>
                    <QrCode className="w-4 h-4" /> {createQrSession.isPending ? 'Generating…' : 'Generate QR code'}
                  </Button>
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 grid place-items-center">
                    <QRCodeCanvas value={qrInsertSession.uploadUrl} size={220} includeMargin />
                    <QrExpiryCountdown expiresAt={qrInsertSession.expiresAt} />
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-700 break-all">
                    {qrInsertSession.uploadUrl}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={copyQrLink}><Copy className="w-4 h-4" /> Copy link</Button>
                    <a href={qrInsertSession.uploadUrl} target="_blank" rel="noreferrer">
                      <Button variant="ghost"><ExternalLink className="w-4 h-4" /> Open upload page</Button>
                    </a>
                  </div>
                  <div className="text-[11px] text-gray-500">
                    New uploads are auto-inserted into notes as they arrive.
                  </div>
                </>
              )}
            </div>
          )}

          {insertAssetTab === 'space' && (
            <div className="space-y-3">
              <input
                value={spaceFileQuery}
                onChange={(e) => setSpaceFileQuery(e.target.value)}
                placeholder="Search file title or URL"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
              />
              {filteredSpaceFiles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center text-sm text-gray-500">
                  No space files found.
                </div>
              ) : (
                <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
                  {filteredSpaceFiles.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => insertSpaceFile(f)}
                      className="w-full text-left rounded-lg border border-gray-200 px-3 py-2 hover:border-brand-300 hover:bg-brand-50/40"
                    >
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-gray-400 shrink-0" />
                        <span className="text-sm font-semibold text-gray-900 truncate">{f.title}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500 truncate">{f.meta || f.url}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      <SlashMenu
        open={!!slash}
        anchorRect={slash?.rect ?? null}
        query={slash?.query ?? ''}
        onPick={onPickSlash}
        onClose={() => setSlash(null)}
      />
      <LinkPicker
        open={!!linkOpen}
        onClose={() => setLinkOpen(null)}
        onPick={onLinkPicked}
        clientId={data.clientId ?? null}
        projectId={data.projectId ?? null}
        spaceFiles={data.spaceFiles}
      />
      <MentionPicker
        open={!!mentionOpen}
        onClose={() => setMentionOpen(null)}
        onPick={onMentionPicked}
      />
      <EmbedDialog
        open={!!embedOpen}
        onClose={() => setEmbedOpen(null)}
        onSubmit={onEmbedSubmitted}
        intent="embed"
      />
    </div>
  );
}

function isLikelyImage(name?: string, url?: string): boolean {
  const value = `${name ?? ''} ${url ?? ''}`;
  return /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)(?:$|\?|#)/i.test(value);
}

function focusBlock(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  if (el) {
    el.focus();
    // Move caret to end.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

function guessEmbedKind(url: string): 'figma' | 'github' | 'drive' | 'link' {
  try {
    const host = new URL(url).host;
    if (host.includes('figma.com')) return 'figma';
    if (host.includes('github.com')) return 'github';
    if (host.includes('drive.google.com') || host.includes('docs.google.com')) return 'drive';
  } catch {
    /* fallthrough */
  }
  return 'link';
}

// ============================================================================
// BlockRow — gutter handle + per-type body
// ============================================================================

function BlockRow({
  block,
  index,
  blocks,
  onRemove,
  onConvert,
  onChangeContent,
  onInsertSibling,
  onOpenSlash,
}: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  onRemove: () => void;
  onConvert: (patch: Partial<SpaceBlock>) => void;
  onChangeContent: (c: string) => void;
  onInsertSibling: (typeOverride?: SpaceBlock['type']) => void;
  onOpenSlash: (next: { rect: { x: number; y: number }; query: string } | null) => void;
}) {
  return (
    <div className="group relative pl-8 -ml-8 py-0.5">
      <button
        type="button"
        onClick={onRemove}
        title="Remove block"
        className="absolute left-1 top-1.5 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity"
        // Block remove without focusing the gutter so the block keeps focus on rapid edits.
        onMouseDown={(e) => e.preventDefault()}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <BlockBody
        block={block}
        index={index}
        blocks={blocks}
        onConvert={onConvert}
        onChangeContent={onChangeContent}
        onInsertSibling={onInsertSibling}
        onOpenSlash={onOpenSlash}
        onRemove={onRemove}
      />
    </div>
  );
}

function BlockBody(props: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  onConvert: (patch: Partial<SpaceBlock>) => void;
  onChangeContent: (c: string) => void;
  onInsertSibling: (typeOverride?: SpaceBlock['type']) => void;
  onOpenSlash: (next: { rect: { x: number; y: number }; query: string } | null) => void;
  onRemove: () => void;
}) {
  const { block } = props;
  switch (block.type) {
    case 'divider':
      return <hr className="my-3 border-gray-200" />;
    case 'todo':
      return <TodoBlockCard block={block} onConvert={props.onConvert} />;
    case 'goal':
      return <GoalBlockCard block={block} onConvert={props.onConvert} />;
    case 'timer':
      return <TimerBlockCard block={block} onConvert={props.onConvert} />;
    case 'link':
      return <LinkBlockCard block={block} />;
    case 'embed':
      return <EmbedBlockCard block={block} />;
    default:
      return <EditableBlock {...props} />;
  }
}

// ============================================================================
// EditableBlock — text / heading / list / quote / callout
// ============================================================================

function EditableBlock({
  block,
  index,
  blocks,
  onConvert,
  onChangeContent,
  onInsertSibling,
  onOpenSlash,
  onRemove,
}: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  onConvert: (patch: Partial<SpaceBlock>) => void;
  onChangeContent: (c: string) => void;
  onInsertSibling: (typeOverride?: SpaceBlock['type']) => void;
  onOpenSlash: (next: { rect: { x: number; y: number }; query: string } | null) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  // Set innerText only on initial mount + on remote/type changes so the
  // caret isn't reset on every keystroke. React state for content lags the
  // DOM here intentionally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerText !== (block.content ?? '')) {
      el.innerText = block.content ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.type]);

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    const text = el.innerText;
    onChangeContent(text);
    // Slash trigger: only when typing a command token at the end of the line.
    // Requires start-of-line or whitespace before `/`, so dates like 06/05
    // do not open the command menu.
    const m = text.match(/(?:^|\s)\/([^\s/]*)$/);
    if (m) {
      const rect = caretRect();
      if (rect) onOpenSlash({ rect, query: m[1] ?? '' });
      return;
    }
    onOpenSlash(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = ref.current;
    const text = el?.innerText ?? '';

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Demote empty list/heading to text instead of growing the list.
      if (text === '' && (block.type === 'bullet' || block.type === 'numbered' || block.type === 'checkbox')) {
        onConvert({ type: 'text' });
        return;
      }
      // Continue same type for lists; otherwise plain text.
      const sameType = block.type === 'bullet' || block.type === 'numbered' || block.type === 'checkbox';
      onInsertSibling(sameType ? block.type : 'text');
      return;
    }

    if (e.key === 'Backspace' && text === '') {
      if (blocks.length <= 1) return;
      if (block.type !== 'text') {
        e.preventDefault();
        onConvert({ type: 'text' });
        return;
      }
      e.preventDefault();
      onRemove();
      return;
    }
  };

  const cls = blockClassName(block, index, blocks);

  // Prefix prefixing for ordered/unordered/checkbox lists.
  const prefix = (() => {
    if (block.type === 'bullet') return <span className="inline-block w-5 -ml-5 align-top text-gray-400 select-none">•</span>;
    if (block.type === 'numbered') {
      // Count consecutive numbered blocks ending at this index.
      let n = 1;
      for (let i = index - 1; i >= 0; i--) {
        if (blocks[i]!.type === 'numbered') n++;
        else break;
      }
      return <span className="inline-block w-7 -ml-7 align-top text-gray-400 tabular-nums select-none">{n}.</span>;
    }
    if (block.type === 'checkbox') {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onConvert({ checked: !block.checked });
          }}
          className="inline-flex items-center justify-center w-4 h-4 -ml-6 mr-1 mt-1 rounded border border-gray-300 align-top"
          aria-label={block.checked ? 'Uncheck' : 'Check'}
          onMouseDown={(e) => e.preventDefault()}
        >
          {block.checked && <CheckCircle className="w-3 h-3 text-brand-600" />}
        </button>
      );
    }
    return null;
  })();

  return (
    <div className="flex items-start gap-0">
      {prefix}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-block-id={block.id}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={cls}
        data-placeholder={placeholderFor(block, focused)}
      />
    </div>
  );
}

function blockClassName(block: SpaceBlock, _i: number, _all: SpaceBlock[]): string {
  const base = 'flex-1 min-w-0 outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300';
  switch (block.type) {
    case 'h1':       return `${base} text-[34px] font-bold tracking-tight leading-tight my-2`;
    case 'h2':       return `${base} text-[26px] font-bold tracking-tight leading-tight my-2`;
    case 'h3':       return `${base} text-[19px] font-bold leading-snug my-2`;
    case 'quote':    return `${base} italic text-gray-700 border-l-4 border-brand-400 pl-3 my-2`;
    case 'callout':  return `${base} bg-brand-50 border border-brand-100 text-brand-900 rounded-xl px-4 py-3 my-2`;
    case 'checkbox': return `${base} text-[15px] leading-relaxed ${block.checked ? 'line-through text-gray-400' : 'text-gray-800'}`;
    default:         return `${base} text-[15px] leading-relaxed text-gray-800`;
  }
}

function placeholderFor(block: SpaceBlock, focused: boolean): string {
  switch (block.type) {
    case 'h1':       return 'Heading 1';
    case 'h2':       return 'Heading 2';
    case 'h3':       return 'Heading 3';
    case 'quote':    return 'Quote';
    case 'callout':  return 'Tip or callout';
    case 'bullet':   return 'List item';
    case 'numbered': return 'List item';
    case 'checkbox': return 'Task';
    default:         return focused ? "Press '/' for commands" : '';
  }
}

function caretRect(): { x: number; y: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const rects = range.getClientRects();
  const r = rects[rects.length - 1];
  if (r) return { x: r.left, y: r.bottom };
  // Empty contentEditable — fall back to anchor node's bounding rect.
  const node = sel.anchorNode as HTMLElement | null;
  if (node && node.getBoundingClientRect) {
    const br = node.getBoundingClientRect();
    return { x: br.left, y: br.bottom };
  }
  return null;
}

// ============================================================================
// Specialized block cards
// ============================================================================

function TodoBlockCard({ block, onConvert }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
  const { data: todos = [] } = useTodos();
  const todo = block.todoId ? todos.find((t) => t.id === block.todoId) : null;
  if (!todo) {
    return (
      <Card>
        <CheckCircle className="w-4 h-4 text-brand-600" />
        <span className="text-sm text-gray-500 italic">Creating to-do…</span>
      </Card>
    );
  }
  const dot = PRIORITY_DOT[todo.priority];
  return (
    <Card>
      <CheckCircle className="w-4 h-4 text-brand-600 shrink-0" />
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot?.color }} />
      <span className={`flex-1 min-w-0 text-sm ${todo.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
        {todo.title}
      </span>
      <AutoLink />
    </Card>
  );
}

function GoalBlockCard({ block, onConvert }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  const goal = block.goalId ? goals.find((g) => g.id === block.goalId) : null;
  if (!goal) {
    return (
      <Card>
        <Target className="w-4 h-4 text-brand-600" />
        <span className="text-sm text-gray-500 italic">Creating goal…</span>
      </Card>
    );
  }
  const pct = rollupProgress(goal, todos);
  return (
    <Card>
      <Target className="w-4 h-4 text-brand-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{goal.title}</div>
        <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <AutoLink />
    </Card>
  );
}

function TimerBlockCard({ block, onConvert }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
  const start = useStartTimer();
  const stop = useStopTimer();
  const { timer, elapsedSec } = useMyTimer();
  const toast = useToast();
  const running = timer?.spaceBlockId === block.id;
  const onClick = async () => {
    try {
      if (running) {
        await stop.mutateAsync();
      } else {
        await start.mutateAsync({
          projectId: block.projectId ?? null,
          note: block.content || 'Working',
          spaceBlockId: block.id,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Timer action failed');
    }
  };
  return (
    <Card className={running ? 'bg-red-50 border-red-300' : undefined}>
      <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
      <input
        value={block.content ?? ''}
        onChange={(e) => onConvert({ content: e.target.value })}
        placeholder="What are you working on?"
        className="flex-1 min-w-0 bg-transparent outline-none text-sm text-gray-800 placeholder:text-gray-400"
      />
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1 transition-colors ${
          running ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-gray-200 text-gray-600 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200'
        }`}
      >
        {running ? <><Square className="w-3 h-3" /><span className="font-mono tabular-nums">{fmtTimer(elapsedSec)}</span> Stop</>
         : <><Play className="w-3 h-3" /> Start</>}
      </button>
    </Card>
  );
}

function LinkBlockCard({ block }: { block: SpaceBlock }) {
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  if (!block.linkRefId || !block.linkType) {
    return <Card><LinkIcon className="w-4 h-4 text-gray-400" /><span className="text-sm text-gray-500 italic">Pick a link target</span></Card>;
  }
  let label = block.linkRefId;
  if (block.linkType === 'goal') {
    const g = goals.find((x) => x.id === block.linkRefId);
    if (g) label = g.title;
  } else if (block.linkType === 'todo') {
    const t = todos.find((x) => x.id === block.linkRefId);
    if (t) label = t.title;
  }
  const Icon = block.linkType === 'goal' ? Target : block.linkType === 'todo' ? CheckCircle : LinkIcon;
  return (
    <Card>
      <Icon className="w-4 h-4 text-brand-600 shrink-0" />
      <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{label}</span>
      <span className="text-[10px] uppercase font-bold tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{block.linkType}</span>
    </Card>
  );
}

function EmbedBlockCard({ block }: { block: SpaceBlock }) {
  const Icon = EmbedIcon;
  const driveId = extractDriveFileId(block.embedUrl ?? '');
  const looksLikeImage = /\.(png|jpe?g|gif|webp|bmp|svg|heic|heif)$/i.test(block.content ?? '');
  const imageCandidates = driveId
    ? [
        `${API_URL}/api/integrations/drive/file/${driveId}/content`,
        `https://drive.google.com/uc?export=view&id=${driveId}`,
        `https://drive.google.com/thumbnail?id=${driveId}&sz=w1600`,
        block.embedUrl ?? '',
      ].filter(Boolean)
    : [block.embedUrl ?? ''].filter(Boolean);
  const [imageSrcIndex, setImageSrcIndex] = useState(0);
  const imageSrc = imageCandidates[imageSrcIndex] ?? null;
  const canTryAnotherImageSrc = imageSrcIndex < imageCandidates.length - 1;

  useEffect(() => {
    setImageSrcIndex(0);
  }, [block.embedUrl]);

  if (looksLikeImage && imageSrc) {
    return (
      <div className="my-2 rounded-xl border border-gray-200 bg-white overflow-hidden">
        <a href={block.embedUrl} target="_blank" rel="noreferrer" className="block hover:opacity-95 transition-opacity">
          <img
            src={imageSrc}
            alt={block.content ?? 'Uploaded image'}
            className="w-full max-h-[480px] object-contain bg-gray-50"
            loading="lazy"
            onError={() => {
              if (canTryAnotherImageSrc) {
                setImageSrcIndex((i) => i + 1);
              }
            }}
          />
        </a>
        <div className="px-3 py-2 flex items-center gap-2 border-t border-gray-100">
          <EmbedIcon className="w-4 h-4 text-brand-600 shrink-0" />
          <a
            href={block.embedUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 min-w-0 text-sm text-gray-800 truncate hover:text-brand-700"
            title={block.embedUrl}
          >
            {block.content || block.embedUrl}
          </a>
          <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <Card>
      <Icon className="w-4 h-4 text-brand-600 shrink-0" />
      <a
        href={block.embedUrl}
        target="_blank"
        rel="noreferrer"
        className="flex-1 min-w-0 text-sm text-gray-800 truncate hover:text-brand-700"
        title={block.embedUrl}
      >
        {block.content || block.embedUrl}
      </a>
      <span className="text-[10px] uppercase font-bold tracking-wide bg-brand-100 text-brand-800 rounded px-1.5 py-0.5">{block.embedKind ?? 'link'}</span>
      <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
    </Card>
  );
}

function extractDriveFileId(url: string): string | null {
  if (!url) return null;
  const byPath = /\/d\/([a-zA-Z0-9_-]+)/.exec(url);
  if (byPath?.[1]) return byPath[1];
  try {
    const parsed = new URL(url);
    const byQuery = parsed.searchParams.get('id');
    if (byQuery) return byQuery;
  } catch {
    // non-URL string; ignore and fall through
  }
  return null;
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`my-1.5 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 ${className ?? 'bg-white'}`}>
      {children}
    </div>
  );
}

function AutoLink() {
  return <span className="text-[10px] italic text-gray-400 ml-1">Auto-linked</span>;
}
