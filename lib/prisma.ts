import { PrismaClient } from '@prisma/client';

// Global is used here to maintain a cached connection across hot reloads
// in development. This prevents connections growing exponentially
// during API Route usage.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
