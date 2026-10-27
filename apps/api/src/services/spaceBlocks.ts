import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, projects } from '../db/schema.js';
import { EV, type AppendSpaceBlocksInput, type SpaceBlock, type UpdateSpaceBlockInput } from '@allebrum/shared';
import { MAX_SPACE_BLOCKS, applyBlockPatch, normalizeAppendBlocks, type SpaceKind } from './spaceBlocksInput.js';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq } from '../tenancy/scope.js';

export { parseSpaceKind, isUuid } from './spaceBlocksInput.js';

function tableFor(kind: SpaceKind) {
  return kind === 'client' ? clients : projects;
}

export async function getSpaceBlocks(kind: SpaceKind, id: string) {
  const t = tableFor(kind);
  const [row] = await db
    .select({ id: t.id, name: t.name, spaceBlocks: t.spaceBlocks, updatedAt: t.updatedAt })
    .from(t)
    .where(and(eq(t.id, id), tenantEq(t.tenantId)))
    .limit(1);
  if (!row) throw new HttpError(404, `${kind}_not_found`);
  return { id: row.id, name: row.name, blocks: (row.spaceBlocks ?? []) as SpaceBlock[], updatedAt: row.updatedAt };
}

/**
 * Append blocks to the end of a Space's Notes in one atomic UPDATE (JSONB
 * concatenation), so concurrent appends never lose each other and existing
 * blocks are never rewritten.
 */
export async function appendSpaceBlocks(kind: SpaceKind, id: string, input: AppendSpaceBlocksInput['blocks'], whoId: string) {
  const blocks = normalizeAppendBlocks(input);
  if (blocks.length > MAX_SPACE_BLOCKS) throw new HttpError(413, 'too_many_blocks');
  const t = tableFor(kind);
  const [row] = await db
    .update(t)
    .set({
      spaceBlocks: sql`coalesce(${t.spaceBlocks}, '[]'::jsonb) || ${JSON.stringify(blocks)}::jsonb`,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(t.id, id),
        tenantEq(t.tenantId),
        sql`jsonb_array_length(coalesce(${t.spaceBlocks}, '[]'::jsonb)) + ${blocks.length} <= ${MAX_SPACE_BLOCKS}`,
      ),
    )
    .returning({ id: t.id, name: t.name, updatedAt: t.updatedAt, total: sql<number>`jsonb_array_length(${t.spaceBlocks})` });
  if (!row) {
    // Distinguish "not found" from "full".
    await getSpaceBlocks(kind, id);
    throw new HttpError(413, 'space_notes_full');
  }
  emit.toOrg(kind === 'client' ? EV.CLIENT_UPDATED : EV.PROJECT_UPDATED, {
    id: row.id,
    by: whoId,
    at: new Date().toISOString(),
  });
  emit.spaceBlocksUpdated({ kind, id: row.id, updatedAt: String(row.updatedAt), by: whoId, source: 'append' });
  await appendActivity({ whoId, kind: `${kind}.update`, target: `${row.name} notes updated` });
  return { id: row.id, appended: blocks, total: Number(row.total), updatedAt: row.updatedAt };
}

/**
 * Edit or delete ONE Notes block by id, leaving every other block untouched.
 * Read-modify-write guarded by `updated_at` (compare-and-swap), retried a few
 * times so a concurrent edit elsewhere in the same Space never gets lost.
 * Linked cards (todo/goal/timer/link) can be deleted but not edited here.
 */
export async function mutateSpaceBlock(
  kind: SpaceKind,
  id: string,
  blockId: string,
  op: { kind: 'update'; patch: UpdateSpaceBlockInput } | { kind: 'delete' },
  whoId: string,
): Promise<{ id: string; block: SpaceBlock | null; total: number; updatedAt: string }> {
  const t = tableFor(kind);
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await getSpaceBlocks(kind, id);
    const idx = cur.blocks.findIndex((b) => b.id === blockId);
    if (idx < 0) throw new HttpError(404, 'block_not_found');
    const next = [...cur.blocks];
    let block: SpaceBlock | null = null;
    if (op.kind === 'delete') {
      next.splice(idx, 1);
    } else {
      block = applyBlockPatch(next[idx]!, op.patch);
      next[idx] = block;
    }
    const now = new Date().toISOString();
    const [row] = await db
      .update(t)
      .set({ spaceBlocks: next, updatedAt: now })
      .where(and(eq(t.id, id), tenantEq(t.tenantId), sql`${t.updatedAt} = ${cur.updatedAt}::timestamptz`))
      .returning({ id: t.id, name: t.name, updatedAt: t.updatedAt });
    if (!row) continue; // lost a race — re-read and retry
    emit.toOrg(kind === 'client' ? EV.CLIENT_UPDATED : EV.PROJECT_UPDATED, { id: row.id, by: whoId, at: now });
    emit.spaceBlocksUpdated({ kind, id: row.id, updatedAt: String(row.updatedAt), by: whoId, source: 'patch' });
    await appendActivity({ whoId, kind: `${kind}.update`, target: `${row.name} notes updated` });
    return { id: row.id, block, total: next.length, updatedAt: String(row.updatedAt) };
  }
  throw new HttpError(409, 'stale_update');
}
