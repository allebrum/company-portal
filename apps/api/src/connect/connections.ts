import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { connections, type Connection } from '../db/schema.js';

// Cache of a client's connected provider accounts. The unique key is
// (client_id, provider, external_id) — re-connecting the same account updates
// the existing row rather than duplicating it.

export interface UpsertConnectionInput {
  clientId: string;
  tenantId: string | null;
  provider: 'composio' | 'zernio';
  externalId: string;
  integration: string;
  displayName?: string | null;
  status?: string;
}

export async function upsertConnection(input: UpsertConnectionInput): Promise<void> {
  await db
    .insert(connections)
    .values({
      clientId: input.clientId,
      tenantId: input.tenantId,
      provider: input.provider,
      externalId: input.externalId,
      integration: input.integration,
      displayName: input.displayName ?? null,
      status: input.status ?? 'active',
      connectedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [connections.clientId, connections.provider, connections.externalId],
      set: {
        integration: input.integration,
        displayName: input.displayName ?? null,
        status: input.status ?? 'active',
        connectedAt: new Date().toISOString(),
      },
    });
}

/** A single connection, scoped to its owning client (null if not theirs). */
export async function getConnection(clientId: string, id: string): Promise<Connection | undefined> {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, id), eq(connections.clientId, clientId)))
    .limit(1);
  return row;
}

export async function listConnections(clientId: string): Promise<Connection[]> {
  return db
    .select()
    .from(connections)
    .where(eq(connections.clientId, clientId))
    .orderBy(desc(connections.connectedAt));
}

export async function markConnectionStatus(
  clientId: string,
  provider: 'composio' | 'zernio',
  externalId: string,
  status: string,
): Promise<void> {
  await db
    .update(connections)
    .set({ status })
    .where(
      and(
        eq(connections.clientId, clientId),
        eq(connections.provider, provider),
        eq(connections.externalId, externalId),
      ),
    );
}

export async function deleteConnection(
  clientId: string,
  provider: 'composio' | 'zernio',
  externalId: string,
): Promise<void> {
  await db
    .delete(connections)
    .where(
      and(
        eq(connections.clientId, clientId),
        eq(connections.provider, provider),
        eq(connections.externalId, externalId),
      ),
    );
}
