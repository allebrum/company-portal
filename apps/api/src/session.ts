import session from 'express-session';
import RedisStore from 'connect-redis';
import { env, isProd } from './env.js';
import { redisSession } from './redis.js';

declare module 'express-session' {
  interface SessionData {
    user?: { userId: string };
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
