'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SpaceBlock } from '@allebrum/shared';
import { useToast } from '@/components/ui/Toast';
import { blockId, emptyText, pastedLines, type Action } from './notes/blocks';
import {
  blocksToHtml, blocksToPlainText, extendSelection, listNumbers, pruneSelection,
  selectAll as selectAllRange, selectedIds, selectionFromEdge, type BlockSelection,
} from './notes/selection';

const INTERACTIVE = 'button, a, input, textarea, select, iframe, video, [draggable="true"], [role="menu"]';
const EDGE = 48; // px from the viewport edge where a drag auto-scrolls

function rowsIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-row-id]'));
}

/** The row under a viewport y (clamped to the first/last row). */
function rowAtY(root: HTMLElement, y: number): string | null {
  const rows = rowsIn(root);
  if (rows.length === 0) return null;
  let best: { id: string; d: number } | null = null;
  for (const r of rows) {
    const rect = r.getBoundingClientRect();
    if (y >= rect.top && y < rect.bottom) return r.dataset.rowId ?? null;
    const d = y < rect.top ? rect.top - y : y - rect.bottom;
    if (!best || d < best.d) best = { id: r.dataset.rowId ?? '', d };
  }
  return best?.id || null;
}

function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement as HTMLElement | null;
}

/**
 * Notion-style block selection for the Notes canvas (see notes/selection.ts
 * for why it's block-level rather than one big text selection).
 *
 * - Drag from one block into another, Shift+Click another block, or
 *   Shift+↑/↓ past a block's edge to select whole blocks.
 * - While blocks are selected, keyboard focus sits on an off-screen "sink"
 *   whose text is the plain-text copy and is natively selected, so the
 *   browser's own Cmd/Ctrl+C / X / V fire; we fill the clipboard with
 *   text/plain (markdown prefixes) and text/html.
 * - Backspace/Delete removes (with Undo), typing replaces, Esc clears.
 *
 * All doc changes go through the reducer, so saving and live merges see
 * ordinary edits; the selection is pruned when merged-in changes remove ids.
 */
export function useBlockSelection({
  blocks,
  blocksRef,
  dispatch,
  focusAfterRender,
  canvasRef,
}: {
  blocks: SpaceBlock[];
  blocksRef: React.MutableRefObject<SpaceBlock[]>;
  dispatch: React.Dispatch<Action>;
  focusAfterRender: (id: string, pos?: 'start' | 'end' | number) => void;
  canvasRef: React.RefObject<HTMLElement | null>;
}) {
  const toast = useToast();
  const [sel, setSel] = useState<BlockSelection | null>(null);
  const selRef = useRef(sel);
  selRef.current = sel;
  const sinkRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ start: string; active: boolean; y: number; raf: number } | null>(null);

  const ids = useMemo(() => selectedIds(blocks, sel), [blocks, sel]);
  const selectedSet = useMemo(() => new Set(ids), [ids]);

  // Live merges / deletes can remove selected ids.
  useEffect(() => {
    setSel((s) => {
      const next = pruneSelection(blocks, s);
      return next === s || (next && s && next.anchor === s.anchor && next.focus === s.focus) ? s : next;
    });
  }, [blocks]);

  const payload = useCallback(() => {
    const list = blocksRef.current;
    const set = new Set(selectedIds(list, selRef.current));
    const chosen = list.filter((b) => set.has(b.id));
    const numbers = listNumbers(list);
    return { chosen, text: blocksToPlainText(chosen, numbers), html: blocksToHtml(chosen, numbers) };
  }, [blocksRef]);

  // Mirror the selection into the sink and keep its text natively selected.
  useLayoutEffect(() => {
    const sink = sinkRef.current;
    if (!sink) return;
    if (!sel) {
      sink.textContent = '';
      return;
    }
    sink.textContent = payload().text || ' ';
    if (document.activeElement === sink) selectSinkText(sink);
  }, [sel, blocks, payload]);

  const focusSink = useCallback(() => {
    const sink = sinkRef.current;
    if (!sink) return;
    sink.focus({ preventScroll: true });
    selectSinkText(sink);
  }, []);

  /** Start/replace a block selection and move keyboard focus to the sink. */
  const select = useCallback((next: BlockSelection | null) => {
    setSel(next);
    if (next) {
      // Synchronously, so a key pressed in the same frame already lands on
      // the sink rather than the block that had the caret.
      window.getSelection()?.removeAllRanges();
      focusSink();
    }
  }, [focusSink]);

  const clear = useCallback((focus?: { id: string; pos: 'start' | 'end' }) => {
    setSel(null);
    if (focus) focusAfterRender(focus.id, focus.pos);
  }, [focusAfterRender]);

  /** Swap the selected run for `insert`, with an Undo toast. */
  const replaceSelected = useCallback((insert: SpaceBlock[], verb: 'deleted' | 'cut' | 'replaced') => {
    const list = blocksRef.current;
    const run = selectedIds(list, selRef.current);
    if (run.length === 0) return;
    const set = new Set(run);
    const removed = list.filter((b) => set.has(b.id));
    const firstIdx = list.findIndex((b) => set.has(b.id));
    const prevId = firstIdx > 0 ? list[firstIdx - 1]!.id : null;
    const nextBlock = list.slice(firstIdx).find((b) => !set.has(b.id)) ?? null;
    const fallback = emptyText();
    dispatch({ type: 'replaceRange', ids: run, insert, fallback });
    setSel(null);
    const everything = removed.length === list.length && insert.length === 0;
    const inserted = everything ? [fallback] : insert;
    // Caret: end of the last inserted block, else where the run used to be.
    const target = inserted[inserted.length - 1];
    if (target) focusAfterRender(target.id, 'end');
    else if (prevId) focusAfterRender(prevId, 'end');
    else if (nextBlock) focusAfterRender(nextBlock.id, 'start');

    const n = removed.length;
    const label = `${n} block${n === 1 ? '' : 's'} ${verb}`;
    const snapshot = new Map(inserted.map((b) => [b.id, b.content ?? '']));
    toast.success(label, {
      action: {
        label: 'Undo',
        onClick: () => {
          const now = blocksRef.current;
          // Drop the replacement only if it's still what we put there.
          const stale = now.filter((b) => snapshot.has(b.id) && (b.content ?? '') === snapshot.get(b.id)).map((b) => b.id);
          if (stale.length) dispatch({ type: 'removeMany', ids: stale });
          const missing = removed.filter((b) => !now.some((x) => x.id === b.id));
          if (missing.length === 0) return;
          const anchor = prevId && now.some((b) => b.id === prevId) ? prevId : null;
          dispatch({ type: 'insertMany', after: anchor, blocks: missing });
          setSel({ anchor: missing[0]!.id, focus: missing[missing.length - 1]!.id });
          requestAnimationFrame(focusSink);
        },
      },
      durationMs: 6000,
    });
  }, [blocksRef, dispatch, focusAfterRender, focusSink, toast]);

  // ----- clipboard (native events on the focused sink) -----
  useEffect(() => {
    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      if (!selRef.current || document.activeElement !== sinkRef.current) return;
      const { text, html } = payload();
      e.clipboardData?.setData('text/plain', text);
      e.clipboardData?.setData('text/html', html);
      e.preventDefault();
      if (cut) replaceSelected([], 'cut');
    };
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => {
      if (!selRef.current || document.activeElement !== sinkRef.current) return;
      const raw = e.clipboardData?.getData('text/plain') ?? '';
      e.preventDefault();
      if (!raw) return;
      const lines = pastedLines(raw);
      while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
      replaceSelected(lines.map((content) => ({ id: blockId(), type: 'text' as const, content })), 'replaced');
    };
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
    };
  }, [payload, replaceSelected]);

  // ----- keyboard while blocks are selected -----
  const onSinkKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const s = selRef.current;
    if (!s || e.nativeEvent.isComposing) return;
    const list = blocksRef.current;
    const run = selectedIds(list, s);
    const first = run[0];
    const last = run[run.length - 1];
    const mod = e.metaKey || e.ctrlKey;
    const stop = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod) {
      const k = e.key.toLowerCase();
      if (k === 'a') {
        stop();
        setSel(selectAllRange(list));
      }
      // c / x / v: let the browser fire copy/cut/paste (handled above).
      return;
    }
    switch (e.key) {
      case 'Escape':
        stop();
        clear(s.focus ? { id: s.focus, pos: 'end' } : undefined);
        return;
      case 'Backspace':
      case 'Delete':
        stop();
        replaceSelected([], 'deleted');
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        stop();
        if (e.shiftKey) setSel(extendSelection(list, s, e.key === 'ArrowUp' ? 'up' : 'down'));
        else if (e.key === 'ArrowUp' && first) clear({ id: first, pos: 'start' });
        else if (last) clear({ id: last, pos: 'end' });
        return;
      case 'ArrowLeft':
        stop();
        if (first) clear({ id: first, pos: 'start' });
        return;
      case 'ArrowRight':
      case 'Enter':
        stop();
        if (last) clear({ id: last, pos: 'end' });
        return;
      case 'Tab':
        setSel(null);
        return;
    }
    // Typing replaces the selection with a new line holding that character.
    if (e.key.length === 1 && !e.altKey) {
      stop();
      replaceSelected([{ id: blockId(), type: 'text', content: e.key }], 'replaced');
    }
  };

  // ----- mouse: drag across blocks, Shift+Click -----
  const stopDrag = useCallback(() => {
    const d = dragRef.current;
    if (d) cancelAnimationFrame(d.raf);
    dragRef.current = null;
  }, []);

  const onCanvasMouseDownCapture = (e: React.MouseEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const root = canvasRef.current;
    const target = e.target as HTMLElement;
    if (!root || target.closest(INTERACTIVE)) {
      if (selRef.current) setSel(null);
      return;
    }
    const rowId = target.closest<HTMLElement>('[data-row-id]')?.dataset.rowId ?? rowAtY(root, e.clientY);
    if (!rowId) return;

    if (e.shiftKey) {
      const active = document.activeElement as HTMLElement | null;
      const focusedRow = active && root.contains(active) ? active.closest<HTMLElement>('[data-row-id]')?.dataset.rowId : null;
      const anchor = selRef.current?.anchor ?? focusedRow ?? null;
      if (anchor && (anchor !== rowId || selRef.current)) {
        e.preventDefault();
        select({ anchor, focus: rowId });
        return;
      }
    } else if (selRef.current) {
      setSel(null); // plain click: back to normal editing
    }

    const d = { start: rowId, active: false, y: e.clientY, raf: 0 };
    dragRef.current = d;
    const scroller = scrollParent(root);
    const update = () => {
      const r = canvasRef.current;
      if (!r || dragRef.current !== d) return;
      const over = rowAtY(r, d.y);
      if (!over) return;
      if (!d.active && over === d.start) return;
      d.active = true;
      window.getSelection()?.removeAllRanges();
      setSel((s) => (s && s.anchor === d.start && s.focus === over ? s : { anchor: d.start, focus: over }));
    };
    const tick = () => {
      if (dragRef.current !== d) return;
      if (d.active && scroller) {
        const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
        const bottom = scroller === document.scrollingElement ? window.innerHeight : scroller.getBoundingClientRect().bottom;
        const dy = d.y < top + EDGE ? -(top + EDGE - d.y) / 3 : d.y > bottom - EDGE ? (d.y - (bottom - EDGE)) / 3 : 0;
        if (dy) {
          scroller.scrollTop += dy;
          update();
        }
      }
      d.raf = requestAnimationFrame(tick);
    };
    const onMove = (ev: MouseEvent) => {
      d.y = ev.clientY;
      update();
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      const wasActive = d.active;
      stopDrag();
      if (wasActive) {
        window.getSelection()?.removeAllRanges();
        focusSink();
      }
    };
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
    d.raf = requestAnimationFrame(tick);
  };

  useEffect(() => stopDrag, [stopDrag]);

  // A click anywhere outside the canvas drops the selection.
  useEffect(() => {
    if (!sel) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (canvasRef.current?.contains(t) || sinkRef.current?.contains(t)) return;
      setSel(null);
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [sel, canvasRef]);

  // Esc belongs to us while blocks are selected, not the space overlay.
  useEffect(() => {
    if (!sel) return;
    document.body.setAttribute('data-space-modal-open', '1');
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [sel]);

  const sink = (
    <div
      ref={sinkRef}
      tabIndex={-1}
      role="textbox"
      aria-readonly="true"
      aria-label={ids.length ? `${ids.length} block${ids.length === 1 ? '' : 's'} selected` : 'Block selection'}
      data-testid="notes-selection-sink"
      onKeyDown={onSinkKeyDown}
      onBlur={(e) => {
        // Focus moved into a block (click, Tab, arrow): selection is done.
        const to = e.relatedTarget as HTMLElement | null;
        if (to && canvasRef.current?.contains(to)) setSel(null);
      }}
      style={{ position: 'fixed', left: -10000, top: 0, width: 1, height: 1, overflow: 'hidden', whiteSpace: 'pre', opacity: 0 }}
    />
  );

  return {
    selection: sel,
    selectedSet,
    selecting: !!sel,
    sink,
    onCanvasMouseDownCapture,
    /** Shift+↑/↓ crossed out of a block. */
    selectFromEdge: (id: string, dir: 'up' | 'down') => select(selectionFromEdge(blocksRef.current, id, dir)),
    /** Second Cmd/Ctrl+A in a block. */
    selectAll: () => select(selectAllRange(blocksRef.current)),
  };
}

function selectSinkText(sink: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(sink);
  const s = window.getSelection();
  s?.removeAllRanges();
  s?.addRange(range);
}
