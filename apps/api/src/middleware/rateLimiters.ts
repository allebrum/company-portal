import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { redisSession } from '../redis.js';
import { hashToken } from '../auth/patFormat.js';
import { parseBearer } from './tokenPolicy.js';

/**
 * express-rate-limit limiters for the personal-access-token surface, backed
 * by the shared Redis (so limits hold across API replicas). Each limiter gets
 * its own key prefix. On a Redis error they fail open (`passOnStoreError`),
 * matching the older custom limiter in middleware/rateLimit.ts.
 */
function store(prefix: string) {
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (command: string, ...args: string[]) =>
      redisSession.call(command, ...args) as Promise<RedisReply>,
  });
}

function rateLimited(_req: Request, res: Response) {
  res.status(429).json({ error: 'rate_limited' });
}

const hasBearer = (req: Request) => parseBearer(req.get('authorization')) !== undefined;

/**
 * Failed bearer authentications per IP: 20 per 10 minutes. Only 401s count
 * (successful/other responses are refunded), and requests without a bearer
 * header are ignored, so normal browser traffic is never affected.
 */
export const patFailedAuthLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => !hasBearer(req),
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode !== 401,
  passOnStoreError: true,
  store: store('pat-fail'),
  handler: rateLimited,
});

/**
 * Requests per token: 120 per minute. Keyed by a truncated hash of the
 * presented token (never the token itself), so one bot can't starve another
 * sharing an IP.
 */
export const patPerTokenLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => !hasBearer(req),
  keyGenerator: (req) => hashToken(parseBearer(req.get('authorization')) ?? '').slice(0, 32),
  passOnStoreError: true,
  store: store('pat'),
  handler: rateLimited,
});

const userOrIp = (req: Request) => req.session?.user?.userId ?? `ip:${req.ip ?? 'unknown'}`;

/**
 * Token management API overall: 60 requests per minute per user. Bearer
 * requests (only `GET /current` is reachable) are already covered by
 * patPerTokenLimiter, so they're skipped here.
 */
export const apiTokensRouteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req) => req.authVia === 'token',
  keyGenerator: userOrIp,
  passOnStoreError: true,
  store: store('pat-mgmt'),
  handler: rateLimited,
});

/** Token creation: 10 per hour per user (was 10/hour per IP). */
export const apiTokenCreateLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  passOnStoreError: true,
  store: store('pat-create'),
  handler: rateLimited,
});
