import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Prisma 7: the runtime connection is supplied via a driver adapter (no engine binary).
// Read the connection string from the process env (prod) or Vite-loaded env (dev).
const connectionString =
  process.env.DATABASE_URL ||
  (import.meta.env.DATABASE_URL as string | undefined) ||
  '';

if (!connectionString) {
  throw new Error('DATABASE_URL is not set — add your Postgres connection string to .env');
}

// Reuse a single PrismaClient across hot-reloads / module re-evaluation.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: import.meta.env.DEV ? ['error', 'warn'] : ['error'],
  });

if (import.meta.env.DEV) globalForPrisma.prisma = prisma;
