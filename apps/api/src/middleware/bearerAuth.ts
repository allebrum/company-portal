import type { Request, Response, NextFunction } from 'express';
import type { ApiTokenScope } from '@allebrum/shared';
import { redisSession } from '../redis.js';
import { authenticateToken, touchToken } from '../services/apiTokens.js';
import { checkTokenRoute, parseBearer } from './tokenPolicy.js';

export { checkTokenRoute, parseBearer, TOKEN_ROUTES } from './tokenPolicy.js';

/**
 * Bearer-token (personal access token) authentication for bots and scripts.
 *
 * Mounted on `/api` BEFORE the cookie session middleware. When a request
 * carries `Authorization: Bearer …`:
 *   - the token must resolve (unknown/revoked/expired/removed user → 401;
 *     we never fall back to a cookie session on the same request),
 *   - the method + path must be on the allow-list below and the token must
 *     hold the matching scope (default-deny → 403),
 *   - per-token rate limiting applies.
 * On success we attach a non-persistent `req.session` carrying the same
 * `{ userId, tenantId }` a browser session would, so tenantContext, RBAC
 * (`userCan`), subscription gating, and every service behave identically.
 * express-session sees `req.session` already set and skips the cookie store,
 * so nothing is written to Redis. CSRF is skipped only for these requests
 * (see `isTokenRequest`): a cross-site page can't attach an Authorization
 * header, so ambient-credential forgery doesn't apply.
 *
 * Requests without an Authorization header are untouched.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authVia?: 'token';
      apiToken?: { id: string; scopes: ApiTokenScope[] };
    }
  }
}

export function isTokenRequest(req: Request): boolean {
  return req.authVia === 'token';
}

const PER_TOKEN_MAX = 120; // requests / minute / token
const FAIL_MAX = 20; // failed token attempts / 10 min / IP
const FAIL_WINDOW = 600;

function clientIp(req: Request): string {
  return (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '');
}

async function incr(key: string, windowSec: number): Promise<number> {
  try {
    const n = await redisSession.incr(key);
    if (n === 1) await redisSession.expire(key, windowSec);
    return n;
  } catch {
    return 0; // fail open, like middleware/rateLimit.ts
  }
}

async function peek(key: string): Promise<number> {
  try {
    return Number((await redisSession.get(key)) ?? 0);
  } catch {
    return 0;
  }
}

function fakeSession(userId: string, tenantId: string, tokenId: string): Request['session'] {
  const cb = (fn?: (err?: unknown) => void) => {
    fn?.();
  };
  const s = {
    id: `pat:${tokenId}`,
    cookie: { originalMaxAge: null, maxAge: undefined, expires: undefined },
    user: { userId, tenantId },
    regenerate(fn: (err?: unknown) => void) { cb(fn); return s; },
    destroy(fn: (err?: unknown) => void) { cb(fn); return s; },
    reload(fn: (err?: unknown) => void) { cb(fn); return s; },
    save(fn?: (err?: unknown) => void) { cb(fn); return s; },
    touch() { return s; },
    resetMaxAge() { return s; },
  };
  return s as unknown as Request['session'];
}

export async function bearerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = parseBearer(req.get('authorization'));
  if (raw === undefined) {
    next();
    return;
  }
  try {
    const failKey = `rl:pat-fail:${clientIp(req)}`;
    if ((await peek(failKey)) >= FAIL_MAX) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    const tok = raw ? await authenticateToken(raw) : null;
    if (!tok) {
      await incr(failKey, FAIL_WINDOW);
      res.setHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
      res.status(401).json({ error: 'invalid_token' });
      return;
    }

    const fullPath = req.baseUrl + req.path;
    const decision = checkTokenRoute(req.method, fullPath, tok.scopes);
    if (!decision.ok) {
      res.status(decision.status).json(decision.scope ? { error: decision.error, scope: decision.scope } : { error: decision.error });
      return;
    }

    const n = await incr(`rl:pat:${tok.id}`, 60);
    if (n > PER_TOKEN_MAX) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'rate_limited' });
      return;
    }

    req.authVia = 'token';
    req.apiToken = { id: tok.id, scopes: tok.scopes };
    req.session = fakeSession(tok.userId, tok.tenantId, tok.id);
    void touchToken(tok);
    next();
  } catch (e) {
    next(e);
  }
}
