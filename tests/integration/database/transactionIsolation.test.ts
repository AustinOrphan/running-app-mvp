/**
 * Integration tests for transaction-based test isolation
 *
 * This test file validates that transaction rollback isolation works correctly
 * and ensures tests don't interfere with each other.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import {
  setupTransactionTestingJest,
  getTransactionClient,
  cleanupTransactionTesting,
  isTransactionIsolationActive,
  getTransactionStats,
  runTestWithTransaction,
} from '../../setup/transactionTestSetup';
import { cleanTestDatabase } from '../utils/testDbSetup';
import bcrypt from 'bcrypt';

describe('Transaction Isolation', () => {
  let originalPrisma: PrismaClient;

  beforeAll(async () => {
    // Setup original Prisma client for verification
    const databaseUrl =
      process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db';
    originalPrisma = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    await originalPrisma.$connect();

    // Clean database before starting tests
    await cleanTestDatabase();

    // Setup transaction isolation
    await setupTransactionTestingJest({
      enableIsolation: true,
      enableLogging: true,
      timeout: 30000,
    });
  });

  afterAll(async () => {
    await cleanupTransactionTesting();
    await originalPrisma.$disconnect();
  });

  describe('Transaction Lifecycle', () => {
    test('should start and rollback transactions automatically', async () => {
      // Verify transaction is active during test
      expect(isTransactionIsolationActive()).toBe(true);

      const client = getTransactionClient();
      expect(client).toBeDefined();

      // Create a user within the transaction
      const user = await client.user.create({
        data: {
          email: 'transaction-test@example.com',
          name: 'Transaction Test User',
          password: await bcrypt.hash('password123', 10),
        },
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('transaction-test@example.com');

      // User should exist within the transaction
      const foundUser = await client.user.findUnique({
        where: { id: user.id },
      });
      expect(foundUser).toBeDefined();
    });

    test('should not see data from previous test (isolation verification)', async () => {
      const client = getTransactionClient();

      // Should not find the user created in the previous test
      const users = await client.user.findMany({
        where: { email: 'transaction-test@example.com' },
      });

      expect(users).toHaveLength(0);

      // Verify with original Prisma client as well
      const usersFromOriginal = await originalPrisma.user.findMany({
        where: { email: 'transaction-test@example.com' },
      });

      expect(usersFromOriginal).toHaveLength(0);
    });

    test('should track transaction statistics', async () => {
      const statsBefore = getTransactionStats();
      expect(statsBefore.activeTransactions).toBe(1); // Current test transaction
      expect(statsBefore.currentTransactionId).toBeDefined();

      const client = getTransactionClient();

      // Create some data to verify transaction is working
      await client.user.create({
        data: {
          email: 'stats-test@example.com',
          name: 'Stats Test User',
          password: await bcrypt.hash('password123', 10),
        },
      });

      const statsAfter = getTransactionStats();
      expect(statsAfter.activeTransactions).toBe(1);
      expect(statsAfter.currentTransactionId).toBe(statsBefore.currentTransactionId);
    });
  });

  describe('Data Isolation', () => {
    test('should isolate user creation between tests', async () => {
      const client = getTransactionClient();

      // Create a user in this test
      const user = await client.user.create({
        data: {
          email: 'isolation-test-1@example.com',
          name: 'Isolation Test User 1',
          password: await bcrypt.hash('password123', 10),
        },
      });

      expect(user.id).toBeDefined();

      const userCount = await client.user.count();
      expect(userCount).toBe(1);
    });

    test('should not see user from previous test', async () => {
      const client = getTransactionClient();

      // Should not see any users from previous tests
      const users = await client.user.findMany();
      expect(users).toHaveLength(0);

      // Create a different user
      const user = await client.user.create({
        data: {
          email: 'isolation-test-2@example.com',
          name: 'Isolation Test User 2',
          password: await bcrypt.hash('password123', 10),
        },
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('isolation-test-2@example.com');

      const userCount = await client.user.count();
      expect(userCount).toBe(1);
    });

    test('should isolate complex data relationships', async () => {
      const client = getTransactionClient();

      // Create user
      const user = await client.user.create({
        data: {
          email: 'complex-test@example.com',
          name: 'Complex Test User',
          password: await bcrypt.hash('password123', 10),
        },
      });

      // Create runs for the user
      const run1 = await client.run.create({
        data: {
          userId: user.id,
          date: new Date('2024-01-15T08:00:00Z'),
          distance: 5.0,
          duration: 1800,
          tag: 'morning',
        },
      });

      const run2 = await client.run.create({
        data: {
          userId: user.id,
          date: new Date('2024-01-16T18:00:00Z'),
          distance: 8.0,
          duration: 2400,
          tag: 'evening',
        },
      });

      // Create goal for the user
      const goal = await client.goal.create({
        data: {
          userId: user.id,
          title: 'Monthly Distance Goal',
          description: 'Run 100km this month',
          type: 'DISTANCE',
          period: 'MONTHLY',
          targetValue: 100,
          targetUnit: 'km',
          startDate: new Date('2024-01-01T00:00:00Z'),
          endDate: new Date('2024-01-31T23:59:59Z'),
          currentValue: 13.0,
        },
      });

      // Verify relationships
      const userWithData = await client.user.findUnique({
        where: { id: user.id },
        include: {
          runs: true,
          goals: true,
        },
      });

      expect(userWithData).toBeDefined();
      expect(userWithData!.runs).toHaveLength(2);
      expect(userWithData!.goals).toHaveLength(1);
      expect(userWithData!.runs[0].tag).toBe('morning');
      expect(userWithData!.goals[0].title).toBe('Monthly Distance Goal');

      // Verify counts
      const counts = await Promise.all([
        client.user.count(),
        client.run.count(),
        client.goal.count(),
      ]);

      expect(counts).toEqual([1, 2, 1]);
    });
  });

  describe('Error Handling', () => {
    test('should handle database errors gracefully', async () => {
      const client = getTransactionClient();

      // Create a user
      await client.user.create({
        data: {
          email: 'error-test@example.com',
          name: 'Error Test User',
          password: await bcrypt.hash('password123', 10),
        },
      });

      // Try to create duplicate user (should fail)
      await expect(
        client.user.create({
          data: {
            email: 'error-test@example.com', // Duplicate email
            name: 'Duplicate User',
            password: await bcrypt.hash('password123', 10),
          },
        })
      ).rejects.toThrow();

      // Transaction should still be active and usable
      expect(isTransactionIsolationActive()).toBe(true);

      // Should still be able to query existing data
      const users = await client.user.findMany();
      expect(users).toHaveLength(1);
      expect(users[0].email).toBe('error-test@example.com');
    });

    test('should handle constraint violations', async () => {
      const client = getTransactionClient();

      // Create user
      const user = await client.user.create({
        data: {
          email: 'constraint-test@example.com',
          name: 'Constraint Test User',
          password: await bcrypt.hash('password123', 10),
        },
      });

      // Try to create run with invalid foreign key
      await expect(
        client.run.create({
          data: {
            userId: 'non-existent-user-id',
            date: new Date(),
            distance: 5.0,
            duration: 1800,
          },
        })
      ).rejects.toThrow();

      // Transaction should still be usable
      const validRun = await client.run.create({
        data: {
          userId: user.id,
          date: new Date(),
          distance: 5.0,
          duration: 1800,
        },
      });

      expect(validRun.id).toBeDefined();
      expect(validRun.userId).toBe(user.id);
    });
  });

  describe('Performance', () => {
    test('should handle multiple operations efficiently', async () => {
      const client = getTransactionClient();

      const startTime = Date.now();

      // Create user
      const user = await client.user.create({
        data: {
          email: 'performance-test@example.com',
          name: 'Performance Test User',
          password: await bcrypt.hash('password123', 10),
        },
      });

      // Create multiple runs
      const runPromises = Array.from({ length: 20 }, (_, i) =>
        client.run.create({
          data: {
            userId: user.id,
            date: new Date(`2024-01-${String(i + 1).padStart(2, '0')}T08:00:00Z`),
            distance: Math.random() * 10 + 1,
            duration: Math.floor(Math.random() * 3600 + 600),
            tag: `run-${i}`,
          },
        })
      );

      const runs = await Promise.all(runPromises);

      // Create multiple goals
      const goalPromises = Array.from({ length: 5 }, (_, i) =>
        client.goal.create({
          data: {
            userId: user.id,
            title: `Goal ${i + 1}`,
            description: `Performance test goal ${i + 1}`,
            type: 'DISTANCE',
            period: 'WEEKLY',
            targetValue: 25 + i * 5,
            targetUnit: 'km',
            startDate: new Date(`2024-01-${String(i * 7 + 1).padStart(2, '0')}T00:00:00Z`),
            endDate: new Date(`2024-01-${String(i * 7 + 7).padStart(2, '0')}T23:59:59Z`),
            currentValue: Math.random() * 25,
          },
        })
      );

      const goals = await Promise.all(goalPromises);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Verify results
      expect(runs).toHaveLength(20);
      expect(goals).toHaveLength(5);

      // Performance should be reasonable (less than 5 seconds)
      expect(duration).toBeLessThan(5000);

      // Verify counts
      const counts = await Promise.all([
        client.user.count(),
        client.run.count(),
        client.goal.count(),
      ]);

      expect(counts).toEqual([1, 20, 5]);

      console.log(`Performance test completed in ${duration}ms`);
    });
  });
});

describe('Manual Transaction Control', () => {
  beforeAll(async () => {
    await setupTransactionTestingJest({
      enableIsolation: false, // Disable automatic isolation for manual tests
      enableLogging: true,
    });
  });

  afterAll(async () => {
    await cleanupTransactionTesting();
  });

  test('should support manual transaction control', async () => {
    const result = await runTestWithTransaction(async client => {
      // Create user within manual transaction
      const user = await client.user.create({
        data: {
          email: 'manual-test@example.com',
          name: 'Manual Test User',
          password: await bcrypt.hash('password123', 10),
        },
      });

      expect(user.id).toBeDefined();

      // Create run
      const run = await client.run.create({
        data: {
          userId: user.id,
          date: new Date(),
          distance: 7.5,
          duration: 2700,
        },
      });

      expect(run.id).toBeDefined();

      return { user, run };
    }, 'manual-transaction-test');

    expect(result.user.id).toBeDefined();
    expect(result.run.id).toBeDefined();

    // Verify data was rolled back by checking with a new client
    const verificationClient = new PrismaClient({
      datasources: {
        db: {
          url: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db',
        },
      },
    });

    await verificationClient.$connect();

    try {
      const users = await verificationClient.user.findMany({
        where: { email: 'manual-test@example.com' },
      });

      expect(users).toHaveLength(0);
    } finally {
      await verificationClient.$disconnect();
    }
  });
});
