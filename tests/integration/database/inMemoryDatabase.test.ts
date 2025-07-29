/**
 * Integration tests for in-memory database functionality
 *
 * This test file demonstrates how to use the in-memory database setup
 * and validates that it works correctly for test scenarios.
 */

import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { setupInMemoryDb, cleanupInMemoryDb, getTestDbClient } from '../../setup/inMemoryDbSetup';
import { seedBasicTestData, seedMinimalTestData, TEST_USERS } from '../../utils/testSeeds';
import type { PrismaClient } from '@prisma/client';

describe('In-Memory Database', () => {
  let client: PrismaClient;

  beforeAll(async () => {
    // Setup in-memory database with basic test data
    const db = await setupInMemoryDb({
      enableLogging: false,
      cleanBetweenTests: true,
      seedFunction: seedBasicTestData,
      testSuiteId: 'in-memory-db-tests',
    });

    client = getTestDbClient();
  });

  afterAll(async () => {
    await cleanupInMemoryDb();
  });

  describe('Database Setup', () => {
    test('should have seeded test users', async () => {
      const users = await client.user.findMany();
      expect(users).toHaveLength(3);

      const userEmails = users.map(u => u.email).sort();
      expect(userEmails).toEqual(['bob@example.com', 'jane@example.com', 'john@example.com']);
    });

    test('should have seeded test runs', async () => {
      const runs = await client.run.findMany();
      expect(runs.length).toBeGreaterThan(0);

      // Test that runs are properly linked to users
      const runsWithUsers = await client.run.findMany({
        include: { user: true },
      });

      for (const run of runsWithUsers) {
        expect(run.user).toBeDefined();
        expect(run.user.email).toMatch(/@example\.com$/);
      }
    });

    test('should have seeded test goals', async () => {
      const goals = await client.goal.findMany();
      expect(goals.length).toBeGreaterThan(0);

      // Test different goal types
      const goalTypes = goals.map(g => g.type);
      expect(goalTypes).toContain('DISTANCE');
      expect(goalTypes).toContain('FREQUENCY');
    });

    test('should have seeded test races', async () => {
      const races = await client.race.findMany();
      expect(races.length).toBeGreaterThan(0);

      // Test that races have valid data
      for (const race of races) {
        expect(race.distance).toBeGreaterThan(0);
        expect(race.raceDate).toBeInstanceOf(Date);
      }
    });
  });

  describe('Database Operations', () => {
    test('should support basic CRUD operations', async () => {
      const johnUser = await client.user.findFirst({
        where: { email: TEST_USERS.john.email },
      });
      expect(johnUser).toBeDefined();

      // Create a new run
      const newRun = await client.run.create({
        data: {
          userId: johnUser!.id,
          date: new Date('2024-02-01T08:00:00Z'),
          distance: 7.5,
          duration: 2700, // 45 minutes
          tag: 'test',
          notes: 'Test run created in integration test',
        },
      });

      expect(newRun.id).toBeDefined();
      expect(newRun.distance).toBe(7.5);
      expect(newRun.tag).toBe('test');

      // Update the run
      const updatedRun = await client.run.update({
        where: { id: newRun.id },
        data: { notes: 'Updated test run notes' },
      });

      expect(updatedRun.notes).toBe('Updated test run notes');

      // Delete the run
      await client.run.delete({
        where: { id: newRun.id },
      });

      // Verify deletion
      const deletedRun = await client.run.findUnique({
        where: { id: newRun.id },
      });
      expect(deletedRun).toBeNull();
    });

    test('should support complex queries with joins', async () => {
      const usersWithData = await client.user.findMany({
        include: {
          runs: {
            orderBy: { date: 'desc' },
            take: 5,
          },
          goals: {
            where: { isActive: true },
          },
          races: {
            where: {
              raceDate: {
                gte: new Date('2024-01-01'),
              },
            },
          },
        },
      });

      expect(usersWithData.length).toBeGreaterThan(0);

      for (const user of usersWithData) {
        expect(user.runs).toBeDefined();
        expect(user.goals).toBeDefined();
        expect(user.races).toBeDefined();

        // Verify run ordering
        const runDates = user.runs.map(r => r.date.getTime());
        const sortedDates = [...runDates].sort((a, b) => b - a);
        expect(runDates).toEqual(sortedDates);
      }
    });

    test('should support aggregation queries', async () => {
      // Test aggregation on runs
      const runStats = await client.run.aggregate({
        _count: { id: true },
        _sum: { distance: true },
        _avg: { duration: true },
        _min: { date: true },
        _max: { date: true },
      });

      expect(runStats._count.id).toBeGreaterThan(0);
      expect(runStats._sum.distance).toBeGreaterThan(0);
      expect(runStats._avg.duration).toBeGreaterThan(0);
      expect(runStats._min.date).toBeInstanceOf(Date);
      expect(runStats._max.date).toBeInstanceOf(Date);

      // Test group by query
      const runsByUser = await client.run.groupBy({
        by: ['userId'],
        _count: { id: true },
        _sum: { distance: true },
      });

      expect(runsByUser.length).toBeGreaterThan(0);
      for (const group of runsByUser) {
        expect(group.userId).toBeDefined();
        expect(group._count.id).toBeGreaterThan(0);
        expect(group._sum.distance).toBeGreaterThan(0);
      }
    });

    test('should handle transactions', async () => {
      const johnUser = await client.user.findFirst({
        where: { email: TEST_USERS.john.email },
      });

      // Test successful transaction
      const result = await client.$transaction(async tx => {
        const newGoal = await tx.goal.create({
          data: {
            userId: johnUser!.id,
            title: 'Transaction Test Goal',
            description: 'Goal created in transaction',
            type: 'DISTANCE',
            period: 'WEEKLY',
            targetValue: 25,
            targetUnit: 'km',
            startDate: new Date('2024-02-01T00:00:00Z'),
            endDate: new Date('2024-02-07T23:59:59Z'),
            currentValue: 0,
          },
        });

        const newRun = await tx.run.create({
          data: {
            userId: johnUser!.id,
            date: new Date('2024-02-02T07:00:00Z'),
            distance: 5.0,
            duration: 1800,
            tag: 'transaction-test',
            notes: 'Run created in transaction',
          },
        });

        return { goal: newGoal, run: newRun };
      });

      expect(result.goal.id).toBeDefined();
      expect(result.run.id).toBeDefined();

      // Verify both records exist
      const goal = await client.goal.findUnique({
        where: { id: result.goal.id },
      });
      const run = await client.run.findUnique({
        where: { id: result.run.id },
      });

      expect(goal).toBeDefined();
      expect(run).toBeDefined();

      // Test transaction rollback
      await expect(
        client.$transaction(async tx => {
          await tx.goal.create({
            data: {
              userId: johnUser!.id,
              title: 'Rollback Test Goal',
              description: 'This should be rolled back',
              type: 'TIME',
              period: 'DAILY',
              targetValue: 60,
              targetUnit: 'minutes',
              startDate: new Date('2024-02-01T00:00:00Z'),
              endDate: new Date('2024-02-01T23:59:59Z'),
              currentValue: 0,
            },
          });

          // This will cause the transaction to fail
          throw new Error('Intentional rollback');
        })
      ).rejects.toThrow('Intentional rollback');

      // Verify rollback goal was not created
      const rollbackGoal = await client.goal.findFirst({
        where: { title: 'Rollback Test Goal' },
      });
      expect(rollbackGoal).toBeNull();
    });
  });

  describe('Database Performance', () => {
    test('should handle rapid consecutive operations', async () => {
      const johnUser = await client.user.findFirst({
        where: { email: TEST_USERS.john.email },
      });

      const startTime = Date.now();

      // Create many runs rapidly
      const createPromises = Array.from({ length: 50 }, (_, i) =>
        client.run.create({
          data: {
            userId: johnUser!.id,
            date: new Date(`2024-02-${String((i % 28) + 1).padStart(2, '0')}T08:00:00Z`),
            distance: Math.random() * 10 + 1,
            duration: Math.floor(Math.random() * 3600 + 600),
            tag: `performance-test-${i}`,
            notes: `Performance test run ${i}`,
          },
        })
      );

      const runs = await Promise.all(createPromises);
      const endTime = Date.now();

      expect(runs).toHaveLength(50);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete in under 5 seconds

      // Clean up
      await client.run.deleteMany({
        where: {
          tag: {
            startsWith: 'performance-test-',
          },
        },
      });
    });

    test('should maintain data integrity under concurrent operations', async () => {
      const users = await client.user.findMany();

      // Concurrent operations on different users
      const operations = users.map(async (user, index) => {
        return client.goal.create({
          data: {
            userId: user.id,
            title: `Concurrent Goal ${index}`,
            description: `Concurrency test goal for user ${user.name}`,
            type: 'DISTANCE',
            period: 'WEEKLY',
            targetValue: 10 + index,
            targetUnit: 'km',
            startDate: new Date('2024-02-01T00:00:00Z'),
            endDate: new Date('2024-02-07T23:59:59Z'),
            currentValue: 0,
          },
        });
      });

      const results = await Promise.all(operations);

      expect(results).toHaveLength(users.length);
      for (const result of results) {
        expect(result.id).toBeDefined();
      }

      // Verify all goals were created correctly
      const concurrentGoals = await client.goal.findMany({
        where: {
          title: {
            startsWith: 'Concurrent Goal',
          },
        },
      });

      expect(concurrentGoals).toHaveLength(users.length);

      // Clean up
      await client.goal.deleteMany({
        where: {
          title: {
            startsWith: 'Concurrent Goal',
          },
        },
      });
    });
  });
});
