import { jest } from '@jest/globals';
import { testDb } from '../integration/utils/testDbSetup.js';
import { TransactionIsolationManager } from '../integration/utils/transactionIsolation.js';
import {
  DatabaseCleanupManager,
  initializeCleanupManager,
} from '../utils/databaseCleanupManager.js';
import { testStateManager } from '../integration/utils/testStateManager.js';
import { setupJestDateMocking } from './jestDateMock.js';
import './platformSetup'; // Auto-apply platform-specific configurations
import './timeoutSetup'; // Auto-apply timeout configurations
import { ensurePrismaClient } from './prismaSetup.js';
import { retryDatabaseOperation, RetryStats } from '../utils/retryUtils';
import {
  connectionPool,
  setupTestDatabase,
  forceCleanupAllConnections,
} from '../utils/connectionPoolManager.js';
import {
  initializeApplicationStateTracking,
  resetApplicationState,
  cleanupApplicationStateTracking,
} from '../utils/applicationStateReset.js';

// Make Jest globals available
(global as any).jest = jest;

// Setup global date mocking for all Jest tests
setupJestDateMocking();

// Initialize transaction isolation manager and cleanup manager
let transactionManager: TransactionIsolationManager;
let cleanupManager: DatabaseCleanupManager;

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.LOG_SALT = process.env.LOG_SALT || 'test-log-salt';
process.env.AUDIT_ENCRYPTION_KEY = process.env.AUDIT_ENCRYPTION_KEY || 'test-audit-key';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'test-encryption-key';

// Early migration verification to catch schema issues
const verifyMigrationState = async () => {
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db',
        },
      },
    });

    try {
      await prisma.$connect();
      // Quick verification that core schema exists
      await prisma.user.findFirst();
      await prisma.$disconnect();
    } catch (error) {
      await prisma.$disconnect();
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('does not exist') || errorMessage.includes('no such table')) {
        console.error('❌ Jest Setup: Database schema not ready for tests');
        console.error('💡 Migrations may not have run properly in globalSetup');
        console.error('🔧 Ensure globalSetup completed successfully before running tests');
      }
      throw error;
    }
  } catch (error) {
    // Only log if it's a real schema issue, not a connection issue
    if (
      error instanceof Error &&
      (error.message.includes('does not exist') || error.message.includes('no such table'))
    ) {
      console.error('⚠️  Migration verification failed in Jest setup:', error.message);
    }
  }
};

// Run verification but don't block setup if there are minor issues
verifyMigrationState().catch(error => {
  if (process.env.DEBUG_TESTS) {
    console.log('Migration verification completed with issues:', error.message);
  }
});
process.env.BCRYPT_ROUNDS = process.env.BCRYPT_ROUNDS || '10'; // Lower for faster tests

// Initialize test database once before all tests
beforeAll(async () => {
  try {
    // Ensure Prisma client is generated before database operations
    await ensurePrismaClient();

    // Initialize connection pool first
    await setupTestDatabase();

    await testDb.initialize();
    // Ensure foreign keys are enabled for SQLite
    if (process.env.DATABASE_URL?.includes('file:')) {
      await testDb.prisma.$executeRaw`PRAGMA foreign_keys = ON`;
    }

    // Initialize transaction isolation manager
    transactionManager = new TransactionIsolationManager(testDb.prisma);

    // Initialize comprehensive cleanup manager
    cleanupManager = initializeCleanupManager(testDb.prisma, transactionManager);

    // Initialize application state tracking for tests
    initializeApplicationStateTracking();

    if (process.env.DEBUG_TESTS) {
      console.log(
        '✅ Test infrastructure initialized with connection pooling, comprehensive cleanup manager, and application state reset'
      );
    }
  } catch (error) {
    console.error('Failed to initialize test database:', error);
    throw error;
  }
}, 30000); // 30 second timeout

// Setup database isolation before each test with retry logic
beforeEach(async () => {
  // Capture application state before test
  testStateManager.captureState();

  await retryDatabaseOperation(
    async () => {
      // Try to start transaction for optimal performance
      await transactionManager.startTransaction();

      if (process.env.DEBUG_TESTS) {
        console.log('🔄 Transaction started for test isolation');
      }
    },
    {
      maxAttempts: 2,
      delayMs: 500,
      description: 'database transaction start',
      shouldRetry: (error: unknown, _attempt: number) => {
        // Retry on connection issues but not on transaction errors
        if (error instanceof Error) {
          const message = error.message.toLowerCase();
          return message.includes('connection') || message.includes('busy');
        }
        return false;
      },
    }
  ).catch(error => {
    console.warn('Failed to start transaction before test, will use cleanup fallback:', error);
    // Don't pre-clean here, let the cleanup manager handle it in afterEach
  });
});

// Clean database and reset application state after each test
afterEach(async () => {
  try {
    // Reset comprehensive application state (in-memory caches, global variables, side effects)
    await resetApplicationState();

    if (process.env.DEBUG_TESTS) {
      console.log('🔄 Application state reset completed');
    }
  } catch (error) {
    console.warn('Failed to reset application state:', error);
  }

  await retryDatabaseOperation(
    async () => {
      // Use comprehensive cleanup manager for optimal strategy selection
      const result = await cleanupManager.cleanDatabase({
        verifyCleanup: true,
        fallbackStrategy: true,
        enableProfiling: process.env.DEBUG_TESTS === 'true',
      });

      if (process.env.DEBUG_TESTS) {
        console.log(
          `✅ Database cleaned using ${result.strategy} strategy in ${result.duration}ms`
        );
      }
    },
    {
      maxAttempts: 3,
      delayMs: 1000,
      description: 'database cleanup',
    }
  ).catch(async error => {
    console.error('❌ All cleanup strategies failed:', error);

    // Last resort: manual cleanup without verification
    try {
      console.warn('🚨 Attempting last resort cleanup...');
      await testDb.clean();
    } catch (manualError) {
      console.error('💥 Manual cleanup also failed:', manualError);
      // At this point, tests may be in an inconsistent state
      throw new Error('Complete database cleanup failure - tests may be unreliable');
    }
  });
});

// Disconnect after all tests
afterAll(async () => {
  try {
    // Clean up transaction manager
    if (transactionManager) {
      await transactionManager.cleanup();
    }

    // Print cleanup statistics if debugging
    if (process.env.DEBUG_TESTS && cleanupManager) {
      const stats = cleanupManager.getCleanupStats();
      console.log('📊 Cleanup Statistics:', {
        totalCleanups: stats.totalCleanups,
        averageDuration: `${stats.averageDuration.toFixed(2)}ms`,
        successRate: `${stats.successRate.toFixed(1)}%`,
        preferredStrategy: stats.preferredStrategy,
        strategyUsage: stats.strategyUsage,
      });
    }

    // Print retry statistics if debugging
    if (process.env.DEBUG_TESTS) {
      const retryReport = RetryStats.generateReport();
      if (retryReport.includes('Total tests with retry data: 0') === false) {
        console.log(retryReport);
      }
    }

    // Perform final database reset and cleanup with retry
    // Connection pool cleanup logging
    if (process.env.DEBUG_TESTS) {
      console.log('📊 Connection Pool Active Connections:', connectionPool?.size || 0);
    }

    await retryDatabaseOperation(
      async () => {
        await testDb.reset();
        await testDb.disconnect();
      },
      {
        maxAttempts: 2,
        delayMs: 1000,
        description: 'final database cleanup',
      }
    );

    // Clean up all connection pool clients
    await forceCleanupAllConnections();

    // Clean up application state tracking
    cleanupApplicationStateTracking();

    if (process.env.DEBUG_TESTS) {
      console.log(
        '✅ Test suite cleanup completed with connection pool teardown and application state tracking'
      );
    }
  } catch (error) {
    console.warn('Failed to clean up after tests:', error);
  }
});

// Export for use in tests
export { testDb, transactionManager, cleanupManager, testStateManager };
