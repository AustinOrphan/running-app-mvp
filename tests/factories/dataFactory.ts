/**
 * Data Factory System - Advanced Test Data Generation
 *
 * Provides flexible, trait-based data factories for creating test data
 * with customizable attributes, relationships, and sequences.
 */

import { faker } from '@faker-js/faker';
import crypto from 'crypto';
import { testDataUtils } from '../utils/testDataIsolationManager.js';

// Ensure consistent fake data across test runs
faker.seed(12345);

/**
 * Base factory interface
 */
export interface FactoryOptions {
  traits?: string[];
  overrides?: Record<string, any>;
  count?: number;
  associations?: Record<string, any>;
}

/**
 * Factory sequence manager for generating unique sequential values
 */
class SequenceManager {
  private sequences: Map<string, number> = new Map();

  next(name: string, startValue: number = 1): number {
    const current = this.sequences.get(name) || startValue - 1;
    const next = current + 1;
    this.sequences.set(name, next);
    return next;
  }

  reset(name?: string): void {
    if (name) {
      this.sequences.delete(name);
    } else {
      this.sequences.clear();
    }
  }

  current(name: string): number {
    return this.sequences.get(name) || 0;
  }
}

const sequenceManager = new SequenceManager();

/**
 * Base factory class with common functionality
 */
abstract class BaseFactory<T> {
  protected abstract defaultAttributes(): Partial<T>;
  protected abstract traits(): Record<string, Partial<T>>;

  /**
   * Generates a sequence value
   */
  protected sequence(name: string, startValue?: number): number {
    return sequenceManager.next(name, startValue);
  }

  /**
   * Creates a single instance
   */
  create(options: FactoryOptions = {}): T {
    const { traits = [], overrides = {}, associations = {} } = options;

    let attributes = { ...this.defaultAttributes() };

    // Apply traits
    for (const trait of traits) {
      const traitAttributes = this.traits()[trait];
      if (traitAttributes) {
        attributes = { ...attributes, ...traitAttributes };
      }
    }

    // Apply associations
    attributes = { ...attributes, ...associations };

    // Apply overrides last
    attributes = { ...attributes, ...overrides };

    return attributes as T;
  }

  /**
   * Creates multiple instances
   */
  createList(count: number, options: Omit<FactoryOptions, 'count'> = {}): T[] {
    return Array.from({ length: count }, () => this.create(options));
  }

  /**
   * Creates instances with sequential variations
   */
  createSequence(
    count: number,
    sequenceFn: (index: number) => Partial<T>,
    options: Omit<FactoryOptions, 'count'> = {}
  ): T[] {
    return Array.from({ length: count }, (_, index) => {
      const sequenceOverrides = sequenceFn(index);
      return this.create({
        ...options,
        overrides: { ...options.overrides, ...sequenceOverrides },
      });
    });
  }

  /**
   * Resets sequences for this factory
   */
  resetSequences(): void {
    sequenceManager.reset();
  }
}

/**
 * User factory
 */
export interface UserFactoryData {
  id: string;
  email: string;
  password: string;
  hashedPassword?: string;
  name?: string;
  createdAt: Date;
  updatedAt: Date;
}

class UserFactory extends BaseFactory<UserFactoryData> {
  protected defaultAttributes(): Partial<UserFactoryData> {
    const id = crypto.randomUUID();
    const sequence = this.sequence('user');

    return {
      id,
      email: testDataUtils.generateUniqueEmail(`user-${sequence}`),
      password: 'FactoryUser@2024!',
      name: faker.person.fullName(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  protected traits(): Record<string, Partial<UserFactoryData>> {
    return {
      admin: {
        email: testDataUtils.generateUniqueEmail('admin'),
        name: 'Admin User',
        password: 'AdminFactory@2024!',
      },
      premium: {
        email: testDataUtils.generateUniqueEmail('premium'),
        name: 'Premium User',
        password: 'PremiumFactory@2024!',
      },
      newbie: {
        email: testDataUtils.generateUniqueEmail('newbie'),
        name: 'New User',
        createdAt: new Date(),
      },
      veteran: {
        email: testDataUtils.generateUniqueEmail('veteran'),
        name: 'Veteran Runner',
        createdAt: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000), // 2 years ago
      },
      inactive: {
        email: testDataUtils.generateUniqueEmail('inactive'),
        name: 'Inactive User',
        updatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
      },
    };
  }
}

/**
 * Run factory
 */
export interface RunFactoryData {
  id: string;
  userId: string;
  date: Date;
  distance: number;
  duration: number;
  tag?: string;
  notes?: string;
  routeGeoJson?: string;
  createdAt: Date;
  updatedAt: Date;
}

class RunFactory extends BaseFactory<RunFactoryData> {
  protected defaultAttributes(): Partial<RunFactoryData> {
    const id = crypto.randomUUID();
    const sequence = this.sequence('run');

    return {
      id,
      userId: '', // Must be provided
      date: faker.date.past({ years: 1 }),
      distance: faker.number.float({ min: 1, max: 25, precision: 0.1 }),
      duration: faker.number.int({ min: 300, max: 9000 }), // 5 min to 2.5 hours
      tag: faker.helpers.arrayElement(['easy', 'tempo', 'interval', 'long', 'recovery']),
      notes: `Run ${sequence}: ${faker.lorem.sentence()}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  protected traits(): Record<string, Partial<RunFactoryData>> {
    return {
      short: {
        distance: faker.number.float({ min: 1, max: 5, precision: 0.1 }),
        duration: faker.number.int({ min: 300, max: 1800 }), // 5-30 min
        tag: 'easy',
        notes: 'Short recovery run',
      },
      long: {
        distance: faker.number.float({ min: 15, max: 42.2, precision: 0.1 }),
        duration: faker.number.int({ min: 5400, max: 18000 }), // 1.5-5 hours
        tag: 'long',
        notes: 'Long endurance run',
      },
      speed: {
        distance: faker.number.float({ min: 3, max: 10, precision: 0.1 }),
        duration: faker.number.int({ min: 600, max: 2400 }), // 10-40 min
        tag: 'interval',
        notes: 'Speed/interval training',
      },
      tempo: {
        distance: faker.number.float({ min: 5, max: 15, precision: 0.1 }),
        duration: faker.number.int({ min: 1200, max: 4200 }), // 20-70 min
        tag: 'tempo',
        notes: 'Tempo/threshold run',
      },
      race: {
        distance: faker.helpers.arrayElement([5, 10, 21.1, 42.2]),
        tag: 'race',
        notes: 'Race performance',
      },
      recent: {
        date: faker.date.recent({ days: 7 }),
        notes: 'Recent training run',
      },
      old: {
        date: faker.date.past({ years: 2 }),
        notes: 'Historical run data',
      },
    };
  }
}

/**
 * Goal factory
 */
export interface GoalFactoryData {
  id: string;
  userId: string;
  title: string;
  description?: string;
  type: string;
  period: string;
  targetValue: number;
  targetUnit: string;
  startDate: Date;
  endDate: Date;
  currentValue: number;
  isCompleted: boolean;
  completedAt?: Date;
  color?: string;
  icon?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

class GoalFactory extends BaseFactory<GoalFactoryData> {
  protected defaultAttributes(): Partial<GoalFactoryData> {
    const id = crypto.randomUUID();
    const sequence = this.sequence('goal');
    const type = faker.helpers.arrayElement([
      'DISTANCE',
      'TIME',
      'FREQUENCY',
      'PACE',
      'LONGEST_RUN',
    ]);

    // Generate appropriate values based on type
    let targetValue: number;
    let targetUnit: string;

    switch (type) {
      case 'DISTANCE':
        targetValue = faker.number.float({ min: 20, max: 200, precision: 0.1 });
        targetUnit = 'km';
        break;
      case 'TIME':
        targetValue = faker.number.int({ min: 300, max: 7200 });
        targetUnit = 'minutes';
        break;
      case 'FREQUENCY':
        targetValue = faker.number.int({ min: 2, max: 7 });
        targetUnit = 'runs';
        break;
      case 'PACE':
        targetValue = faker.number.float({ min: 3.5, max: 6.5, precision: 0.1 });
        targetUnit = 'min/km';
        break;
      default:
        targetValue = faker.number.float({ min: 5, max: 25, precision: 0.1 });
        targetUnit = 'km';
    }

    return {
      id,
      userId: '', // Must be provided
      title: `Goal ${sequence}: ${faker.word.adjective()} ${type.toLowerCase()}`,
      description: faker.lorem.sentence(),
      type,
      period: faker.helpers.arrayElement(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM']),
      targetValue,
      targetUnit,
      startDate: new Date(),
      endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      currentValue: 0,
      isCompleted: false,
      color: faker.color.rgb(),
      icon: faker.helpers.arrayElement(['🏃', '⚡', '🎯', '🏆', '⏱️']),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  protected traits(): Record<string, Partial<GoalFactoryData>> {
    return {
      weekly: {
        period: 'WEEKLY',
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        title: 'Weekly running goal',
      },
      monthly: {
        period: 'MONTHLY',
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        title: 'Monthly distance goal',
      },
      distance: {
        type: 'DISTANCE',
        targetValue: 50,
        targetUnit: 'km',
        title: 'Distance challenge',
      },
      frequency: {
        type: 'FREQUENCY',
        targetValue: 4,
        targetUnit: 'runs',
        title: 'Consistency goal',
      },
      completed: {
        isCompleted: true,
        completedAt: new Date(),
        currentValue: 100, // Will be overridden by targetValue if provided
      },
      overdue: {
        startDate: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
        title: 'Overdue goal',
      },
      upcoming: {
        startDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 37 * 24 * 60 * 60 * 1000),
        title: 'Upcoming challenge',
      },
      inactive: {
        isActive: false,
        title: 'Inactive goal',
      },
    };
  }
}

/**
 * Race factory
 */
export interface RaceFactoryData {
  id: string;
  userId: string;
  name: string;
  raceDate: Date;
  distance: number;
  targetTime?: number;
  actualTime?: number;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

class RaceFactory extends BaseFactory<RaceFactoryData> {
  protected defaultAttributes(): Partial<RaceFactoryData> {
    const id = crypto.randomUUID();
    const sequence = this.sequence('race');
    const distance = faker.helpers.arrayElement([5, 10, 21.1, 42.2]);

    return {
      id,
      userId: '', // Must be provided
      name: `${faker.location.city()} ${distance}K Race ${sequence}`,
      raceDate: faker.date.future({ years: 1 }),
      distance,
      targetTime: faker.number.int({ min: 900, max: 18000 }), // 15 min to 5 hours
      notes: faker.lorem.sentence(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  protected traits(): Record<string, Partial<RaceFactoryData>> {
    return {
      parkrun: {
        name: 'Local Parkrun',
        distance: 5,
        targetTime: faker.number.int({ min: 900, max: 2400 }), // 15-40 min
        notes: 'Weekly parkrun event',
      },
      '10k': {
        distance: 10,
        targetTime: faker.number.int({ min: 1800, max: 4200 }), // 30-70 min
        name: '10K Championship',
      },
      halfMarathon: {
        distance: 21.1,
        targetTime: faker.number.int({ min: 4500, max: 10800 }), // 1.25-3 hours
        name: 'Half Marathon',
      },
      marathon: {
        distance: 42.2,
        targetTime: faker.number.int({ min: 9000, max: 18000 }), // 2.5-5 hours
        name: 'Marathon Challenge',
      },
      upcoming: {
        raceDate: faker.date.soon({ days: 30 }),
        notes: 'Upcoming race event',
      },
      past: {
        raceDate: faker.date.past({ years: 1 }),
        actualTime: faker.number.int({ min: 900, max: 18000 }),
        notes: 'Completed race',
      },
      pb: {
        actualTime: faker.number.int({ min: 900, max: 4200 }),
        notes: 'Personal best performance!',
      },
      dnf: {
        actualTime: undefined,
        notes: 'Did not finish - injury',
      },
    };
  }
}

/**
 * Factory registry
 */
export class DataFactory {
  private static userFactory = new UserFactory();
  private static runFactory = new RunFactory();
  private static goalFactory = new GoalFactory();
  private static raceFactory = new RaceFactory();

  /**
   * User factory methods
   */
  static user = {
    create: (options?: FactoryOptions) => this.userFactory.create(options),
    createList: (count: number, options?: Omit<FactoryOptions, 'count'>) =>
      this.userFactory.createList(count, options),
    createSequence: (
      count: number,
      sequenceFn: (index: number) => Partial<UserFactoryData>,
      options?: Omit<FactoryOptions, 'count'>
    ) => this.userFactory.createSequence(count, sequenceFn, options),
  };

  /**
   * Run factory methods
   */
  static run = {
    create: (userId: string, options?: FactoryOptions) =>
      this.runFactory.create({ ...options, associations: { userId } }),
    createList: (userId: string, count: number, options?: Omit<FactoryOptions, 'count'>) =>
      this.runFactory.createList(count, { ...options, associations: { userId } }),
    createSequence: (
      userId: string,
      count: number,
      sequenceFn: (index: number) => Partial<RunFactoryData>,
      options?: Omit<FactoryOptions, 'count'>
    ) =>
      this.runFactory.createSequence(count, sequenceFn, { ...options, associations: { userId } }),
  };

  /**
   * Goal factory methods
   */
  static goal = {
    create: (userId: string, options?: FactoryOptions) =>
      this.goalFactory.create({ ...options, associations: { userId } }),
    createList: (userId: string, count: number, options?: Omit<FactoryOptions, 'count'>) =>
      this.goalFactory.createList(count, { ...options, associations: { userId } }),
    createSequence: (
      userId: string,
      count: number,
      sequenceFn: (index: number) => Partial<GoalFactoryData>,
      options?: Omit<FactoryOptions, 'count'>
    ) =>
      this.goalFactory.createSequence(count, sequenceFn, { ...options, associations: { userId } }),
  };

  /**
   * Race factory methods
   */
  static race = {
    create: (userId: string, options?: FactoryOptions) =>
      this.raceFactory.create({ ...options, associations: { userId } }),
    createList: (userId: string, count: number, options?: Omit<FactoryOptions, 'count'>) =>
      this.raceFactory.createList(count, { ...options, associations: { userId } }),
    createSequence: (
      userId: string,
      count: number,
      sequenceFn: (index: number) => Partial<RaceFactoryData>,
      options?: Omit<FactoryOptions, 'count'>
    ) =>
      this.raceFactory.createSequence(count, sequenceFn, { ...options, associations: { userId } }),
  };

  /**
   * Utility methods
   */
  static resetSequences() {
    this.userFactory.resetSequences();
    this.runFactory.resetSequences();
    this.goalFactory.resetSequences();
    this.raceFactory.resetSequences();
  }

  /**
   * Create a complete user profile with related data
   */
  static createUserProfile(
    options: {
      userTraits?: string[];
      userOverrides?: Partial<UserFactoryData>;
      runsCount?: number;
      runTraits?: string[];
      goalsCount?: number;
      goalTraits?: string[];
      racesCount?: number;
      raceTraits?: string[];
    } = {}
  ) {
    const {
      userTraits = [],
      userOverrides = {},
      runsCount = 5,
      runTraits = [],
      goalsCount = 2,
      goalTraits = [],
      racesCount = 1,
      raceTraits = [],
    } = options;

    const user = this.user.create({
      traits: userTraits,
      overrides: userOverrides,
    });

    const runs = this.run.createList(user.id, runsCount, {
      traits: runTraits,
    });

    const goals = this.goal.createList(user.id, goalsCount, {
      traits: goalTraits,
    });

    const races = this.race.createList(user.id, racesCount, {
      traits: raceTraits,
    });

    return {
      user,
      runs,
      goals,
      races,
    };
  }

  /**
   * Create training progression data (runs over time)
   */
  static createTrainingProgression(userId: string, weeks: number = 12) {
    const runs: RunFactoryData[] = [];
    const startDate = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);

    for (let week = 0; week < weeks; week++) {
      const weekStart = new Date(startDate.getTime() + week * 7 * 24 * 60 * 60 * 1000);

      // 3-4 runs per week
      const runsThisWeek = faker.number.int({ min: 3, max: 4 });

      for (let run = 0; run < runsThisWeek; run++) {
        const runDate = new Date(weekStart.getTime() + run * 2 * 24 * 60 * 60 * 1000);
        const distance = faker.number.float({
          min: 3 + week * 0.5,
          max: 8 + week * 0.5,
          precision: 0.1,
        });

        runs.push(
          this.run.create(userId, {
            overrides: {
              date: runDate,
              distance,
              duration: Math.round(distance * faker.number.int({ min: 300, max: 420 })), // 5-7 min/km
              notes: `Week ${week + 1}, Run ${run + 1}`,
            },
          })
        );
      }
    }

    return runs;
  }

  /**
   * Create race season data
   */
  static createRaceSeason(userId: string, year: number = new Date().getFullYear()) {
    const raceSchedule = [
      { month: 2, distance: 10, name: 'Winter 10K' },
      { month: 4, distance: 21.1, name: 'Spring Half Marathon' },
      { month: 6, distance: 5, name: 'Summer 5K Series' },
      { month: 9, distance: 42.2, name: 'Marathon Challenge' },
      { month: 11, distance: 10, name: 'Turkey Trot 10K' },
    ];

    return raceSchedule.map((race, index) => {
      const raceDate = new Date(year, race.month - 1, faker.number.int({ min: 1, max: 28 }));
      const isPast = raceDate < new Date();

      return this.race.create(userId, {
        overrides: {
          name: race.name,
          distance: race.distance,
          raceDate,
          actualTime: isPast ? faker.number.int({ min: 900, max: 18000 }) : undefined,
          notes: isPast ? 'Season race completed' : 'Upcoming season race',
        },
      });
    });
  }

  /**
   * Get available traits for each factory
   */
  static getAvailableTraits() {
    return {
      user: Object.keys(this.userFactory['traits']()),
      run: Object.keys(this.runFactory['traits']()),
      goal: Object.keys(this.goalFactory['traits']()),
      race: Object.keys(this.raceFactory['traits']()),
    };
  }
}

/**
 * Factory builder for fluent API
 */
export class FactoryBuilder<T> {
  private factory: BaseFactory<T>;
  private options: FactoryOptions = {};

  constructor(factory: BaseFactory<T>) {
    this.factory = factory;
  }

  traits(...traits: string[]): this {
    this.options.traits = [...(this.options.traits || []), ...traits];
    return this;
  }

  overrides(overrides: Partial<T>): this {
    this.options.overrides = { ...this.options.overrides, ...overrides };
    return this;
  }

  associations(associations: Record<string, any>): this {
    this.options.associations = { ...this.options.associations, ...associations };
    return this;
  }

  build(): T {
    return this.factory.create(this.options);
  }

  buildList(count: number): T[] {
    return this.factory.createList(count, this.options);
  }
}

// Export individual factories for direct access if needed
export { UserFactory, RunFactory, GoalFactory, RaceFactory };
