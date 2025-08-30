/**
 * Fixture Loader - Database Integration for Test Fixtures
 *
 * Provides utilities to load fixtures into the test database
 * with proper error handling and validation.
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import {
  TestFixtures,
  FixtureCollections,
  FixtureUtils,
  UserFixture,
  RunFixture,
  GoalFixture,
  RaceFixture,
} from './testFixtures.js';

export interface LoadedFixtures {
  users: any[];
  runs: any[];
  goals: any[];
  races: any[];
}

export interface FixtureLoadOptions {
  hashPasswords?: boolean;
  validateData?: boolean;
  skipDuplicates?: boolean;
  batchSize?: number;
}

/**
 * Fixture Loader class for managing test data in database
 */
export class FixtureLoader {
  private prisma: PrismaClient;
  private saltRounds: number;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.saltRounds = parseInt(process.env.BCRYPT_ROUNDS || '10', 10);
  }

  /**
   * Loads a single user fixture into the database
   */
  async loadUser(fixture: UserFixture, options: FixtureLoadOptions = {}): Promise<any> {
    const { hashPasswords = true, validateData = true } = options;

    if (validateData && !FixtureUtils.validateFixture(fixture, 'user')) {
      throw new Error(`Invalid user fixture: ${JSON.stringify(fixture)}`);
    }

    const userData = FixtureUtils.toPrismaUser(fixture);

    if (hashPasswords && fixture.password && !fixture.hashedPassword) {
      userData.password = await bcrypt.hash(fixture.password, this.saltRounds);
    }

    try {
      const user = await this.prisma.user.create({
        data: userData,
      });

      // Add plainPassword for test use
      return { ...user, plainPassword: fixture.password };
    } catch (error) {
      if (options.skipDuplicates && (error as any).code === 'P2002') {
        console.warn(`Skipping duplicate user: ${fixture.email}`);
        return null;
      }
      throw new Error(`Failed to load user fixture: ${error}`);
    }
  }

  /**
   * Loads multiple user fixtures into the database
   */
  async loadUsers(fixtures: UserFixture[], options: FixtureLoadOptions = {}): Promise<any[]> {
    const { batchSize = 10 } = options;
    const results: any[] = [];

    // Process in batches to avoid overwhelming the database
    for (let i = 0; i < fixtures.length; i += batchSize) {
      const batch = fixtures.slice(i, i + batchSize);
      const batchPromises = batch.map(fixture => this.loadUser(fixture, options));

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(result => result !== null));
      } catch (error) {
        console.error(`Failed to load user batch ${Math.floor(i / batchSize) + 1}:`, error);
        if (!options.skipDuplicates) {
          throw error;
        }
      }
    }

    return results;
  }

  /**
   * Loads a single run fixture into the database
   */
  async loadRun(fixture: RunFixture, options: FixtureLoadOptions = {}): Promise<any> {
    const { validateData = true } = options;

    if (validateData && !FixtureUtils.validateFixture(fixture, 'run')) {
      throw new Error(`Invalid run fixture: ${JSON.stringify(fixture)}`);
    }

    const runData = FixtureUtils.toPrismaRun(fixture);

    try {
      return await this.prisma.run.create({
        data: runData,
      });
    } catch (error) {
      throw new Error(`Failed to load run fixture: ${error}`);
    }
  }

  /**
   * Loads multiple run fixtures into the database
   */
  async loadRuns(fixtures: RunFixture[], options: FixtureLoadOptions = {}): Promise<any[]> {
    const { batchSize = 20 } = options;
    const results: any[] = [];

    for (let i = 0; i < fixtures.length; i += batchSize) {
      const batch = fixtures.slice(i, i + batchSize);
      const batchPromises = batch.map(fixture => this.loadRun(fixture, options));

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      } catch (error) {
        console.error(`Failed to load run batch ${Math.floor(i / batchSize) + 1}:`, error);
        throw error;
      }
    }

    return results;
  }

  /**
   * Loads a single goal fixture into the database
   */
  async loadGoal(fixture: GoalFixture, options: FixtureLoadOptions = {}): Promise<any> {
    const { validateData = true } = options;

    if (validateData && !FixtureUtils.validateFixture(fixture, 'goal')) {
      throw new Error(`Invalid goal fixture: ${JSON.stringify(fixture)}`);
    }

    const goalData = FixtureUtils.toPrismaGoal(fixture);

    try {
      return await this.prisma.goal.create({
        data: goalData,
      });
    } catch (error) {
      throw new Error(`Failed to load goal fixture: ${error}`);
    }
  }

  /**
   * Loads multiple goal fixtures into the database
   */
  async loadGoals(fixtures: GoalFixture[], options: FixtureLoadOptions = {}): Promise<any[]> {
    const { batchSize = 15 } = options;
    const results: any[] = [];

    for (let i = 0; i < fixtures.length; i += batchSize) {
      const batch = fixtures.slice(i, i + batchSize);
      const batchPromises = batch.map(fixture => this.loadGoal(fixture, options));

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      } catch (error) {
        console.error(`Failed to load goal batch ${Math.floor(i / batchSize) + 1}:`, error);
        throw error;
      }
    }

    return results;
  }

  /**
   * Loads a single race fixture into the database
   */
  async loadRace(fixture: RaceFixture, options: FixtureLoadOptions = {}): Promise<any> {
    const { validateData = true } = options;

    if (validateData && !FixtureUtils.validateFixture(fixture, 'race')) {
      throw new Error(`Invalid race fixture: ${JSON.stringify(fixture)}`);
    }

    const raceData = FixtureUtils.toPrismaRace(fixture);

    try {
      return await this.prisma.race.create({
        data: raceData,
      });
    } catch (error) {
      throw new Error(`Failed to load race fixture: ${error}`);
    }
  }

  /**
   * Loads multiple race fixtures into the database
   */
  async loadRaces(fixtures: RaceFixture[], options: FixtureLoadOptions = {}): Promise<any[]> {
    const { batchSize = 15 } = options;
    const results: any[] = [];

    for (let i = 0; i < fixtures.length; i += batchSize) {
      const batch = fixtures.slice(i, i + batchSize);
      const batchPromises = batch.map(fixture => this.loadRace(fixture, options));

      try {
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);
      } catch (error) {
        console.error(`Failed to load race batch ${Math.floor(i / batchSize) + 1}:`, error);
        throw error;
      }
    }

    return results;
  }

  /**
   * Loads a complete test environment into the database
   */
  async loadTestEnvironment(
    environment: {
      users: UserFixture[];
      runs: RunFixture[];
      goals: GoalFixture[];
      races: RaceFixture[];
    },
    options: FixtureLoadOptions = {}
  ): Promise<LoadedFixtures> {
    console.log('🔧 Loading test environment fixtures...');

    try {
      // Load users first (required by other entities)
      const loadedUsers = await this.loadUsers(environment.users, options);
      console.log(`✅ Loaded ${loadedUsers.length} users`);

      // Load other entities in parallel (they depend on users but not each other)
      const [loadedRuns, loadedGoals, loadedRaces] = await Promise.all([
        this.loadRuns(environment.runs, options),
        this.loadGoals(environment.goals, options),
        this.loadRaces(environment.races, options),
      ]);

      console.log(`✅ Loaded ${loadedRuns.length} runs`);
      console.log(`✅ Loaded ${loadedGoals.length} goals`);
      console.log(`✅ Loaded ${loadedRaces.length} races`);

      return {
        users: loadedUsers,
        runs: loadedRuns,
        goals: loadedGoals,
        races: loadedRaces,
      };
    } catch (error) {
      console.error('❌ Failed to load test environment:', error);
      throw error;
    }
  }

  /**
   * Loads a predefined fixture collection
   */
  async loadFixtureCollection(
    collectionName: keyof typeof FixtureCollections,
    options: FixtureLoadOptions = {}
  ): Promise<LoadedFixtures> {
    const collection = FixtureCollections[collectionName];

    if (!collection) {
      throw new Error(`Unknown fixture collection: ${collectionName}`);
    }

    console.log(`🔧 Loading fixture collection: ${collectionName}`);

    try {
      if (collectionName === 'auth') {
        // Handle auth fixtures (individual users)
        const authCollection = collection as typeof FixtureCollections.auth;
        const users = [
          authCollection.validUser,
          authCollection.adminUser,
          authCollection.duplicateEmailUser,
        ];

        const loadedUsers = await this.loadUsers(users, options);

        return {
          users: loadedUsers,
          runs: [],
          goals: [],
          races: [],
        };
      } else if (collectionName === 'api') {
        // Handle API test environment
        const apiCollection = collection as typeof FixtureCollections.api;
        return await this.loadTestEnvironment(apiCollection.testEnvironment, options);
      } else if (collectionName === 'performance') {
        // Handle performance fixtures (choose medium by default)
        const perfCollection = collection as typeof FixtureCollections.performance;
        return await this.loadTestEnvironment(perfCollection.medium, options);
      } else if (collectionName === 'edgeCases') {
        // Handle edge cases
        const edgeCollection = collection as typeof FixtureCollections.edgeCases;
        return await this.loadTestEnvironment(
          {
            users: [edgeCollection.user],
            runs: edgeCollection.runs,
            goals: edgeCollection.goals,
            races: edgeCollection.races,
          },
          options
        );
      } else if (collectionName === 'minimal') {
        // Handle minimal fixtures
        const minimalCollection = collection as typeof FixtureCollections.minimal;
        return await this.loadTestEnvironment(
          {
            users: [minimalCollection.user],
            runs: [minimalCollection.run],
            goals: [minimalCollection.goal],
            races: [],
          },
          options
        );
      }

      throw new Error(`Unsupported collection type: ${collectionName}`);
    } catch (error) {
      console.error(`❌ Failed to load fixture collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Creates and loads fixtures for a specific test scenario
   */
  async createAndLoadScenario(
    scenarioName: string,
    config: {
      userCount?: number;
      runsPerUser?: number;
      goalsPerUser?: number;
      racesPerUser?: number;
    } = {},
    options: FixtureLoadOptions = {}
  ): Promise<LoadedFixtures> {
    console.log(`🔧 Creating and loading scenario: ${scenarioName}`);

    const environment = TestFixtures.createTestEnvironment(config);
    return await this.loadTestEnvironment(environment, options);
  }

  /**
   * Gets statistics about loaded fixtures
   */
  async getLoadedFixtureStats(): Promise<{
    users: number;
    runs: number;
    goals: number;
    races: number;
    total: number;
  }> {
    const [userCount, runCount, goalCount, raceCount] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.run.count(),
      this.prisma.goal.count(),
      this.prisma.race.count(),
    ]);

    return {
      users: userCount,
      runs: runCount,
      goals: goalCount,
      races: raceCount,
      total: userCount + runCount + goalCount + raceCount,
    };
  }

  /**
   * Validates that fixtures were loaded correctly
   */
  async validateLoadedFixtures(expectedCounts: {
    users?: number;
    runs?: number;
    goals?: number;
    races?: number;
  }): Promise<{
    valid: boolean;
    issues: string[];
    stats: any;
  }> {
    const stats = await this.getLoadedFixtureStats();
    const issues: string[] = [];

    if (expectedCounts.users !== undefined && stats.users !== expectedCounts.users) {
      issues.push(`Expected ${expectedCounts.users} users, found ${stats.users}`);
    }

    if (expectedCounts.runs !== undefined && stats.runs !== expectedCounts.runs) {
      issues.push(`Expected ${expectedCounts.runs} runs, found ${stats.runs}`);
    }

    if (expectedCounts.goals !== undefined && stats.goals !== expectedCounts.goals) {
      issues.push(`Expected ${expectedCounts.goals} goals, found ${stats.goals}`);
    }

    if (expectedCounts.races !== undefined && stats.races !== expectedCounts.races) {
      issues.push(`Expected ${expectedCounts.races} races, found ${stats.races}`);
    }

    return {
      valid: issues.length === 0,
      issues,
      stats,
    };
  }
}

/**
 * Creates a fixture loader for a given Prisma client
 */
export function createFixtureLoader(prisma: PrismaClient): FixtureLoader {
  return new FixtureLoader(prisma);
}

/**
 * Utility functions for common fixture loading patterns
 */
export const FixtureLoadingUtils = {
  /**
   * Quick load minimal test data
   */
  async loadMinimal(prisma: PrismaClient): Promise<LoadedFixtures> {
    const loader = new FixtureLoader(prisma);
    return await loader.loadFixtureCollection('minimal');
  },

  /**
   * Quick load auth test fixtures
   */
  async loadAuth(prisma: PrismaClient): Promise<LoadedFixtures> {
    const loader = new FixtureLoader(prisma);
    return await loader.loadFixtureCollection('auth');
  },

  /**
   * Quick load API test environment
   */
  async loadApiTestEnvironment(prisma: PrismaClient): Promise<LoadedFixtures> {
    const loader = new FixtureLoader(prisma);
    return await loader.loadFixtureCollection('api');
  },

  /**
   * Quick load edge case data
   */
  async loadEdgeCases(prisma: PrismaClient): Promise<LoadedFixtures> {
    const loader = new FixtureLoader(prisma);
    return await loader.loadFixtureCollection('edgeCases');
  },

  /**
   * Load custom scenario
   */
  async loadCustomScenario(
    prisma: PrismaClient,
    config: {
      userCount?: number;
      runsPerUser?: number;
      goalsPerUser?: number;
      racesPerUser?: number;
    }
  ): Promise<LoadedFixtures> {
    const loader = new FixtureLoader(prisma);
    return await loader.createAndLoadScenario('custom', config);
  },
};
