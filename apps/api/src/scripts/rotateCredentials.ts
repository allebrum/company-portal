/**
 * Re-encrypt every stored project/client credential onto the ACTIVE key.
 *
 *   pnpm --filter @allebrum/api credentials:rotate            # dry run (counts only)
 *   pnpm --filter @allebrum/api credentials:rotate --apply    # write
 *
 * Rotation procedure (docs/CREDENTIALS.md):
 *   1. Add a new kid to CREDENTIALS_KEYS (keep the old one), e.g.
 *      `k1:OLD,k2:NEW` (JSON `{"k1":"...","k2":"..."}` is also accepted),
 *      set CREDENTIALS_ACTIVE_KID to the new kid, deploy. New writes use it.
 *   2. Run this with --apply (DigitalOcean App Platform → Console on the API
 *      component). It decrypts each value with its own kid and re-encrypts
 *      it with the active kid, row by row, with the same AAD binding.
 *   3. When it reports 0 remaining, remove the old kid and deploy again.
 *
 * Prints counts only — never plaintext, ciphertext or key material. Runs
 * across all workspaces (no tenant context), so it is an operator tool.
 */
import { and, asc, eq, gt } from 'drizzle-orm';
import { db, sqlClient } from '../db/client.js';
import { credentials } from '../db/schema.js';
import { env } from '../env.js';
import { kidOf, parseKeyset, rotateField, type Keyset } from '../lib/crypto.js';

const FIELDS = [
  ['secret', 'secretEnc'],
  ['notes', 'notesEnc'],
  ['totp', 'totpEnc'],
] as const;

export interface RotateStats {
  rows: number;
  values: number;
  rotated: number;
  alreadyActive: number;
  failed: number;
  byKid: Record<string, number>;
}

type Row = { id: string; tenantId: string; secretEnc: string | null; notesEnc: string | null; totpEnc: string | null };

/** Pure per-row step (exported for tests): returns the column patch, or null when nothing changes. */
export function rotateRow(row: Row, keyset: Keyset, stats: RotateStats): Partial<Row> | null {
  const patch: Partial<Row> = {};
  for (const [field, col] of FIELDS) {
    const blob = row[col];
    if (!blob) continue;
    stats.values += 1;
    try {
      const kid = kidOf(blob);
      stats.byKid[kid] = (stats.byKid[kid] ?? 0) + 1;
      const next = rotateField(blob, { tenantId: row.tenantId, rowId: row.id, field }, keyset);
      if (next === null) stats.alreadyActive += 1;
      else {
        patch[col] = next;
        stats.rotated += 1;
      }
    } catch {
      stats.failed += 1;
    }
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const keyset = parseKeyset(env.CREDENTIALS_KEYS, env.CREDENTIALS_ACTIVE_KID);
  const stats: RotateStats = { rows: 0, values: 0, rotated: 0, alreadyActive: 0, failed: 0, byKid: {} };
  let cursor = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const batch = await db
      .select({
        id: credentials.id,
        tenantId: credentials.tenantId,
        secretEnc: credentials.secretEnc,
        notesEnc: credentials.notesEnc,
        totpEnc: credentials.totpEnc,
      })
      .from(credentials)
      .where(gt(credentials.id, cursor))
      .orderBy(asc(credentials.id))
      .limit(200);
    if (batch.length === 0) break;
    for (const row of batch) {
      stats.rows += 1;
      const patch = rotateRow(row, keyset, stats);
      if (patch && apply) {
        await db
          .update(credentials)
          .set(patch)
          .where(and(eq(credentials.id, row.id), eq(credentials.tenantId, row.tenantId)));
      }
    }
    cursor = batch[batch.length - 1]!.id;
  }
  const kids = Object.entries(stats.byKid).map(([k, n]) => `${k}=${n}`).join(', ') || 'none';
  // eslint-disable-next-line no-console
  console.log(
    `[credentials:rotate] ${apply ? 'APPLIED' : 'dry run'} — active kid ${keyset.activeKid}; rows ${stats.rows}, ` +
      `values ${stats.values} (by kid before: ${kids}); ${apply ? 'rotated' : 'would rotate'} ${stats.rotated}, ` +
      `already active ${stats.alreadyActive}, failed ${stats.failed}`,
  );
  if (stats.failed > 0) process.exitCode = 2;
}

const isMain = process.argv[1] && /rotateCredentials\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  main()
    .then(async () => {
      await sqlClient.end();
    })
    .catch(async (err) => {
      // eslint-disable-next-line no-console
      console.error('[credentials:rotate] failed:', err instanceof Error ? err.message : 'unknown error');
      await sqlClient.end().catch(() => undefined);
      process.exit(1);
    });
}
