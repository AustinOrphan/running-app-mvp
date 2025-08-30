#!/usr/bin/env tsx

/**
 * Global Jest teardown for integration tests
 * Ensures proper cleanup after all tests complete including connection pools
 */

import { CIIntegrationDBManager } from '../../scripts/ci-integration-db-setup.js';
import { forceCleanupAllConnections } from '../utils/connectionPoolManager';
import { cleanupPrismaConnection, resetPrismaConnection } from '../../lib/prisma.js';

export default async function globalTeardown() {
  console.log('🧹 Running global teardown for integration tests...');

  try {
    // Get connection pool stats before cleanup
    const statsBefore = getConnectionPoolStats();

    if (process.env.DEBUG_TESTS) {
      console.log('📊 Connection Pool Stats Before Cleanup:', statsBefore);
    }

    // Disconnect all managed connections first
    await forceCleanupAllConnections();

    // Clean up the main Prisma connection
    await cleanupPrismaConnection();

    // Reset the main Prisma connection to prevent leaks
    await resetPrismaConnection();

    // Validate the cleanup was successful
    const statsAfter = getConnectionPoolStats();
    const validation = validateConnectionPool();

    if (process.env.DEBUG_TESTS) {
      console.log('📊 Connection Pool Stats After Cleanup:', statsAfter);
      console.log('✅ Connection Pool Validation:', validation);
    }

    // Report any issues found
    if (!validation.isValid) {
      console.warn('⚠️  Connection pool validation found issues:', validation.issues);
      console.warn('💡 Recommendations:', validation.recommendations);
    }

    // Now run the CI database teardown
    const manager = new CIIntegrationDBManager({ verbose: false });
    await manager.teardownForCI();

    // Final verification that connections are closed
    if (statsAfter.activeConnections > 0) {
      console.warn(
        `⚠️  Warning: ${statsAfter.activeConnections} connections still active after cleanup`
      );
    } else {
      console.log('✅ All database connections successfully closed');
    }

    console.log('✅ Global teardown completed successfully');
  } catch (error) {
    console.error('❌ Global teardown failed:', error);
    // Don't fail the test run if teardown fails
  }
}
