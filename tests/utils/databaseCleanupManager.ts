/**
 * Database Cleanup Manager for Test Isolation
 *
 * Provides multiple strategies for cleaning database between tests:
 * 1. Transaction rollback (fastest, preferred)
 * 2. Optimized manual cleanup (fallback)
 * 3. Full database reset (last resort)
 */

import { PrismaClient } from '@prisma/client';
import { TransactionIsolationManager } from './transactionIsolation';
import { testDb } from '../integration/utils/testDbSetup';

export interface CleanupStrategy {
  name: 'transaction' | 'optimized' | 'full-reset';
  priority: number;
  description: string;
}

export interface CleanupOptions {
  maxRetries?: number;
  verifyCleanup?: boolean;
  fallbackStrategy?: boolean;
  enableProfiling?: boolean;
}

export interface CleanupResult {
  strategy: CleanupStrategy['name'];
  duration: number;
  success: boolean;
  recordsAffected?: number;
  error?: Error;
}

/**
 * Comprehensive Database Cleanup Manager
 */
export class DatabaseCleanupManager {
  private transactionManager?: TransactionIsolationManager;
  private prisma: PrismaClient;
  private cleanupHistory: CleanupResult[] = [];
  private currentStrategy: CleanupStrategy['name'] = 'transaction';

  constructor(prisma: PrismaClient, transactionManager?: TransactionIsolationManager) {
    this.prisma = prisma;
    this.transactionManager = transactionManager;
  }

  /**
   * Available cleanup strategies in order of preference
   */
  private readonly strategies: CleanupStrategy[] = [
    {
      name: 'transaction',
      priority: 1,
      description: 'Transaction rollback (fastest, preferred)',
    },
    {
      name: 'optimized',
      priority: 2,
      description: 'Optimized manual cleanup with verification',
    },
    {
      name: 'full-reset',
      priority: 3,
      description: 'Full database reset (slowest, most thorough)',
    },
  ];

  /**
   * Clean database using the best available strategy
   */
  async cleanDatabase(options: CleanupOptions = {}): Promise<CleanupResult> {
    const {
      maxRetries = 3,
      verifyCleanup = true,
      fallbackStrategy = true,
      enableProfiling = process.env.DEBUG_TESTS === 'true',
    } = options;

    const startTime = Date.now();
    let lastError: Error | undefined;

    // Try each strategy in order of preference
    for (const strategy of this.strategies) {
      try {
        if (enableProfiling) {
          console.log(`🧹 Attempting ${strategy.description}...`);
        }

        const result = await this.executeCleanupStrategy(strategy.name, {
          maxRetries,
          verifyCleanup,
          enableProfiling,
        });

        if (result.success) {
          this.currentStrategy = strategy.name;
          this.cleanupHistory.push(result);

          if (enableProfiling) {
            console.log(
              `✅ Database cleaned successfully using ${strategy.name} strategy in ${result.duration}ms`
            );
          }

          return result;
        }

        lastError = result.error;

        if (!fallbackStrategy) {
          break; // Don't try other strategies
        }

        if (enableProfiling) {
          console.warn(`⚠️ ${strategy.name} strategy failed, trying next...`);
        }
      } catch (error) {
        lastError = error as Error;

        if (enableProfiling) {
          console.warn(`⚠️ ${strategy.name} strategy failed:`, error);
        }

        if (!fallbackStrategy) {
          break;
        }
      }
    }

    // All strategies failed
    const duration = Date.now() - startTime;
    const failureResult: CleanupResult = {
      strategy: this.currentStrategy,
      duration,
      success: false,
      error: lastError || new Error('All cleanup strategies failed'),
    };

    this.cleanupHistory.push(failureResult);
    throw lastError || new Error('All cleanup strategies failed');
  }

  /**
   * Execute a specific cleanup strategy
   */
  private async executeCleanupStrategy(
    strategy: CleanupStrategy['name'],
    options: {
      maxRetries: number;
      verifyCleanup: boolean;
      enableProfiling: boolean;
    }
  ): Promise<CleanupResult> {
    const { maxRetries, verifyCleanup, enableProfiling } = options;
    const startTime = Date.now();

    let attempt = 0;
    while (attempt < maxRetries) {
      try {
        let recordsAffected = 0;

        switch (strategy) {
          case 'transaction':
            recordsAffected = await this.cleanupWithTransaction();
            break;
          case 'optimized':
            recordsAffected = await this.cleanupWithOptimizedMethod();
            break;
          case 'full-reset':
            recordsAffected = await this.cleanupWithFullReset();
            break;
          default:
            throw new Error(`Unknown cleanup strategy: ${strategy}`);
        }

        // Verify cleanup if requested
        if (verifyCleanup) {
          const isClean = await testDb.verify();
          if (!isClean) {
            throw new Error('Database cleanup verification failed');
          }
        }

        const duration = Date.now() - startTime;
        return {
          strategy,
          duration,
          success: true,
          recordsAffected,
        };
      } catch (error) {
        attempt++;
        if (attempt >= maxRetries) {
          const duration = Date.now() - startTime;
          return {
            strategy,
            duration,
            success: false,
            error: error as Error,
          };
        }

        if (enableProfiling) {
          console.warn(`Cleanup attempt ${attempt} failed, retrying...`, error);
        }

        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 50 * attempt));
      }
    }

    // This should never be reached, but TypeScript requires it
    const duration = Date.now() - startTime;
    return {
      strategy,
      duration,
      success: false,
      error: new Error('Max retries exceeded'),
    };
  }

  /**
   * Cleanup using transaction rollback (fastest)
   */
  private async cleanupWithTransaction(): Promise<number> {
    if (!this.transactionManager || !this.transactionManager.isActive()) {
      throw new Error('Transaction manager not available or no active transaction');
    }

    await this.transactionManager.rollbackTransaction();

    // For transaction rollback, we don't know exact records affected
    // Return 0 as it's a rollback operation
    return 0;
  }

  /**
   * Cleanup using optimized manual method
   */
  private async cleanupWithOptimizedMethod(): Promise<number> {
    // Count records before cleanup for reporting
    const beforeCounts = await this.countAllRecords();
    const totalBefore = Object.values(beforeCounts).reduce((sum, count) => sum + count, 0);

    await testDb.cleanOptimized({ skipVerification: true });

    return totalBefore;
  }

  /**
   * Cleanup using full database reset (slowest but most thorough)
   */
  private async cleanupWithFullReset(): Promise<number> {
    // Count records before cleanup for reporting
    const beforeCounts = await this.countAllRecords();
    const totalBefore = Object.values(beforeCounts).reduce((sum, count) => sum + count, 0);

    await testDb.reset();

    return totalBefore;
  }

  /**
   * Count all records in all tables
   */
  private async countAllRecords(): Promise<Record<string, number>> {
    try {
      const [users, runs, goals, races] = await Promise.all([
        this.prisma.user.count(),
        this.prisma.run.count(),
        this.prisma.goal.count(),
        this.prisma.race.count(),
      ]);

      return { users, runs, goals, races };
    } catch (error) {
      console.warn('Failed to count records:', error);
      return { users: 0, runs: 0, goals: 0, races: 0 };
    }
  }

  /**
   * Get cleanup performance statistics
   */
  getCleanupStats(): {
    totalCleanups: number;
    averageDuration: number;
    successRate: number;
    preferredStrategy: CleanupStrategy['name'];
    strategyUsage: Record<CleanupStrategy['name'], number>;
  } {
    if (this.cleanupHistory.length === 0) {
      return {
        totalCleanups: 0,
        averageDuration: 0,
        successRate: 0,
        preferredStrategy: 'transaction',
        strategyUsage: { transaction: 0, optimized: 0, 'full-reset': 0 },
      };
    }

    const successful = this.cleanupHistory.filter(r => r.success);
    const totalDuration = this.cleanupHistory.reduce((sum, r) => sum + r.duration, 0);

    const strategyUsage = this.cleanupHistory.reduce(
      (usage, result) => {
        usage[result.strategy] = (usage[result.strategy] || 0) + 1;
        return usage;
      },
      {} as Record<CleanupStrategy['name'], number>
    );

    // Find most used successful strategy
    const preferredStrategy =
      (Object.entries(strategyUsage).sort(
        ([, a], [, b]) => b - a
      )[0]?.[0] as CleanupStrategy['name']) || 'transaction';

    return {
      totalCleanups: this.cleanupHistory.length,
      averageDuration: totalDuration / this.cleanupHistory.length,
      successRate: (successful.length / this.cleanupHistory.length) * 100,
      preferredStrategy,
      strategyUsage: {
        transaction: 0,
        optimized: 0,
        'full-reset': 0,
        ...strategyUsage,
      },
    };
  }

  /**
   * Reset cleanup statistics
   */
  resetStats(): void {
    this.cleanupHistory = [];
  }

  /**
   * Set the transaction manager (useful for late initialization)
   */
  setTransactionManager(transactionManager: TransactionIsolationManager): void {
    this.transactionManager = transactionManager;
  }

  /**
   * Get current strategy being used
   */
  getCurrentStrategy(): CleanupStrategy['name'] {
    return this.currentStrategy;
  }

  /**
   * Force a specific strategy for next cleanup
   */
  setStrategy(strategy: CleanupStrategy['name']): void {
    this.currentStrategy = strategy;
  }
}

/**
 * Global cleanup manager instance
 */
let globalCleanupManager: DatabaseCleanupManager | null = null;

/**
 * Initialize global cleanup manager
 */
export function initializeCleanupManager(
  prisma: PrismaClient,
  transactionManager?: TransactionIsolationManager
): DatabaseCleanupManager {
  globalCleanupManager = new DatabaseCleanupManager(prisma, transactionManager);
  return globalCleanupManager;
}

/**
 * Get the global cleanup manager
 */
export function getCleanupManager(): DatabaseCleanupManager {
  if (!globalCleanupManager) {
    throw new Error('Cleanup manager not initialized. Call initializeCleanupManager() first.');
  }
  return globalCleanupManager;
}

/**
 * Clean database using the global cleanup manager
 */
export async function cleanDatabase(options?: CleanupOptions): Promise<CleanupResult> {
  const manager = getCleanupManager();
  return manager.cleanDatabase(options);
}
