import session from 'express-session';
import RedisStore from 'connect-redis';
import { env, isProd } from './env.js';
import { redisSession } from './redis.js';

declare module 'express-session' {
  interface SessionData {
    user?: { userId: string };
    // Primary auth passed but a second factor is still required.
    pending?: { userId: string };
    // Transient WebAuthn challenge for register/authenticate ceremonies.
    webauthnChallenge?: string;
    oauthState?: string;
    // Gmail uses its own state slot so a concurrent Drive connect (which
    // also uses `oauthState`) can't collide. Also carries `returnTo` so
    // the JIT connect flow can come back to where the user was.
    gmailOauthState?: { state: string; returnTo?: string };
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
