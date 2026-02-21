import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma Client for tests
 * Can be used by both Jest and Playwright tests
 */
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'file:./prisma/test.db',
    },
  },
});
