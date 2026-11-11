import Redis from 'ioredis';
import { env } from '../config/env';

/** Redis used for sessions/rate limiting (Phase B3+); health checks from B1. */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
});

export async function closeRedis(): Promise<void> {
  redis.disconnect();
}
