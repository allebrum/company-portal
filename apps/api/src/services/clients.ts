import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, type Client } from '../db/schema.js';
import type { CreateClientInput, UpdateClientInput } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { isConnected as driveIsConnected, ensureSharedFolder, createFolder as driveCreateFolder } from './drive.js';

export async function listClients(): Promise<Client[]> {
  return db.select().from(clients).orderBy(asc(clients.name));
}

export async function createClient(input: CreateClientInput, whoId: string): Promise<Client> {
  const [inserted] = await db.insert(clients).values(input).returning();
  if (!inserted) throw new Error('client insert failed');
  let row = inserted;

  // Best-effort: create a Drive folder for this client under the shared
  // portal root. If Drive isn't connected or the API call fails, the
  // client is still returned — driveFolderId stays null. Projects created
  // under a folder-less client will not get sub-folders either ("going
  // forward only" semantics for the auto-folder feature).
  try {
    if (await driveIsConnected()) {
      const rootId = await ensureSharedFolder();
      const folder = await driveCreateFolder(rootId, row.name);
      const [updated] = await db
        .update(clients)
        .set({ driveFolderId: folder.id, updatedAt: new Date().toISOString() })
        .where(eq(clients.id, row.id))
        .returning();
      if (updated) row = updated;
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
  if (patch.spaceBlocks !== undefined) upd.spaceBlocks = patch.spaceBlocks;
  if (patch.spaceFiles !== undefined) upd.spaceFiles = patch.spaceFiles;
  const [row] = await db.update(clients).set(upd).where(eq(clients.id, id)).returning();
  if (!row) throw new HttpError(404, 'client_not_found');
  emit.toOrg(EV.CLIENT_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'client.update', target: `${row.name} updated` });
  return row;
}
