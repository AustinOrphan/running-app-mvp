#!/usr/bin/env tsx

/**
 * Database Isolation Helper for Integration Tests
 * Ensures each test gets a clean database state
 */

import { PrismaClient } from '@prisma/client';
import { getTestPrismaClient, connectionPool } from './connectionPoolManager.js';

class DatabaseIsolationHelper {
  // Use shared connection pool instead of singleton pattern
  static getPrismaInstance(): PrismaClient {
    return getTestPrismaClient();
  }

  static async cleanDatabase(): Promise<void> {
    try {
      // Use connection pool's optimized cleanup method
      await connectionPool.cleanDatabase();
    } catch (error) {
      console.error('Failed to clean database:', error);
      throw error;
    }
  }

  static async closeConnection(): Promise<void> {
    // Connection pool manages connections, so we just disconnect gracefully
    await connectionPool.disconnect();
  }
}

export { DatabaseIsolationHelper };
