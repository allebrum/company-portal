import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { requireClientPortalAuth } from '../middleware/requireClientPortalAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { ensureProvisioned } from '../connect/provision.js';
import { getConnectUrl } from '../connect/zernio.js';
import { startConnect as composioStartConnect, listConnected as composioListConnected } from '../connect/composio.js';
import { upsertConnection } from '../connect/connections.js';
import { signState, verifyState } from '../connect/oauthState.js';
import { db } from '../db/client.js';
import { clients } from '../db/schema.js';
import { env } from '../env.js';

// Connect routes — derive the client strictly from the authenticated portal
// session (or the signed OAuth state on the public callback); the browser never
// supplies a profileId / user_id. Provider keys stay server-only.

export const connectRouter = Router();

const appUrl = (): string => (env.APP_URL ?? env.WEB_ORIGIN).replace(/\/$/, '');

// ---- Zernio (social channels) -----------------------------------------------

// POST /api/connect/zernio { platform } → { authUrl }  (portal-session gated)
connectRouter.post(
  '/zernio',
  requireClientPortalAuth,
  rateLimit({ key: 'connect-zernio', max: 20, windowSec: 60 }),
  async (req, res, next) => {
    try {
      const sess = req.session.clientPortalSession!;
      const platform = String(req.body?.platform ?? '').trim().toLowerCase();
      if (!platform) {
        res.status(400).json({ error: 'platform_required' });
        return;
      }
      const prov = await ensureProvisioned(sess.clientId);
      if (!prov.zernioProfileId) {
        res.status(503).json({ error: 'zernio_not_configured' });
        return;
      }
      const state = signState({ clientId: sess.clientId, provider: 'zernio', ref: platform });
      const redirectUrl = `${appUrl()}/api/connect/zernio/callback/${state}`;
      const authUrl = await getConnectUrl(prov.zernioProfileId, platform, redirectUrl);
      res.json({ authUrl });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/connect/zernio/callback/:state  (public browser redirect from Zernio;
// authenticated by the signed state, NOT a portal token). Zernio appends
// ?connected={platform}&profileId&accountId&username.
connectRouter.get('/zernio/callback/:state', async (req, res, next) => {
  const fail = (reason: string): void => {
    res.redirect(`${appUrl()}/connections?error=${encodeURIComponent(reason)}`);
  };
  try {
    const state = verifyState(req.params.state);
    if (!state || state.provider !== 'zernio') return fail('bad_state');

    const profileId = typeof req.query.profileId === 'string' ? req.query.profileId : '';
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : '';
    const platform = typeof req.query.connected === 'string' ? req.query.connected : state.ref;
    const username = typeof req.query.username === 'string' ? req.query.username : null;
    if (!profileId || !accountId) return fail('missing_params');

    // The returned profile must belong to the client we signed state for —
    // blocks linking an account to a different client.
    const [client] = await db
      .select({ id: clients.id, tenantId: clients.tenantId, zernioProfileId: clients.zernioProfileId })
      .from(clients)
      .where(eq(clients.id, state.clientId))
      .limit(1);
    if (!client || client.zernioProfileId !== profileId) return fail('profile_mismatch');

    await upsertConnection({
      clientId: client.id,
      tenantId: client.tenantId,
      provider: 'zernio',
      externalId: accountId,
      integration: platform,
      displayName: username,
    });
    res.redirect(`${appUrl()}/connections`);
  } catch (e) {
    next(e);
  }
});

// ---- Composio (apps & tools) ------------------------------------------------

// POST /api/connect/composio { toolkit } → { redirectUrl }  (portal-session gated)
connectRouter.post(
  '/composio',
  requireClientPortalAuth,
  rateLimit({ key: 'connect-composio', max: 20, windowSec: 60 }),
  async (req, res, next) => {
    try {
      const sess = req.session.clientPortalSession!;
      const toolkit = String(req.body?.toolkit ?? '').trim().toLowerCase();
      if (!toolkit) {
        res.status(400).json({ error: 'toolkit_required' });
        return;
      }
      const prov = await ensureProvisioned(sess.clientId);
      const state = signState({ clientId: sess.clientId, provider: 'composio', ref: toolkit });
      const callbackUrl = `${appUrl()}/api/connect/composio/callback/${state}`;
      const redirectUrl = await composioStartConnect(prov.composioUserId, toolkit, callbackUrl);
      res.json({ redirectUrl });
    } catch (e) {
      next(e);
    }
  },
);

// GET /api/connect/composio/callback/:state  (public; Composio redirects here
// after managed OAuth). We re-read the user's connected accounts and upsert.
connectRouter.get('/composio/callback/:state', async (req, res, next) => {
  const fail = (reason: string): void => {
    res.redirect(`${appUrl()}/connections?error=${encodeURIComponent(reason)}`);
  };
  try {
    const state = verifyState(req.params.state);
    if (!state || state.provider !== 'composio') return fail('bad_state');

    const [client] = await db
      .select({ id: clients.id, tenantId: clients.tenantId, composioUserId: clients.composioUserId })
      .from(clients)
      .where(eq(clients.id, state.clientId))
      .limit(1);
    if (!client) return fail('client_not_found');
    const composioUserId = client.composioUserId ?? client.id;

    // Re-read the source of truth from Composio and refresh our cache.
    const accounts = await composioListConnected(composioUserId);
    for (const a of accounts) {
      if (a.status.toUpperCase() !== 'ACTIVE') continue;
      await upsertConnection({
        clientId: client.id,
        tenantId: client.tenantId,
        provider: 'composio',
        externalId: a.id,
        integration: a.toolkit || state.ref,
      });
    }
    res.redirect(`${appUrl()}/connections`);
  } catch (e) {
    next(e);
  }
});
