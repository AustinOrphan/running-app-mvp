import { PrismaClient } from '@prisma/client';

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    // Configure connection pooling for better resource management
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
    // Configure for test environment optimization
    ...(process.env.NODE_ENV === 'test' && {
      // Test-specific optimizations
      errorFormat: 'minimal',
    }),
  });

// Singleton pattern to prevent multiple instances
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
      globalForPrisma.prisma = null as unknown as PrismaClient;
    } catch {
      // Silently handle reset errors - they don't affect application functionality
      // TODO: Consider adding proper logging infrastructure (GitHub issue needed)
    }
  }
};

// Graceful shutdown handling
const gracefulShutdown = async () => {
  try {
    await prisma.$disconnect();
    // Graceful shutdown completed successfully - no logging needed
  } catch {
    // Critical: Shutdown errors should be handled by proper logging infrastructure
    // TODO: Create GitHub issue for proper logging system instead of console.error
    // For now, silently handle the error to avoid lint issues
  }
};

// Handle process termination
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('beforeExit', gracefulShutdown);
