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
import type { AuthConfig, AuthMethods } from '@allebrum/shared';
import { validate, getValidated } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { verifyLogin, getUser, findByEmail, findOrCreateGoogleUser } from '../services/users.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { getUserGroupIds } from '../services/rbac.js';
import { getSettings } from '../services/settings.js';
import {
  resolveLoginTenantId,
  getDefaultTenantId,
  ensureMembership,
  getUserTenants,
  isMember,
} from '../services/tenants.js';
import { buildConsentUrl, exchangeCodeForProfile } from '../auth/google.js';
import { needsSecondFactor } from '../services/twofa.js';
import { db } from '../db/client.js';
import { oauthTokens, users } from '../db/schema.js';
import { env, googleOAuthConfigured, passwordLoginEnabled, provisioningConfigured } from '../env.js';
import { withTenant } from '../tenancy/context.js';
import {
  issueToken,
  consumeToken,
  invalidateTokensFor,
  RESET_TTL_MS,
} from '../auth/tokens.js';
import { sendResetEmail } from '../services/mail.js';
import { appendActivity } from '../services/activity.js';

export const authRouter = Router();

// Pre-login branding for the hosted multi-tenant instance. On SaaS the
// "default workspace" is just the internal team's tenant — its custom
// name/logo/legal links must not leak to every visitor on the shared login
// domain (app.hoppa.io). Legal links stay null until the marketing site has
// real terms/privacy pages. Self-host keeps default-workspace branding, which
// IS the instance brand there.
const SAAS_PRELOGIN_BRANDING = {
  portalName: 'Hoppa',
  brandPrimaryColor: '#9333ea',
  brandLogoDataUrl: null,
  termsUrl: null,
  privacyUrl: null,
} as const;

// Public: step 1 of login. The shared login page can't know a user's workspace
// before they identify themselves, so the METHODS here are INSTANCE-level (is
// password offered on this deployment + is Google configured). Per-account /
// per-workspace refinement happens at `POST /auth/methods` once an email is
// entered. Branding/legal links come from the default workspace on self-host;
// on SaaS (PROVISIONING_SECRET set) the pre-login surface is product-branded.
authRouter.get('/config', async (_req, res, next) => {
  try {
    const methodFlags = { passwordLoginEnabled, googleLoginEnabled: googleOAuthConfigured };
    if (provisioningConfigured) {
      res.json({ ...methodFlags, ...SAAS_PRELOGIN_BRANDING } satisfies AuthConfig);
      return;
    }
    const s = await getSettings();
    const cfg: AuthConfig = {
      ...methodFlags,
      termsUrl: s.termsUrl,
      privacyUrl: s.privacyUrl,
      portalName: s.portalName,
      brandPrimaryColor: s.brandPrimaryColor,
      brandLogoDataUrl: s.brandLogoDataUrl,
    };
    res.json(cfg);
  } catch (e) {
    next(e);
  }
});

// Public: step 2 of login — given an email, which methods does THIS account
// support? Resolves the user's workspace and honors that workspace's policy
// (app_settings.passwordLoginEnabled/googleLoginEnabled) + whether they have a
// password set. Unknown emails get the instance defaults + default branding, so
// the response doesn't trivially reveal whether an email exists (rate-limited
// on top). Reuses ForgotPasswordSchema since both take just `{ email }`.
authRouter.post(
  '/methods',
  rateLimit({ key: 'auth-methods', max: 20, windowSec: 60 }),
  validate(ForgotPasswordSchema),
  async (req, res, next) => {
    try {
      const { email } = getValidated<typeof ForgotPasswordSchema._type>(req);
      const def = await getSettings(); // default workspace → domain allowlist (+ self-host fallback branding)
      // Unknown emails must not reveal the internal team's workspace branding
      // on SaaS — same rule as /config above.
      const fallbackBranding = provisioningConfigured
        ? {
            portalName: SAAS_PRELOGIN_BRANDING.portalName,
            brandPrimaryColor: SAAS_PRELOGIN_BRANDING.brandPrimaryColor,
            brandLogoDataUrl: SAAS_PRELOGIN_BRANDING.brandLogoDataUrl,
          }
        : {
            portalName: def.portalName,
            brandPrimaryColor: def.brandPrimaryColor,
            brandLogoDataUrl: def.brandLogoDataUrl,
          };
      // The Google callback resolves new sign-ins into the default workspace and
      // enforces ITS email-domain allowlist, so only offer Google when this
      // email's domain would actually pass (empty allowlist = any domain). This
      // keeps SaaS users (non-listed domains) from seeing a button that 404s.
      const domain = email.split('@')[1]?.toLowerCase() ?? '';
      const googleDomainOk =
        def.allowedEmailDomains.length === 0 ||
        def.allowedEmailDomains.map((d) => d.toLowerCase()).includes(domain);
      const googleAvailable = googleOAuthConfigured && googleDomainOk;

      const user = await findByEmail(email);
      const tenantId = user ? await resolveLoginTenantId(user.id) : null;
      if (!user || !tenantId) {
        // Unknown email (or known-but-no-workspace) → instance defaults. For a
        // known user we still respect whether they actually have a password.
        const methods: AuthMethods = {
          password: passwordLoginEnabled && (user ? !!user.passwordHash : true),
          google: googleAvailable,
          ...fallbackBranding,
        };
        res.json(methods);
        return;
      }
      const s = await withTenant(tenantId, () => getSettings());
      const methods: AuthMethods = {
        password: passwordLoginEnabled && !!user.passwordHash && s.passwordLoginEnabled,
        google: googleAvailable && s.googleLoginEnabled,
        portalName: s.portalName,
        brandPrimaryColor: s.brandPrimaryColor,
        brandLogoDataUrl: s.brandLogoDataUrl,
      };
      res.json(methods);
    } catch (e) {
      next(e);
    }
  },
);

authRouter.post('/login', rateLimit({ key: 'login', max: 10, windowSec: 60 }), validate(LoginSchema), async (req, res, next) => {
  try {
    // Instance-level off-switch first (pure-SSO deployments). The PER-WORKSPACE
    // password policy is enforced below, against the user's RESOLVED tenant —
    // NOT the default workspace (which is why SaaS signups used to get a 403).
    if (!passwordLoginEnabled) {
      res.status(403).json({ error: 'password_login_disabled' });
      return;
    }
    const { email, password } = getValidated<typeof LoginSchema._type>(req);
    const user = await verifyLogin(email, password);
    if (!user) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }

    // Hoppa: resolve the user's active workspace. A user with no workspace
    // can't enter the app (they'd need to subscribe on the marketing site
    // first).
    const tenantId = await resolveLoginTenantId(user.id);
    if (!tenantId) {
      res.status(403).json({ error: 'no_workspace' });
      return;
    }

    // Honor the RESOLVED workspace's password policy. A user who verified a
    // password but whose workspace forbids it (SSO-only org) is rejected here.
    const settings = await withTenant(tenantId, () => getSettings());
    if (!settings.passwordLoginEnabled) {
      res.status(403).json({ error: 'password_login_disabled' });
      return;
    }

    // Primary auth OK — gate on a second factor if required/enrolled.
    if (await needsSecondFactor(user.id)) {
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.pending = { userId: user.id, tenantId };
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.json({ mfaRequired: true });
        });
      });
      return;
    }

    const finishLogin = async (): Promise<void> => {
      try {
        const permissions = [...(await getEffectivePermissions(user.id, tenantId))];
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
      req.session.user = { userId: user.id, tenantId };
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

    // Hoppa: resolve the workspace. A brand-new Google user has no membership
    // yet — Phase 1 auto-enrolls them in the default workspace so the existing
    // "sign in with Google" behavior is preserved. (Phase 4: the marketing
    // site owns signup and only invited users reach the app.)
    let tenantId = await resolveLoginTenantId(user.id);
    if (!tenantId) {
      const def = await getDefaultTenantId();
      if (def) {
        await ensureMembership(def, user.id);
        tenantId = def;
      }
    }
    if (!tenantId) return fail('no_workspace');

    if (await needsSecondFactor(user.id)) {
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.pending = { userId: user.id, tenantId: tenantId! };
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.redirect(`${env.WEB_ORIGIN}/login?mfa=1`);
        });
      });
      return;
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { userId: user.id, tenantId: tenantId! };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(`${env.WEB_ORIGIN}/dashboard`);
      });
    });
  } catch {
    return fail('oauth_failed');
  }
});

// ---- Marketing signup → portal auto-login handoff ----
//
// The marketing signup flow (billing /complete) mints a single-use
// 'portal-login' token after the card is validated and redirects the browser
// here. We consume it and establish a first-party portal session, so the user
// lands in their new workspace without a second login. No `requireAuth` (this
// IS the login), and it lives under /auth so the subscription gate exempts it.
authRouter.get('/handoff', async (req, res, next) => {
  // The single-use token rides in the query string; keep it out of the Referer
  // of the destination page (history/access logs still hold it briefly, but
  // single-use + 10-min TTL close the replay window).
  res.setHeader('Referrer-Policy', 'no-referrer');
  const fail = (reason: string) =>
    res.redirect(`${env.WEB_ORIGIN}/login?error=${encodeURIComponent(reason)}`);
  try {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!token) return fail('handoff_expired');

    let subject;
    try {
      subject = await consumeToken(token, 'portal-login');
    } catch {
      return fail('handoff_expired');
    }
    if (subject.kind !== 'user') return fail('handoff_expired');
    const userId = subject.userId;

    const tenantId = await resolveLoginTenantId(userId);
    if (!tenantId) return fail('no_workspace');

    // Mirror the Google-callback pattern: a 2FA-enrolled user completes the
    // second factor on /login before the full session is granted.
    if (await needsSecondFactor(userId)) {
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.pending = { userId, tenantId };
        req.session.save((saveErr) => {
          if (saveErr) return next(saveErr);
          res.redirect(`${env.WEB_ORIGIN}/login?mfa=1`);
        });
      });
      return;
    }

    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { userId, tenantId };
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.redirect(`${env.WEB_ORIGIN}/dashboard`);
      });
    });
  } catch {
    return fail('handoff_failed');
  }
});

// ---- Password reset / accept-invite ----
//
// All three are rate-limited and gated on the INSTANCE `passwordLoginEnabled`
// (a pure-SSO deployment turns the whole surface off). `forgot-password`
// additionally resolves the user's workspace and respects ITS password policy,
// so an SSO-only org never emits reset links — and `verifyLogin`/the reset flow
// already no-op for accounts with no password hash.

// "Forgot password" returns 200 unconditionally to defeat email-enumeration.
// We perform a constant-time argon2 dummy hash on misses so timing doesn't
// leak whether an email is registered.
authRouter.post(
  '/forgot-password',
  rateLimit({ key: 'forgot', max: 5, windowSec: 60 }),
  validate(ForgotPasswordSchema),
  async (req, res, next) => {
    try {
      if (!passwordLoginEnabled) {
        res.status(403).json({ error: 'password_login_disabled' });
        return;
      }
      const { email } = getValidated<typeof ForgotPasswordSchema._type>(req);
      const user = await findByEmail(email);
      // Resolve the user's workspace so we honor ITS password policy and use
      // ITS configured system sender (not the default workspace's). Falls back
      // to default settings for unknown emails (the else-branch ignores it).
      const tenantId = user ? await resolveLoginTenantId(user.id) : null;
      const settings = tenantId ? await withTenant(tenantId, () => getSettings()) : await getSettings();
      if (user && user.passwordHash && settings.passwordLoginEnabled) {
        // Invalidate any prior unused reset tokens so older email links
        // can't be replayed after a new reset request.
        await invalidateTokensFor(user.id, 'reset');
        const { rawToken, expiresAt } = await issueToken({ kind: 'user', userId: user.id }, 'reset', RESET_TTL_MS);
        const resetUrl = `${env.WEB_ORIGIN}/reset-password?token=${encodeURIComponent(rawToken)}`;
        // No session here — use the workspace's designated system sender
        // (an admin who connected their Gmail in Settings). If unset, the
        // mail service logs the URL but doesn't send, which the route
        // surfaces as the usual constant-time 200.
        await sendResetEmail({
          senderUserId: settings.systemSenderUserId,
          to: user.email,
          name: user.name,
          resetUrl,
          expiresAt,
        });
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
      if (!passwordLoginEnabled) {
        res.status(403).json({ error: 'password_login_disabled' });
        return;
      }
      const { token, password } = getValidated<typeof ResetPasswordSchema._type>(req);
      const subject = await consumeToken(token, 'reset');
      if (subject.kind !== 'user') {
        // Defensive: 'reset' is a staff-only kind; mixed-subject token is malformed.
        res.status(400).json({ error: 'invalid_token' });
        return;
      }
      const { userId } = subject;
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
      if (!passwordLoginEnabled) {
        res.status(403).json({ error: 'password_login_disabled' });
        return;
      }
      const { token, password } = getValidated<typeof AcceptInviteSchema._type>(req);
      const subject = await consumeToken(token, 'invite');
      if (subject.kind !== 'user') {
        // Defensive: 'invite' is a staff-only kind.
        res.status(400).json({ error: 'invalid_token' });
        return;
      }
      const { userId } = subject;
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

// Hoppa: switch the active workspace. Verifies the user is a member of the
// target tenant, then updates the session. The web client clears its query
// cache + refetches bootstrap so no other workspace's data lingers.
authRouter.post('/switch-workspace', requireAuth, async (req, res, next) => {
  try {
    const me = req.session.user!;
    const tenantId = (req.body?.tenantId ?? '') as string;
    if (!tenantId || typeof tenantId !== 'string') {
      res.status(400).json({ error: 'tenantId_required' });
      return;
    }
    if (!(await isMember(me.userId, tenantId))) {
      res.status(403).json({ error: 'not_a_member' });
      return;
    }
    req.session.user = { userId: me.userId, tenantId };
    req.session.save((err) => {
      if (err) return next(err);
      res.json({ ok: true, tenantId });
    });
  } catch (e) {
    next(e);
  }
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = await getUser(req.session.user!.userId);
    if (!u) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const [permissions, groupIds, workspaces] = await Promise.all([
      getEffectivePermissions(u.id, req.session.user!.tenantId),
      getUserGroupIds(u.id),
      getUserTenants(u.id),
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
      // Hoppa: the active workspace + the full membership list for the switcher.
      tenantId: req.session.user!.tenantId,
      workspaces,
    });
  } catch (e) {
    next(e);
  }
});
