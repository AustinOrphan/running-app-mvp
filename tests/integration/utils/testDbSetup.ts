import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  TestDataIsolationManager,
  createTestDataIsolationManager,
  testDataUtils,
} from '../../utils/testDataIsolationManager.js';
import {
  FixtureLoader,
  createFixtureLoader,
  FixtureLoadingUtils,
} from '../../fixtures/fixtureLoader.js';
import { TestFixtures, FixtureCollections } from '../../fixtures/testFixtures.js';

// Use a singleton pattern to ensure only one Prisma instance
let prismaInstance: PrismaClient | null = null;

/**
 * Gets or creates a singleton Prisma instance for tests
 */
export const getTestPrisma = () => {
  if (!prismaInstance) {
    const databaseUrl =
      process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db';
    prismaInstance = new PrismaClient({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      log: process.env.DEBUG_TESTS ? ['query', 'info', 'warn', 'error'] : ['error'],
      // Note: Connection pooling for SQLite is handled internally by Prisma
      // Configuration is done via URL parameters in connectionPoolManager
    });

    // Enhanced Prisma shutdown handling with connection leak prevention
    const cleanup = async () => {
      if (prismaInstance) {
        try {
          if (process.env.DEBUG_TESTS) {
            console.log('🔌 Disconnecting test Prisma instance...');
          }

          // Force disconnect to ensure no hanging connections
          await Promise.race([
            prismaInstance.$disconnect(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Disconnect timeout')), 5000)
            ),
          ]);

          if (process.env.DEBUG_TESTS) {
            console.log('✅ Test Prisma instance disconnected successfully');
          }
        } catch (error) {
          console.warn('⚠️ Error during Prisma cleanup:', error);
          // Force null the instance even if disconnect fails
          prismaInstance = null;
        }
      }
    };

    // Register cleanup handlers for all possible exit scenarios
    process.on('beforeExit', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

    // Handle unhandled promise rejections that could leave connections open
    process.on('unhandledRejection', (reason, promise) => {
      if (process.env.DEBUG_TESTS) {
        console.warn('Unhandled rejection detected, ensuring database cleanup:', reason);
      }
      cleanup().catch(() => {}); // Ensure cleanup runs even if it fails
    });
    process.on('SIGHUP', cleanup);
  }
  return prismaInstance;
};

/**
 * Ensures the test database is properly initialized with migrations
 */
export const initializeTestDatabase = async () => {
  const prisma = getTestPrisma();

  try {
    // Check connection
    await prisma.$connect();

    // Verify that all required tables exist by testing core tables
    try {
      await Promise.all([
        prisma.user.findFirst(),
        prisma.run.findFirst(),
        prisma.goal.findFirst(),
        prisma.race.findFirst(),
      ]);

      // If all queries succeed, database schema is properly initialized
      if (process.env.DEBUG_TESTS) {
        console.log('✅ Test database schema verified');
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('does not exist') || errorMessage.includes('no such table')) {
        console.error('❌ Database tables do not exist. Schema verification failed.');
        console.error('💡 This indicates migrations were not run properly before tests.');
        console.error('📋 Expected tables: user, run, goal, race');
        throw new Error(`Database schema not initialized: ${errorMessage}`);
      }
      // If it's not a "table doesn't exist" error, it might be ok (e.g., empty tables)
      if (process.env.DEBUG_TESTS) {
        console.log('⚠️  Database query failed but tables may exist:', errorMessage);
      }
    }

    return prisma;
  } catch (error) {
    console.error('Failed to initialize test database:', error);
    throw error;
  }
};

/**
 * Cleans all data from the test database with proper foreign key handling
 */
export const cleanTestDatabase = async () => {
  const prisma = getTestPrisma();

  try {
    // Use more efficient cleanup strategies based on database state
    const strategy = await selectOptimalCleanupStrategy();

    if (strategy === 'fast-empty') {
      // Database is already empty, skip cleanup
      if (process.env.DEBUG_TESTS) {
        console.log('⚡ Database already empty, skipping cleanup');
      }
      return;
    }

    // Start performance tracking
    const startTime = Date.now();

    // Disable foreign key constraints temporarily for efficient cleanup
    if (process.env.DATABASE_URL?.includes('file:')) {
      await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;
    }

    if (strategy === 'truncate') {
      // Use TRUNCATE for faster cleanup when supported
      await truncateAllTables();
    } else {
      // Fallback to DELETE operations with proper order
      await deleteAllTablesInOrder();
    }

    // Reset SQLite sequences for auto-incrementing fields (if any)
    if (process.env.DATABASE_URL?.includes('file:')) {
      try {
        await prisma.$executeRaw`DELETE FROM sqlite_sequence WHERE name IN ('User', 'Run', 'Goal', 'Race')`;
      } catch (error) {
        // Ignore errors - sqlite_sequence may not exist or contain these tables
        if (process.env.DEBUG_TESTS) {
          console.log('Note: Could not reset sequences (this is normal for UUID primary keys)');
        }
      }
    }

    // Re-enable foreign key constraints
    if (process.env.DATABASE_URL?.includes('file:')) {
      await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
    }

    const duration = Date.now() - startTime;
    if (process.env.DEBUG_TESTS) {
      console.log(`✅ Database cleaned successfully in ${duration}ms using ${strategy} strategy`);
    }
  } catch (error) {
    console.error('Failed to clean test database:', error);

    // Ensure foreign keys are re-enabled even if cleanup failed
    if (process.env.DATABASE_URL?.includes('file:')) {
      try {
        await prisma.$executeRaw`PRAGMA foreign_keys = ON`;
      } catch (fkError) {
        console.warn('Failed to re-enable foreign keys:', fkError);
      }
    }

    throw error;
  }
};

/**
 * Determines the optimal cleanup strategy based on database state
 */
const selectOptimalCleanupStrategy = async (): Promise<'fast-empty' | 'truncate' | 'delete'> => {
  const prisma = getTestPrisma();

  try {
    // Quick check if database is already empty
    const counts = await Promise.all([
      prisma.user.count(),
      prisma.run.count(),
      prisma.goal.count(),
      prisma.race.count(),
    ]);

    const totalRecords = counts.reduce((sum, count) => sum + count, 0);

    if (totalRecords === 0) {
      return 'fast-empty';
    }

    // SQLite doesn't support TRUNCATE, so use DELETE
    if (process.env.DATABASE_URL?.includes('file:')) {
      return 'delete';
    }

    // For other databases, TRUNCATE is usually faster for large datasets
    return totalRecords > 1000 ? 'truncate' : 'delete';
  } catch (error) {
    console.warn('Failed to analyze database state, using delete strategy:', error);
    return 'delete';
  }
};

/**
 * Truncate all tables (not supported by SQLite, fallback to DELETE)
 */
const truncateAllTables = async () => {
  const prisma = getTestPrisma();

  // SQLite doesn't support TRUNCATE, this is a placeholder for other databases
  // For now, fallback to DELETE operations
  await deleteAllTablesInOrder();
};

/**
 * Delete all data from tables in proper order respecting foreign key constraints
 */
const deleteAllTablesInOrder = async () => {
  const prisma = getTestPrisma();

  // Order matters due to foreign key constraints - delete children first
  const tables = [
    { name: 'run', model: prisma.run },
    { name: 'goal', model: prisma.goal },
    { name: 'race', model: prisma.race },
    { name: 'user', model: prisma.user },
  ];

  let totalDeleted = 0;

  // Clean all tables in proper order
  for (const table of tables) {
    try {
      const count = await table.model.deleteMany();
      totalDeleted += count.count;
      if (process.env.DEBUG_TESTS) {
        console.log(`Cleaned ${count.count} records from ${table.name} table`);
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      // Only warn if it's not a "table doesn't exist" error
      if (!errorMessage.includes('does not exist')) {
        console.warn(`Failed to clean ${table.name} table:`, errorMessage);
      }
    }
  }

  if (process.env.DEBUG_TESTS && totalDeleted > 0) {
    console.log(`📊 Total records deleted: ${totalDeleted}`);
  }
};

/**
 * Enhanced database cleanup with optimized strategies
 */
export const optimizedCleanTestDatabase = async (
  options: {
    skipVerification?: boolean;
    maxRetries?: number;
  } = {}
) => {
  const { skipVerification = false, maxRetries = 3 } = options;
  const prisma = getTestPrisma();

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await cleanTestDatabase();

      // Verify cleanup was successful
      if (!skipVerification) {
        const isClean = await verifyDatabaseClean();
        if (!isClean) {
          throw new Error('Database cleanup verification failed');
        }
      }

      return; // Success
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) {
        console.error(`Failed to clean database after ${maxRetries} attempts:`, error);
        throw error;
      }

      console.warn(`Database cleanup attempt ${attempt} failed, retrying...`, error);

      // Brief delay before retry
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
};

/**
 * Creates a test user with hashed password and conflict prevention
 */
export const createTestUser = async (userData?: {
  email?: string;
  password?: string;
  name?: string;
  useIsolation?: boolean;
}) => {
  const prisma = getTestPrisma();
  const useIsolation = userData?.useIsolation !== false; // Default to true

  let email: string;
  if (useIsolation) {
    // Use conflict-free email generation
    email = userData?.email || testDataUtils.generateUniqueEmail('testuser');
  } else {
    // Legacy behavior for backward compatibility
    email = userData?.email || `test-${crypto.randomUUID()}@example.com`;
  }

  const password = userData?.password || 'TestSecure#2024';
  const name =
    userData?.name ||
    (useIsolation ? `Test User ${testDataUtils.generateUniqueId('name')}` : undefined);

  const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  const hashedPassword = await bcrypt.hash(password, saltRounds);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      name,
    },
  });

  return { ...user, plainPassword: password };
};

/**
 * Generates a valid JWT token for testing
 */
export const generateTestToken = (userId: string, email?: string) => {
  const secret = process.env.JWT_SECRET || 'test-secret';
  const payload = {
    id: userId,
    email: email || 'test@example.com',
    type: 'access',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, secret, {
    expiresIn: '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });
};

/**
 * Generates both access and refresh tokens
 */
export const generateTestTokens = (userId: string, email?: string) => {
  const secret = process.env.JWT_SECRET || 'test-secret';
  // Using the same secret for both tokens as per application logic

  const accessPayload = {
    id: userId,
    email: email || 'test@example.com',
    type: 'access',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  const refreshPayload = {
    id: userId,
    type: 'refresh',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };

  const accessToken = jwt.sign(accessPayload, secret, {
    expiresIn: '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  const refreshToken = jwt.sign(refreshPayload, secret, {
    expiresIn: '7d',
    issuer: 'running-app',
    audience: 'running-app-users',
  });

  return { accessToken, refreshToken };
};

/**
 * Performs a complete database reset including clearing cached data
 */
export const resetTestDatabase = async () => {
  const prisma = getTestPrisma();

  try {
    // Clean all data
    await cleanTestDatabase();

    // Skip VACUUM in CI or when database might be locked
    // VACUUM requires exclusive database access and can cause locking issues
    const shouldVacuum = process.env.CI !== 'true' && process.env.SKIP_VACUUM !== 'true';

    if (shouldVacuum) {
      try {
        await prisma.$executeRaw`VACUUM`;
      } catch (vacuumError) {
        // VACUUM failure is not critical - just log and continue
        if (process.env.DEBUG_TESTS) {
          console.warn('⚠️  VACUUM failed (non-critical):', vacuumError);
        }
      }
    }

    // Reset any in-memory state if using in-memory database
    if (process.env.USE_IN_MEMORY_DB === 'true') {
      // For in-memory databases, we might need to reconnect
      await prisma.$disconnect();
      await prisma.$connect();
    }

    if (process.env.DEBUG_TESTS) {
      console.log('✅ Database reset completed');
    }
  } catch (error) {
    console.error('Failed to reset test database:', error);
    throw error;
  }
};

/**
 * Verifies database is clean and ready for tests
 */
export const verifyDatabaseClean = async (
  options: {
    strict?: boolean;
    reportDetails?: boolean;
  } = {}
) => {
  const { strict = false, reportDetails = process.env.DEBUG_TESTS === 'true' } = options;
  const prisma = getTestPrisma();

  try {
    const counts = {
      users: await prisma.user.count(),
      runs: await prisma.run.count(),
      goals: await prisma.goal.count(),
      races: await prisma.race.count(),
    };

    const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);

    if (totalRecords > 0) {
      if (reportDetails || strict) {
        console.warn('⚠️ Database is not clean:', counts);
      }

      if (strict) {
        throw new Error(`Database verification failed: ${totalRecords} records found`);
      }

      return false;
    }

    if (reportDetails) {
      console.log('✅ Database verified clean - all tables empty');
    }

    return true;
  } catch (error) {
    console.error('Failed to verify database state:', error);

    if (strict) {
      throw error;
    }

    return false;
  }
};

/**
 * Comprehensive database health check
 */
export const checkDatabaseHealth = async () => {
  const prisma = getTestPrisma();

  try {
    const startTime = Date.now();

    // Check basic connectivity
    await prisma.$connect();
    const connectTime = Date.now() - startTime;

    // Check foreign key constraints are enabled (SQLite)
    let foreignKeysEnabled = true;
    if (process.env.DATABASE_URL?.includes('file:')) {
      const result = await prisma.$queryRaw<{ foreign_keys: number }[]>`PRAGMA foreign_keys`;
      foreignKeysEnabled = result[0]?.foreign_keys === 1;
    }

    // Check table integrity
    const tableChecks = await Promise.all([
      prisma.user
        .findFirst()
        .then(() => true)
        .catch(() => false),
      prisma.run
        .findFirst()
        .then(() => true)
        .catch(() => false),
      prisma.goal
        .findFirst()
        .then(() => true)
        .catch(() => false),
      prisma.race
        .findFirst()
        .then(() => true)
        .catch(() => false),
    ]);

    const allTablesAccessible = tableChecks.every(check => check);

    // Count records for status
    const counts = {
      users: await prisma.user.count(),
      runs: await prisma.run.count(),
      goals: await prisma.goal.count(),
      races: await prisma.race.count(),
    };

    const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0);

    const healthStatus = {
      connected: true,
      connectionTime: connectTime,
      foreignKeysEnabled,
      allTablesAccessible,
      totalRecords,
      recordCounts: counts,
      isEmpty: totalRecords === 0,
      healthy: foreignKeysEnabled && allTablesAccessible,
    };

    if (process.env.DEBUG_TESTS) {
      console.log('🏥 Database Health Check:', healthStatus);
    }

    return healthStatus;
  } catch (error) {
    console.error('Database health check failed:', error);
    return {
      connected: false,
      connectionTime: -1,
      foreignKeysEnabled: false,
      allTablesAccessible: false,
      totalRecords: -1,
      recordCounts: { users: -1, runs: -1, goals: -1, races: -1 },
      isEmpty: false,
      healthy: false,
      error: error as Error,
    };
  }
};

/**
 * Disconnects the test database
 */
export const disconnectTestDatabase = async () => {
  if (prismaInstance) {
    try {
      // Force disconnect all connections
      await prismaInstance.$disconnect();
      console.log('✅ Test database disconnected successfully');
    } catch (error) {
      console.warn('Warning: Error during test database disconnect:', error);
    } finally {
      // Reset the instance to null to allow recreation
      prismaInstance = null;
    }
  }
};

/**
 * Connection pool health check for test database
 */
export const checkConnectionPoolHealth = async () => {
  if (!prismaInstance) {
    return { healthy: false, error: 'No Prisma instance available' };
  }

  try {
    const startTime = Date.now();

    // Simple connectivity test
    await prismaInstance.$queryRaw`SELECT 1 as test`;

    const responseTime = Date.now() - startTime;

    return {
      healthy: true,
      responseTime,
      connectionActive: true,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      connectionActive: false,
    };
  }
};

/**
 * Force reconnection to test database (useful for recovery from connection issues)
 */
export const forceReconnectTestDatabase = async () => {
  try {
    if (process.env.DEBUG_TESTS) {
      console.log('🔄 Force reconnecting to test database...');
    }

    // Disconnect first
    await disconnectTestDatabase();

    // Wait a bit to ensure cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    // Get fresh instance (will auto-connect on first query)
    const prisma = getTestPrisma();

    // Test the new connection
    await prisma.$queryRaw`SELECT 1 as test`;

    if (process.env.DEBUG_TESTS) {
      console.log('✅ Test database reconnected successfully');
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to reconnect test database:', error);
    return false;
  }
};

/**
 * Creates an isolation manager for a specific test suite
 */
export const createIsolatedTestEnvironment = (testSuiteName?: string) => {
  return createTestDataIsolationManager(getTestPrisma(), testSuiteName);
};

/**
 * Validates test data for conflicts before tests run
 */
export const validateTestDataIntegrity = async (): Promise<{
  valid: boolean;
  issues: string[];
  recommendations: string[];
}> => {
  const prisma = getTestPrisma();
  const issues: string[] = [];
  const recommendations: string[] = [];

  try {
    // Check for potential email conflicts
    const duplicateEmails = await prisma.user.groupBy({
      by: ['email'],
      _count: {
        email: true,
      },
      having: {
        email: {
          _count: {
            gt: 1,
          },
        },
      },
    });

    if (duplicateEmails.length > 0) {
      issues.push(`Found ${duplicateEmails.length} duplicate email(s) in test database`);
      recommendations.push('Use unique email generation for all test users');
    }

    // Check for hardcoded values that could cause conflicts
    const hardcodedUsers = await prisma.user.count({
      where: {
        email: {
          in: [
            // Legacy hardcoded emails - these should not be used in new tests
            'test@example.com',
            'user@test.com',
            'admin@test.com',
            'testuser@example.com',
            'newuser@test.com',
          ],
        },
      },
    });

    if (hardcodedUsers > 0) {
      issues.push(`Found ${hardcodedUsers} user(s) with hardcoded test email(s)`);
      recommendations.push('Replace hardcoded emails with generated unique emails');
    }

    // Check for runs with identical timestamps that could cause race conditions
    const duplicateRunDates = await prisma.run.groupBy({
      by: ['userId', 'date'],
      _count: {
        id: true,
      },
      having: {
        id: {
          _count: {
            gt: 1,
          },
        },
      },
    });

    if (duplicateRunDates.length > 0) {
      issues.push(
        `Found ${duplicateRunDates.length} duplicate run date(s) that could cause conflicts`
      );
      recommendations.push('Use different timestamps for test runs or add randomization');
    }

    return {
      valid: issues.length === 0,
      issues,
      recommendations,
    };
  } catch (error) {
    return {
      valid: false,
      issues: [`Test data validation failed: ${error}`],
      recommendations: ['Check database connectivity and schema'],
    };
  }
};

/**
 * Creates a fixture loader for the test database
 */
export const createTestFixtureLoader = () => {
  return createFixtureLoader(getTestPrisma());
};

/**
 * Loads fixtures using the predefined collections
 */
export const loadTestFixtures = {
  minimal: () => FixtureLoadingUtils.loadMinimal(getTestPrisma()),
  auth: () => FixtureLoadingUtils.loadAuth(getTestPrisma()),
  api: () => FixtureLoadingUtils.loadApiTestEnvironment(getTestPrisma()),
  edgeCases: () => FixtureLoadingUtils.loadEdgeCases(getTestPrisma()),
  custom: (config: {
    userCount?: number;
    runsPerUser?: number;
    goalsPerUser?: number;
    racesPerUser?: number;
  }) => FixtureLoadingUtils.loadCustomScenario(getTestPrisma(), config),
};

// Export a unified test database interface
export const testDb = {
  prisma: getTestPrisma(),
  initialize: initializeTestDatabase,
  clean: cleanTestDatabase,
  cleanOptimized: optimizedCleanTestDatabase,
  reset: resetTestDatabase,
  verify: verifyDatabaseClean,
  healthCheck: checkDatabaseHealth,
  disconnect: disconnectTestDatabase,
  createUser: createTestUser,
  generateToken: generateTestToken,
  generateTokens: generateTestTokens,
  // Connection pool management utilities
  checkPoolHealth: checkConnectionPoolHealth,
  forceReconnect: forceReconnectTestDatabase,
  // Data isolation utilities
  createIsolationManager: createIsolatedTestEnvironment,
  validateIntegrity: validateTestDataIntegrity,
  utils: testDataUtils,
  // Test fixture utilities
  fixtures: {
    loader: createTestFixtureLoader,
    load: loadTestFixtures,
    collections: FixtureCollections,
    factory: TestFixtures,
  },
};
