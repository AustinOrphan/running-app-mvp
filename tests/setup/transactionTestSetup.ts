/**
 * Transaction-based Test Setup
 *
 * This module provides test setup using transaction rollback for isolation.
 * Tests run within transactions that are automatically rolled back, ensuring
 * complete isolation without the performance cost of database cleanup.
 */

import { PrismaClient } from '@prisma/client';
import {
  TransactionIsolationManager,
  setupTransactionRollbackJest,
  setupTransactionRollbackVitest,
  initializeTransactionIsolation,
  // getTransactionManager,
} from '../utils/transactionIsolation';

// Global transaction manager instance
let transactionManager: TransactionIsolationManager | null = null;

export interface TransactionTestConfig {
  /** Whether to enable transaction isolation */
  enableIsolation: boolean;
  /** Transaction timeout in milliseconds */
  timeout: number;
  /** Whether to log transaction events */
  enableLogging: boolean;
  /** Test framework being used */
  framework: 'jest' | 'vitest' | 'manual';
  /** Custom Prisma client (optional) */
  prismaClient?: PrismaClient;
}

/**
 * Setup transaction-based test isolation
 */
export async function setupTransactionTesting(
  config: Partial<TransactionTestConfig> = {}
): Promise<TransactionIsolationManager> {
  const finalConfig: TransactionTestConfig = {
    enableIsolation: true,
    timeout: 30000,
    enableLogging: process.env.TEST_TRANSACTION_LOGGING === 'true',
    framework: detectTestFramework(),
    ...config,
  };

  // Get or create Prisma client
  const prisma = finalConfig.prismaClient || createTestPrismaClient();

  // Ensure database is connected
  await prisma.$connect();

  // Initialize transaction manager based on framework
  if (finalConfig.enableIsolation) {
    try {
      if (finalConfig.framework === 'jest') {
        transactionManager = setupTransactionRollbackJest(prisma, {
          enabled: finalConfig.enableIsolation,
          timeout: finalConfig.timeout,
          enableLogging: finalConfig.enableLogging,
          maxNestingLevel: 3,
        });
      } else if (finalConfig.framework === 'vitest') {
        transactionManager = setupTransactionRollbackVitest(prisma, {
          enabled: finalConfig.enableIsolation,
          timeout: finalConfig.timeout,
          enableLogging: finalConfig.enableLogging,
          maxNestingLevel: 3,
        });
      } else {
        // Manual setup - user must handle beforeEach/afterEach
        transactionManager = initializeTransactionIsolation(prisma, {
          enabled: finalConfig.enableIsolation,
          timeout: finalConfig.timeout,
          enableLogging: finalConfig.enableLogging,
          maxNestingLevel: 3,
        });
      }

      if (finalConfig.enableLogging) {
        console.log(`✅ Transaction isolation setup complete (${finalConfig.framework})`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to setup transaction isolation, falling back to manual mode:', error);
      transactionManager = initializeTransactionIsolation(prisma, {
        enabled: false,
        timeout: finalConfig.timeout,
        enableLogging: finalConfig.enableLogging,
        maxNestingLevel: 3,
      });
    }
  } else {
    // Isolation disabled
    transactionManager = initializeTransactionIsolation(prisma, {
      enabled: false,
      timeout: finalConfig.timeout,
      enableLogging: finalConfig.enableLogging,
      maxNestingLevel: 3,
    });
  }

  return transactionManager;
}

/**
 * Get the current transaction client for database operations
 */
export function getTransactionClient(): PrismaClient {
  if (!transactionManager) {
    throw new Error('Transaction testing not setup. Call setupTransactionTesting() first.');
  }

  if (transactionManager.isActive()) {
    return transactionManager.getTransactionClient() as PrismaClient;
  } else {
    // Fallback to regular Prisma client if no transaction is active
    return createTestPrismaClient();
  }
}

/**
 * Cleanup transaction testing
 */
export async function cleanupTransactionTesting(): Promise<void> {
  if (transactionManager) {
    await transactionManager.cleanup();
    transactionManager = null;
  }
}

/**
 * Check if transaction isolation is currently active
 */
export function isTransactionIsolationActive(): boolean {
  return transactionManager?.isActive() ?? false;
}

/**
 * Get transaction statistics for monitoring
 */
export function getTransactionStats() {
  return (
    transactionManager?.getTransactionStats() ?? {
      activeTransactions: 0,
      currentTransactionId: null,
      averageDuration: 0,
      totalTransactions: 0,
    }
  );
}

/**
 * Manual transaction control for advanced use cases
 */
export async function startManualTransaction(testName?: string) {
  if (!transactionManager) {
    throw new Error('Transaction testing not setup. Call setupTransactionTesting() first.');
  }
  return transactionManager.startTransaction(testName);
}

/**
 * Manual transaction rollback
 */
export async function rollbackManualTransaction(transactionId?: string) {
  if (!transactionManager) {
    throw new Error('Transaction testing not setup. Call setupTransactionTesting() first.');
  }
  return transactionManager.rollbackTransaction(transactionId);
}

/**
 * Detect which test framework is being used
 */
function detectTestFramework(): 'jest' | 'vitest' | 'manual' {
  // Check for Jest
  if (
    typeof (global as any).beforeEach === 'function' &&
    typeof (global as any).afterEach === 'function' &&
    typeof (global as any).jest !== 'undefined'
  ) {
    return 'jest';
  }

  // Check for Vitest
  try {
    require('vitest');
    return 'vitest';
  } catch {
    // Vitest not available
  }

  // Default to manual
  return 'manual';
}

/**
 * Create a test Prisma client with appropriate configuration
 */
function createTestPrismaClient(): PrismaClient {
  const databaseUrl =
    process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db';

  return new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
    log: process.env.DEBUG_TESTS ? ['query', 'info', 'warn', 'error'] : ['error'],
  });
}

/**
 * Jest-specific setup function
 */
export async function setupTransactionTestingJest(
  config?: Partial<TransactionTestConfig>
): Promise<TransactionIsolationManager> {
  return setupTransactionTesting({
    ...config,
    framework: 'jest',
  });
}

/**
 * Vitest-specific setup function
 */
export async function setupTransactionTestingVitest(
  config?: Partial<TransactionTestConfig>
): Promise<TransactionIsolationManager> {
  return setupTransactionTesting({
    ...config,
    framework: 'vitest',
  });
}

/**
 * Utility to run a single test with transaction isolation
 */
export async function runTestWithTransaction<T>(
  testFn: (client: PrismaClient) => Promise<T>,
  testName?: string
): Promise<T> {
  const manager = transactionManager || (await setupTransactionTesting());

  const context = await manager.startTransaction(testName);
  try {
    const result = await testFn(context.client as PrismaClient);
    return result;
  } finally {
    await manager.rollbackTransaction(context.id);
  }
}
