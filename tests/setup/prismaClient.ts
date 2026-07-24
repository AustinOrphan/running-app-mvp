import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma Client for tests
 * Can be used by both Jest and Playwright tests
 *
 * NOTE: Prisma resolves relative SQLite paths against the schema directory
 * (prisma/), so the URL is `file:./test.db` — NOT `file:./prisma/test.db`,
 * which would double-nest to prisma/prisma/test.db and fail to open the
 * migrated database that jestSetup provisions at prisma/test.db.
 */
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'file:./test.db',
    },
  },
});
