import type { SpaceBlock } from '@allebrum/shared';
import { mergeBlocks, sameBlocks } from './merge';

/**
 * Unsaved Notes kept on this device when the session ends mid-edit.
 *
 * If a save comes back 401 (or edits are still waiting to go out when the
 * session is declared over), the editor's newest blocks and the snapshot
 * they were based on are written to localStorage, keyed by user + Space.
 * After signing back in, opening that Space three-way merges the draft
 * onto the current server copy (same rules as a 409 merge, so a bot's
 * blocks added meanwhile survive) and saves it. Drafts are per user, so a
 * different person signing in on the same browser never sees them, and
 * they expire after a week.
 */

export type NotesDraft = {
  v: 1;
  /** The editor's blocks that never reached the server. */
  blocks: SpaceBlock[];
  /** The last server copy those edits were based on (merge base). */
  base: SpaceBlock[];
  baseUpdatedAt: string | null;
  savedAt: number;
};

export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function draftKey(userId: string, kind: string, id: string): string {
  return `allebrum:notes-draft:v1:${userId}:${kind}:${id}`;
}

function storage(): DraftStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // storage disabled (privacy mode, quota policy)
  }
}

export function saveDraft(
  key: string,
  d: Omit<NotesDraft, 'v' | 'savedAt'>,
  store: DraftStorage | null = storage(),
  now = Date.now(),
): boolean {
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify({ v: 1, ...d, savedAt: now } satisfies NotesDraft));
    return true;
  } catch {
    return false; // quota exceeded: nothing more we can do
  }
}

/** Read and remove a draft. Expired or malformed drafts are discarded. */
export function takeDraft(key: string, store: DraftStorage | null = storage(), now = Date.now()): NotesDraft | null {
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
  try {
    const d = JSON.parse(raw) as NotesDraft;
    if (d?.v !== 1 || !Array.isArray(d.blocks) || !Array.isArray(d.base)) return null;
    if (typeof d.savedAt !== 'number' || now - d.savedAt > DRAFT_TTL_MS) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Fold a draft onto the server's current blocks. Returns null when the
 * draft holds nothing the server doesn't already have.
 */
export function applyDraft(draft: NotesDraft, server: SpaceBlock[]): SpaceBlock[] | null {
  if (sameBlocks(draft.blocks, draft.base)) return null;
  const merged = mergeBlocks(draft.base, draft.blocks, server);
  return sameBlocks(merged, server) ? null : merged;
}
