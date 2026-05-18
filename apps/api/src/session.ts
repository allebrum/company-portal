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
