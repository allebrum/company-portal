import { Router } from 'express';
import { createHmac } from 'node:crypto';
import { ForgotPasswordSchema } from '@modernzen/shared';
import type { AuthConfig, AuthMethods } from '@modernzen/shared';
import { validate, getValidated } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { getUser, findByEmail } from '../services/users.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { getUserGroupIds } from '../services/rbac.js';
import { getSettings } from '../services/settings.js';
import { resolveLoginTenantId, getUserTenants, isMember } from '../services/tenants.js';
import { env, googleOAuthConfigured, passwordLoginEnabled, provisioningConfigured } from '../env.js';
import { withTenant } from '../tenancy/context.js';

// Auth on this deployment is Supabase Auth: the browser talks to Supabase
// directly for sign-in, sign-up, OAuth, MFA, password reset and sign-out, and
// sends the resulting access token to this API as a Bearer token (verified by
// the `supabaseAuth` middleware, which populates `req.session.user`). The
// endpoints below are the thin server-side surface that remains: instance/
// workspace config for the login page, the authenticated identity (`/me`),
// workspace switching, and the PostHog identity HMAC.

export const authRouter = Router();

// Pre-login branding for the hosted multi-tenant instance. On SaaS the default
// workspace's custom name/logo must not leak to every visitor on the shared
// login domain; self-host shows the default-workspace branding (its instance brand).
const SAAS_PRELOGIN_BRANDING = {
  portalName: 'Modern Zen Portal',
  brandPrimaryColor: '#9333ea',
  brandLogoDataUrl: null,
  termsUrl: null,
  privacyUrl: null,
} as const;

// Public: instance-level auth config for the login page (is password offered,
// is Google configured) + branding.
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

// PostHog Support widget — sign the session user's distinct id with the team's
// secret so support tickets follow the user across devices. Null when unset.
authRouter.get('/posthog-identity', requireAuth, (req, res) => {
  const me = req.session.user!;
  const identityHash = env.POSTHOG_IDENTITY_SECRET
    ? createHmac('sha256', env.POSTHOG_IDENTITY_SECRET).update(me.userId).digest('hex')
    : null;
  res.json({ distinctId: me.userId, identityHash });
});

// Public: given an email, which methods does the login page offer? Honors the
// resolved workspace's policy (app_settings.passwordLoginEnabled/
// googleLoginEnabled). Credential existence is owned by Supabase Auth, so this
// no longer inspects a password hash — it advertises availability only.
authRouter.post(
  '/methods',
  rateLimit({ key: 'auth-methods', max: 20, windowSec: 60 }),
  validate(ForgotPasswordSchema),
  async (req, res, next) => {
    try {
      const { email } = getValidated<typeof ForgotPasswordSchema._type>(req);
      const def = await getSettings();
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
      const domain = email.split('@')[1]?.toLowerCase() ?? '';
      const googleDomainOk =
        def.allowedEmailDomains.length === 0 ||
        def.allowedEmailDomains.map((d) => d.toLowerCase()).includes(domain);
      const googleAvailable = googleOAuthConfigured && googleDomainOk;

      const user = await findByEmail(email);
      const tenantId = user ? await resolveLoginTenantId(user.id) : null;
      if (!user || !tenantId) {
        const methods: AuthMethods = {
          password: passwordLoginEnabled,
          google: googleAvailable,
          ...fallbackBranding,
        };
        res.json(methods);
        return;
      }
      const s = await withTenant(tenantId, () => getSettings());
      const methods: AuthMethods = {
        password: passwordLoginEnabled && s.passwordLoginEnabled,
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

// Switch the active workspace. Verifies membership, then updates the
// per-request session shim. (The active tenant is resolved from membership on
// each request by `supabaseAuth`; for multi-workspace switching the client
// persists the choice — see useAuth.)
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
    res.json({ ok: true, tenantId });
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
      tenantId: req.session.user!.tenantId,
      workspaces,
    });
  } catch (e) {
    next(e);
  }
});
