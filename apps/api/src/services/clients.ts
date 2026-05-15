import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, type Client } from '../db/schema.js';
import type { CreateClientInput, UpdateClientInput } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';

export async function listClients(): Promise<Client[]> {
  return db.select().from(clients).orderBy(asc(clients.name));
}

export async function createClient(input: CreateClientInput, whoId: string): Promise<Client> {
  const [row] = await db.insert(clients).values(input).returning();
  if (!row) throw new Error('client insert failed');
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
  const [row] = await db.update(clients).set(upd).where(eq(clients.id, id)).returning();
  if (!row) throw new HttpError(404, 'client_not_found');
  emit.toOrg(EV.CLIENT_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'client.update', target: `${row.name} updated` });
  return row;
}
