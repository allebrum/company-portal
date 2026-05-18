import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import {
  TotpVerifySchema,
  TotpEnableSchema,
  WebAuthnResponseSchema,
  RenameCredentialSchema,
} from '@allebrum/shared';
import type { TwoFactorChallenge } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate, getValidated } from '../middleware/validate.js';
import { getUser } from '../services/users.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import {
  getStatus,
  getTotp,
  listPasskeys,
  startTotpSetup,
  enableTotp,
  disableTotp,
  regenerateRecoveryCodes,
  verifySecondFactorCode,
  webauthnRegisterOptions,
  webauthnRegisterVerify,
  webauthnAuthOptions,
  webauthnAuthVerify,
  deletePasskey,
  renamePasskey,
} from '../services/twofa.js';

export const twofaRouter = Router();

// Promote a pending (primary-auth-passed) session to fully authenticated.
function promote(req: Request, res: Response, next: NextFunction, userId: string): void {
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.user = { userId };
    req.session.save(async (saveErr) => {
      if (saveErr) return next(saveErr);
      try {
        const u = await getUser(userId);
        if (!u) {
          res.status(401).json({ error: 'unauthorized' });
          return;
        }
        const permissions = [...(await getEffectivePermissions(userId))];
        res.json({
          user: {
            id: u.id,
            name: u.name,
            email: u.email,
            initials: u.initials,
            color: u.color,
            billable: Number(u.billable),
            permissions,
          },
        });
      } catch (e) {
        next(e);
      }
    });
  });
}

// ---- Second login step (uses session.pending; not yet authenticated) ----
twofaRouter.get('/2fa/challenge', async (req, res, next) => {
  try {
    const pending = req.session.pending;
    if (!pending) {
      res.json({ pending: false, totp: false, passkey: false } satisfies TwoFactorChallenge);
      return;
    }
    const [totp, passkeys] = await Promise.all([getTotp(pending.userId), listPasskeys(pending.userId)]);
    res.json({
      pending: true,
      totp: !!totp?.enabled,
      passkey: passkeys.length > 0,
    } satisfies TwoFactorChallenge);
  } catch (e) {
    next(e);
  }
});

twofaRouter.post('/2fa/totp', validate(TotpVerifySchema), async (req, res, next) => {
  try {
    const pending = req.session.pending;
    if (!pending) {
      res.status(401).json({ error: 'no_pending_login' });
      return;
    }
    const { code } = getValidated<typeof TotpVerifySchema._type>(req);
    const ok = await verifySecondFactorCode(pending.userId, code);
    if (!ok) {
      res.status(401).json({ error: 'invalid_code' });
      return;
    }
    promote(req, res, next, pending.userId);
  } catch (e) {
    next(e);
  }
});

twofaRouter.get('/2fa/webauthn/options', async (req, res, next) => {
  try {
    const pending = req.session.pending;
    if (!pending) {
      res.status(401).json({ error: 'no_pending_login' });
      return;
    }
    const options = await webauthnAuthOptions(pending.userId);
    req.session.webauthnChallenge = options.challenge;
    req.session.save((err) => {
      if (err) return next(err);
      res.json(options);
    });
  } catch (e) {
    next(e);
  }
});

twofaRouter.post('/2fa/webauthn/verify', validate(WebAuthnResponseSchema), async (req, res, next) => {
  try {
    const pending = req.session.pending;
    const challenge = req.session.webauthnChallenge;
    if (!pending || !challenge) {
      res.status(401).json({ error: 'no_pending_login' });
      return;
    }
    const { response } = getValidated<typeof WebAuthnResponseSchema._type>(req);
    const ok = await webauthnAuthVerify(pending.userId, response, challenge);
    if (!ok) {
      res.status(401).json({ error: 'verification_failed' });
      return;
    }
    promote(req, res, next, pending.userId);
  } catch (e) {
    next(e);
  }
});

// ---- Enrollment / management (authenticated) ----
twofaRouter.get('/2fa/status', requireAuth, async (req, res, next) => {
  try {
    res.json(await getStatus(req.session.user!.userId));
  } catch (e) {
    next(e);
  }
});

twofaRouter.post('/2fa/totp/setup', requireAuth, async (req, res, next) => {
  try {
    res.json(await startTotpSetup(req.session.user!.userId));
  } catch (e) {
    next(e);
  }
});

twofaRouter.post('/2fa/totp/enable', requireAuth, validate(TotpEnableSchema), async (req, res, next) => {
  try {
    const { code } = getValidated<typeof TotpEnableSchema._type>(req);
    const recoveryCodes = await enableTotp(req.session.user!.userId, code);
    res.json({ recoveryCodes });
  } catch (e) {
    if (e instanceof Error && e.message === 'invalid_code') {
      res.status(400).json({ error: 'invalid_code' });
      return;
    }
    next(e);
  }
});

twofaRouter.delete('/2fa/totp', requireAuth, async (req, res, next) => {
  try {
    await disableTotp(req.session.user!.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

twofaRouter.post('/2fa/recovery/regenerate', requireAuth, async (req, res, next) => {
  try {
    const recoveryCodes = await regenerateRecoveryCodes(req.session.user!.userId);
    res.json({ recoveryCodes });
  } catch (e) {
    next(e);
  }
});

twofaRouter.get('/2fa/webauthn/register/options', requireAuth, async (req, res, next) => {
  try {
    const options = await webauthnRegisterOptions(req.session.user!.userId);
    req.session.webauthnChallenge = options.challenge;
    req.session.save((err) => {
      if (err) return next(err);
      res.json(options);
    });
  } catch (e) {
    next(e);
  }
});

twofaRouter.post('/2fa/webauthn/register/verify', requireAuth, async (req, res, next) => {
  try {
    const challenge = req.session.webauthnChallenge;
    if (!challenge) {
      res.status(400).json({ error: 'no_challenge' });
      return;
    }
    const body = req.body as { response?: unknown; name?: string };
    const ok = await webauthnRegisterVerify(
      req.session.user!.userId,
      body.response,
      challenge,
      typeof body.name === 'string' ? body.name : 'Passkey',
    );
    delete req.session.webauthnChallenge;
    if (!ok) {
      res.status(400).json({ error: 'verification_failed' });
      return;
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

twofaRouter.patch('/2fa/webauthn/:id', requireAuth, validate(RenameCredentialSchema), async (req, res, next) => {
  try {
    const { name } = getValidated<typeof RenameCredentialSchema._type>(req);
    await renamePasskey(req.session.user!.userId, req.params.id!, name);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

twofaRouter.delete('/2fa/webauthn/:id', requireAuth, async (req, res, next) => {
  try {
    await deletePasskey(req.session.user!.userId, req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
