import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { env } from '../env.js';
import { createProfile } from './zernio.js';

// One stable client → one Composio user → one Zernio profile.
//   - composio_user_id = the client's own id (Composio users exist implicitly
//     the first time you open a session for them — no API call needed).
//   - zernio_profile_id = created once via the Zernio API (only when Zernio is
//     configured; otherwise left null and created on first Zernio connect).
// Idempotent: safe to call on every connect attempt / portal load.

export interface Provisioned {
  clientId: string;
  tenantId: string | null;
  composioUserId: string;
  zernioProfileId: string | null;
}

export async function ensureProvisioned(clientId: string): Promise<Provisioned> {
  const [client] = await db
    .select({
      id: clients.id,
      name: clients.name,
      tenantId: clients.tenantId,
      composioUserId: clients.composioUserId,
      zernioProfileId: clients.zernioProfileId,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  if (!client) throw new Error('client_not_found');

  const updates: Partial<{ composioUserId: string; zernioProfileId: string; updatedAt: string }> = {};

  // Composio user id is simply the client id (stable, server-derived).
  const composioUserId = client.composioUserId ?? client.id;
  if (!client.composioUserId) updates.composioUserId = composioUserId;

  // Create the Zernio profile lazily, only when Zernio is configured.
  let zernioProfileId = client.zernioProfileId;
  if (!zernioProfileId && env.ZERNIO_API_KEY) {
    zernioProfileId = await createProfile(client.name, `Modern Zen client portal: ${client.name}`);
    updates.zernioProfileId = zernioProfileId;
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date().toISOString();
    await db.update(clients).set(updates).where(eq(clients.id, client.id));
  }

  return { clientId: client.id, tenantId: client.tenantId, composioUserId, zernioProfileId };
}
