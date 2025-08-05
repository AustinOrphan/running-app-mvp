/**
 * In-Memory Database Setup for Test Suites
 *
 * This module provides setup and teardown functions for in-memory SQLite databases
 * in test environments. It ensures fast, isolated testing with proper cleanup.
 */

// Import from appropriate test framework
let beforeAll: any, afterAll: any, afterEach: any;

// Initialize test framework hooks dynamically
// async function _initializeTestFramework() {
//   try {
//     // Try Vitest first (dynamic import for ES modules)
//     const vitest = await import('vitest');
//     beforeAll = vitest.beforeAll;
//     afterAll = vitest.afterAll;
//     afterEach = vitest.afterEach;
//   } catch {
//     // Fallback to Jest globals
//     beforeAll = (global as any).beforeAll;
//     afterAll = (global as any).afterAll;
//     afterEach = (global as any).afterEach;
//   }
// }

// Initialize immediately if in a test environment
if (typeof beforeAll === 'undefined') {
  // Use synchronous approach for Jest compatibility
  try {
    // Check if we're in a Jest environment
    if (typeof (global as any).beforeAll !== 'undefined') {
      beforeAll = (global as any).beforeAll;
      afterAll = (global as any).afterAll;
      afterEach = (global as any).afterEach;
    }
  } catch {
    // Will be initialized later when needed
  }
}
import { InMemoryDatabase, InMemoryDbManager, createTestDatabase } from '../utils/inMemoryDb';
import type { PrismaClient } from '@prisma/client';

// Global database instance for test suites
let globalTestDb: InMemoryDatabase | null = null;

/**
 * Setup configuration for in-memory database
 */
export interface DbTestConfig {
  /** Whether to enable SQL query logging */
  enableLogging?: boolean;
  /** Whether to clean database between tests */
  cleanBetweenTests?: boolean;
  /** Custom seed function for test data */
  seedFunction?: (client: PrismaClient) => Promise<void>;
  /** Test suite identifier for database isolation */
  testSuiteId?: string;
}

/**
 * Setup in-memory database for a test suite
 * Call this in your test file's beforeAll hook
 */
export async function setupInMemoryDb(config: DbTestConfig = {}): Promise<InMemoryDatabase> {
  const {
    enableLogging = process.env.TEST_DB_LOGGING === 'true',
    cleanBetweenTests = true,
    seedFunction,
    testSuiteId = `suite-${Date.now()}`,
  } = config;

  // Create database instance
  globalTestDb = await createTestDatabase(testSuiteId, {
    enableLogging,
    runMigrations: true,
  });

  // Seed initial data if provided
  if (seedFunction) {
    await globalTestDb.seed(seedFunction);
  }

  // Setup cleanup between tests if enabled
  if (cleanBetweenTests) {
    afterEach(async () => {
      if (globalTestDb) {
        await globalTestDb.clean();
        if (seedFunction) {
          await globalTestDb.seed(seedFunction);
        }
      }
    });
  }

  return globalTestDb;
}

/**
 * Get the current test database instance
 */
export function getTestDb(): InMemoryDatabase {
  if (!globalTestDb) {
    throw new Error('Test database not setup. Call setupInMemoryDb() in beforeAll hook.');
  }
  return globalTestDb;
}

/**
 * Get the Prisma client for the current test database
 */
export function getTestDbClient(): PrismaClient {
  return getTestDb().getClient();
}

/**
 * Cleanup in-memory database for a test suite
 * Call this in your test file's afterAll hook
 */
export async function cleanupInMemoryDb(): Promise<void> {
  if (globalTestDb) {
    await globalTestDb.destroy();
    globalTestDb = null;
  }
}

/**
 * Vitest setup hook for automatic database management
 * Add this to your vitest setup files for automatic database lifecycle
 */
export function setupDatabaseLifecycle(config: DbTestConfig = {}): void {
  beforeAll(async () => {
    await setupInMemoryDb(config);
  });

  afterAll(async () => {
    await cleanupInMemoryDb();
  });
}

/**
 * Jest setup hook for automatic database management
 * Add this to your Jest setup files for automatic database lifecycle
 */
export function setupDatabaseLifecycleJest(config: DbTestConfig = {}): void {
  beforeAll(async () => {
    await setupInMemoryDb(config);
  }, 30000); // 30 second timeout for setup

  afterAll(async () => {
    await cleanupInMemoryDb();
  }, 10000); // 10 second timeout for cleanup
}

/**
 * Global cleanup function for all test databases
 * Use this in global teardown scripts
 */
export async function globalDbCleanup(): Promise<void> {
  await InMemoryDbManager.cleanupAll();
}
