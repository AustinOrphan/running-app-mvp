/**
 * Test Data Seeds for In-Memory Database
 *
 * This module provides pre-defined seed functions for common test scenarios.
 * These functions create consistent, realistic test data for different test suites.
 */

import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

/**
 * Basic user data for testing
 */
export const TEST_USERS = {
  john: {
    id: 'user-john-doe-test-id',
    email: 'john@example.com',
    name: 'John Doe',
    password: 'securepassword123',
  },
  jane: {
    id: 'user-jane-smith-test-id',
    email: 'jane@example.com',
    name: 'Jane Smith',
    password: 'securepassword456',
  },
  bob: {
    id: 'user-bob-wilson-test-id',
    email: 'bob@example.com',
    name: 'Bob Wilson',
    password: 'securepassword789',
  },
} as const;

/**
 * Basic test runs data
 */
export const TEST_RUNS = [
  {
    id: 'run-morning-jog-test-id',
    userId: TEST_USERS.john.id,
    date: new Date('2024-01-15T07:00:00Z'),
    distance: 5.2,
    duration: 1800, // 30 minutes
    tag: 'morning',
    notes: 'Great morning run in the park',
  },
  {
    id: 'run-interval-training-test-id',
    userId: TEST_USERS.john.id,
    date: new Date('2024-01-17T18:00:00Z'),
    distance: 8.0,
    duration: 2400, // 40 minutes
    tag: 'training',
    notes: 'Interval training session',
  },
  {
    id: 'run-long-weekend-test-id',
    userId: TEST_USERS.jane.id,
    date: new Date('2024-01-20T08:00:00Z'),
    distance: 15.5,
    duration: 5400, // 90 minutes
    tag: 'long',
    notes: 'Weekend long run preparation for half marathon',
  },
] as const;

/**
 * Basic test goals data
 */
export const TEST_GOALS = [
  {
    id: 'goal-monthly-distance-test-id',
    userId: TEST_USERS.john.id,
    title: 'Monthly Distance Goal',
    description: 'Run 100km this month',
    type: 'DISTANCE',
    period: 'MONTHLY',
    targetValue: 100,
    targetUnit: 'km',
    startDate: new Date('2024-01-01T00:00:00Z'),
    endDate: new Date('2024-01-31T23:59:59Z'),
    currentValue: 25.5,
    isCompleted: false,
    color: '#4CAF50',
    icon: 'run',
    isActive: true,
  },
  {
    id: 'goal-weekly-frequency-test-id',
    userId: TEST_USERS.jane.id,
    title: 'Weekly Running Frequency',
    description: 'Run 4 times per week',
    type: 'FREQUENCY',
    period: 'WEEKLY',
    targetValue: 4,
    targetUnit: 'runs',
    startDate: new Date('2024-01-15T00:00:00Z'),
    endDate: new Date('2024-01-21T23:59:59Z'),
    currentValue: 2,
    isCompleted: false,
    color: '#2196F3',
    icon: 'calendar',
    isActive: true,
  },
  {
    id: 'goal-completed-test-id',
    userId: TEST_USERS.bob.id,
    title: 'Completed Goal',
    description: 'This goal was already completed',
    type: 'TIME',
    period: 'WEEKLY',
    targetValue: 180,
    targetUnit: 'minutes',
    startDate: new Date('2024-01-08T00:00:00Z'),
    endDate: new Date('2024-01-14T23:59:59Z'),
    currentValue: 180,
    isCompleted: true,
    completedAt: new Date('2024-01-14T20:00:00Z'),
    color: '#FF9800',
    icon: 'trophy',
    isActive: false,
  },
] as const;

/**
 * Basic test races data
 */
export const TEST_RACES = [
  {
    id: 'race-spring-5k-test-id',
    userId: TEST_USERS.john.id,
    name: 'Spring 5K Fun Run',
    raceDate: new Date('2024-03-15T09:00:00Z'),
    distance: 5.0,
    targetTime: 1200, // 20 minutes
    actualTime: null,
    notes: 'First race of the season',
  },
  {
    id: 'race-city-half-marathon-test-id',
    userId: TEST_USERS.jane.id,
    name: 'City Half Marathon',
    raceDate: new Date('2024-04-20T08:00:00Z'),
    distance: 21.1,
    targetTime: 7200, // 2 hours
    actualTime: 6900, // 1h 55m
    notes: 'Personal best time!',
  },
] as const;

/**
 * Seed function for basic test data (users, runs, goals, races)
 */
export async function seedBasicTestData(client: PrismaClient): Promise<void> {
  // Create users with hashed passwords
  const users = await Promise.all(
    Object.values(TEST_USERS).map(async user => {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      return client.user.create({
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          password: hashedPassword,
        },
      });
    })
  );

  // Create runs
  await client.run.createMany({
    data: TEST_RUNS,
  });

  // Create goals
  await client.goal.createMany({
    data: TEST_GOALS,
  });

  // Create races
  await client.race.createMany({
    data: TEST_RACES,
  });
}

/**
 * Seed function for minimal test data (just users)
 */
export async function seedMinimalTestData(client: PrismaClient): Promise<void> {
  const users = await Promise.all(
    Object.values(TEST_USERS).map(async user => {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      return client.user.create({
        data: {
          id: user.id,
          email: user.email,
          name: user.name,
          password: hashedPassword,
        },
      });
    })
  );
}

/**
 * Seed function for performance testing (large dataset)
 */
export async function seedPerformanceTestData(client: PrismaClient): Promise<void> {
  // Start with basic users
  await seedMinimalTestData(client);

  // Generate large number of runs for performance testing
  const performanceRuns = [];
  const startDate = new Date('2023-01-01');
  const endDate = new Date('2024-01-31');

  for (let i = 0; i < 1000; i++) {
    const randomDate = new Date(
      startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime())
    );

    const randomUser = Object.values(TEST_USERS)[i % 3];

    performanceRuns.push({
      id: `perf-run-${i}`,
      userId: randomUser.id,
      date: randomDate,
      distance: Math.random() * 20 + 1, // 1-21 km
      duration: Math.floor(Math.random() * 7200 + 300), // 5 minutes to 2 hours
      tag: ['morning', 'evening', 'training', 'long', 'recovery'][Math.floor(Math.random() * 5)],
      notes: `Performance test run ${i}`,
    });
  }

  // Create runs in batches to avoid memory issues
  const batchSize = 100;
  for (let i = 0; i < performanceRuns.length; i += batchSize) {
    const batch = performanceRuns.slice(i, i + batchSize);
    await client.run.createMany({
      data: batch,
    });
  }
}

/**
 * Seed function for edge case testing
 */
export async function seedEdgeCaseTestData(client: PrismaClient): Promise<void> {
  // Create user with edge case data
  const edgeUser = await client.user.create({
    data: {
      id: 'edge-case-user-id',
      email: 'edge.case+test@example.com',
      name: 'Edge Case User',
      password: await bcrypt.hash('edgecasepassword', 10),
    },
  });

  // Edge case runs
  await client.run.createMany({
    data: [
      {
        id: 'edge-run-very-short',
        userId: edgeUser.id,
        date: new Date('2024-01-01T00:00:01Z'), // Start of year
        distance: 0.1, // Very short distance
        duration: 60, // 1 minute
        tag: 'short',
        notes: 'Very short test run',
      },
      {
        id: 'edge-run-very-long',
        userId: edgeUser.id,
        date: new Date('2024-12-31T23:59:59Z'), // End of year
        distance: 100.0, // Very long distance
        duration: 36000, // 10 hours
        tag: 'ultra',
        notes: 'Ultra marathon distance',
      },
      {
        id: 'edge-run-no-notes',
        userId: edgeUser.id,
        date: new Date('2024-06-15T12:00:00Z'),
        distance: 5.0,
        duration: 1800,
        tag: null,
        notes: null, // No optional fields
      },
    ],
  });

  // Edge case goals
  await client.goal.createMany({
    data: [
      {
        id: 'edge-goal-zero-current',
        userId: edgeUser.id,
        title: 'Zero Progress Goal',
        description: 'Goal with zero current value',
        type: 'DISTANCE',
        period: 'WEEKLY',
        targetValue: 50,
        targetUnit: 'km',
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-07T23:59:59Z'),
        currentValue: 0, // Zero progress
        isCompleted: false,
        isActive: true,
      },
      {
        id: 'edge-goal-exceeded',
        userId: edgeUser.id,
        title: 'Exceeded Goal',
        description: 'Goal where current exceeds target',
        type: 'TIME',
        period: 'MONTHLY',
        targetValue: 600,
        targetUnit: 'minutes',
        startDate: new Date('2024-01-01T00:00:00Z'),
        endDate: new Date('2024-01-31T23:59:59Z'),
        currentValue: 750, // Exceeded target
        isCompleted: true,
        completedAt: new Date('2024-01-25T10:00:00Z'),
        isActive: true,
      },
    ],
  });
}

/**
 * Get a specific test user by key
 */
export function getTestUser(key: keyof typeof TEST_USERS) {
  return TEST_USERS[key];
}

/**
 * Get all test user IDs
 */
export function getTestUserIds(): string[] {
  return Object.values(TEST_USERS).map(user => user.id);
}

/**
 * Get test data for a specific user
 */
export function getTestDataForUser(userId: string) {
  return {
    runs: TEST_RUNS.filter(run => run.userId === userId),
    goals: TEST_GOALS.filter(goal => goal.userId === userId),
    races: TEST_RACES.filter(race => race.userId === userId),
  };
}
