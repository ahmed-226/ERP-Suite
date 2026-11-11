import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma 7 does not load `.env` files itself. The repo-root `.env` is shared by
// the API and the CLI, so resolve it relative to this file's location.
const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  // The datasource URL is configured HERE and in `src/db/db.ts` (runtime, via
  // the pg driver adapter) — deliberately not in schema.prisma.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
