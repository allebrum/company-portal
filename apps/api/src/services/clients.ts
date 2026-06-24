import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, type Client } from '../db/schema.js';
import type { CreateClientInput, UpdateClientInput } from '@modernzen/shared';
import { emit } from '../realtime/emit.js';
import { EV } from '@modernzen/shared';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { isConnected as driveIsConnected, ensureClientFolder } from './drive.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

export async function listClients(): Promise<Client[]> {
  return db.select().from(clients).where(tenantEq(clients.tenantId)).orderBy(asc(clients.name));
}

export async function createClient(input: CreateClientInput, whoId: string): Promise<Client> {
  const [inserted] = await db.insert(clients).values(stampTenant(input)).returning();
  if (!inserted) throw new Error('client insert failed');
  let row = inserted;

  // Best-effort: create a Drive folder for this client under the shared
  // portal root. Delegates to `ensureClientFolder`, which is race-safe —
  // if a concurrent request beats us, it cleans up its own orphan and
  // returns the canonical ID. Failure (Drive disconnected, API error)
  // leaves `driveFolderId` null; uploads will lazily create on demand.
  try {
    if (await driveIsConnected()) {
      const folderId = await ensureClientFolder(row.id);
      const [updated] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, row.id), tenantEq(clients.tenantId)))
        .limit(1);
      if (updated) row = updated;
      void folderId;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[drive] failed to create folder for client "${row.name}":`, e instanceof Error ? e.message : e);
  }

  emit.toOrg(EV.CLIENT_CREATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'client.create', target: `${row.name} added` });
  return row;
}

export async function updateClient(
  id: string,
  patch: UpdateClientInput,
  whoId: string,
): Promise<Client> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.kind !== undefined) upd.kind = patch.kind;
  if (patch.color !== undefined) upd.color = patch.color;
  if (patch.clientOverview !== undefined) upd.clientOverview = patch.clientOverview;
  if (patch.spaceBlocks !== undefined) upd.spaceBlocks = patch.spaceBlocks;
  if (patch.spaceFiles !== undefined) upd.spaceFiles = patch.spaceFiles;
  // F23 client portal config — slug uniqueness is enforced by the
  // DB; PG returns 23505 on collision which the error handler maps to
  // a friendly 409. portalPublishedAt is the publish toggle (null =
  // draft / 404 publicly, non-null = live).
  if (patch.portalSlug !== undefined) upd.portalSlug = patch.portalSlug;
  if (patch.portalPublishedAt !== undefined) upd.portalPublishedAt = patch.portalPublishedAt;
  const [row] = await db
    .update(clients)
    .set(upd)
    .where(and(eq(clients.id, id), tenantEq(clients.tenantId)))
    .returning();
  if (!row) throw new HttpError(404, 'client_not_found');
  emit.toOrg(EV.CLIENT_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'client.update', target: `${row.name} updated` });
  return row;
}
