import { Router, type Request } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { env, provisioningConfigured } from '../env.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { provisionAccount, getOwnerUserId, getTenant } from '../services/tenants.js';
import { issueToken, HANDOFF_TTL_MS } from '../auth/tokens.js';
import { verifyManageRef } from '../auth/manageRef.js';

/**
 * Identity contract for the marketing billing service (server-to-server, HMAC).
 *
 * Billing lives in the marketing service now; IDENTITY stays here. The marketing
 * service creates the Stripe customer, then calls these endpoints — signed with
 * an HMAC over the raw body using the shared PROVISIONING_SECRET — to create the
 * account, mint the auto-login handoff, and validate the in-app "fix card" ref.
 * The HMAC IS the auth (no session). The router is only mounted when
 * PROVISIONING_SECRET is set (so self-host never exposes it).
 */
export const provisioningRouter = Router();

function verifySignature(rawBody: Buffer | undefined, signature: string | undefined): boolean {
  if (!rawBody || !signature || !env.PROVISIONING_SECRET) return false;
  const expected = createHmac('sha256', env.PROVISIONING_SECRET).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function authed(req: Request): boolean {
  const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
  return verifySignature(rawBody, req.header('X-Hoppa-Signature') ?? undefined);
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'workspace'
  );
}

// ---- C1: create the account (identity) for a marketing-side signup -----------
// The marketing service has already created the Stripe customer; it passes the
// customer id in. We create the tenant + owner (race-safe), set the password,
// record the customer id, and mark the workspace trialing.
provisioningRouter.post('/account', rateLimit({ key: 'provision', max: 30, windowSec: 60 }), async (req, res, next) => {
  try {
    if (!provisioningConfigured) {
      res.status(503).json({ error: 'provisioning_not_configured' });
      return;
    }
    if (!authed(req)) {
      res.status(401).json({ error: 'bad_signature' });
      return;
    }
    const body = req.body as {
      email?: string;
      password?: string;
      workspaceName?: string;
      ownerName?: string;
      billingExternalId?: string;
    };
    if (!body.email || !body.password || !body.workspaceName || !body.billingExternalId) {
      res.status(400).json({ error: 'missing_fields' });
      return;
    }
    const passwordHash = await argon2.hash(body.password);
    const result = await provisionAccount({
      email: body.email,
      ownerName: body.ownerName?.trim() || body.email,
      workspaceName: body.workspaceName,
      slug: slugify(body.workspaceName),
      passwordHash,
      billingExternalId: body.billingExternalId,
    });
    if (result.kind === 'account_exists') {
      res.status(409).json({ error: 'account_exists' });
      return;
    }
    res.status(200).json({
      tenantId: result.tenantId,
      ownerUserId: result.ownerUserId,
      billingExternalId: result.billingExternalId,
      kind: result.kind,
    });
  } catch (e) {
    next(e);
  }
});

// ---- C2: mint a single-use auto-login handoff for a provisioned tenant -------
provisioningRouter.post('/handoff', async (req, res, next) => {
  try {
    if (!provisioningConfigured) {
      res.status(503).json({ error: 'provisioning_not_configured' });
      return;
    }
    if (!authed(req)) {
      res.status(401).json({ error: 'bad_signature' });
      return;
    }
    const body = req.body as { tenantId?: string };
    if (!body.tenantId) {
      res.status(400).json({ error: 'tenantId_required' });
      return;
    }
    const ownerId = await getOwnerUserId(body.tenantId);
    if (!ownerId) {
      res.status(404).json({ error: 'unknown_tenant' });
      return;
    }
    const { rawToken } = await issueToken({ kind: 'user', userId: ownerId }, 'portal-login', HANDOFF_TTL_MS);
    res.status(200).json({ handoffUrl: `${env.WEB_ORIGIN}/auth/handoff?token=${encodeURIComponent(rawToken)}` });
  } catch (e) {
    next(e);
  }
});

// ---- C3: validate a portal-signed "manage billing" ref (in-app fix-card) -----
provisioningRouter.post('/billing-ref/validate', async (req, res, next) => {
  try {
    if (!provisioningConfigured) {
      res.status(503).json({ error: 'provisioning_not_configured' });
      return;
    }
    if (!authed(req)) {
      res.status(401).json({ error: 'bad_signature' });
      return;
    }
    const body = req.body as { manageRef?: string };
    const parsed = body.manageRef ? verifyManageRef(body.manageRef) : null;
    if (!parsed) {
      res.status(401).json({ error: 'invalid_ref' });
      return;
    }
    const tenant = await getTenant(parsed.tenantId);
    if (!tenant?.billingExternalId) {
      res.status(404).json({ error: 'unknown_tenant' });
      return;
    }
    res.status(200).json({
      tenantId: tenant.id,
      billingExternalId: tenant.billingExternalId,
      billingStatus: tenant.billingStatus ?? null,
    });
  } catch (e) {
    next(e);
  }
});
