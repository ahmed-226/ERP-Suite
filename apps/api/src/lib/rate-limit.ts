import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';
import { redis } from './redis';

/**
 * Small fixed-window rate limiter backed by Redis (INCR + EXPIRE), so limits
 * survive restarts and multiple dev processes. 429 uses the shared envelope.
 */
export function rateLimit(options: { windowSeconds: number; max: number; key: string }) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Integration tests log in repeatedly within the window; skip throttling.
    if (env.NODE_ENV === 'test') {
      next();
      return;
    }
    const ip = req.ip ?? 'unknown';
    const bucket = `ratelimit:${options.key}:${ip}`;
    try {
      const count = await redis.incr(bucket);
      if (count === 1) await redis.expire(bucket, options.windowSeconds);
      const ttl = await redis.ttl(bucket);
      res.setHeader('ratelimit-limit', String(options.max));
      res.setHeader('ratelimit-remaining', String(Math.max(options.max - count, 0)));
      if (count > options.max) {
        res.setHeader('ratelimit-reset', String(Math.max(ttl, 0)));
        res.status(429).json({
          error: { code: 'RATE_LIMITED', message: 'Too many requests, try again later' },
        });
        return;
      }
    } catch {
      // Redis down: fail open — auth still works, just unthrottled in dev.
    }
    next();
  };
}
