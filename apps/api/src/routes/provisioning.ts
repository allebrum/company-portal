import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, provisioningConfigured } from '../env.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { provisionTenant } from '../services/tenants.js';
import { issueToken, INVITE_TTL_MS } from '../auth/tokens.js';
import { sendInviteEmail } from '../services/mail.js';

/**
 * Hoppa Phase 3 — inbound provisioning webhook from the marketing site.
 *
 * Fired on Stripe `checkout.session.completed`: the marketing site POSTs the
 * new workspace + owner here, signed with an HMAC over the raw body using the
 * shared PROVISIONING_SECRET. We verify the signature, create the workspace +
 * owner (provisionTenant), issue an invite magic-link, and return it so the
 * marketing site can drop the owner straight into onboarding.
 *
 * No session — this is a server-to-server call. The HMAC IS the auth. The
 * router is only mounted when PROVISIONING_SECRET is set.
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

provisioningRouter.post('/tenant', rateLimit({ key: 'provision', max: 30, windowSec: 60 }), async (req, res, next) => {
  try {
    if (!provisioningConfigured) {
      res.status(503).json({ error: 'provisioning_not_configured' });
      return;
    }
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    const signature = req.header('X-Hoppa-Signature') ?? undefined;
    if (!verifySignature(rawBody, signature)) {
      res.status(401).json({ error: 'bad_signature' });
      return;
    }

    const body = req.body as {
      billingExternalId?: string;
      workspaceName?: string;
      ownerEmail?: string;
      ownerName?: string;
      plan?: string;
      seats?: number;
    };
    if (!body.workspaceName || !body.ownerEmail) {
      res.status(400).json({ error: 'workspaceName_and_ownerEmail_required' });
      return;
    }

    const { tenantId, ownerUserId } = await provisionTenant({
      name: body.workspaceName,
      slug: slugify(body.workspaceName),
      ownerEmail: body.ownerEmail,
      ownerName: body.ownerName ?? body.ownerEmail,
      billingExternalId: body.billingExternalId ?? null,
      plan: body.plan ?? null,
      seatLimit: typeof body.seats === 'number' ? body.seats : null,
    });

    // Issue an invite magic-link so the owner sets their password + lands in
    // the new workspace. Email send is best-effort (system sender may not be
    // connected yet); the URL is always returned for the marketing site to use.
    const { rawToken, expiresAt } = await issueToken({ kind: 'user', userId: ownerUserId }, 'invite', INVITE_TTL_MS);
    const inviteUrl = `${env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(rawToken)}`;
    try {
      await sendInviteEmail({
        senderUserId: null,
        to: body.ownerEmail,
        inviterName: 'Hoppa',
        acceptUrl: inviteUrl,
        expiresAt,
      });
    } catch {
      /* best-effort — the URL is returned regardless */
    }

    res.status(200).json({ tenantId, inviteUrl });
  } catch (e) {
    next(e);
  }
});
