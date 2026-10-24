import session from 'express-session';
import RedisStore from 'connect-redis';
import { env, isProd } from './env.js';
import { redisSession } from './redis.js';

declare module 'express-session' {
  interface SessionData {
    // Hoppa: the session carries the active workspace (`tenantId`) alongside
    // the user id. Set at login once the user's tenant is resolved; changed
    // by the workspace switcher (Phase 2).
    user?: { userId: string; tenantId: string };
    // Primary auth passed but a second factor is still required. Carries the
    // resolved tenant so the 2FA-complete step can promote it onto `user`.
    pending?: { userId: string; tenantId: string };
    // Transient WebAuthn challenge for register/authenticate ceremonies.
    webauthnChallenge?: string;
    // Anti-CSRF token for cookie-carrying clients that send no Origin /
    // Sec-Fetch-Site headers (non-browser scripts). Issued by
    // GET /auth/csrf, checked in middleware/csrf.ts.
    csrfToken?: string;
    // Google *login* OAuth state (auth.ts). Gmail + Drive connect each use
    // their own slots below so concurrent flows can't collide.
    oauthState?: string;
    // Gmail + Drive connect each carry their own state plus an optional
    // same-origin `returnTo`, so the JIT / integration-gate connect flow can
    // bounce the user back to where they were.
    gmailOauthState?: { state: string; returnTo?: string };
    driveOauthState?: { state: string; returnTo?: string };
    qboOauthState?: { state: string; returnTo?: string };
    // F23 public client portal — sibling of `user`, never set at the same
    // time. Identifies an external client contact who consumed a magic
    // link. Scoped to one client; cross-client API calls return 403.
    clientPortalSession?: { contactId: string; clientId: string; slug: string };
  }
}

/** Idle timeout: a session ends after this long without a request. */
export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const store = new RedisStore({ client: redisSession, prefix: 'sess:' });

export const sessionMiddleware = session({
  store,
  name: 'connect.sid',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Sliding expiry: every authenticated response re-issues the cookie with a
  // fresh maxAge (and connect-redis's touch() refreshes the Redis TTL), so
  // the 7 days count from the user's last request, not from sign-in. Without
  // this, the Redis TTL slid but the browser cookie still died 7 days after
  // login, logging active users out mid-session. Bearer-token requests set
  // req.session before this middleware runs, so they never get a cookie.
  rolling: true,
  proxy: isProd,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: SESSION_MAX_AGE_MS,
    domain: env.COOKIE_DOMAIN,
  },
});
