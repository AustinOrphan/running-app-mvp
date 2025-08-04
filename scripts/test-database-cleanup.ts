#!/usr/bin/env tsx
/**
 * Test Database Cleanup Implementation
 *
 * This script tests the database cleanup functionality to ensure
 * proper isolation between tests.
 */

import { testDb } from '../tests/integration/utils/testDbSetup.js';
import {
  DatabaseCleanupManager,
  initializeCleanupManager,
} from '../tests/utils/databaseCleanupManager.js';
import { TransactionIsolationManager } from '../tests/utils/transactionIsolation.js';

async function testDatabaseCleanup() {
  console.log('🧪 Testing Database Cleanup Implementation');
  console.log('==========================================');

  try {
    // Initialize database
    console.log('📋 Initializing test database...');
    await testDb.initialize();

    // Ensure foreign keys are enabled
    if (process.env.DATABASE_URL?.includes('file:')) {
      await testDb.prisma.$executeRaw`PRAGMA foreign_keys = ON`;
    }

    // Check initial database health
    console.log('🏥 Checking database health...');
    const healthCheck = await testDb.healthCheck();
    console.log('Health status:', {
      connected: healthCheck.connected,
      foreignKeysEnabled: healthCheck.foreignKeysEnabled,
      isEmpty: healthCheck.isEmpty,
      healthy: healthCheck.healthy,
    });

    if (!healthCheck.healthy) {
      throw new Error('Database is not healthy');
    }

    // Create some test data
    console.log('📝 Creating test data...');
    const user1 = await testDb.createUser({ email: 'test1@example.com' });
    const user2 = await testDb.createUser({ email: 'test2@example.com' });

    // Create some related data
    await testDb.prisma.goal.create({
      data: {
        userId: user1.id,
        title: 'Test Goal 1',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 100,
        targetUnit: 'km',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      },
    });

    await testDb.prisma.run.create({
      data: {
        userId: user2.id,
        date: new Date('2024-01-01'),
        distance: 5.0,
        duration: 1800, // 30 minutes
      },
    });

    // Verify data was created
    let counts = {
      users: await testDb.prisma.user.count(),
      goals: await testDb.prisma.goal.count(),
      runs: await testDb.prisma.run.count(),
    };
    console.log('📊 Data created:', counts);

    if (counts.users !== 2 || counts.goals !== 1 || counts.runs !== 1) {
      throw new Error('Failed to create expected test data');
    }

    // Test 1: Basic cleanup
    console.log('\n🧹 Test 1: Basic cleanup');
    await testDb.clean();

    counts = {
      users: await testDb.prisma.user.count(),
      goals: await testDb.prisma.goal.count(),
      runs: await testDb.prisma.run.count(),
    };
    console.log('📊 After basic cleanup:', counts);

    const isClean = await testDb.verify();
    if (!isClean) {
      throw new Error('Basic cleanup failed');
    }
    console.log('✅ Basic cleanup successful');

    // Test 2: Optimized cleanup
    console.log('\n🧹 Test 2: Optimized cleanup');

    // Create test data again
    const user3 = await testDb.createUser({ email: 'test3@example.com' });
    await testDb.prisma.goal.create({
      data: {
        userId: user3.id,
        title: 'Test Goal 2',
        type: 'FREQUENCY',
        period: 'WEEKLY',
        targetValue: 3,
        targetUnit: 'runs',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-12-31'),
      },
    });

    counts = {
      users: await testDb.prisma.user.count(),
      goals: await testDb.prisma.goal.count(),
      runs: await testDb.prisma.run.count(),
    };
    console.log('📊 Data before optimized cleanup:', counts);

    await testDb.cleanOptimized();

    counts = {
      users: await testDb.prisma.user.count(),
      goals: await testDb.prisma.goal.count(),
      runs: await testDb.prisma.run.count(),
    };
    console.log('📊 After optimized cleanup:', counts);

    const isCleanOptimized = await testDb.verify();
    if (!isCleanOptimized) {
      throw new Error('Optimized cleanup failed');
    }
    console.log('✅ Optimized cleanup successful');

    // Test 3: Comprehensive cleanup manager
    console.log('\n🧹 Test 3: Comprehensive cleanup manager');

    // Initialize cleanup manager
    const transactionManager = new TransactionIsolationManager(testDb.prisma);
    const cleanupManager = initializeCleanupManager(testDb.prisma, transactionManager);

    // Create test data again
    const user4 = await testDb.createUser({ email: 'test4@example.com' });
    await testDb.prisma.race.create({
      data: {
        userId: user4.id,
        name: 'Test Marathon',
        raceDate: new Date('2024-06-01'),
        distance: 42.195,
      },
    });

    counts = {
      users: await testDb.prisma.user.count(),
      goals: await testDb.prisma.goal.count(),
      runs: await testDb.prisma.run.count(),
      races: await testDb.prisma.race.count(),
    };
    console.log('📊 Data before comprehensive cleanup:', counts);

    const cleanupResult = await cleanupManager.cleanDatabase({
      verifyCleanup: true,
      fallbackStrategy: true,
      enableProfiling: true,
    });

    console.log('📊 Cleanup result:', {
      strategy: cleanupResult.strategy,
      duration: `${cleanupResult.duration}ms`,
      success: cleanupResult.success,
      recordsAffected: cleanupResult.recordsAffected,
    });

    counts = {
      users: await testDb.prisma.user.count(),
      goals: await testDb.prisma.goal.count(),
      runs: await testDb.prisma.run.count(),
      races: await testDb.prisma.race.count(),
    };
    console.log('📊 After comprehensive cleanup:', counts);

    if (!cleanupResult.success) {
      throw new Error('Comprehensive cleanup failed');
    }
    console.log('✅ Comprehensive cleanup successful');

    // Get cleanup statistics
    const stats = cleanupManager.getCleanupStats();
    console.log('\n📊 Cleanup Statistics:', {
      totalCleanups: stats.totalCleanups,
      averageDuration: `${stats.averageDuration.toFixed(2)}ms`,
      successRate: `${stats.successRate.toFixed(1)}%`,
      preferredStrategy: stats.preferredStrategy,
    });

    // Test 4: Database health check
    console.log('\n🏥 Test 4: Final health check');
    const finalHealthCheck = await testDb.healthCheck();
    console.log('Final health status:', {
      connected: finalHealthCheck.connected,
      foreignKeysEnabled: finalHealthCheck.foreignKeysEnabled,
      isEmpty: finalHealthCheck.isEmpty,
      healthy: finalHealthCheck.healthy,
      totalRecords: finalHealthCheck.totalRecords,
    });

    if (!finalHealthCheck.healthy || !finalHealthCheck.isEmpty) {
      throw new Error('Final health check failed');
    }

    console.log('✅ All database cleanup tests passed!');
  } catch (error) {
    console.error('❌ Database cleanup test failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      await testDb.disconnect();
      console.log('🔌 Database disconnected');
    } catch (error) {
      console.warn('Warning: Failed to disconnect database:', error);
    }
  }
}

// Set up test environment
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'file:./prisma/test.db';
process.env.TEST_DATABASE_URL = 'file:./prisma/test.db';
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.DEBUG_TESTS = 'true';

// Run the test
testDatabaseCleanup().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
