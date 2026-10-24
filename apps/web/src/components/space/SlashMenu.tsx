'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Pilcrow, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare,
  Quote, Sparkles, Minus,
  Target, CheckCircle, Timer, Link as LinkIcon, Image as EmbedIcon, AtSign, Upload,
} from 'lucide-react';
import { fuzzyScore } from './notes/blocks';
import { SLASH_COMMANDS, SLASH_GROUP_LABELS, type SlashCommand, type SlashCommandId } from './notes/commands';

export type { SlashCommandId } from './notes/commands';

type CommandDef = SlashCommand & { icon: typeof Pilcrow };

// Exhaustive by construction: adding a command id without an icon fails typecheck.
const ICONS: Record<SlashCommandId, typeof Pilcrow> = {
  todo: CheckCircle, goal: Target, timer: Timer, link: LinkIcon, embed: EmbedIcon, mention: AtSign, upload: Upload,
  h1: Heading1, h2: Heading2, h3: Heading3,
  text: Pilcrow, bullet: List, numbered: ListOrdered, checkbox: CheckSquare, quote: Quote, callout: Sparkles, divider: Minus,
};

const COMMANDS: CommandDef[] = SLASH_COMMANDS.map((c) => ({ ...c, icon: ICONS[c.id] }));
const GROUP_LABELS = SLASH_GROUP_LABELS;

/**
 * Slash-command popover. Anchored to the caret when the user types `/`.
 * Filtering comes from the inline typed token (e.g. `/upl`) so focus stays
 * in the editor and the user can keep typing.
 *
 * Keyboard (captured on window *before* the block's own handlers so the
 * block never also acts on them): ↑/↓ or Tab/Shift+Tab move, Enter picks,
 * Esc closes and keeps the typed text. Typing a space closes it too (the
 * token no longer matches). A click anywhere outside closes it without
 * swallowing that click. When nothing matches a "No results" row shows;
 * after a few more unmatched characters the menu closes by itself.
 *
 * Sets `data-space-modal-open` on <body> while visible so the overlay's ESC
 * handler defers to the menu.
 */
const NO_MATCH_CLOSE_AFTER = 3;

export function SlashMenu({
  open,
  anchorRect,
  query,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorRect: { x: number; y: number; top?: number } | null;
  query: string;
  onPick: (id: SlashCommandId) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const lastMatchLen = useRef(0);
  const [placement, setPlacement] = useState<{ left: number; top: number } | null>(null);

  // Fuzzy filter. With no query the list keeps its grouped order; with a
  // query the best matches float to the top (group order breaks ties).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS
      .map((c, i) => ({
        c,
        i,
        score: Math.max(fuzzyScore(q, c.label), ...c.keywords.map((k) => fuzzyScore(q, k) - 2), fuzzyScore(q, c.id)),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .map((x) => x.c);
  }, [query]);

  const visible = open && !!anchorRect;

  useEffect(() => {
    if (!visible) return;
    document.body.setAttribute('data-space-modal-open', '1');
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [visible]);

  useEffect(() => {
    if (open) setActive(0);
    if (!open) lastMatchLen.current = 0;
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Close once the user has typed several characters past the last match.
  useEffect(() => {
    if (!open) return;
    if (filtered.length > 0) {
      lastMatchLen.current = query.length;
      return;
    }
    if (query.length - lastMatchLen.current >= NO_MATCH_CLOSE_AFTER) onClose();
  }, [open, filtered.length, query, onClose]);

  // Keep the active row in view.
  useEffect(() => {
    itemRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Keys: capture phase on window so we run before React's root listener
  // (and therefore before the block's onKeyDown).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const move = (delta: number) => {
        e.preventDefault();
        e.stopPropagation();
        if (filtered.length === 0) return;
        setActive((i) => (i + delta + filtered.length) % filtered.length);
      };
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) return move(1);
      if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) return move(-1);
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const cmd = filtered[active];
        if (cmd) onPick(cmd.id);
        else onClose();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
        // Let the key do its normal thing (type the space / move the caret);
        // the menu just goes away and the typed text stays.
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, filtered, active, onPick, onClose]);

  // Outside mousedown closes without eating the click (no backdrop).
  useEffect(() => {
    if (!visible) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [visible, onClose]);

  // Position below the caret, flipping above when there's no room.
  useLayoutEffect(() => {
    if (!visible || !anchorRect) {
      setPlacement(null);
      return;
    }
    const h = panelRef.current?.offsetHeight ?? 320;
    const w = panelRef.current?.offsetWidth ?? 288;
    const below = anchorRect.y + 6;
    const caretTop = anchorRect.top ?? anchorRect.y - 20;
    const fitsBelow = below + h <= window.innerHeight - 8;
    const top = fitsBelow ? below : Math.max(8, caretTop - h - 6);
    const left = Math.max(8, Math.min(anchorRect.x, window.innerWidth - w - 8));
    setPlacement({ left, top });
  }, [visible, anchorRect, filtered.length]);

  if (!visible || !anchorRect) return null;

  // Group headings only when browsing (no query); a query shows a ranked list.
  const browsing = query.trim() === '';
  const grouped: { group: CommandDef['group'] | null; items: CommandDef[] }[] = [];
  if (browsing) {
    for (const c of filtered) {
      let g = grouped.find((x) => x.group === c.group);
      if (!g) {
        g = { group: c.group, items: [] };
        grouped.push(g);
      }
      g.items.push(c);
    }
  } else if (filtered.length > 0) {
    grouped.push({ group: null, items: filtered });
  }
  const flat = grouped.flatMap((g) => g.items);
  itemRefs.current = [];

  return createPortal(
    <div
      ref={panelRef}
      role="listbox"
      aria-label="Insert block"
      className="fixed z-[301] w-72 bg-white border border-gray-200 shadow-2xl rounded-xl overflow-hidden"
      style={{
        left: placement?.left ?? anchorRect.x,
        top: placement?.top ?? anchorRect.y + 6,
        visibility: placement ? 'visible' : 'hidden',
      }}
      // Keep focus (and the caret) in the editor while clicking items.
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="px-3 py-2 border-b border-gray-100 text-[11px] text-gray-500 flex items-center justify-between">
        <span className="font-mono">/{query}</span>
        <span className="text-gray-400">↑↓ · Enter · Esc</span>
      </div>
      <div className="max-h-80 overflow-y-auto py-1">
        {flat.length === 0 && (
          <div className="px-3 py-3 text-sm text-gray-500" role="option" aria-disabled="true" aria-selected="false">
            No results
          </div>
        )}
        {grouped.map((g) => (
          <div key={g.group ?? 'results'} className="py-1">
            {g.group && (
              <div className="px-3 pb-1 text-[10px] uppercase tracking-widest font-bold text-gray-500">
                {GROUP_LABELS[g.group]}
              </div>
            )}
            {g.items.map((c) => {
              const idx = flat.indexOf(c);
              const isActive = idx === active;
              return (
                <button
                  key={c.id}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => onPick(c.id)}
                  className={`w-full text-left px-3 py-1.5 flex items-center gap-2 ${
                    isActive ? 'bg-brand-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                    isActive ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-500'
                  }`}>
                    <c.icon className="w-4 h-4" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm font-semibold truncate ${isActive ? 'text-brand-800' : 'text-gray-900'}`}>
                      {c.label}
                    </span>
                    <span className="block text-[11px] text-gray-500 truncate">{c.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
