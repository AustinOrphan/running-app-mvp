import { PrismaClient } from '@prisma/client';
import { testDb } from '../fixtures/testDatabase.js';
import { createUser, createMultipleUsers, UserWithPassword } from './userFactory.js';
import { createRunSeries } from './runFactory.js';
import { createGoal } from './goalFactory.js';
import { createRace } from './raceFactory.js';

/**
 * Test Data Manager
 * Utilities for managing test data lifecycle and complex scenarios
 */

export interface TestContext {
  users: UserWithPassword[];
  cleanup: () => Promise<void>;
}

export class TestDataManager {
  private prisma: PrismaClient;
  private createdUserIds: string[] = [];

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma || testDb.prisma;
  }

  /**
   * Create a complete test scenario
   */
  async createScenario(scenario: 'basic' | 'competition' | 'training'): Promise<TestContext> {
    switch (scenario) {
      case 'basic':
        return this.createBasicScenario();
      case 'competition':
        return this.createCompetitionScenario();
      case 'training':
        return this.createTrainingScenario();
      default:
        throw new Error(`Unknown scenario: ${scenario}`);
    }
  }

  /**
   * Basic scenario: Single user with some runs and goals
   */
  private async createBasicScenario(): Promise<TestContext> {
    const user = await createUser();
    this.createdUserIds.push(user.id);

    // Create some runs
    await createRunSeries(user.id, 10);

    // Create a few goals
    await createGoal({
      userId: user.id,
      title: 'Monthly Distance Goal',
      type: 'DISTANCE',
      targetValue: 100,
    });

    await createGoal({
      userId: user.id,
      title: 'Weekly Frequency Goal',
      type: 'FREQUENCY',
      targetValue: 4,
    });

    return {
      users: [user],
      cleanup: () => this.cleanup(),
    };
  }

  /**
   * Competition scenario: Multiple users with races
   */
  private async createCompetitionScenario(): Promise<TestContext> {
    const users = await createMultipleUsers(3);
    this.createdUserIds.push(...users.map(u => u.id));

    // Each user has runs and upcoming races
    for (const user of users) {
      await createRunSeries(user.id, 20);

      await createRace({
        userId: user.id,
        name: 'City Marathon',
        distance: 42.195,
        raceDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days from now
      });

      await createGoal({
        userId: user.id,
        title: 'Marathon Training',
        type: 'DISTANCE',
        period: 'MONTHLY',
        targetValue: 200,
      });
    }

    return {
      users,
      cleanup: () => this.cleanup(),
    };
  }

  /**
   * Training scenario: User with structured training plan
   */
  private async createTrainingScenario(): Promise<TestContext> {
    const user = await createUser();
    this.createdUserIds.push(user.id);

    // Create runs with different types
    const runTags = ['Easy Run', 'Long Run', 'Speed Work', 'Tempo Run', 'Recovery'];
    const runs = [];

    for (let week = 0; week < 4; week++) {
      for (let day = 0; day < 5; day++) {
        const date = new Date();
        date.setDate(date.getDate() - (week * 7 + day));

        const run = await this.prisma.run.create({
          data: {
            userId: user.id,
            date,
            distance: 5 + Math.random() * 10,
            duration: 1800 + Math.floor(Math.random() * 3600),
            tag: runTags[day % runTags.length],
          },
        });
        runs.push(run);
      }
    }

    // Create structured goals
    await createGoal({
      userId: user.id,
      title: 'Base Building Phase',
      type: 'DISTANCE',
      period: 'WEEKLY',
      targetValue: 50,
    });

    await createGoal({
      userId: user.id,
      title: 'Long Run Progress',
      type: 'LONGEST_RUN',
      period: 'MONTHLY',
      targetValue: 21.1,
    });

    await createGoal({
      userId: user.id,
      title: 'Consistency Goal',
      type: 'FREQUENCY',
      period: 'WEEKLY',
      targetValue: 5,
    });

    return {
      users: [user],
      cleanup: () => this.cleanup(),
    };
  }

  /**
   * Clean up all created test data
   */
  async cleanup(): Promise<void> {
    if (this.createdUserIds.length === 0) return;

    // Delete in correct order to respect foreign keys
    await this.prisma.race.deleteMany({
      where: { userId: { in: this.createdUserIds } },
    });

    await this.prisma.goal.deleteMany({
      where: { userId: { in: this.createdUserIds } },
    });

    await this.prisma.run.deleteMany({
      where: { userId: { in: this.createdUserIds } },
    });

    await this.prisma.user.deleteMany({
      where: { id: { in: this.createdUserIds } },
    });

    this.createdUserIds = [];
  }

  /**
   * Create isolated test data (no interference between tests)
   */
  async createIsolatedData(setupFn: (userId: string) => Promise<void>): Promise<TestContext> {
    const user = await createUser();
    this.createdUserIds.push(user.id);

    await setupFn(user.id);

    return {
      users: [user],
      cleanup: () => this.cleanup(),
    };
  }

  /**
   * Reset database to clean state
   */
  async resetDatabase(): Promise<void> {
    await this.prisma.race.deleteMany();
    await this.prisma.goal.deleteMany();
    await this.prisma.run.deleteMany();
    await this.prisma.user.deleteMany();
  }

  /**
   * Seed database with sample data
   */
  async seedDatabase(): Promise<void> {
    // Create sample users
    const users = await createMultipleUsers(5);

    for (const user of users) {
      // Add runs
      await createRunSeries(user.id, 30);

      // Add goals
      await createGoal({
        userId: user.id,
        title: 'Monthly Distance',
        type: 'DISTANCE',
        targetValue: 100 + Math.random() * 100,
      });

      // Add races
      if (Math.random() > 0.5) {
        await createRace({
          userId: user.id,
          name: 'Upcoming Race',
          distance: [5, 10, 21.1, 42.195][Math.floor(Math.random() * 4)],
        });
      }
    }
  }
}

// Export singleton instance
export const testManager = new TestDataManager();

/**
 * Utility function for test setup
 */
export async function setupTestData(
  scenario: 'basic' | 'competition' | 'training' = 'basic'
): Promise<TestContext> {
  return testManager.createScenario(scenario);
}

/**
 * Utility function for test cleanup
 */
export async function cleanupTestData(): Promise<void> {
  return testManager.cleanup();
}
