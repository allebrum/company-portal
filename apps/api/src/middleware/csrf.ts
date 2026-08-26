import crypto from 'node:crypto';
import type { Request, Response, NextFunction, RequestHandler } from 'express';

// Cross-site request forgery guard for every state-changing route served
// behind the session cookie. The prod cookie is SameSite=None (the web app is
// a separate origin), so the browser attaches it to cross-site form POSTs —
// CORS only stops the attacker from *reading* the response, not from the
// write happening. Layered checks, first pass wins:
//
//   1. `Sec-Fetch-Site: same-origin` — browser-controlled, immune to the
//      Referrer-Policy quirk that turns a same-origin POST's Origin header
//      into the literal string "null" (self-host SERVE_WEB mode).
//   2. Origin (fallback: Referer) must be WEB_ORIGIN or the API's own origin.
//      Browsers always send Origin on CORS and non-GET requests and a page
//      cannot forge it, so this is the check the SPA actually exercises.
//   3. An `x-csrf-token` header equal to the session's token (issued by
//      GET /api/auth/csrf) — for cookie-carrying clients that are not
//      browsers and therefore send none of the headers above.
//
// Surfaces that are not cookie-authenticated (or not browser-reachable) are
// exempted by path — their auth is CSRF-proof by construction (HMAC body
// signatures, capability tokens in the URL, or no credentials at all).
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface CsrfOptions {
  /** Origins allowed to issue state-changing requests (e.g. env.WEB_ORIGIN). */
  allowedOrigins: string[];
  /** Full-path prefixes exempt from the check (each matches `prefix` exactly or `prefix/...`). */
  exemptPrefixes: string[];
  /** Regexes for finer-grained exemptions (e.g. token-authenticated public uploads). */
  exemptPatterns?: RegExp[];
}

function isExempt(path: string, opts: CsrfOptions): boolean {
  return (
    opts.exemptPrefixes.some((p) => path === p || path.startsWith(p + '/')) ||
    (opts.exemptPatterns ?? []).some((re) => re.test(path))
  );
}

function sourceOrigin(req: Request): string | undefined {
  const origin = req.get('origin');
  if (origin && origin !== 'null') return origin;
  const referer = req.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function csrfProtection(opts: CsrfOptions): RequestHandler {
  const allowed = new Set(opts.allowedOrigins);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (isExempt(req.path, opts)) {
      next();
      return;
    }

    if (req.get('sec-fetch-site') === 'same-origin') {
      next();
      return;
    }

    const origin = sourceOrigin(req);
    // The API's own origin is always acceptable: a cross-site attacker's
    // browser sends the *attacker's* Origin, never ours.
    if (origin && (allowed.has(origin) || origin === `${req.protocol}://${req.get('host')}`)) {
      next();
      return;
    }

    const headerToken = req.get('x-csrf-token');
    if (headerToken && req.session?.csrfToken === headerToken) {
      next();
      return;
    }

    res.status(403).json({ error: 'cross_site_request_blocked' });
  };
}

/** Issue (or return the existing) per-session CSRF token — see layer 3 above. */
export function issueCsrfToken(req: Request): string {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfToken;
}
