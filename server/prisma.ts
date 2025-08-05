import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// SQLite connection optimization for different environments
const getSQLiteConnectionString = (baseUrl: string) => {
  if (process.env.NODE_ENV === 'test') {
    // Test environment: Use separate database with optimized settings for longer timeouts
    return baseUrl.includes('test.db')
      ? `${baseUrl}?connection_limit=1&busy_timeout=30000&socket_timeout=60000&pool_timeout=10000&synchronous=OFF&journal_mode=WAL`
      : `${baseUrl.replace(/\.db$/, '-test.db')}?connection_limit=1&busy_timeout=30000&socket_timeout=60000&pool_timeout=10000&synchronous=OFF&journal_mode=WAL`;
  } else if (process.env.NODE_ENV === 'development') {
    // Development: Enable WAL mode for better concurrent access with reasonable timeouts
    return `${baseUrl}?busy_timeout=15000&socket_timeout=30000&synchronous=NORMAL&journal_mode=WAL`;
  } else {
    // Production: Conservative settings for reliability with extended timeouts
    return `${baseUrl}?busy_timeout=30000&socket_timeout=60000&synchronous=FULL&journal_mode=WAL`;
  }
};

const databaseUrl = process.env.DATABASE_URL || 'file:./prisma/dev.db';
const optimizedUrl = getSQLiteConnectionString(databaseUrl);

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    datasources: {
      db: {
        url: optimizedUrl,
      },
    },
    // Error format optimization for better debugging
    errorFormat: process.env.NODE_ENV === 'development' ? 'pretty' : 'minimal',
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Connection cleanup helper for tests
export const cleanupPrismaConnection = async (): Promise<void> => {
  if (globalForPrisma.prisma) {
    try {
      await globalForPrisma.prisma.$disconnect();
    } catch {
      // Silently handle cleanup errors - they don't affect application functionality
      // TODO: Consider adding proper logging infrastructure (GitHub issue needed)
    }
  }
};

// Force disconnect and reset connection
export const resetPrismaConnection = async (): Promise<void> => {
  if (globalForPrisma.prisma) {
    try {
      await globalForPrisma.prisma.$disconnect();
      globalForPrisma.prisma = undefined;
    } catch {
      // Silently handle reset errors - they don't affect application functionality
      // TODO: Consider adding proper logging infrastructure (GitHub issue needed)
    }
  }
};

export default prisma;
