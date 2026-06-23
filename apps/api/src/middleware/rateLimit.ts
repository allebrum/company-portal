import type { Request, Response, NextFunction } from 'express';

// In-memory fixed-window rate limiter (per process). Redis is gone in the
// Supabase/Netlify model; per-instance limiting is sufficient here and degrades
// safely (a burst is at worst bounded per instance). Buckets self-expire.
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(opts: { key: string; max: number; windowSec: number; clientIpHeader?: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const headerIp = opts.clientIpHeader ? req.header(opts.clientIpHeader) : undefined;
    const ip = (headerIp ?? req.ip ?? req.socket.remoteAddress ?? 'unknown').replace(/[^a-zA-Z0-9.:_-]/g, '');
    const k = `${opts.key}:${ip}`;
    const now = Date.now();
    const b = buckets.get(k);
    if (!b || now >= b.resetAt) {
      buckets.set(k, { count: 1, resetAt: now + opts.windowSec * 1000 });
      next();
      return;
    }
    b.count += 1;
    if (b.count > opts.max) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  };
}

// Opportunistic sweep so the map can't grow unbounded under many distinct IPs.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60_000).unref();
