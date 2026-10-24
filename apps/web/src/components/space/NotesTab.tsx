'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useMutationState } from '@tanstack/react-query';
import {
  Trash2, Sparkles, Play, Square, Target, CheckCircle, AlertCircle, Link as LinkIcon, ExternalLink, Image as EmbedIcon,
  Upload, Camera, QrCode, FolderOpen, Copy, GripVertical, CopyPlus, Pilcrow, Heading1, Heading2, Heading3, List,
  ListOrdered, CheckSquare, Quote,
} from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { SlashMenu, type SlashCommandId } from './SlashMenu';
import { NotesShortcutsHelp } from './NotesShortcutsHelp';
import { TURN_INTO_OPTIONS } from './notes/commands';
import { useBlockSelection } from './useBlockSelection';
import { selectAllEscalates, shiftArrowLeavesBlock } from './notes/selection';
import { EmbedDialog, type EmbedDialogValue } from './pickers/EmbedDialog';
import { LinkPicker } from './pickers/LinkPicker';
import { MentionPicker } from './pickers/MentionPicker';
import {
  useGoals, useTodos, useProjects, useCreateGoal, useCreateTodo,
  useStartTimer, useStopTimer,
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
import { Popover } from '@/components/ui/Popover';
import { API_URL } from '@/lib/env';
import { isStaleUpdate } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { applyDraft, draftKey, takeDraft } from './notes/drafts';
import { EV, type SpaceBlocksUpdatedPayload } from '@allebrum/shared';
import { fmtTimer, PRIORITY_DOT } from '@/lib/formatters';
import { rollupProgress } from '@/lib/roadmap';
import type { SpaceBlock, SpaceFile } from '@allebrum/shared';
import type { Scope } from '@/lib/roadmap';
import {
  reducer, blockId, emptyText, migrateBlocks, isEditable, isList, isEmptyContent,
  matchMarkdownShortcut, findSlashToken, removeSlashToken, pastedLines,
  type BlockType, type MarkdownShortcut,
} from './notes/blocks';
import {
  readText, writeText, needsNormalize, getOffsets, setCaret, caretBox,
  caretOnFirstLine, caretOnLastLine, placeCaretNearX,
} from './notes/dom';

/** Custom drag MIME so block reordering never drops text into an editor. */
const DRAG_MIME = 'application/x-hoppa-notes-block';

type CaretPos = 'start' | 'end' | number;
type SlashOpen = { rect: { x: number; y: number; top: number }; query: string; tokenStart: number };

// ============================================================================
// NotesTab — the canvas
// ============================================================================

export function NotesTab({ scope }: { scope: Scope }) {
  const data = useSpaceData(scope);
  const [blocks, dispatch] = useReducer(reducer, [] as SpaceBlock[]);
  // Versioned saves + live merge: when the server copy moved on (a bot
  // append, another tab), fold it into the live doc. The reducer merges
  // against the current state, so nothing typed meanwhile is lost, and
  // existing blocks keep their identity, so focus and caret stay put.
  const sync = useUpdateSpaceBlocks(scope, {
    onRemote: (_ref, base, server) => dispatch({ type: 'merge', base, server }),
  });
  const saveFiles = useUpdateSpaceFiles(scope);
  const { me } = useAuth();
  const toast = useToast();
  const uploadMgr = useUploadManager();
  const initialized = useRef(false);
  // The exact array dispatched on load. The save effect skips it so merely
  // opening a space (or migrating its blocks in memory) never writes.
  const initBlocksRef = useRef<SpaceBlock[] | null>(null);
  // True once the reducer actually holds the loaded doc. Until then the
  // save effect must never fire — on mount (or with cached data) it can run
  // with the reducer's initial [] or a previous space's blocks.
  const hydratedRef = useRef(false);
  // Latest blocks for handlers that run after a render (rAF, toasts, async).
  const blocksRef = useRef<SpaceBlock[]>(blocks);
  blocksRef.current = blocks;
  // Focus requested by a block op (split, merge, paste, …). Applied in a
  // layout effect right after the commit that renders the target, so the
  // very next keystroke already lands in the right block (a rAF would race
  // fast typing). The rAF in focusAfterRender is only a fallback.
  const pendingFocusRef = useRef<{ id: string; pos: CaretPos } | null>(null);
  useLayoutEffect(() => {
    const f = pendingFocusRef.current;
    if (f && focusBlock(f.id, f.pos)) pendingFocusRef.current = null;
  });
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
    initialized.current = false;
    hydratedRef.current = false;
    setSlash(null);
    if (scope.kind === 'all') return;
    if (data.loading) return;
    // The loaded copy is the merge base for this editor's saves.
    sync.hydrate(scope, data.spaceBlocks, (data.project ?? data.client)?.updatedAt);
    let initial: SpaceBlock[];
    if (data.spaceBlocks.length === 0) {
      // First open — seed welcome blocks.
      const scopeName = data.project?.name ?? data.client?.name ?? 'this space';
      const seed: SpaceBlock[] = [
        { id: blockId(), type: 'h1', content: scopeName },
        { id: blockId(), type: 'callout', content: `Type "/" anywhere to insert a to-do, goal, heading, list, link, embed, or @mention. Anything you create here is auto-linked to ${data.client?.name ?? scopeName}.` },
        emptyText(),
      ];
      initial = seed;
      sync.save(seed);
    } else {
      // One line per block: split legacy multi-line text blocks in memory.
      // Persisted with the next real edit.
      initial = migrateBlocks(data.spaceBlocks);
    }
    // Edits that were stranded when the session ended (stashed by
    // useUpdateSpaceBlocks): merge them onto the current copy and save.
    const draft = me ? takeDraft(draftKey(me.id, scope.kind, scope.id)) : null;
    const restored = draft ? applyDraft(draft, initial) : null;
    if (restored) {
      initial = restored;
      sync.save(restored);
      toast.success('Restored notes you hadn’t saved before your session ended.');
    }
    initBlocksRef.current = initial;
    dispatch({ type: 'init', blocks: initial });
    initialized.current = true;
    // The cached row may predate a bot write; catch up once on open.
    void sync.pull();
    // The scope.id key is what changes on client→project hop; data.loading
    // changes on first arrival. We deliberately depend only on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind === 'all' ? null : scope.id, data.loading]);

  // ----- live updates -----
  // Watch this Space's room; a SPACE_BLOCKS_UPDATED notice (bot append or a
  // save from another tab) triggers a pull + merge unless it is our own
  // save echoing back. Reconnects and returning to the tab also pull (see
  // useUpdateSpaceBlocks), so a missed notice only delays the merge — the
  // versioned save path still catches it with a 409.
  const watchKey = scope.kind === 'all' ? null : `${scope.kind}:${scope.id}`;
  useEffect(() => {
    if (scope.kind === 'all') return;
    const ref = { kind: scope.kind, id: scope.id } as const;
    const socket = getSocket();
    let connectedBefore = socket.connected;
    const watch = () => {
      socket.emit('space:watch', ref);
      if (connectedBefore) void sync.pull(); // reconnect: we may have missed notices
      connectedBefore = true;
    };
    const onUpdated = (p: SpaceBlocksUpdatedPayload) => {
      if (p.kind === ref.kind && p.id === ref.id) void sync.pull(p.updatedAt);
    };
    if (socket.connected) socket.emit('space:watch', ref);
    socket.on('connect', watch);
    socket.on(EV.SPACE_BLOCKS_UPDATED, onUpdated);
    return () => {
      socket.off('connect', watch);
      socket.off(EV.SPACE_BLOCKS_UPDATED, onUpdated);
      socket.emit('space:unwatch', ref);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchKey, sync]);

  // ----- save-state indicator (S2.6) -----
  // Purely observational — the save itself is the 250ms trailing debounce
  // in useUpdateSpaceBlocks (versioned full-replace PATCH on the
  // client/project row). We watch those mutations in the React Query
  // mutation cache and timestamp local edits so the header can show the
  // debounce gap ("Unsaved changes") plus the real mutation lifecycle. A
  // 409 stale_update is not a failure — it is merged and retried — so it
  // reads as "saving". Other errors are retried by the next edit, which
  // re-sends the whole doc — the error copy reflects that.
  const scopeId = scope.kind === 'all' ? null : scope.id;
  const [lastEditAt, setLastEditAt] = useState(0);
  const blockSaves = useMutationState({
    filters: {
      predicate: (m) => {
        if (!scopeId) return false;
        const vars = m.state.variables as { id?: string; patch?: Record<string, unknown> } | undefined;
        if (!vars?.patch) return false;
        return vars.id === scopeId && 'spaceBlocks' in vars.patch;
      },
    },
    select: (m) => ({
      status: m.state.status === 'error' && isStaleUpdate(m.state.error) ? 'pending' as const : m.state.status,
      submittedAt: m.state.submittedAt,
    }),
  });
  const latestSave = blockSaves[blockSaves.length - 1] ?? null;
  // Older cache entries are GC'd after a few idle minutes; remember the
  // newest submit so a long-idle canvas can't fall back to a phantom
  // "Unsaved changes".
  const newestSubmitRef = useRef(0);
  if (latestSave && latestSave.submittedAt > newestSubmitRef.current) {
    newestSubmitRef.current = latestSave.submittedAt;
  }
  const saveState: SaveState = (() => {
    if (lastEditAt > newestSubmitRef.current) return 'unsaved'; // debounce window (or edits during an in-flight save)
    if (!latestSave) return 'idle';
    if (latestSave.status === 'pending') return 'saving';
    if (latestSave.status === 'error') return 'error';
    if (latestSave.status === 'success') return 'saved';
    return 'idle';
  })();

  // Push reducer state out to the server after edits — but only after the
  // initial load has settled so the initial dispatch doesn't double-write.
  useEffect(() => {
    if (!initialized.current) return;
    if (blocks === initBlocksRef.current) {
      hydratedRef.current = true; // just loaded — nothing changed
      return;
    }
    if (!hydratedRef.current) return;
    if (sync.save(blocks)) setLastEditAt(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // ----- slash menu -----
  const [slash, setSlash] = useState<({ blockId: string } & SlashOpen) | null>(null);
  const closeSlash = useCallback(() => setSlash(null), []);
  const [linkOpen, setLinkOpen] = useState<{ blockId: string } | null>(null);
  const [mentionOpen, setMentionOpen] = useState<{ blockId: string; at: number } | null>(null);
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
  const focusAfterRender = (id: string, pos: CaretPos = 'end') => {
    const req = { id, pos };
    pendingFocusRef.current = req;
    requestAnimationFrame(() => {
      if (pendingFocusRef.current !== req) return;
      pendingFocusRef.current = null;
      focusBlock(id, pos);
    });
  };
  const canvasRef = useRef<HTMLDivElement>(null);
  const blockSel = useBlockSelection({ blocks, blocksRef, dispatch, focusAfterRender, canvasRef });
  const insertAfter = (afterId: string | null, b?: Partial<SpaceBlock>) => {
    const block: SpaceBlock = { id: blockId(), type: 'text', content: '', ...b };
    dispatch({ type: 'insert', after: afterId, block });
    focusAfterRender(block.id, 'end');
    return block.id;
  };
  const restoreBlock = (block: SpaceBlock, prevId: string | null) => {
    const list = blocksRef.current;
    if (list.some((b) => b.id === block.id)) return;
    const anchor = prevId && list.some((b) => b.id === prevId) ? prevId : null;
    dispatch({ type: 'insert', after: anchor, block });
    focusAfterRender(block.id, 'end');
  };
  const removeBlock = (id: string, opts: { undo?: boolean; focus?: 'prev' | 'next' | 'none' } = {}) => {
    const list = blocksRef.current;
    const idx = list.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const removed = list[idx]!;
    const prev = list[idx - 1] ?? null;
    const next = list[idx + 1] ?? null;
    if (slash?.blockId === id) setSlash(null);
    if (list.length <= 1) {
      // Never leave the canvas empty — the last block becomes a fresh line.
      const fresh = emptyText();
      dispatch({ type: 'replace', blocks: [fresh] });
      focusAfterRender(fresh.id, 'end');
    } else {
      dispatch({ type: 'remove', id });
      const target = opts.focus === 'next' ? (next ?? prev) : (prev ?? next);
      if (opts.focus !== 'none' && target) {
        focusAfterRender(target.id, target === next ? 'start' : 'end');
      }
    }
    const trivial = isEditable(removed) && isEmptyContent(removed.content);
    if (opts.undo && !trivial) {
      toast.success('Block deleted', {
        action: { label: 'Undo', onClick: () => restoreBlock(removed, prev?.id ?? null) },
        durationMs: 6000,
      });
    }
  };
  const duplicateBlock = (id: string) => {
    const b = blocksRef.current.find((x) => x.id === id);
    if (!b) return;
    const copy: SpaceBlock = { ...b, id: blockId() };
    dispatch({ type: 'insert', after: id, block: copy });
    focusAfterRender(copy.id, 'end');
  };
  const convertBlock = (id: string, patch: Partial<SpaceBlock>) => {
    dispatch({ type: 'patch', id, patch });
  };
  const turnInto = (id: string, type: BlockType) => {
    convertBlock(id, { type, ...(type === 'checkbox' ? { checked: false } : {}) });
    focusAfterRender(id, 'end');
  };
  const setContent = (id: string, content: string) => {
    dispatch({ type: 'patch', id, patch: { content } });
  };
  /** Enter: split at the caret. Lists continue their type; others → text. */
  const splitBlock = (id: string, before: string, after: string) => {
    const b = blocksRef.current.find((x) => x.id === id);
    if (!b) return;
    const nextType: BlockType = isList(b.type) ? b.type : 'text';
    if (before === '' && after !== '') {
      // Caret at the start of a non-empty line: open a blank line above.
      dispatch({ type: 'insertBefore', before: id, block: { id: blockId(), type: nextType, content: '' } });
      focusAfterRender(id, 0);
      return;
    }
    dispatch({ type: 'patch', id, patch: { content: before } });
    const nb: SpaceBlock = {
      id: blockId(),
      type: nextType,
      content: after,
      ...(nextType === 'checkbox' ? { checked: false } : {}),
    };
    dispatch({ type: 'insert', after: id, block: nb });
    focusAfterRender(nb.id, 0);
  };
  /** Backspace at the start of a line: merge it into the line above. */
  const mergeWithPrevious = (id: string, text: string) => {
    const list = blocksRef.current;
    const idx = list.findIndex((b) => b.id === id);
    if (idx <= 0) return;
    const prev = list[idx - 1]!;
    if (prev.type === 'divider') {
      dispatch({ type: 'remove', id: prev.id });
      focusAfterRender(id, 0);
      return;
    }
    if (!isEditable(prev)) {
      focusBlock(prev.id);
      return;
    }
    const prevText = prev.content ?? '';
    dispatch({ type: 'patch', id: prev.id, patch: { content: prevText + text } });
    dispatch({ type: 'remove', id });
    if (slash?.blockId === id) setSlash(null);
    focusAfterRender(prev.id, prevText.length);
  };
  /** Delete at the end of a line: pull the next line up. */
  const mergeNext = (id: string, text: string): boolean => {
    const list = blocksRef.current;
    const idx = list.findIndex((b) => b.id === id);
    const next = list[idx + 1];
    if (idx === -1 || !next) return false;
    if (next.type === 'divider') {
      dispatch({ type: 'remove', id: next.id });
      return true;
    }
    if (!isEditable(next)) return false;
    dispatch({ type: 'patch', id, patch: { content: text + (next.content ?? '') } });
    dispatch({ type: 'remove', id: next.id });
    focusAfterRender(id, text.length);
    return true;
  };
  const applyMarkdown = (id: string, md: MarkdownShortcut, text: string) => {
    if (md.kind === 'divider') {
      convertBlock(id, { type: 'divider', content: '' });
      insertAfter(id);
      return;
    }
    convertBlock(id, {
      type: md.type,
      content: text.slice(md.strip),
      ...(md.type === 'checkbox' ? { checked: false } : {}),
    });
    // Same element stays focused; EditableBlock's layout effect keeps the
    // caret at the start of the (now stripped) text.
  };
  /** Multi-line plain-text paste → one block per line. */
  const pasteLines = (id: string, before: string, lines: string[], after: string) => {
    const b = blocksRef.current.find((x) => x.id === id);
    if (!b || lines.length === 0) return;
    const nextType: BlockType = isList(b.type) ? b.type : 'text';
    const last = lines.length - 1;
    dispatch({ type: 'patch', id, patch: { content: before + (lines[0] ?? '') + (last === 0 ? after : '') } });
    const rest: SpaceBlock[] = lines.slice(1).map((line, i) => ({
      id: blockId(),
      type: nextType,
      content: i + 1 === last ? line + after : line,
      ...(nextType === 'checkbox' ? { checked: false } : {}),
    }));
    if (rest.length > 0) {
      dispatch({ type: 'insertMany', after: id, blocks: rest });
      focusAfterRender(rest[rest.length - 1]!.id, (lines[last] ?? '').length);
    } else {
      focusAfterRender(id, before.length + (lines[0] ?? '').length);
    }
  };
  /** Arrow keys across blocks; cards get keyboard focus as a whole. */
  const navigate = (id: string, dir: 'up' | 'down' | 'left' | 'right', x: number): boolean => {
    const list = blocksRef.current;
    const idx = list.findIndex((b) => b.id === id);
    const target = list[idx + (dir === 'up' || dir === 'left' ? -1 : 1)];
    if (idx === -1 || !target) return false;
    if (!isEditable(target)) return focusBlock(target.id);
    const el = editorEl(target.id);
    if (!el) return false;
    if (dir === 'up' || dir === 'down') {
      placeCaretNearX(el, x, dir === 'up' ? 'last' : 'first');
    } else {
      el.focus();
      setCaret(el, dir === 'left' ? Infinity : 0);
    }
    el.scrollIntoView({ block: 'nearest' });
    return true;
  };

  // ----- drag reorder -----
  const dragIdRef = useRef<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: 'before' | 'after' } | null>(null);
  const onDragStartBlock = (id: string, e: React.DragEvent) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData(DRAG_MIME, id);
    const row = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-row-id]');
    if (row) e.dataTransfer.setDragImage(row, 16, 12);
    setSlash(null);
  };
  const onDragOverBlock = (id: string, e: React.DragEvent) => {
    if (!dragIdRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    setDropHint((prev) => (prev?.id === id && prev.pos === pos ? prev : { id, pos }));
  };
  const onDropBlock = (id: string, e: React.DragEvent) => {
    const dragged = dragIdRef.current;
    if (!dragged) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
    if (dragged !== id) dispatch({ type: 'move', id: dragged, target: id, position: pos });
    dragIdRef.current = null;
    setDropHint(null);
  };
  const onDragEndBlock = () => {
    dragIdRef.current = null;
    setDropHint(null);
  };

  /** Bottom "Click to write" — reuse a trailing empty line instead of piling them up. */
  const focusOrAppendLine = () => {
    const last = blocksRef.current[blocksRef.current.length - 1];
    if (last && last.type === 'text' && isEmptyContent(last.content)) {
      focusBlock(last.id, 'end');
      return;
    }
    insertAfter(last?.id ?? null);
  };

  // ----- slash command handling -----
  const onPickSlash = async (cmd: SlashCommandId) => {
    const s = slash;
    if (!s) return;
    setSlash(null);
    const target = blocksRef.current.find((b) => b.id === s.blockId);
    if (!target) return;

    // Remove exactly the `/query` token the user typed (recorded at
    // tokenStart), wherever the caret was — not just a trailing match.
    const { content: rest, caret } = removeSlashToken(target.content ?? '', s.tokenStart, s.query);

    if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3' || cmd === 'text' ||
        cmd === 'bullet' || cmd === 'numbered' || cmd === 'checkbox' ||
        cmd === 'quote' || cmd === 'callout') {
      convertBlock(target.id, { type: cmd, content: rest, ...(cmd === 'checkbox' ? { checked: false } : {}) });
      focusAfterRender(target.id, caret);
      return;
    }
    if (cmd === 'mention') {
      convertBlock(target.id, { content: rest });
      setMentionOpen({ blockId: target.id, at: caret });
      return;
    }

    // Card-type commands: reuse the line when it's otherwise empty; when it
    // has text, keep the text and put the new card on its own line below.
    let activeBlockId = target.id;
    if (isEmptyContent(rest)) {
      convertBlock(target.id, { content: '' });
    } else {
      convertBlock(target.id, { content: rest });
      const nb = emptyText();
      dispatch({ type: 'insert', after: target.id, block: nb });
      activeBlockId = nb.id;
    }

    if (cmd === 'divider') {
      convertBlock(activeBlockId, { type: 'divider', content: '' });
      // Always append a fresh text block after a divider so the canvas
      // keeps growing.
      insertAfter(activeBlockId);
      return;
    }
    if (cmd === 'todo') {
      // Convert the current block into a todo placeholder, then create the
      // real to-do async and patch in the resulting id.
      convertBlock(activeBlockId, { type: 'todo', content: 'New to-do' });
      if (!data.clientId) return;
      try {
        const created = await createTodoForBlock(activeBlockId);
        if (created) convertBlock(activeBlockId, { todoId: created.id, content: created.title });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not create to-do');
      }
      return;
    }
    if (cmd === 'goal') {
      convertBlock(activeBlockId, { type: 'goal', content: 'New goal' });
      if (!data.clientId) return;
      try {
        const created = await createGoalForBlock(activeBlockId);
        if (created) convertBlock(activeBlockId, { goalId: created.id, content: created.title });
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
      convertBlock(activeBlockId, {
        type: 'timer',
        content: data.project?.name ?? data.client?.name ?? 'Working',
        projectId: pid ?? null,
      });
      return;
    }
    if (cmd === 'link') {
      setLinkOpen({ blockId: activeBlockId });
      return;
    }
    if (cmd === 'embed') {
      setEmbedOpen({ blockId: activeBlockId });
      return;
    }
    if (cmd === 'upload') {
      openInsertAssetModal(activeBlockId, 'computer');
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
    const b = blocksRef.current.find((x) => x.id === mentionOpen.blockId);
    if (b) {
      const c = b.content ?? '';
      const at = Math.min(mentionOpen.at, c.length);
      const ins = `@${name.split(' ')[0]} `;
      convertBlock(b.id, { content: c.slice(0, at) + ins + c.slice(at) });
      focusAfterRender(b.id, at + ins.length);
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

  // Hooks must run unconditionally — keep this memo above the early return.
  const headings = useMemo(
    () => blocks
      .filter((b) => b.type === 'h1' || b.type === 'h2' || b.type === 'h3')
      .map((b) => ({
        id: b.id,
        type: b.type,
        label: (b.content ?? '').trim(),
      }))
      .filter((h) => h.label.length > 0),
    [blocks],
  );

  if (data.loading || scope.kind === 'all') return null;

  const filteredSpaceFiles = data.spaceFiles.filter((f) => {
    const q = spaceFileQuery.trim().toLowerCase();
    if (!q) return true;
    return f.title.toLowerCase().includes(q) || f.url.toLowerCase().includes(q);
  });

  const focusHeading = (id: string) => {
    const el = document.querySelector<HTMLElement>(`[data-row-id="${cssId(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    requestAnimationFrame(() => focusBlock(id));
  };

  const editorApi: EditorApi = {
    blockCount: blocks.length,
    remove: removeBlock,
    duplicate: duplicateBlock,
    turnInto,
    convert: convertBlock,
    setContent,
    split: splitBlock,
    mergePrev: mergeWithPrevious,
    mergeNext,
    markdown: applyMarkdown,
    pasteLines,
    pasteFiles: (id, files) => queueUploads(files, id),
    navigate,
    insertAfter: (id) => {
      insertAfter(id);
    },
    openSlash: (id, next) => {
      if (!next) {
        setSlash((prev) => (prev?.blockId === id ? null : prev));
        return;
      }
      setSlash({ blockId: id, ...next });
    },
    selectFromEdge: blockSel.selectFromEdge,
    selectAll: blockSel.selectAll,
    dragStart: onDragStartBlock,
    dragOver: onDragOverBlock,
    drop: onDropBlock,
    dragEnd: onDragEndBlock,
  };

  return (
    <div className="mx-auto max-w-6xl lg:grid lg:grid-cols-[220px,minmax(0,1fr)] lg:gap-8">
      <aside className="hidden lg:block">
        <div className="sticky top-24 rounded-xl border border-gray-200 bg-white/90 backdrop-blur px-3 py-3">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 mb-2">Contents</div>
          {headings.length === 0 ? (
            <div className="text-xs text-gray-400">Add headings to build a table of contents.</div>
          ) : (
            <nav className="space-y-0.5" aria-label="Notes table of contents">
              {headings.map((h) => {
                const indent = h.type === 'h1' ? '' : h.type === 'h2' ? 'pl-3' : 'pl-6';
                const size = h.type === 'h1' ? 'text-[13px] font-semibold' : h.type === 'h2' ? 'text-xs font-medium' : 'text-xs';
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => focusHeading(h.id)}
                    className={`block w-full truncate rounded-md px-2 py-1 text-left text-gray-600 hover:bg-gray-100 hover:text-gray-900 ${indent} ${size}`}
                    title={h.label}
                  >
                    {h.label}
                  </button>
                );
              })}
            </nav>
          )}
        </div>
      </aside>

      <div className="max-w-3xl w-full">
        {/* S2.6 — autosave status. Fixed-height strip so state flips don't shift the canvas. */}
        <div className="h-5 flex items-center justify-end gap-2">
          <div aria-live="polite">
            <SaveStatus state={saveState} savedKey={latestSave?.submittedAt ?? 0} />
          </div>
          <NotesShortcutsHelp />
        </div>
        <div
          ref={canvasRef}
          onMouseDownCapture={blockSel.onCanvasMouseDownCapture}
          data-block-selecting={blockSel.selecting ? 'true' : undefined}
          // While whole blocks are selected, hide any leftover text highlight.
          className={blockSel.selecting ? '[&_*::selection]:bg-transparent' : undefined}
        >
          {blocks.map((b, i) => (
            <BlockRow
              key={b.id}
              block={b}
              index={i}
              blocks={blocks}
              api={editorApi}
              slashOpen={slash?.blockId === b.id}
              dropHint={dropHint?.id === b.id ? dropHint.pos : null}
              selected={blockSel.selectedSet.has(b.id)}
            />
          ))}
        </div>
        {blockSel.sink}
        <button
          type="button"
          onClick={focusOrAppendLine}
          className="w-full text-left text-sm text-gray-500 hover:text-gray-700 py-3 px-2 rounded-lg hover:bg-gray-50"
          contentEditable={false}
        >
          Click to write, or press <kbd className="font-mono text-[11px] bg-gray-100 px-1 rounded">/</kbd> for commands…
        </button>
      </div>

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
        onClose={closeSlash}
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
// SaveStatus — truthful autosave indicator for the canvas header (S2.6)
// ============================================================================

type SaveState = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

function SaveStatus({ state, savedKey }: { state: SaveState; savedKey: number }) {
  // "Saved ✓" lingers ~2s after a successful write, then fades out. Keyed on
  // the mutation's submittedAt so each fresh save re-shows it.
  const [faded, setFaded] = useState(false);
  useEffect(() => {
    setFaded(false);
    if (state !== 'saved') return;
    const t = setTimeout(() => setFaded(true), 2000);
    return () => clearTimeout(t);
  }, [state, savedKey]);

  if (state === 'idle') return null;
  if (state === 'unsaved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
        Unsaved changes
      </span>
    );
  }
  if (state === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
        Saving…
      </span>
    );
  }
  if (state === 'error') {
    // Truth of the mechanism: the PATCH is fire-and-forget with no automatic
    // retry — only the next edit re-sends the doc (it's a full replace).
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-600">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        Save failed — not retried automatically; edit again to resend
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs text-emerald-600 transition-opacity duration-700 ${
        faded ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
      Saved
    </span>
  );
}

// ============================================================================
// Editor plumbing shared by rows
// ============================================================================

/** Everything a row needs from the canvas. Built fresh each render. */
type EditorApi = {
  blockCount: number;
  remove: (id: string, opts?: { undo?: boolean; focus?: 'prev' | 'next' | 'none' }) => void;
  duplicate: (id: string) => void;
  turnInto: (id: string, type: BlockType) => void;
  convert: (id: string, patch: Partial<SpaceBlock>) => void;
  setContent: (id: string, content: string) => void;
  split: (id: string, before: string, after: string) => void;
  mergePrev: (id: string, text: string) => void;
  mergeNext: (id: string, text: string) => boolean;
  markdown: (id: string, md: MarkdownShortcut, text: string) => void;
  pasteLines: (id: string, before: string, lines: string[], after: string) => void;
  pasteFiles: (id: string, files: File[]) => void;
  navigate: (id: string, dir: 'up' | 'down' | 'left' | 'right', x: number) => boolean;
  insertAfter: (id: string) => void;
  openSlash: (id: string, next: SlashOpen | null) => void;
  /** Shift+↑/↓ crossed a block edge → select whole blocks. */
  selectFromEdge: (id: string, dir: 'up' | 'down') => void;
  /** Second Cmd/Ctrl+A → select every block. */
  selectAll: () => void;
  dragStart: (id: string, e: React.DragEvent) => void;
  dragOver: (id: string, e: React.DragEvent) => void;
  drop: (id: string, e: React.DragEvent) => void;
  dragEnd: () => void;
};

function cssId(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/["\\]/g, '\\$&');
}

function editorEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-block-id="${cssId(id)}"]`);
}

/**
 * Focus a block. Editable blocks get a caret at `pos`; card blocks
 * (to-do, goal, timer, link, embed, divider) get keyboard focus as a whole.
 * Returns false when the block isn't in the DOM.
 */
function focusBlock(id: string, pos: CaretPos = 'end'): boolean {
  const el = editorEl(id);
  if (el) {
    el.focus({ preventScroll: true });
    setCaret(el, pos === 'start' ? 0 : pos === 'end' ? Infinity : pos);
    el.scrollIntoView({ block: 'nearest' });
    return true;
  }
  const card = document.querySelector<HTMLElement>(`[data-card-id="${cssId(id)}"]`);
  if (card) {
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: 'nearest' });
    return true;
  }
  return false;
}

/** Marks <body> so the overlay's ESC handler leaves our menus alone. */
function useModalFlag(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.body.setAttribute('data-space-modal-open', '1');
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [active]);
}

// ============================================================================
// BlockRow — gutter handle (delete · menu/drag) + per-type body
// ============================================================================

function gutterTop(type: BlockType): string {
  switch (type) {
    case 'h1':      return 'top-3.5';
    case 'h2':      return 'top-3';
    case 'h3':      return 'top-2.5';
    case 'quote':   return 'top-2.5';
    case 'callout': return 'top-5';
    case 'divider': return 'top-1.5';
    case 'todo':
    case 'goal':
    case 'timer':
    case 'link':
    case 'embed':   return 'top-3';
    default:        return 'top-1';
  }
}

function BlockRow({
  block,
  index,
  blocks,
  api,
  slashOpen,
  dropHint,
  selected = false,
}: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  api: EditorApi;
  slashOpen: boolean;
  dropHint: 'before' | 'after' | null;
  selected?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const editable = isEditable(block);

  return (
    <div
      data-row-id={block.id}
      className="group/row relative pl-14 -ml-14 py-0.5"
      onDragOver={(e) => api.dragOver(block.id, e)}
      onDrop={(e) => api.drop(block.id, e)}
      data-selected={selected ? 'true' : undefined}
      aria-selected={selected || undefined}
    >
      {selected && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-14 -right-1 rounded-md bg-brand-500/15 ring-1 ring-inset ring-brand-300/60"
        />
      )}
      {dropHint === 'before' && (
        <div className="pointer-events-none absolute left-14 right-0 -top-px h-0.5 rounded bg-brand-400" />
      )}
      <div
        contentEditable={false}
        className={`absolute left-1 ${gutterTop(block.type)} flex items-center transition-opacity ${
          menuOpen
            ? 'opacity-100'
            : 'opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:none)]:opacity-100'
        }`}
      >
        <button
          type="button"
          onClick={() => api.remove(block.id, { undo: true })}
          // Keep the caret where it is on rapid deletes.
          onMouseDown={(e) => e.preventDefault()}
          title="Delete block"
          aria-label="Delete block"
          className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-gray-100 focus-visible:opacity-100"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        {/* A div, not a <button>: Firefox never starts a drag from buttons. */}
        <div
          ref={handleRef}
          role="button"
          tabIndex={0}
          draggable
          onDragStart={(e) => api.dragStart(block.id, e)}
          onDragEnd={api.dragEnd}
          onClick={() => setMenuOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setMenuOpen((o) => !o);
            }
          }}
          title="Drag to move · click for options"
          aria-label="Block options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 cursor-grab active:cursor-grabbing outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
      </div>

      {editable ? (
        <EditableBlock block={block} index={index} blocks={blocks} api={api} slashOpen={slashOpen} />
      ) : (
        <CardShell block={block} api={api}>
          <CardBody block={block} onConvert={(patch) => api.convert(block.id, patch)} />
        </CardShell>
      )}

      {dropHint === 'after' && (
        <div className="pointer-events-none absolute left-14 right-0 -bottom-px h-0.5 rounded bg-brand-400" />
      )}
      <BlockMenu open={menuOpen} onClose={closeMenu} anchorRef={handleRef} block={block} api={api} />
    </div>
  );
}

const TURN_INTO_ICONS: Partial<Record<BlockType, React.ComponentType<{ className?: string }>>> = {
  text: Pilcrow, h1: Heading1, h2: Heading2, h3: Heading3,
  bullet: List, numbered: ListOrdered, checkbox: CheckSquare, quote: Quote, callout: Sparkles,
};
const TURN_INTO = TURN_INTO_OPTIONS.map((o) => ({ ...o, icon: TURN_INTO_ICONS[o.type] ?? Pilcrow }));

function BlockMenu({
  open,
  onClose,
  anchorRef,
  block,
  api,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  block: SpaceBlock;
  api: EditorApi;
}) {
  useModalFlag(open);
  const item =
    'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left text-gray-700 hover:bg-gray-50 focus:bg-gray-50 outline-none';
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Popover open={open} onClose={onClose} anchorRef={anchorRef} width={208}>
      <div role="menu" aria-label="Block options" className="py-1">
        <button type="button" role="menuitem" className={`${item} hover:text-red-600`}
          onClick={run(() => api.remove(block.id, { undo: true }))}>
          <Trash2 className="w-4 h-4 text-gray-400" /> Delete
        </button>
        <button type="button" role="menuitem" className={item} onClick={run(() => api.duplicate(block.id))}>
          <CopyPlus className="w-4 h-4 text-gray-400" /> Duplicate
        </button>
        {isEditable(block) && (
          <>
            <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Turn into</div>
            {TURN_INTO.map(({ type, label, icon: Icon }) => (
              <button
                key={type}
                type="button"
                role="menuitemradio"
                aria-checked={block.type === type}
                className={`${item} ${block.type === type ? 'text-brand-700 font-medium' : ''}`}
                onClick={run(() => api.turnInto(block.id, type))}
              >
                <Icon className="w-4 h-4 text-gray-400" /> {label}
              </button>
            ))}
          </>
        )}
      </div>
    </Popover>
  );
}

/**
 * Wraps non-editable blocks so they can be reached and removed from the
 * keyboard: arrows move on, Backspace/Delete remove (with undo), Enter opens
 * a new line below.
 */
function CardShell({ block, api, children }: { block: SpaceBlock; api: EditorApi; children: React.ReactNode }) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // inputs/buttons inside the card
    const x = e.currentTarget.getBoundingClientRect().left;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      api.selectAll();
      return;
    }
    if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      api.selectFromEdge(block.id, e.key === 'ArrowUp' ? 'up' : 'down');
      return;
    }
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowLeft':
        if (api.navigate(block.id, e.key === 'ArrowUp' ? 'up' : 'left', x)) e.preventDefault();
        return;
      case 'ArrowDown':
      case 'ArrowRight':
        if (api.navigate(block.id, e.key === 'ArrowDown' ? 'down' : 'right', x)) e.preventDefault();
        return;
      case 'Backspace':
      case 'Delete':
        e.preventDefault();
        api.remove(block.id, { undo: true, focus: e.key === 'Delete' ? 'next' : 'prev' });
        return;
      case 'Enter':
        e.preventDefault();
        api.insertAfter(block.id);
        return;
    }
  };
  return (
    <div
      data-card-id={block.id}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      contentEditable={false}
      className="rounded-xl outline-none focus:ring-2 focus:ring-brand-200"
    >
      {children}
    </div>
  );
}

function CardBody({ block, onConvert }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
  switch (block.type) {
    case 'divider':
      return <hr className="my-3 border-gray-200" />;
    case 'todo':
      return <TodoBlockCard block={block} onConvert={onConvert} />;
    case 'goal':
      return <GoalBlockCard block={block} onConvert={onConvert} />;
    case 'timer':
      return <TimerBlockCard block={block} onConvert={onConvert} />;
    case 'link':
      return <LinkBlockCard block={block} />;
    case 'embed':
      return <EmbedBlockCard block={block} />;
    default:
      return null;
  }
}

// ============================================================================
// EditableBlock — one line of text / heading / list / quote / callout
// ============================================================================

function EditableBlock({
  block,
  index,
  blocks,
  api,
  slashOpen,
}: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  api: EditorApi;
  slashOpen: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const composingRef = useRef(false);
  // tokenStart of a `/…` the user dismissed (Esc/Space/no match) so typing on
  // doesn't immediately reopen the menu for the same token.
  const dismissedSlashRef = useRef<number | null>(null);
  const wasSlashOpen = useRef(false);
  const content = block.content ?? '';

  // State → DOM. Only rewrites when the DOM disagrees (remote change,
  // conversion, split/merge), and keeps the caret where it was.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    if (readText(el, { ignoreTrailingBr: true }) === content && !needsNormalize(el, content)) return;
    const hadFocus = document.activeElement === el;
    const off = hadFocus ? getOffsets(el) : null;
    writeText(el, content);
    if (hadFocus) setCaret(el, Math.min(off?.end ?? content.length, content.length));
  }, [content, block.id, block.type]);

  // Remember which token the menu was dismissed for.
  useEffect(() => {
    if (wasSlashOpen.current && !slashOpen) {
      const el = ref.current;
      if (el) {
        const text = readText(el, { ignoreTrailingBr: true });
        const off = getOffsets(el);
        const tok = findSlashToken(text, off?.end ?? text.length);
        dismissedSlashRef.current = tok ? tok.tokenStart : null;
      }
    }
    wasSlashOpen.current = slashOpen;
  }, [slashOpen]);

  const commit = (el: HTMLDivElement, text: string, caret: number) => {
    if (block.type === 'text') {
      const md = matchMarkdownShortcut(text, caret);
      if (md) {
        api.openSlash(block.id, null);
        api.markdown(block.id, md, text);
        return;
      }
    }
    if (text !== content) api.setContent(block.id, text);

    const tok = findSlashToken(text, caret);
    if (tok && tok.tokenStart !== dismissedSlashRef.current) {
      const box = caretBox(el);
      api.openSlash(block.id, {
        rect: { x: box.x, y: box.bottom, top: box.top },
        query: tok.query,
        tokenStart: tok.tokenStart,
      });
      return;
    }
    if (!tok) dismissedSlashRef.current = null;
    if (slashOpen) api.openSlash(block.id, null);
  };

  const handleInput = () => {
    const el = ref.current;
    if (!el || composingRef.current) return;
    const off = getOffsets(el);
    const text = readText(el, { ignoreTrailingBr: true });
    const caret = Math.min(off?.end ?? text.length, text.length);
    // Browsers leave stray <br>/<div> behind (e.g. after select-all + delete);
    // normalise so the DOM always mirrors `text` exactly.
    if (needsNormalize(el, text)) {
      writeText(el, text);
      setCaret(el, caret);
    }
    commit(el, text, caret);
  };

  /** Replace the selection with `insert` and run the normal input path. */
  const insertAtCaret = (insert: string) => {
    const el = ref.current;
    if (!el) return;
    const text = readText(el, { ignoreTrailingBr: true });
    const off = getOffsets(el) ?? { start: text.length, end: text.length };
    const next = text.slice(0, off.start) + insert + text.slice(off.end);
    const caret = off.start + insert.length;
    writeText(el, next);
    setCaret(el, caret);
    commit(el, next, caret);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229 || composingRef.current) return;
    // The slash menu owns these keys while it's open (it also captures them
    // at the window level; this is a belt-and-braces guard).
    if (slashOpen && ['Enter', 'ArrowUp', 'ArrowDown', 'Tab', 'Escape'].includes(e.key)) {
      e.preventDefault();
      return;
    }
    const el = ref.current;
    if (!el) return;
    const text = readText(el, { ignoreTrailingBr: true });
    const off = getOffsets(el) ?? { start: text.length, end: text.length };
    const collapsed = off.start === off.end;
    const mod = e.metaKey || e.ctrlKey || e.altKey;

    // Cmd/Ctrl+A: first press selects this block's text (native), the next
    // one selects every block.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a') {
      if (selectAllEscalates(text.length, off.start, off.end)) {
        e.preventDefault();
        api.selectAll();
      }
      return;
    }
    // Shift+↑/↓ past the block's edge selects whole blocks.
    if (e.shiftKey && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const dir = e.key === 'ArrowUp' ? 'up' : 'down';
      if (shiftArrowLeavesBlock(dir, text.length, off.start, off.end)) {
        e.preventDefault();
        api.selectFromEdge(block.id, dir);
      }
      return;
    }

    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        if (e.shiftKey) {
          insertAtCaret('\n');
          return;
        }
        if (isEmptyContent(text) && isList(block.type)) {
          api.turnInto(block.id, 'text');
          return;
        }
        api.split(block.id, text.slice(0, off.start), text.slice(off.end));
        return;
      }
      case 'Backspace': {
        if (!collapsed || off.start !== 0 || mod) return;
        e.preventDefault();
        if (block.type !== 'text') {
          // First Backspace on a heading/list/quote turns it back into text.
          api.turnInto(block.id, 'text');
          return;
        }
        if (isEmptyContent(text)) {
          if (blocks.length <= 1) return;
          api.remove(block.id, { focus: index === 0 ? 'next' : 'prev' });
          return;
        }
        if (index > 0) api.mergePrev(block.id, text);
        return;
      }
      case 'Delete': {
        if (!collapsed || off.end !== text.length || mod) return;
        if (api.mergeNext(block.id, text)) e.preventDefault();
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        if (e.shiftKey || mod || !collapsed) return;
        const up = e.key === 'ArrowUp';
        if (up ? !caretOnFirstLine(el) : !caretOnLastLine(el)) return;
        if (api.navigate(block.id, up ? 'up' : 'down', caretBox(el).x)) e.preventDefault();
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (e.shiftKey || mod || !collapsed) return;
        const left = e.key === 'ArrowLeft';
        if (left ? off.start !== 0 : off.end !== text.length) return;
        if (api.navigate(block.id, left ? 'left' : 'right', 0)) e.preventDefault();
        return;
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length > 0) {
      e.preventDefault();
      api.pasteFiles(block.id, files);
      return;
    }
    // Always paste as plain text — no foreign HTML in the canvas.
    e.preventDefault();
    const raw = e.clipboardData.getData('text/plain');
    if (!raw) return;
    const lines = pastedLines(raw);
    if (lines.length <= 1 || block.type === 'quote' || block.type === 'callout') {
      insertAtCaret(lines.length <= 1 ? (lines[0] ?? '') : lines.join('\n'));
      return;
    }
    const el = ref.current;
    if (!el) return;
    const text = readText(el, { ignoreTrailingBr: true });
    const off = getOffsets(el) ?? { start: text.length, end: text.length };
    api.openSlash(block.id, null);
    api.pasteLines(block.id, text.slice(0, off.start), lines, text.slice(off.end));
  };

  // Prefix for ordered/unordered/checkbox lists.
  const prefix = (() => {
    if (block.type === 'bullet') return <span className="inline-block w-6 mr-2 align-top text-gray-400 select-none text-center" contentEditable={false}>•</span>;
    if (block.type === 'numbered') {
      let n = 1;
      for (let i = index - 1; i >= 0; i--) {
        if (blocks[i]!.type === 'numbered') n++;
        else break;
      }
      return <span className="inline-block w-8 mr-2 align-top text-gray-400 tabular-nums select-none text-right" contentEditable={false}>{n}.</span>;
    }
    if (block.type === 'checkbox') {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            api.convert(block.id, { checked: !block.checked });
          }}
          className="inline-flex items-center justify-center w-4 h-4 mr-3 mt-1 rounded border border-gray-300 align-top shrink-0"
          aria-label={block.checked ? 'Uncheck' : 'Check'}
          aria-pressed={!!block.checked}
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
        role="textbox"
        aria-multiline="true"
        aria-label={placeholderFor(block, true) || 'Text'}
        data-block-id={block.id}
        data-empty={isEmptyContent(content) ? 'true' : 'false'}
        data-placeholder={placeholderFor(block, focused)}
        onInput={handleInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onCompositionStart={() => {
          composingRef.current = true;
          if (ref.current) ref.current.dataset.empty = 'false';
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (slashOpen) api.openSlash(block.id, null);
        }}
        className={blockClassName(block, index, blocks)}
      />
    </div>
  );
}

function blockClassName(block: SpaceBlock, _i: number, _all: SpaceBlock[]): string {
  // Placeholder is driven by `data-empty` (state), not `:empty`, because
  // browsers leave <br>s behind in "empty" contentEditables.
  const base =
    'flex-1 min-w-0 outline-none whitespace-pre-wrap break-words ' +
    'data-[empty=true]:before:content-[attr(data-placeholder)] before:text-gray-400 before:pointer-events-none';
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

// ============================================================================
// Specialized block cards
// ============================================================================

function TodoBlockCard({ block }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
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

function GoalBlockCard({ block }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
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
    <div
      contentEditable={false}
      className={`my-1.5 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 ${className ?? 'bg-white'}`}
    >
      {children}
    </div>
  );
}

function AutoLink() {
  return <span className="text-[10px] italic text-gray-400 ml-1">Auto-linked</span>;
}
