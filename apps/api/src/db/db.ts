import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from '../config/env';

// Prisma 7 + `pg` driver adapter: the connection string is provided HERE, at
// runtime, to the adapter — not in `schema.prisma` (see schema.prisma header).
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
