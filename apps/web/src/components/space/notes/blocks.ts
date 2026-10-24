/**
 * Pure block-model helpers for the Notes canvas: the reducer, the
 * one-line-per-block migration, markdown shortcuts, and slash-token
 * detection. Kept DOM-free so they can be unit tested with `node --test`.
 */
import type { SpaceBlock } from '@allebrum/shared';
import { mergeBlocks } from './merge';

export type BlockType = SpaceBlock['type'];

export const EDITABLE_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  'text', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'checkbox', 'quote', 'callout',
]);
export const LIST_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['bullet', 'numbered', 'checkbox']);
/** Types whose content may legitimately hold soft line breaks (Shift+Enter). */
export const MULTILINE_TYPES: ReadonlySet<BlockType> = new Set<BlockType>(['quote', 'callout']);

export const isEditable = (b: Pick<SpaceBlock, 'type'>): boolean => EDITABLE_TYPES.has(b.type);
export const isList = (t: BlockType): boolean => LIST_TYPES.has(t);
export const isEmptyContent = (s: string | undefined | null): boolean =>
  (s ?? '').replace(/\u200B/g, '') === '';

export const blockId = (): string => Math.random().toString(36).slice(2, 11);
export const emptyText = (): SpaceBlock => ({ id: blockId(), type: 'text', content: '' });

// ----------------------------------------------------------------------------
// Reducer
// ----------------------------------------------------------------------------

export type Action =
  | { type: 'init'; blocks: SpaceBlock[] }
  | { type: 'replace'; blocks: SpaceBlock[] }
  | { type: 'insert'; after: string | null; block: SpaceBlock }
  | { type: 'insertMany'; after: string | null; blocks: SpaceBlock[] }
  | { type: 'insertBefore'; before: string; block: SpaceBlock }
  | { type: 'remove'; id: string }
  | { type: 'patch'; id: string; patch: Partial<SpaceBlock> }
  | { type: 'move'; id: string; target: string; position: 'before' | 'after' }
  /** Fold a newer server copy into the live state (see notes/merge.ts). */
  | { type: 'merge'; base: SpaceBlock[]; server: SpaceBlock[] };

export function reducer(state: SpaceBlock[], action: Action): SpaceBlock[] {
  switch (action.type) {
    case 'init':
    case 'replace':
      return action.blocks;
    case 'insert':
    case 'insertMany': {
      const items = action.type === 'insert' ? [action.block] : action.blocks;
      const next = [...state];
      const i = action.after == null ? -1 : next.findIndex((b) => b.id === action.after);
      // Unknown anchor (e.g. deleted meanwhile) → append rather than prepend.
      const at = action.after != null && i === -1 ? next.length : i + 1;
      next.splice(at, 0, ...items);
      return next;
    }
    case 'insertBefore': {
      const next = [...state];
      const i = next.findIndex((b) => b.id === action.before);
      next.splice(i === -1 ? 0 : i, 0, action.block);
      return next;
    }
    case 'remove':
      return state.filter((b) => b.id !== action.id);
    case 'patch':
      return state.map((b) => (b.id === action.id ? { ...b, ...action.patch } : b));
    case 'move': {
      if (action.id === action.target) return state;
      const moving = state.find((b) => b.id === action.id);
      if (!moving) return state;
      const rest = state.filter((b) => b.id !== action.id);
      const ti = rest.findIndex((b) => b.id === action.target);
      if (ti === -1) return state;
      rest.splice(action.position === 'before' ? ti : ti + 1, 0, moving);
      return rest;
    }
    case 'merge':
      return mergeBlocks(action.base, state, action.server);
    default:
      return state;
  }
}

// ----------------------------------------------------------------------------
// Migration: one line per block
// ----------------------------------------------------------------------------

/**
 * Older canvases let native contentEditable Enter add lines *inside* a text
 * block. Split those into one block per line (the first keeps its id) so
 * every line gets its own placeholder, gutter handle, and slash menu.
 * Trailing empty lines (often an innerText artifact) are dropped. Always
 * returns a new array.
 */
export function migrateBlocks(blocks: SpaceBlock[], makeId: () => string = blockId): SpaceBlock[] {
  const out: SpaceBlock[] = [];
  for (const b of blocks) {
    const content = (b.content ?? '').replace(/\u200B/g, '').replace(/\r\n?/g, '\n');
    if (b.type !== 'text' || !content.includes('\n')) {
      out.push(content === (b.content ?? '') ? b : { ...b, content });
      continue;
    }
    const lines = content.split('\n');
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    lines.forEach((line, i) => {
      out.push(i === 0 ? { ...b, content: line } : { id: makeId(), type: 'text', content: line });
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Markdown shortcuts
// ----------------------------------------------------------------------------

export type MarkdownShortcut = { kind: 'type'; type: BlockType; strip: number } | { kind: 'divider' };

const SHORTCUTS: Array<{ re: RegExp; type: BlockType }> = [
  { re: /^###\s$/, type: 'h3' },
  { re: /^##\s$/, type: 'h2' },
  { re: /^#\s$/, type: 'h1' },
  { re: /^[-*]\s$/, type: 'bullet' },
  { re: /^1[.)]\s$/, type: 'numbered' },
  { re: /^\[\s?\]\s$/, type: 'checkbox' },
  { re: /^>\s$/, type: 'quote' },
];

/**
 * Detect a markdown shortcut typed at the start of a plain text block.
 * `caret` is the offset right after the character just typed.
 */
export function matchMarkdownShortcut(text: string, caret: number): MarkdownShortcut | null {
  const before = text.slice(0, caret);
  if (text === '---' && caret === 3) return { kind: 'divider' };
  for (const s of SHORTCUTS) {
    if (s.re.test(before)) return { kind: 'type', type: s.type, strip: before.length };
  }
  return null;
}

// ----------------------------------------------------------------------------
// Slash token
// ----------------------------------------------------------------------------

/**
 * Find a `/command` token ending at the caret. Requires start-of-text or
 * whitespace before `/` so dates like 06/05 and URLs don't open the menu.
 */
export function findSlashToken(text: string, caret: number): { query: string; tokenStart: number } | null {
  const before = text.slice(0, caret);
  const m = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  if (!m) return null;
  const query = m[1] ?? '';
  return { query, tokenStart: caret - query.length - 1 };
}

/**
 * Remove the `/query` token from `content`. Uses the recorded tokenStart
 * when the token is still there; otherwise falls back to a trailing token.
 */
export function removeSlashToken(content: string, tokenStart: number, query: string): { content: string; caret: number } {
  const token = `/${query}`;
  if (tokenStart >= 0 && content.slice(tokenStart, tokenStart + token.length) === token) {
    return { content: content.slice(0, tokenStart) + content.slice(tokenStart + token.length), caret: tokenStart };
  }
  const m = /(^|\s)\/[^\s/]*$/.exec(content);
  if (m) {
    const at = m.index + (m[1]?.length ?? 0);
    return { content: content.slice(0, at), caret: at };
  }
  return { content, caret: content.length };
}

// ----------------------------------------------------------------------------
// Paste
// ----------------------------------------------------------------------------

/** Normalize pasted plain text into lines (CRLF → LF, ZWSP/NBSP cleaned). */
export function pastedLines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').replace(/\u200B/g, '').replace(/\u00A0/g, ' ').split('\n');
}

// ----------------------------------------------------------------------------
// Slash menu fuzzy matching
// ----------------------------------------------------------------------------

/**
 * Score how well `query` matches `candidate` (higher is better, 0 = no
 * match): prefix > word-prefix > substring > in-order subsequence.
 */
export function fuzzyScore(query: string, candidate: string): number {
  const q = query.trim().toLowerCase();
  const c = candidate.toLowerCase();
  if (!q) return 1;
  if (c.startsWith(q)) return 100 - Math.min(50, c.length - q.length);
  if (c.split(/[\s/-]+/).some((w) => w.startsWith(q))) return 70;
  if (c.includes(q)) return 50;
  let i = 0;
  let gaps = 0;
  let last = -1;
  for (let j = 0; j < c.length && i < q.length; j++) {
    if (c[j] === q[i]) {
      if (last !== -1 && j - last > 1) gaps++;
      last = j;
      i++;
    }
  }
  if (i < q.length) return 0;
  return Math.max(1, 30 - gaps * 5);
}
