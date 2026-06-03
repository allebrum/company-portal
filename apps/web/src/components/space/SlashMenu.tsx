'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Pilcrow, Heading1, Heading2, Heading3,
  List, ListOrdered, CheckSquare,
  Quote, Sparkles, Minus,
  Target, CheckCircle, Timer, Link as LinkIcon, Image as EmbedIcon, AtSign, Upload,
} from 'lucide-react';

export type SlashCommandId =
  | 'text' | 'h1' | 'h2' | 'h3'
  | 'bullet' | 'numbered' | 'checkbox'
  | 'quote' | 'callout' | 'divider'
  | 'todo' | 'goal' | 'timer' | 'link' | 'embed' | 'mention' | 'upload';

type CommandDef = {
  id: SlashCommandId;
  label: string;
  hint: string;
  group: 'create' | 'heading' | 'block';
  keywords: string[];
  icon: typeof Pilcrow;
};

const COMMANDS: CommandDef[] = [
  { id: 'todo',     label: 'To-do',          hint: 'Create a real to-do, auto-linked',  group: 'create',  keywords: ['todo','task','do'],     icon: CheckCircle },
  { id: 'goal',     label: 'Goal',           hint: 'Create a roadmap goal, auto-linked', group: 'create', keywords: ['goal','milestone'],     icon: Target },
  { id: 'timer',    label: 'Timer',          hint: 'Start a timer for this scope',       group: 'create', keywords: ['timer','track','time'], icon: Timer },
  { id: 'link',     label: 'Link to item',   hint: 'Reference an existing goal/todo/file',group: 'create',keywords: ['link','ref','to'],      icon: LinkIcon },
  { id: 'embed',    label: 'Embed',          hint: 'Embed a URL (Figma, Drive, GitHub…)',group: 'create', keywords: ['embed','url','iframe'], icon: EmbedIcon },
  { id: 'mention',  label: 'Mention a teammate', hint: 'Insert @FirstName',              group: 'create', keywords: ['mention','at','user'],  icon: AtSign },
  { id: 'upload',   label: 'Image/file', hint: 'Insert via modal: computer, QR, or space files', group: 'create', keywords: ['upload','file','image','photo'], icon: Upload },

  { id: 'h1',       label: 'Heading 1',      hint: 'Big section title',                  group: 'heading', keywords: ['h1','heading','title'],   icon: Heading1 },
  { id: 'h2',       label: 'Heading 2',      hint: 'Subsection title',                   group: 'heading', keywords: ['h2','heading'],           icon: Heading2 },
  { id: 'h3',       label: 'Heading 3',      hint: 'Sub-subsection',                     group: 'heading', keywords: ['h3','heading'],           icon: Heading3 },

  { id: 'text',     label: 'Text',           hint: 'Plain paragraph',                    group: 'block', keywords: ['text','paragraph','p'],   icon: Pilcrow },
  { id: 'bullet',   label: 'Bulleted list',  hint: '• item',                             group: 'block', keywords: ['bullet','list','ul'],     icon: List },
  { id: 'numbered', label: 'Numbered list',  hint: '1. item',                            group: 'block', keywords: ['numbered','list','ol'],   icon: ListOrdered },
  { id: 'checkbox', label: 'Checkbox',       hint: 'Visual checkbox row',                group: 'block', keywords: ['check','box','task'],     icon: CheckSquare },
  { id: 'quote',    label: 'Quote',          hint: 'Italic, left-bordered block',        group: 'block', keywords: ['quote','blockquote'],     icon: Quote },
  { id: 'callout',  label: 'Callout',        hint: 'Purple-tinted note',                 group: 'block', keywords: ['callout','note','tip'],   icon: Sparkles },
  { id: 'divider',  label: 'Divider',        hint: 'Horizontal rule',                    group: 'block', keywords: ['divider','hr','line'],    icon: Minus },
];

const GROUP_LABELS: Record<CommandDef['group'], string> = {
  create: 'Create & link',
  heading: 'Headings',
  block: 'Blocks',
};

/**
 * Slash-command popover. Anchored to the screen position of the caret when
 * the user types `/`. Filtering comes from the inline typed token (e.g.
 * `/upl`) so focus stays in the editor and the user can keep typing.
 *
 * Keyboard: ↑↓ to move, Enter to pick, Esc to close. ESC sets a global
 * `data-space-modal-open` body attribute while open so the overlay's ESC
 * handler defers to the menu.
 */
export function SlashMenu({
  open,
  anchorRect,
  query,
  onPick,
  onClose,
}: {
  open: boolean;
  anchorRect: { x: number; y: number } | null;
  query: string;
  onPick: (id: SlashCommandId) => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setActive(0);
      document.body.setAttribute('data-space-modal-open', '1');
    } else {
      document.body.removeAttribute('data-space-modal-open');
    }
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.startsWith(q)),
    );
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        if (filtered.length === 0) return;
        e.preventDefault();
        const cmd = filtered[active];
        if (cmd) onPick(cmd.id);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, filtered, active, onPick, onClose]);

  if (!open || !anchorRect || filtered.length === 0) return null;

  // Group the filtered list so we can render group headings.
  const grouped: { group: CommandDef['group']; items: CommandDef[] }[] = [];
  for (const c of filtered) {
    let g = grouped.find((x) => x.group === c.group);
    if (!g) {
      g = { group: c.group, items: [] };
      grouped.push(g);
    }
    g.items.push(c);
  }

  // Flat index → command (so ↑↓ can move across groups linearly).
  const flat = grouped.flatMap((g) => g.items);

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[300]"
        onClick={onClose}
      />
      <div
        className="fixed z-[301] w-72 bg-white border border-gray-200 shadow-2xl rounded-xl overflow-hidden"
        style={{
          left: Math.min(anchorRect.x, window.innerWidth - 304),
          top: Math.min(anchorRect.y + 6, window.innerHeight - 360),
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className="px-3 py-2 border-b border-gray-100 text-[11px] text-gray-500">
          /{query}
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {grouped.map((g) => (
            <div key={g.group} className="py-1">
              <div className="px-3 pb-1 text-[10px] uppercase tracking-widest font-bold text-gray-400">
                {GROUP_LABELS[g.group]}
              </div>
              {g.items.map((c) => {
                const idx = flat.indexOf(c);
                const isActive = idx === active;
                return (
                  <button
                    key={c.id}
                    type="button"
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
      </div>
    </>,
    document.body,
  );
}
