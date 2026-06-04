import type { Request, Response, NextFunction } from 'express';
import { redisSession } from '../redis.js';

export function rateLimit(opts: { key: string; max: number; windowSec: number; clientIpHeader?: string }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Optionally key on a forwarded client IP (e.g. the marketing BFF passes the
    // real visitor IP via `x-client-ip`). Only used on endpoints already gated to
    // a trusted caller, so the header can't be spoofed by the public.
    const headerIp = opts.clientIpHeader ? req.header(opts.clientIpHeader) : undefined;
    const ip = (headerIp ?? req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '');
    const k = `rl:${opts.key}:${ip}`;
    try {
      const n = await redisSession.incr(k);
      if (n === 1) await redisSession.expire(k, opts.windowSec);
      if (n > opts.max) {
        res.status(429).json({ error: 'rate_limited' });
        return;
      }
      next();
    } catch {
      next();
    }
  };
}
