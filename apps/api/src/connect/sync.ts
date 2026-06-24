import { env } from '../env.js';
import { listConnections, upsertConnection, markConnectionStatus } from './connections.js';
import { listConnected as composioListConnected } from './composio.js';
import { listAccounts as zernioListAccounts } from './zernio.js';

// Re-read both providers (the sources of truth) and reconcile our `connections`
// cache: upsert live accounts with their current status, and mark cached
// connections that no longer exist provider-side as 'revoked'. This is how we
// surface provider-side revocation (token expiry, user-revoked) without a
// webhook — invoked from the portal "Refresh" action. (Webhooks —
// Composio expiry events, Zernio account.disconnected — are the future
// real-time path.)
export async function syncClientConnections(args: {
  clientId: string;
  tenantId: string | null;
  composioUserId: string;
  zernioProfileId: string | null;
}): Promise<void> {
  const existing = await listConnections(args.clientId);

  if (env.COMPOSIO_API_KEY) {
    try {
      const accounts = await composioListConnected(args.composioUserId);
      const live = new Set(accounts.map((a) => a.id));
      for (const a of accounts) {
        await upsertConnection({
          clientId: args.clientId,
          tenantId: args.tenantId,
          provider: 'composio',
          externalId: a.id,
          integration: a.toolkit,
          status: a.status.toLowerCase() === 'active' ? 'active' : a.status.toLowerCase(),
        });
      }
      for (const c of existing.filter((x) => x.provider === 'composio')) {
        if (!live.has(c.externalId)) await markConnectionStatus(args.clientId, 'composio', c.externalId, 'revoked');
      }
    } catch {
      /* provider read failed — leave the cache untouched */
    }
  }

  if (env.ZERNIO_API_KEY && args.zernioProfileId) {
    try {
      const accounts = await zernioListAccounts(args.zernioProfileId);
      const live = new Set(accounts.map((a) => a._id));
      for (const a of accounts) {
        const s = (a.status ?? 'connected').toLowerCase();
        await upsertConnection({
          clientId: args.clientId,
          tenantId: args.tenantId,
          provider: 'zernio',
          externalId: a._id,
          integration: a.platform,
          displayName: a.username ?? null,
          status: s === 'connected' ? 'active' : s,
        });
      }
      for (const c of existing.filter((x) => x.provider === 'zernio')) {
        if (!live.has(c.externalId)) await markConnectionStatus(args.clientId, 'zernio', c.externalId, 'revoked');
      }
    } catch {
      /* leave the cache untouched */
    }
  }
}
