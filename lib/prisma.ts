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
    } catch (error) {
      console.warn('Warning: Error during Prisma cleanup:', error);
    }
  }
};

// Force disconnect and reset connection
export const resetPrismaConnection = async (): Promise<void> => {
  if (globalForPrisma.prisma) {
    try {
      await globalForPrisma.prisma.$disconnect();
      globalForPrisma.prisma = null as any;
    } catch (error) {
      console.warn('Warning: Error during Prisma reset:', error);
    }
  }
};

// Graceful shutdown handling
const gracefulShutdown = async () => {
  try {
    await prisma.$disconnect();
    console.log('🔌 Prisma client disconnected gracefully');
  } catch (error) {
    console.error('❌ Error disconnecting Prisma client:', error);
  }
};

// Handle process termination
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
process.on('beforeExit', gracefulShutdown);
