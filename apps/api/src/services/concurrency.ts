import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, projects } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq } from '../tenancy/scope.js';

/**
 * Called after a conditional (`updated_at = expected`) UPDATE matched no
 * rows: if the row exists, someone else wrote it first → 409 with the
 * current `updatedAt` so the caller can refetch/merge. If it doesn't exist,
 * return and let the caller throw its 404.
 */
export async function throwIfStale(table: typeof clients | typeof projects, id: string, _notFound: string): Promise<void> {
  const [row] = await db
    .select({ updatedAt: table.updatedAt })
    .from(table)
    .where(and(eq(table.id, id), tenantEq(table.tenantId)))
    .limit(1);
  if (row) throw new HttpError(409, 'stale_update', { updatedAt: row.updatedAt });
}
