import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import {
  LoginSchema,
  ForgotPasswordSchema,
  ResetPasswordSchema,
  AcceptInviteSchema,
} from '@allebrum/shared';
import type { AuthConfig } from '@allebrum/shared';
import { validate, getValidated } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { verifyLogin, getUser, findByEmail, findOrCreateGoogleUser } from '../services/users.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { getUserGroupIds } from '../services/rbac.js';
import { getSettings } from '../services/settings.js';
import { buildConsentUrl, exchangeCodeForProfile } from '../auth/google.js';
import { needsSecondFactor } from '../services/twofa.js';
import { db } from '../db/client.js';
import { oauthTokens, users } from '../db/schema.js';
import { env, googleOAuthConfigured } from '../env.js';
import {
  issueToken,
  consumeToken,
  invalidateTokensFor,
  RESET_TTL_MS,
} from '../auth/tokens.js';
import { sendResetEmail } from '../services/mail.js';
import { appendActivity } from '../services/activity.js';

export const authRouter = Router();

// Public: lets the login page decide which methods to show.
authRouter.get('/config', async (_req, res, next) => {
  try {
    const s = await getSettings();
    const cfg: AuthConfig = {
      passwordLoginEnabled: s.passwordLoginEnabled,
      googleLoginEnabled: s.googleLoginEnabled && googleOAuthConfigured,
    };
    res.json(cfg);
  } catch (e) {
    next(e);
  }
});

authRouter.post('/login', rateLimit({ key: 'login', max: 10, windowSec: 60 }), validate(LoginSchema), async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings.passwordLoginEnabled) {
      res.status(403).json({ error: 'password_login_disabled' });
      return;
    }
    const { email, password } = getValidated<typeof LoginSchema._type>(req);
    const user = await verifyLogin(email, password);
    if (!user) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    // Primary auth OK — gate on a second factor if required/enrolled.
    if (await needsSecondFactor(user.id)) {
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.pending = { userId: user.id };
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.json({ mfaRequired: true });
        });
      });
      return;
    }

    const finishLogin = async (): Promise<void> => {
      try {
        const permissions = [...(await getEffectivePermissions(user.id))];
        res.json({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            initials: user.initials,
            color: user.color,
            billable: Number(user.billable),
            permissions,
          },
        });
      } catch (e) {
        next(e);
      }
    };

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { userId: user.id };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        void finishLogin();
      });
    });
  } catch (e) {
    next(e);
  }
});

// ---- Google OAuth ----
authRouter.get('/google', async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings.googleLoginEnabled || !googleOAuthConfigured) {
      res.status(404).json({ error: 'google_login_unavailable' });
      return;
    }
    const state = randomBytes(16).toString('hex');
    req.session.oauthState = state;
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(buildConsentUrl(state));
    });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/google/callback', async (req, res, next) => {
  const fail = (reason: string) =>
    res.redirect(`${env.WEB_ORIGIN}/login?error=${encodeURIComponent(reason)}`);
  try {
    const settings = await getSettings();
    if (!settings.googleLoginEnabled || !googleOAuthConfigured) return fail('google_unavailable');

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state || state !== req.session.oauthState) return fail('bad_state');
    delete req.session.oauthState;

    const { profile, tokens } = await exchangeCodeForProfile(code);
    if (!profile.emailVerified) return fail('email_unverified');

    if (settings.allowedEmailDomains.length > 0) {
      const domain = profile.email.split('@')[1]?.toLowerCase() ?? '';
      if (!settings.allowedEmailDomains.map((d) => d.toLowerCase()).includes(domain)) {
        return fail('domain_not_allowed');
      }
    }

    const user = await findOrCreateGoogleUser(profile);

    await db
      .insert(oauthTokens)
      .values({
        userId: user.id,
        provider: 'google',
        scopes: ['openid', 'email', 'profile'],
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      })
      .onConflictDoUpdate({
        target: [oauthTokens.userId, oauthTokens.provider],
        set: {
          accessToken: tokens.access_token ?? null,
          refreshToken: tokens.refresh_token ?? null,
          expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
          updatedAt: new Date().toISOString(),
        },
      });

    if (await needsSecondFactor(user.id)) {
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.pending = { userId: user.id };
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.redirect(`${env.WEB_ORIGIN}/login?mfa=1`);
        });
      });
      return;
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { userId: user.id };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(`${env.WEB_ORIGIN}/dashboard`);
      });
    });
  } catch {
    return fail('oauth_failed');
  }
});

// ---- Password reset / accept-invite ----
//
// All three routes are rate-limited and gated on `passwordLoginEnabled` —
// if the org has disabled password login, password recovery would just
// re-enable the surface they tried to close.

// "Forgot password" returns 200 unconditionally to defeat email-enumeration.
// We perform a constant-time argon2 dummy hash on misses so timing doesn't
// leak whether an email is registered.
authRouter.post(
  '/forgot-password',
  rateLimit({ key: 'forgot', max: 5, windowSec: 60 }),
  validate(ForgotPasswordSchema),
  async (req, res, next) => {
    try {
      const settings = await getSettings();
      if (!settings.passwordLoginEnabled) {
        res.status(403).json({ error: 'password_login_disabled' });
        return;
      }
      const { email } = getValidated<typeof ForgotPasswordSchema._type>(req);
      const user = await findByEmail(email);
      if (user && user.passwordHash) {
        // Invalidate any prior unused reset tokens so older email links
        // can't be replayed after a new reset request.
        await invalidateTokensFor(user.id, 'reset');
        const { rawToken, expiresAt } = await issueToken(user.id, 'reset', RESET_TTL_MS);
        const resetUrl = `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(rawToken)}`;
        await sendResetEmail({ to: user.email, name: user.name, resetUrl, expiresAt });
        await appendActivity({ whoId: user.id, kind: 'auth.reset.request', target: user.email });
      } else {
        // Spend ~the same wall-clock time as the hit branch so a clock-
        // wielding attacker can't enumerate emails by response timing.
        await argon2.hash('dummy-constant-time-burn');
      }
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

authRouter.post(
  '/reset-password',
  rateLimit({ key: 'reset', max: 10, windowSec: 60 }),
  validate(ResetPasswordSchema),
  async (req, res, next) => {
    try {
      const settings = await getSettings();
      if (!settings.passwordLoginEnabled) {
        res.status(403).json({ error: 'password_login_disabled' });
        return;
      }
      const { token, password } = getValidated<typeof ResetPasswordSchema._type>(req);
      const { userId } = await consumeToken(token, 'reset');
      const passwordHash = await argon2.hash(password);
      await db
        .update(users)
        .set({ passwordHash, updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
      await appendActivity({ whoId: userId, kind: 'auth.reset.complete', target: userId });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

authRouter.post(
  '/accept-invite',
  rateLimit({ key: 'accept-invite', max: 10, windowSec: 60 }),
  validate(AcceptInviteSchema),
  async (req, res, next) => {
    try {
      const settings = await getSettings();
      if (!settings.passwordLoginEnabled) {
        res.status(403).json({ error: 'password_login_disabled' });
        return;
      }
      const { token, password } = getValidated<typeof AcceptInviteSchema._type>(req);
      const { userId } = await consumeToken(token, 'invite');
      const passwordHash = await argon2.hash(password);
      // Accept-invite both sets the password AND flips the user to `active`
      // — the legacy "first login flips invited→active" branch in
      // verifyLogin stays as a fallback but this is the canonical path.
      await db
        .update(users)
        .set({ passwordHash, status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(users.id, userId));
      await appendActivity({ whoId: userId, kind: 'auth.invite.accept', target: userId });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

authRouter.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = await getUser(req.session.user!.userId);
    if (!u) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const [permissions, groupIds] = await Promise.all([
      getEffectivePermissions(u.id),
      getUserGroupIds(u.id),
    ]);
    res.json({
      id: u.id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      color: u.color,
      billable: Number(u.billable),
      permissions: [...permissions],
      groupIds,
    });
  } catch (e) {
    next(e);
  }
});
