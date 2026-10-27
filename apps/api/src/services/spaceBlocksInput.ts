import { randomUUID } from 'node:crypto';
import type { AppendSpaceBlocksInput, SpaceBlock, UpdateSpaceBlockInput } from '@allebrum/shared';
import { HttpError } from '../middleware/errorHandler.js';

/** Same cap as UpdateClientSchema/UpdateProjectSchema `spaceBlocks.max`. */
export const MAX_SPACE_BLOCKS = 2000;

export type SpaceKind = 'client' | 'project';

/** Accepts `client(s)` / `project(s)`; null for anything else. */
export function parseSpaceKind(raw: string | undefined): SpaceKind | null {
  if (raw === 'client' || raw === 'clients') return 'client';
  if (raw === 'project' || raw === 'projects') return 'project';
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(s: string | undefined): s is string {
  return !!s && UUID_RE.test(s);
}

/**
 * Turn bot input into stored blocks: fresh server ids, one block per line
 * for line-oriented types (the Notes editor's model), and only the fields
 * meaningful for each type.
 */
export function normalizeAppendBlocks(input: AppendSpaceBlocksInput['blocks'], newId: () => string = randomUUID): SpaceBlock[] {
  const out: SpaceBlock[] = [];
  for (const b of input) {
    const type = b.type ?? 'text';
    if (type === 'divider') {
      out.push({ id: newId(), type: 'divider' });
      continue;
    }
    if (type === 'embed') {
      const url = (b.embedUrl ?? b.content ?? '').trim();
      if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'invalid_embed_url');
      out.push({ id: newId(), type: 'embed', embedUrl: url, embedKind: b.embedKind ?? 'link', content: '' });
      continue;
    }
    const lines = (b.content ?? '').replace(/\r\n?/g, '\n').split('\n');
    for (const line of lines) {
      const block: SpaceBlock = { id: newId(), type, content: line };
      if (type === 'checkbox') block.checked = b.checked ?? false;
      out.push(block);
    }
  }
  return out;
}


const LINKED_TYPES = new Set(['todo', 'goal', 'link', 'timer']);

/** Pure: apply a single-block patch (exported for tests). */
export function applyBlockPatch(prev: SpaceBlock, patch: UpdateSpaceBlockInput): SpaceBlock {
  if (LINKED_TYPES.has(prev.type)) throw new HttpError(400, 'linked_block_not_editable');
  const type = patch.type ?? prev.type;
  if (type === 'divider') return { id: prev.id, type: 'divider' };
  if (type === 'embed') {
    const url = (patch.embedUrl ?? prev.embedUrl ?? '').trim();
    if (!/^https?:\/\//i.test(url)) throw new HttpError(400, 'invalid_embed_url');
    return { id: prev.id, type: 'embed', embedUrl: url, embedKind: prev.embedKind ?? 'link', content: '' };
  }
  const content = patch.content ?? prev.content ?? '';
  if (content.includes('\n')) throw new HttpError(400, 'single_line_content_required');
  const out: SpaceBlock = { id: prev.id, type, content };
  if (type === 'checkbox') out.checked = patch.checked ?? prev.checked ?? false;
  return out;
}
