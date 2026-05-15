import type { Request, Response, NextFunction } from 'express';
import { redisSession } from '../redis.js';

export function rateLimit(opts: { key: string; max: number; windowSec: number }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = (req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '');
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
