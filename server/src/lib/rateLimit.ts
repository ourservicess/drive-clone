import type { MiddlewareHandler } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { env } from '../env.js';
import { AppError } from './errors.js';

/** Best-effort client IP. X-Forwarded-For is only trusted behind a known proxy. */
export function clientIp(c: Parameters<MiddlewareHandler>[0]): string {
  if (env.TRUST_PROXY) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown'; // e.g. in tests, where there is no real socket
  }
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window, in-memory rate limiter. Good enough for a single server.
 * (With several server instances you would store the counters in Redis.)
 */
export function rateLimit(options: { windowMs: number; max: number; name: string }): MiddlewareHandler & {
  reset: () => void;
} {
  const buckets = new Map<string, Bucket>();

  const middleware: MiddlewareHandler = async (c, next) => {
    const now = Date.now();
    const key = `${options.name}:${clientIp(c)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;

    if (bucket.count > options.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      c.header('Retry-After', String(retryAfter));
      throw new AppError(429, 'RATE_LIMITED', `Too many attempts. Try again in ${retryAfter} seconds.`);
    }

    // Occasionally drop stale buckets so memory does not grow forever.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
    await next();
  };

  return Object.assign(middleware, { reset: () => buckets.clear() });
}
