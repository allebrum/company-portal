/**
 * Three-way merge for the Notes canvas, so an open editor and a bot (or
 * another tab) can both write to a Space without one wiping the other.
 *
 *   base   – the blocks this editor last synced with the server
 *   local  – what the editor holds now (base + the user's edits)
 *   server – what the server holds now (base + everyone else's edits)
 *
 * Rules (per block id):
 *   - Local order is kept, and local edits always win. If both sides changed
 *     the same block, the local version is the one that survives.
 *   - A block the user deleted (in base, missing locally) stays deleted, even
 *     if the server changed it meanwhile.
 *   - A block only the server changed (local still equals base) takes the
 *     server version.
 *   - A block the server deleted is dropped locally too, unless the user
 *     edited it (then the edit wins and the block is kept).
 *   - Blocks new on the server (not in base) are inserted at their server
 *     position: right after the nearest preceding server block the editor
 *     still has, else right before the nearest following one, else at the end.
 *
 * Pure and DOM-free (unit tested with `node --test`). Returns `local`
 * itself when nothing changes so callers can skip a re-render.
 */
import type { SpaceBlock } from '@allebrum/shared';

/** Field-wise equality; `undefined` and `null` count as the same (absent). */
export function sameBlock(a: SpaceBlock, b: SpaceBlock): boolean {
  if (a === b) return true;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    const va = ra[k];
    const vb = rb[k];
    if (va === vb) continue;
    if (va == null && vb == null) continue;
    return false;
  }
  return true;
}

export function sameBlocks(a: readonly SpaceBlock[], b: readonly SpaceBlock[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!sameBlock(a[i]!, b[i]!)) return false;
  return true;
}

export function mergeBlocks(
  base: readonly SpaceBlock[],
  local: SpaceBlock[],
  server: readonly SpaceBlock[],
): SpaceBlock[] {
  const baseById = new Map(base.map((b) => [b.id, b]));
  const serverById = new Map(server.map((b) => [b.id, b]));
  let changed = false;

  const out: SpaceBlock[] = [];
  for (const l of local) {
    const b = baseById.get(l.id);
    if (!b) {
      out.push(l); // new locally (an id clash with a new server block: local wins)
      continue;
    }
    const s = serverById.get(l.id);
    const editedLocally = !sameBlock(l, b);
    if (!s) {
      if (editedLocally) out.push(l); // server deleted it, but the local edit wins
      else changed = true; // respect the server delete
      continue;
    }
    if (!editedLocally && !sameBlock(s, b)) {
      out.push(s); // only the server changed it
      changed = true;
      continue;
    }
    out.push(l);
  }

  const present = new Set(out.map((b) => b.id));
  const indexOf = (id: string) => (present.has(id) ? out.findIndex((b) => b.id === id) : -1);
  server.forEach((s, i) => {
    // In base → either kept above or deleted locally on purpose.
    if (baseById.has(s.id) || present.has(s.id)) return;
    let at = -1;
    for (let j = i - 1; j >= 0 && at === -1; j--) {
      const k = indexOf(server[j]!.id);
      if (k !== -1) at = k + 1;
    }
    for (let j = i + 1; j < server.length && at === -1; j++) {
      const k = indexOf(server[j]!.id);
      if (k !== -1) at = k;
    }
    if (at === -1) at = out.length;
    out.splice(at, 0, s);
    present.add(s.id);
    changed = true;
  });

  return changed ? out : local;
}

/** Row versions are Postgres timestamptz text ("2026-10-24 09:05:22.936-07")
 *  or ISO strings; compare them as instants. */
export function versionMs(v: string | null | undefined): number {
  if (!v) return Number.NEGATIVE_INFINITY;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(v.trim());
  if (!m) return Date.parse(v);
  const frac = m[3] ? m[3].slice(0, 4).padEnd(4, '0') : '.000';
  let tz = m[4] ?? 'Z';
  if (/^[+-]\d{2}$/.test(tz)) tz += ':00';
  else if (/^[+-]\d{4}$/.test(tz)) tz = `${tz.slice(0, 3)}:${tz.slice(3)}`;
  return Date.parse(`${m[1]}T${m[2]}${frac}${tz}`);
}
export const isNewerVersion = (a: string | null | undefined, b: string | null | undefined) =>
  a !== b && versionMs(a) > versionMs(b);
