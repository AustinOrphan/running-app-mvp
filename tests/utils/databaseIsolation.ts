#!/usr/bin/env tsx

/**
 * Database Isolation Helper for Integration Tests
 * Ensures each test gets a clean database state
 */

import { PrismaClient } from '@prisma/client';

class DatabaseIsolationHelper {
  private static prismaInstance: PrismaClient | null = null;

  static getPrismaInstance(): PrismaClient {
    if (!this.prismaInstance) {
      const dbUrl =
        process.env.TEST_DATABASE_URL ||
        process.env.DATABASE_URL ||
        'file:./prisma/integration-test.db';

      this.prismaInstance = new PrismaClient({
        datasources: {
          db: { url: dbUrl },
        },
        log: process.env.DEBUG_TESTS ? ['query', 'error'] : ['error'],
      });
    }
    return this.prismaInstance;
  }

  static async cleanDatabase(): Promise<void> {
    const prisma = this.getPrismaInstance();

    try {
      await prisma.$connect();

      // Use transaction for atomic cleanup
      await prisma.$transaction(async tx => {
        // Delete in order to respect foreign key constraints
        await tx.race.deleteMany();
        await tx.goal.deleteMany();
        await tx.run.deleteMany();
        await tx.user.deleteMany();
      });
    } catch (error) {
      console.error('Failed to clean database:', error);
      throw error;
    }
  }

  static async closeConnection(): Promise<void> {
    if (this.prismaInstance) {
      await this.prismaInstance.$disconnect();
      this.prismaInstance = null;
    }
  }
}

export { DatabaseIsolationHelper };
