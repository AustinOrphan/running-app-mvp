import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

/**
 * Test Data Isolation Manager
 *
 * Prevents test data conflicts by ensuring each test gets unique data
 * and proper isolation between parallel test runs.
 */
export class TestDataIsolationManager {
  private testRunId: string;
  private testNamespace: string;
  private prisma: PrismaClient;
  private createdEntities: Map<string, string[]> = new Map();

  constructor(prisma: PrismaClient, testSuiteName?: string) {
    this.prisma = prisma;
    this.testRunId = crypto.randomUUID();
    this.testNamespace = testSuiteName || 'default';
  }

  /**
   * Generates a unique test-scoped identifier
   */
  generateTestId(prefix: string = 'test'): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${this.testNamespace}-${timestamp}-${random}`;
  }

  /**
   * Generates a unique email for test users
   */
  generateTestEmail(prefix: string = 'user'): string {
    const id = this.generateTestId(prefix);
    return `${id}@test-${this.testRunId.slice(0, 8)}.example.com`;
  }

  /**
   * Creates a unique test user with isolated data
   */
  async createIsolatedTestUser(userData?: { email?: string; password?: string; name?: string }) {
    const email = userData?.email || this.generateTestEmail('testuser');
    const password = userData?.password || 'TestSecure#2024!';
    const name = userData?.name || `Test User ${this.generateTestId('name')}`;

    const bcrypt = await import('bcrypt');
    const saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      },
    });

    // Track created entity for cleanup
    this.trackEntity('user', user.id);

    return { ...user, plainPassword: password };
  }

  /**
   * Creates a unique test run with isolated data
   */
  async createIsolatedTestRun(data: {
    userId: string;
    date?: Date;
    distance?: number;
    duration?: number;
    notes?: string;
    tag?: string;
  }) {
    const run = await this.prisma.run.create({
      data: {
        userId: data.userId,
        date: data.date || new Date(),
        distance: data.distance || 5.0,
        duration: data.duration || 1800,
        notes: data.notes || `Test run ${this.generateTestId('run')}`,
        tag: data.tag,
      },
    });

    this.trackEntity('run', run.id);
    return run;
  }

  /**
   * Creates a unique test goal with isolated data
   */
  async createIsolatedTestGoal(data: {
    userId: string;
    title?: string;
    description?: string;
    type?: string;
    period?: string;
    targetValue?: number;
    targetUnit?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    const goal = await this.prisma.goal.create({
      data: {
        userId: data.userId,
        title: data.title || `Test goal ${this.generateTestId('goal')}`,
        description: data.description || `Test goal description ${this.generateTestId('desc')}`,
        type: data.type || 'DISTANCE',
        period: data.period || 'WEEKLY',
        targetValue: data.targetValue || 10.0,
        targetUnit: data.targetUnit || 'km',
        startDate: data.startDate || new Date(),
        endDate: data.endDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week later
      },
    });

    this.trackEntity('goal', goal.id);
    return goal;
  }

  /**
   * Creates a unique test race with isolated data
   */
  async createIsolatedTestRace(data: {
    userId: string;
    name?: string;
    raceDate?: Date;
    distance?: number;
    targetTime?: number;
    actualTime?: number;
    notes?: string;
  }) {
    const race = await this.prisma.race.create({
      data: {
        userId: data.userId,
        name: data.name || `Test race ${this.generateTestId('race')}`,
        raceDate: data.raceDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days later
        distance: data.distance || 10.0,
        targetTime: data.targetTime,
        actualTime: data.actualTime,
        notes: data.notes,
      },
    });

    this.trackEntity('race', race.id);
    return race;
  }

  /**
   * Tracks created entities for cleanup
   */
  private trackEntity(type: string, id: string) {
    if (!this.createdEntities.has(type)) {
      this.createdEntities.set(type, []);
    }
    this.createdEntities.get(type)!.push(id);
  }

  /**
   * Cleans up all entities created during this test run
   */
  async cleanupCreatedEntities() {
    try {
      // Clean up in reverse dependency order
      const cleanupOrder = ['run', 'goal', 'race', 'user'];

      for (const entityType of cleanupOrder) {
        const ids = this.createdEntities.get(entityType);
        if (!ids || ids.length === 0) continue;

        switch (entityType) {
          case 'run':
            await this.prisma.run.deleteMany({
              where: { id: { in: ids } },
            });
            break;
          case 'goal':
            await this.prisma.goal.deleteMany({
              where: { id: { in: ids } },
            });
            break;
          case 'race':
            await this.prisma.race.deleteMany({
              where: { id: { in: ids } },
            });
            break;
          case 'user':
            await this.prisma.user.deleteMany({
              where: { id: { in: ids } },
            });
            break;
        }

        if (process.env.DEBUG_TESTS) {
          console.log(`🧹 Cleaned up ${ids.length} ${entityType} entities`);
        }
      }

      // Clear tracking
      this.createdEntities.clear();
    } catch (error) {
      console.warn('Failed to clean up created entities:', error);
    }
  }

  /**
   * Creates a completely isolated test environment with test data
   */
  async createTestEnvironment(
    options: {
      userCount?: number;
      runsPerUser?: number;
      goalsPerUser?: number;
      racesPerUser?: number;
    } = {}
  ) {
    const { userCount = 1, runsPerUser = 2, goalsPerUser = 1, racesPerUser = 1 } = options;

    const environment = {
      users: [] as any[],
      runs: [] as any[],
      goals: [] as any[],
      races: [] as any[],
    };

    // Create users
    for (let i = 0; i < userCount; i++) {
      const user = await this.createIsolatedTestUser({
        email: `user${i}-${this.generateTestEmail('env')}`,
        name: `Test User ${i + 1} - ${this.generateTestId('env')}`,
      });
      environment.users.push(user);

      // Create runs for this user
      for (let j = 0; j < runsPerUser; j++) {
        const run = await this.createIsolatedTestRun({
          userId: user.id,
          date: new Date(Date.now() - j * 24 * 60 * 60 * 1000), // j days ago
          distance: 5 + j * 2,
          duration: 1800 + j * 600,
          notes: `Run ${j + 1} for ${user.name}`,
        });
        environment.runs.push(run);
      }

      // Create goals for this user
      for (let k = 0; k < goalsPerUser; k++) {
        const goal = await this.createIsolatedTestGoal({
          userId: user.id,
          title: `Goal ${k + 1} for ${user.name}`,
          targetValue: 10 + k * 5,
        });
        environment.goals.push(goal);
      }

      // Create races for this user
      for (let l = 0; l < racesPerUser; l++) {
        const race = await this.createIsolatedTestRace({
          userId: user.id,
          name: `Race ${l + 1} for ${user.name}`,
          distance: 10 + l * 5,
        });
        environment.races.push(race);
      }
    }

    return environment;
  }

  /**
   * Gets statistics about created entities
   */
  getCreatedEntitiesStats() {
    const stats: Record<string, number> = {};
    for (const [entityType, ids] of this.createdEntities.entries()) {
      stats[entityType] = ids.length;
    }
    return {
      testRunId: this.testRunId,
      testNamespace: this.testNamespace,
      entityCounts: stats,
      totalEntities: Object.values(stats).reduce((sum, count) => sum + count, 0),
    };
  }

  /**
   * Verifies that test isolation is working correctly
   */
  async verifyIsolation(): Promise<{
    isolated: boolean;
    conflicts: string[];
    recommendations: string[];
  }> {
    const conflicts: string[] = [];
    const recommendations: string[] = [];

    try {
      // Check for email conflicts
      const emailPattern = `%@test-${this.testRunId.slice(0, 8)}.example.com`;
      const conflictingEmails = await this.prisma.user.groupBy({
        by: ['email'],
        where: {
          email: {
            like: emailPattern,
          },
        },
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

      if (conflictingEmails.length > 0) {
        conflicts.push(`Found ${conflictingEmails.length} duplicate email(s) in test data`);
        recommendations.push('Use generateTestEmail() for all test users');
      }

      // Check for hardcoded test data
      const hardcodedEmails = await this.prisma.user.count({
        where: {
          email: {
            in: ['test@example.com', 'user@test.com', 'admin@test.com'],
          },
        },
      });

      if (hardcodedEmails > 0) {
        conflicts.push(`Found ${hardcodedEmails} hardcoded test email(s)`);
        recommendations.push('Replace hardcoded emails with generated ones');
      }

      return {
        isolated: conflicts.length === 0,
        conflicts,
        recommendations,
      };
    } catch (error) {
      return {
        isolated: false,
        conflicts: [`Isolation verification failed: ${error}`],
        recommendations: ['Check database connectivity and schema'],
      };
    }
  }
}

/**
 * Creates a test data isolation manager for a specific test suite
 */
export function createTestDataIsolationManager(
  prisma: PrismaClient,
  testSuiteName?: string
): TestDataIsolationManager {
  return new TestDataIsolationManager(prisma, testSuiteName);
}

/**
 * Test data conflict prevention utilities
 */
export const testDataUtils = {
  /**
   * Generates a unique timestamp-based ID
   */
  generateUniqueId: (prefix: string = 'id') => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}-${timestamp}-${random}`;
  },

  /**
   * Generates a unique email that won't conflict with other tests
   */
  generateUniqueEmail: (prefix: string = 'test') => {
    const id = testDataUtils.generateUniqueId(prefix);
    const processId = process.pid;
    return `${id}-${processId}@isolated-test.example.com`;
  },

  /**
   * Creates test data with automatic conflict prevention
   */
  createConflictFreeData: (baseData: Record<string, any>) => {
    const result = { ...baseData };

    // Auto-generate unique values for common conflict-prone fields
    if (result.email && typeof result.email === 'string') {
      result.email = testDataUtils.generateUniqueEmail('auto');
    }

    if (result.name && typeof result.name === 'string') {
      result.name = `${result.name} ${testDataUtils.generateUniqueId('name')}`;
    }

    if (result.title && typeof result.title === 'string') {
      result.title = `${result.title} ${testDataUtils.generateUniqueId('title')}`;
    }

    return result;
  },
};
