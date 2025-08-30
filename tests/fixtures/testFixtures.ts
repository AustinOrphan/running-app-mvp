/**
 * Test Fixtures - Consistent Test Data Generation
 *
 * Provides standardized, consistent test data for all test types.
 * Ensures predictable data structures while avoiding conflicts.
 */

import { faker } from '@faker-js/faker';
import crypto from 'crypto';
import { testDataUtils } from '../utils/testDataIsolationManager.js';

// Set a seed for reproducible fake data in tests
faker.seed(12345);

/**
 * Base fixture interface for all entities
 */
interface BaseFixture {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/**
 * User fixture interface
 */
export interface UserFixture extends BaseFixture {
  email: string;
  password: string;
  hashedPassword?: string;
  name?: string;
}

/**
 * Run fixture interface
 */
export interface RunFixture extends BaseFixture {
  userId: string;
  date: Date;
  distance: number;
  duration: number;
  tag?: string;
  notes?: string;
  routeGeoJson?: string;
}

/**
 * Goal fixture interface
 */
export interface GoalFixture extends BaseFixture {
  userId: string;
  title: string;
  description?: string;
  type: string;
  period: string;
  targetValue: number;
  targetUnit: string;
  startDate: Date;
  endDate: Date;
  currentValue?: number;
  isCompleted?: boolean;
  completedAt?: Date;
  color?: string;
  icon?: string;
  isActive?: boolean;
}

/**
 * Race fixture interface
 */
export interface RaceFixture extends BaseFixture {
  userId: string;
  name: string;
  raceDate: Date;
  distance: number;
  targetTime?: number;
  actualTime?: number;
  notes?: string;
}

/**
 * Test fixture templates
 */
export class TestFixtures {
  private static fixtureCounter = 0;
  private static sessionId = crypto.randomUUID().slice(0, 8);

  /**
   * Generates a unique fixture ID
   */
  private static generateFixtureId(type: string): string {
    this.fixtureCounter++;
    return `${type}-${this.sessionId}-${this.fixtureCounter}-${Date.now()}`;
  }

  /**
   * Creates a consistent user fixture
   */
  static createUser(overrides: Partial<UserFixture> = {}): UserFixture {
    const id = this.generateFixtureId('user');

    return {
      id: overrides.id || id,
      email: overrides.email || testDataUtils.generateUniqueEmail(`fixture-user-${id}`),
      password: overrides.password || 'TestFixture@2024!',
      name: overrides.name || faker.person.fullName(),
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides,
    };
  }

  /**
   * Creates a consistent run fixture
   */
  static createRun(userId: string, overrides: Partial<RunFixture> = {}): RunFixture {
    const id = this.generateFixtureId('run');

    return {
      id: overrides.id || id,
      userId,
      date: overrides.date || faker.date.past({ years: 1 }),
      distance: overrides.distance || faker.number.float({ min: 1, max: 42.2, precision: 0.1 }),
      duration: overrides.duration || faker.number.int({ min: 600, max: 14400 }), // 10 min to 4 hours
      tag:
        overrides.tag ||
        faker.helpers.arrayElement(['easy', 'tempo', 'interval', 'long', 'recovery']),
      notes: overrides.notes || faker.lorem.sentence(),
      routeGeoJson: overrides.routeGeoJson,
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides,
    };
  }

  /**
   * Creates a consistent goal fixture
   */
  static createGoal(userId: string, overrides: Partial<GoalFixture> = {}): GoalFixture {
    const id = this.generateFixtureId('goal');
    const goalTypes = ['DISTANCE', 'TIME', 'FREQUENCY', 'PACE', 'LONGEST_RUN'];
    const periods = ['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM'];

    const type = overrides.type || faker.helpers.arrayElement(goalTypes);
    const period = overrides.period || faker.helpers.arrayElement(periods);

    // Generate appropriate target values based on type
    let targetValue: number;
    let targetUnit: string;

    switch (type) {
      case 'DISTANCE':
        targetValue = faker.number.float({ min: 10, max: 500, precision: 0.1 });
        targetUnit = 'km';
        break;
      case 'TIME':
        targetValue = faker.number.int({ min: 300, max: 10800 }); // 5 min to 3 hours
        targetUnit = 'minutes';
        break;
      case 'FREQUENCY':
        targetValue = faker.number.int({ min: 1, max: 7 });
        targetUnit = 'runs';
        break;
      case 'PACE':
        targetValue = faker.number.float({ min: 3.5, max: 7.0, precision: 0.1 });
        targetUnit = 'min/km';
        break;
      case 'LONGEST_RUN':
        targetValue = faker.number.float({ min: 5, max: 42.2, precision: 0.1 });
        targetUnit = 'km';
        break;
      default:
        targetValue = 10;
        targetUnit = 'km';
    }

    const startDate = overrides.startDate || new Date();
    const endDate = overrides.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days later

    return {
      id: overrides.id || id,
      userId,
      title: overrides.title || `${faker.word.adjective()} ${type.toLowerCase()} goal`,
      description: overrides.description || faker.lorem.sentence(),
      type,
      period,
      targetValue: overrides.targetValue || targetValue,
      targetUnit: overrides.targetUnit || targetUnit,
      startDate,
      endDate,
      currentValue: overrides.currentValue || 0,
      isCompleted: overrides.isCompleted || false,
      completedAt: overrides.completedAt,
      color: overrides.color || faker.color.rgb(),
      icon: overrides.icon || faker.helpers.arrayElement(['🏃', '⚡', '🎯', '🏆', '⏱️']),
      isActive: overrides.isActive !== false, // Default to true
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides,
    };
  }

  /**
   * Creates a consistent race fixture
   */
  static createRace(userId: string, overrides: Partial<RaceFixture> = {}): RaceFixture {
    const id = this.generateFixtureId('race');
    const raceDistances = [5, 10, 21.1, 42.2]; // 5K, 10K, Half Marathon, Marathon
    const distance = overrides.distance || faker.helpers.arrayElement(raceDistances);

    return {
      id: overrides.id || id,
      userId,
      name: overrides.name || `${faker.location.city()} ${distance}K Race`,
      raceDate: overrides.raceDate || faker.date.future({ years: 1 }),
      distance,
      targetTime: overrides.targetTime || faker.number.int({ min: 1200, max: 18000 }), // 20 min to 5 hours
      actualTime: overrides.actualTime,
      notes: overrides.notes || faker.lorem.sentence(),
      createdAt: overrides.createdAt || new Date(),
      updatedAt: overrides.updatedAt || new Date(),
      ...overrides,
    };
  }

  /**
   * Creates a complete test environment with related entities
   */
  static createTestEnvironment(
    options: {
      userCount?: number;
      runsPerUser?: number;
      goalsPerUser?: number;
      racesPerUser?: number;
    } = {}
  ) {
    const { userCount = 2, runsPerUser = 3, goalsPerUser = 2, racesPerUser = 1 } = options;

    const environment = {
      users: [] as UserFixture[],
      runs: [] as RunFixture[],
      goals: [] as GoalFixture[],
      races: [] as RaceFixture[],
    };

    // Create users
    for (let i = 0; i < userCount; i++) {
      const user = this.createUser({
        name: `Test User ${i + 1}`,
        email: testDataUtils.generateUniqueEmail(`env-user-${i}`),
      });
      environment.users.push(user);

      // Create runs for this user
      for (let j = 0; j < runsPerUser; j++) {
        const run = this.createRun(user.id!, {
          date: new Date(Date.now() - j * 24 * 60 * 60 * 1000), // j days ago
          distance: 5 + j * 2.5,
          duration: 1800 + j * 600,
        });
        environment.runs.push(run);
      }

      // Create goals for this user
      for (let k = 0; k < goalsPerUser; k++) {
        const goalTypes = ['DISTANCE', 'FREQUENCY'];
        const goal = this.createGoal(user.id!, {
          type: goalTypes[k % goalTypes.length],
          title: `Goal ${k + 1} for ${user.name}`,
        });
        environment.goals.push(goal);
      }

      // Create races for this user
      for (let l = 0; l < racesPerUser; l++) {
        const race = this.createRace(user.id!, {
          name: `Race ${l + 1} for ${user.name}`,
          raceDate: new Date(Date.now() + (l + 1) * 30 * 24 * 60 * 60 * 1000), // l+1 months later
        });
        environment.races.push(race);
      }
    }

    return environment;
  }

  /**
   * Creates minimal test data for basic scenarios
   */
  static createMinimalTestData() {
    const user = this.createUser({
      email: testDataUtils.generateUniqueEmail('minimal-test'),
      name: 'Minimal Test User',
    });

    const run = this.createRun(user.id!, {
      distance: 5.0,
      duration: 1800,
      notes: 'Minimal test run',
    });

    const goal = this.createGoal(user.id!, {
      type: 'DISTANCE',
      period: 'WEEKLY',
      targetValue: 20,
      targetUnit: 'km',
      title: 'Minimal test goal',
    });

    return { user, run, goal };
  }

  /**
   * Creates performance test data with larger datasets
   */
  static createPerformanceTestData(scale: 'small' | 'medium' | 'large' = 'medium') {
    const scales = {
      small: { users: 5, runsPerUser: 10, goalsPerUser: 3, racesPerUser: 1 },
      medium: { users: 20, runsPerUser: 50, goalsPerUser: 10, racesPerUser: 5 },
      large: { users: 100, runsPerUser: 200, goalsPerUser: 20, racesPerUser: 10 },
    };

    const config = scales[scale];
    return this.createTestEnvironment({
      userCount: config.users,
      runsPerUser: config.runsPerUser,
      goalsPerUser: config.goalsPerUser,
      racesPerUser: config.racesPerUser,
    });
  }

  /**
   * Creates edge case test data
   */
  static createEdgeCaseTestData() {
    const user = this.createUser({
      email: testDataUtils.generateUniqueEmail('edge-case'),
      name: 'Edge Case User',
    });

    // Edge case runs
    const runs = [
      this.createRun(user.id!, {
        distance: 0.1, // Very short run
        duration: 60, // 1 minute
        notes: 'Very short run',
      }),
      this.createRun(user.id!, {
        distance: 100, // Ultra marathon distance
        duration: 36000, // 10 hours
        notes: 'Ultra marathon',
      }),
      this.createRun(user.id!, {
        distance: 42.195, // Exact marathon distance
        duration: 10800, // 3 hours
        notes: 'Marathon PR',
      }),
    ];

    // Edge case goals
    const goals = [
      this.createGoal(user.id!, {
        type: 'FREQUENCY',
        period: 'WEEKLY',
        targetValue: 7, // Daily running
        targetUnit: 'runs',
        title: 'Daily running goal',
      }),
      this.createGoal(user.id!, {
        type: 'PACE',
        period: 'MONTHLY',
        targetValue: 3, // Very fast pace
        targetUnit: 'min/km',
        title: 'Elite pace goal',
      }),
    ];

    // Edge case races
    const races = [
      this.createRace(user.id!, {
        name: 'Ultra Trail Race',
        distance: 100,
        raceDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year away
      }),
      this.createRace(user.id!, {
        name: 'Parkrun 5K',
        distance: 5,
        raceDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 1 week away
        targetTime: 1200, // 20 minutes
      }),
    ];

    return { user, runs, goals, races };
  }

  /**
   * Resets the fixture counter (useful for test isolation)
   */
  static resetCounter() {
    this.fixtureCounter = 0;
    this.sessionId = crypto.randomUUID().slice(0, 8);
  }

  /**
   * Gets fixture generation statistics
   */
  static getStats() {
    return {
      fixtureCounter: this.fixtureCounter,
      sessionId: this.sessionId,
    };
  }
}

/**
 * Pre-defined fixture collections for common test scenarios
 */
export const FixtureCollections = {
  /**
   * Basic auth testing fixtures
   */
  auth: {
    validUser: TestFixtures.createUser({
      email: testDataUtils.generateUniqueEmail('auth-valid'),
      password: 'ValidAuth@2024!',
      name: 'Valid Auth User',
    }),

    adminUser: TestFixtures.createUser({
      email: testDataUtils.generateUniqueEmail('auth-admin'),
      password: 'AdminAuth@2024!',
      name: 'Admin User',
    }),

    duplicateEmailUser: TestFixtures.createUser({
      email: 'duplicate-email@test.com', // Will be made unique by the system
      password: 'DuplicateTest@2024!',
      name: 'Duplicate Email User',
    }),
  },

  /**
   * API testing fixtures
   */
  api: {
    testEnvironment: TestFixtures.createTestEnvironment({
      userCount: 3,
      runsPerUser: 5,
      goalsPerUser: 3,
      racesPerUser: 2,
    }),
  },

  /**
   * Performance testing fixtures
   */
  performance: {
    small: TestFixtures.createPerformanceTestData('small'),
    medium: TestFixtures.createPerformanceTestData('medium'),
    large: TestFixtures.createPerformanceTestData('large'),
  },

  /**
   * Edge case testing fixtures
   */
  edgeCases: TestFixtures.createEdgeCaseTestData(),

  /**
   * Minimal testing fixtures
   */
  minimal: TestFixtures.createMinimalTestData(),
};

/**
 * Fixture utilities for test setup
 */
export const FixtureUtils = {
  /**
   * Converts fixture to Prisma create data
   */
  toPrismaUser: (fixture: UserFixture) => ({
    id: fixture.id,
    email: fixture.email,
    password: fixture.hashedPassword || fixture.password,
    name: fixture.name,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  }),

  toPrismaRun: (fixture: RunFixture) => ({
    id: fixture.id,
    userId: fixture.userId,
    date: fixture.date,
    distance: fixture.distance,
    duration: fixture.duration,
    tag: fixture.tag,
    notes: fixture.notes,
    routeGeoJson: fixture.routeGeoJson,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  }),

  toPrismaGoal: (fixture: GoalFixture) => ({
    id: fixture.id,
    userId: fixture.userId,
    title: fixture.title,
    description: fixture.description,
    type: fixture.type,
    period: fixture.period,
    targetValue: fixture.targetValue,
    targetUnit: fixture.targetUnit,
    startDate: fixture.startDate,
    endDate: fixture.endDate,
    currentValue: fixture.currentValue,
    isCompleted: fixture.isCompleted,
    completedAt: fixture.completedAt,
    color: fixture.color,
    icon: fixture.icon,
    isActive: fixture.isActive,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  }),

  toPrismaRace: (fixture: RaceFixture) => ({
    id: fixture.id,
    userId: fixture.userId,
    name: fixture.name,
    raceDate: fixture.raceDate,
    distance: fixture.distance,
    targetTime: fixture.targetTime,
    actualTime: fixture.actualTime,
    notes: fixture.notes,
    createdAt: fixture.createdAt,
    updatedAt: fixture.updatedAt,
  }),

  /**
   * Validates fixture data integrity
   */
  validateFixture: (fixture: any, type: string): boolean => {
    const requiredFields = {
      user: ['email', 'password'],
      run: ['userId', 'date', 'distance', 'duration'],
      goal: ['userId', 'title', 'type', 'period', 'targetValue', 'targetUnit'],
      race: ['userId', 'name', 'raceDate', 'distance'],
    };

    const required = requiredFields[type as keyof typeof requiredFields];
    if (!required) return false;

    return required.every(field => fixture[field] !== undefined && fixture[field] !== null);
  },
};
