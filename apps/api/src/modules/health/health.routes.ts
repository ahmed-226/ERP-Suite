import { Router } from 'express';
import { prisma } from '../../db/db';
import { redis } from '../../lib/redis';

export const healthRouter = Router();

/** GET /api/v1/health — liveness plus DB and Redis reachability. */
healthRouter.get('/', async (req, res) => {
  const [db, redisOk] = await Promise.allSettled([
    prisma.$queryRaw`SELECT 1`,
    redis.ping(),
  ]);

  const healthy = db.status === 'fulfilled' && redisOk.status === 'fulfilled';
  const body = {
    status: healthy ? 'ok' : 'degraded',
    db: db.status === 'fulfilled' ? 'ok' : 'unavailable',
    redis: redisOk.status === 'fulfilled' ? 'ok' : 'unavailable',
    uptimeSeconds: Math.round(process.uptime()),
  };

  if (healthy) {
    res.status(200).json(body);
  } else {
    req.log.warn(body, 'health check degraded');
    res.status(503).json(body);
  }
});
