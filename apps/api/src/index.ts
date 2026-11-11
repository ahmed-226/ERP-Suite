import { createServer } from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './db/db';
import { logger } from './lib/logger';
import { closeRedis } from './lib/redis';

const server = createServer(createApp());

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'api listening');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.close();
  await Promise.allSettled([prisma.$disconnect(), closeRedis()]);
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
