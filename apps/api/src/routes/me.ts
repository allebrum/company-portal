import { Router } from 'express';
import { API_TOKEN_SCOPES, type ApiTokenScope, type CapabilitiesResponse } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { isTokenRequest } from '../middleware/bearerAuth.js';
import { SESSION_ONLY_ROUTES, TOKEN_ROUTES, effectiveScopes, hasScope } from '../middleware/tokenPolicy.js';
import { loadPermissions } from '../auth/permissions.js';
import { getUser } from '../services/users.js';
import { meRouteLimiter } from '../middleware/rateLimiters.js';

/**
 * `/api/me` — self-description for bots (and the web app).
 *
 * GET /api/me/capabilities: who am I, which scopes does this credential hold,
 * what are my live RBAC permissions (the hard ceiling), and which endpoints can
 * this credential call. A browser session holds every scope implicitly.
 */
export const meRouter = Router();
meRouter.use(meRouteLimiter);
meRouter.use(requireAuth);

meRouter.get('/capabilities', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const [user, perms] = await Promise.all([getUser(me.userId), loadPermissions(req)]);
    if (!user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const token = isTokenRequest(req) ? req.apiToken ?? null : null;
    const held: ApiTokenScope[] = token ? effectiveScopes(token.scopes) : [...API_TOKEN_SCOPES];
    const body: CapabilitiesResponse = {
      via: token ? 'token' : 'session',
      user: { id: user.id, name: user.name, email: user.email },
      tenantId: me.tenantId,
      token: token ? { id: token.id, name: token.name, scopes: token.scopes, expiresAt: token.expiresAt } : null,
      effectiveScopes: held,
      permissions: [...perms].sort(),
      actions: TOKEN_ROUTES.map((r) => ({
        method: r.method,
        path: r.path,
        scope: r.scope,
        allowed: r.scope === null || hasScope(held, r.scope),
        ...(r.sessionOnlyFields ? { sessionOnlyFields: r.sessionOnlyFields } : {}),
        ...(r.note ? { note: r.note } : {}),
      })),
      sessionOnly: SESSION_ONLY_ROUTES.map(({ method, path, reason }) => ({ method, path, reason })),
    };
    res.setHeader('Cache-Control', 'no-store');
    res.json(body);
  } catch (e) {
    next(e);
  }
});
