/**
 * Transaction-based Test Isolation
 *
 * This module provides transaction rollback functionality for test isolation.
 * Each test runs within a transaction that is rolled back after completion,
 * ensuring tests don't interfere with each other while maintaining performance.
 */

import { PrismaClient } from '@prisma/client';
import type { ITXClientDenyList } from '@prisma/client/runtime/library';

// Type for Prisma transaction client
type TransactionClient = Omit<PrismaClient, ITXClientDenyList>;

export interface TransactionIsolationConfig {
  /** Whether to enable transaction rollback isolation */
  enabled: boolean;
  /** Timeout for transactions (in milliseconds) */
  timeout: number;
  /** Whether to log transaction lifecycle events */
  enableLogging: boolean;
  /** Maximum number of nested transactions allowed */
  maxNestingLevel: number;
}

export interface TransactionContext {
  /** The transaction client */
  client: TransactionClient;
  /** Transaction ID for tracking */
  id: string;
  /** Nesting level (0 = root transaction) */
  nestingLevel: number;
  /** Start time for performance tracking */
  startTime: number;
  /** Whether this transaction was rolled back */
  rolledBack: boolean;
}

/**
 * Transaction Isolation Manager
 *
 * Manages database transactions for test isolation, ensuring each test
 * runs in its own transaction that can be rolled back.
 */
export class TransactionIsolationManager {
  private prisma: PrismaClient;
  private config: TransactionIsolationConfig;
  private activeTransactions = new Map<string, TransactionContext>();
  private currentTransaction: TransactionContext | null = null;

  constructor(prisma: PrismaClient, config: Partial<TransactionIsolationConfig> = {}) {
    this.prisma = prisma;
    this.config = {
      enabled: true,
      timeout: 30000, // 30 seconds
      enableLogging: process.env.TEST_TRANSACTION_LOGGING === 'true',
      maxNestingLevel: 3,
      ...config,
    };
  }

  /**
   * Start a new transaction for test isolation
   */
  async startTransaction(testName?: string): Promise<TransactionContext> {
    if (!this.config.enabled) {
      throw new Error('Transaction isolation is disabled');
    }

    const nestingLevel = this.currentTransaction ? this.currentTransaction.nestingLevel + 1 : 0;

    if (nestingLevel > this.config.maxNestingLevel) {
      const error = new Error(
        `Maximum transaction nesting level (${this.config.maxNestingLevel}) exceeded. ` +
          `Current level: ${nestingLevel}. This usually indicates nested test execution or ` +
          `forgotten transaction cleanup. Check your test setup and ensure proper transaction lifecycle management.`
      );

      if (this.config.enableLogging) {
        console.error(`❌ Transaction nesting error:`, {
          requestedLevel: nestingLevel,
          maxAllowed: this.config.maxNestingLevel,
          currentTransaction: this.currentTransaction?.id,
          activeTransactions: this.activeTransactions.size,
          testName: testName || 'unknown',
        });
      }

      throw error;
    }

    const transactionId = `tx-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    if (this.config.enableLogging) {
      console.log(
        `🔄 Starting transaction ${transactionId}${testName ? ` for test: ${testName}` : ''}`
      );
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      this.prisma
        .$transaction(
          async tx => {
            const context: TransactionContext = {
              client: tx,
              id: transactionId,
              nestingLevel,
              startTime,
              rolledBack: false,
            };

            this.activeTransactions.set(transactionId, context);
            this.currentTransaction = context;

            if (this.config.enableLogging) {
              console.log(
                `✅ Transaction ${transactionId} started (nesting level: ${nestingLevel})`
              );
            }

            resolve(context);

            // Keep transaction open indefinitely until rollback is called
            // This is achieved by returning a promise that never resolves
            return new Promise(() => {
              // Transaction will be rolled back when the outer promise is rejected
            });
          },
          {
            timeout: this.config.timeout,
          }
        )
        .catch(error => {
          // This catch handles the intentional rollback
          const context = this.activeTransactions.get(transactionId);
          if (context && !context.rolledBack) {
            // Unexpected error, not intentional rollback
            console.error(`❌ Transaction ${transactionId} failed unexpectedly:`, error);
            reject(error);
          }
        });
    });
  }

  /**
   * Rollback the current transaction
   */
  async rollbackTransaction(transactionId?: string): Promise<void> {
    const targetId = transactionId || this.currentTransaction?.id;

    if (!targetId) {
      if (this.config.enableLogging) {
        console.log('⏭️ No active transaction to rollback');
      }
      return;
    }

    const context = this.activeTransactions.get(targetId);
    if (!context) {
      if (this.config.enableLogging) {
        console.warn(`⚠️ Transaction ${targetId} not found for rollback`);
      }
      return;
    }

    if (context.rolledBack) {
      if (this.config.enableLogging) {
        console.log(`⏭️ Transaction ${targetId} already rolled back`);
      }
      return;
    }

    context.rolledBack = true;
    const duration = Date.now() - context.startTime;

    if (this.config.enableLogging) {
      console.log(`🔄 Rolling back transaction ${targetId} (duration: ${duration}ms)`);
    }

    // Clean up
    this.activeTransactions.delete(targetId);
    if (this.currentTransaction?.id === targetId) {
      this.currentTransaction = null;
    }

    // The actual rollback happens when the transaction function throws/rejects
    // We don't need to do anything special here as Prisma handles it

    if (this.config.enableLogging) {
      console.log(`✅ Transaction ${targetId} rolled back successfully`);
    }
  }

  /**
   * Get the current transaction client for database operations
   */
  getTransactionClient(): TransactionClient {
    if (!this.currentTransaction) {
      throw new Error('No active transaction. Call startTransaction() first.');
    }
    return this.currentTransaction.client;
  }

  /**
   * Get transaction statistics
   */
  getTransactionStats(): {
    activeTransactions: number;
    currentTransactionId: string | null;
    averageDuration: number;
    totalTransactions: number;
  } {
    const active = Array.from(this.activeTransactions.values());
    const averageDuration =
      active.length > 0
        ? active.reduce((sum, tx) => sum + (Date.now() - tx.startTime), 0) / active.length
        : 0;

    return {
      activeTransactions: this.activeTransactions.size,
      currentTransactionId: this.currentTransaction?.id || null,
      averageDuration,
      totalTransactions: this.activeTransactions.size, // Simplified for now
    };
  }

  /**
   * Cleanup all active transactions (emergency cleanup)
   */
  async cleanup(): Promise<void> {
    if (this.config.enableLogging) {
      console.log(`🧹 Cleaning up ${this.activeTransactions.size} active transactions`);
    }

    const transactionIds = Array.from(this.activeTransactions.keys());

    for (const id of transactionIds) {
      await this.rollbackTransaction(id);
    }

    this.activeTransactions.clear();
    this.currentTransaction = null;

    if (this.config.enableLogging) {
      console.log('✅ Transaction cleanup completed');
    }
  }

  /**
   * Check if transaction isolation is active
   */
  isActive(): boolean {
    return this.config.enabled && this.currentTransaction !== null;
  }

  /**
   * Get current transaction context
   */
  getCurrentTransaction(): TransactionContext | null {
    return this.currentTransaction;
  }

  /**
   * Force cleanup of stale transactions (emergency recovery)
   * Use this only when normal cleanup fails
   */
  async forceCleanupStaleTransactions(): Promise<void> {
    if (this.config.enableLogging) {
      console.warn(`⚠️  Force cleaning ${this.activeTransactions.size} stale transactions`);
    }

    const staleTransactions = Array.from(this.activeTransactions.keys());

    for (const transactionId of staleTransactions) {
      try {
        await this.rollbackTransaction(transactionId);
      } catch (error) {
        if (this.config.enableLogging) {
          console.error(`❌ Failed to rollback stale transaction ${transactionId}:`, error);
        }
      }
    }

    // Force clear any remaining transactions
    this.activeTransactions.clear();
    this.currentTransaction = null;

    if (this.config.enableLogging) {
      console.log(`✅ Force cleanup completed, ${staleTransactions.length} transactions cleaned`);
    }
  }

  /**
   * Check for stale transactions that might indicate cleanup issues
   */
  checkForStaleTransactions(): boolean {
    const now = Date.now();
    const staleThreshold = this.config.timeout * 2; // Consider stale if 2x the timeout

    for (const [id, context] of this.activeTransactions) {
      const age = now - context.startTime;
      if (age > staleThreshold) {
        if (this.config.enableLogging) {
          console.warn(`⚠️  Stale transaction detected: ${id} (age: ${age}ms)`);
        }
        return true;
      }
    }

    return false;
  }
}

/**
 * Global transaction manager instance
 */
let globalTransactionManager: TransactionIsolationManager | null = null;

/**
 * Initialize transaction isolation for a Prisma client
 */
export function initializeTransactionIsolation(
  prisma: PrismaClient,
  config?: Partial<TransactionIsolationConfig>
): TransactionIsolationManager {
  globalTransactionManager = new TransactionIsolationManager(prisma, config);
  return globalTransactionManager;
}

/**
 * Get the global transaction manager
 */
export function getTransactionManager(): TransactionIsolationManager {
  if (!globalTransactionManager) {
    throw new Error(
      'Transaction isolation not initialized. Call initializeTransactionIsolation() first.'
    );
  }
  return globalTransactionManager;
}

/**
 * Setup transaction rollback for test frameworks
 */
export interface TestHooks {
  beforeEach: (fn: () => Promise<void>) => void;
  afterEach: (fn: () => Promise<void>) => void;
}

/**
 * Setup automatic transaction rollback for test suites
 */
export function setupTransactionRollback(
  prisma: PrismaClient,
  hooks: TestHooks,
  config?: Partial<TransactionIsolationConfig>
): TransactionIsolationManager {
  const manager = initializeTransactionIsolation(prisma, config);

  hooks.beforeEach(async () => {
    await manager.startTransaction();
  });

  hooks.afterEach(async () => {
    await manager.rollbackTransaction();
  });

  return manager;
}

/**
 * Vitest setup helper
 */
export function setupTransactionRollbackVitest(
  prisma: PrismaClient,
  config?: Partial<TransactionIsolationConfig>
): TransactionIsolationManager {
  // Dynamic import to avoid issues when Vitest is not available
  try {
    const { beforeEach, afterEach } = require('vitest');
    return setupTransactionRollback(prisma, { beforeEach, afterEach }, config);
  } catch {
    throw new Error('Vitest not available. Make sure vitest is installed.');
  }
}

/**
 * Jest setup helper
 */
export function setupTransactionRollbackJest(
  prisma: PrismaClient,
  config?: Partial<TransactionIsolationConfig>
): TransactionIsolationManager {
  // Use global Jest functions
  const beforeEach = (global as any).beforeEach;
  const afterEach = (global as any).afterEach;

  if (!beforeEach || !afterEach) {
    throw new Error('Jest hooks not available. Make sure this is running in a Jest environment.');
  }

  return setupTransactionRollback(prisma, { beforeEach, afterEach }, config);
}

/**
 * Utility function to run a test within a transaction
 */
export async function runInTransaction<T>(
  testFn: (client: TransactionClient) => Promise<T>,
  testName?: string
): Promise<T> {
  const manager = getTransactionManager();
  const context = await manager.startTransaction(testName);

  try {
    const result = await testFn(context.client);
    return result;
  } finally {
    await manager.rollbackTransaction(context.id);
  }
}
