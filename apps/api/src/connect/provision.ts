import { eq, sql } from 'drizzle-orm';
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

  const composioUserId = client.composioUserId ?? client.id;
  const needsComposio = !client.composioUserId;
  const needsZernio = !client.zernioProfileId && !!env.ZERNIO_API_KEY;

  // Fast path — already provisioned (no write, no lock).
  if (!needsComposio && !needsZernio) {
    return { clientId: client.id, tenantId: client.tenantId, composioUserId, zernioProfileId: client.zernioProfileId };
  }

  // Serialize provisioning PER CLIENT so two concurrent connects can't each
  // create a Zernio profile (TOCTOU → orphaned profile). A per-client advisory
  // lock (xact-scoped) + re-read inside the transaction makes it exactly-once.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'connect:provision:' + clientId}))`);
    const [fresh] = await tx
      .select({ composioUserId: clients.composioUserId, zernioProfileId: clients.zernioProfileId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);

    const updates: Partial<{ composioUserId: string; zernioProfileId: string; updatedAt: string }> = {};
    const cuid = fresh?.composioUserId ?? client.id;
    if (!fresh?.composioUserId) updates.composioUserId = cuid;

    let zpid = fresh?.zernioProfileId ?? null;
    if (!zpid && env.ZERNIO_API_KEY) {
      zpid = await createProfile(client.name, `Modern Zen client portal: ${client.name}`);
      updates.zernioProfileId = zpid;
    }

    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date().toISOString();
      await tx.update(clients).set(updates).where(eq(clients.id, clientId));
    }
    return { clientId: client.id, tenantId: client.tenantId, composioUserId: cuid, zernioProfileId: zpid };
  });
}
