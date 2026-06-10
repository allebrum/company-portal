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
    // Google *login* OAuth state (auth.ts). Gmail + Drive connect each use
    // their own slots below so concurrent flows can't collide.
    oauthState?: string;
    // Gmail + Drive connect each carry their own state plus an optional
    // same-origin `returnTo`, so the JIT / integration-gate connect flow can
    // bounce the user back to where they were.
    gmailOauthState?: { state: string; returnTo?: string };
    driveOauthState?: { state: string; returnTo?: string };
    // F23 public client portal — sibling of `user`, never set at the same
    // time. Identifies an external client contact who consumed a magic
    // link. Scoped to one client; cross-client API calls return 403.
    clientPortalSession?: { contactId: string; clientId: string; slug: string };
  }
}

const store = new RedisStore({ client: redisSession, prefix: 'sess:' });

export const sessionMiddleware = session({
  store,
  name: 'connect.sid',
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  proxy: isProd,
  cookie: {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    domain: env.COOKIE_DOMAIN,
  },
});
