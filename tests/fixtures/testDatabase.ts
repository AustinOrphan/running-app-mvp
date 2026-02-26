import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

import {
  mockRuns,
  mockTestUser,
  mockGoals,
  mockRaces,
  mockTrainingPlans,
  mockWorkoutTemplates,
} from './mockData.js';

/**
 * Generate a unique test database URL for a given test suite
 * This ensures each suite has its own isolated database to prevent race conditions
 */
export function getTestDatabaseUrl(suiteName: string): string {
  return `file:./prisma/test-${suiteName}.db`;
}

/**
 * TestDatabase class - Provides isolated database instance per test suite
 *
 * Usage:
 *   const testDb = new TestDatabase(getTestDatabaseUrl('auth'));
 *   // Or use the default shared instance:
 *   const testDb = new TestDatabase();
 */
export class TestDatabase {
  public readonly prisma: PrismaClient;
  private readonly databaseUrl: string;

  constructor(databaseUrl?: string) {
    this.databaseUrl = databaseUrl || process.env.TEST_DATABASE_URL || 'file:./prisma/test.db';
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: this.databaseUrl,
        },
      },
    });
  }

  // Test user creation utility
  async createTestUser(userData?: { email?: string; password?: string }) {
    const email = userData?.email || mockTestUser.email;
    const password = userData?.password || 'Test@password123';
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
      },
    });

    return { ...user, plainPassword: password };
  }

  // Test runs creation utility
  async createTestRuns(userId: string, runs = mockRuns) {
    const createdRuns = [];

    for (const run of runs) {
      const createdRun = await this.prisma.run.create({
        data: {
          date: new Date(run.date),
          distance: run.distance,
          duration: run.duration,
          tag: run.tag,
          notes: run.notes,
          userId: userId,
        },
      });
      createdRuns.push(createdRun);
    }

    return createdRuns;
  }

  // Test goals creation utility
  async createTestGoals(userId: string, goals = mockGoals) {
    const createdGoals = [];

    for (const goal of goals) {
      const createdGoal = await this.prisma.goal.create({
        data: {
          title: goal.title,
          description: goal.description,
          type: goal.type,
          targetValue: goal.targetValue,
          targetUnit: goal.targetUnit,
          currentValue: goal.currentValue || 0,
          period: goal.period,
          startDate: new Date(goal.startDate),
          endDate: new Date(goal.endDate),
          isCompleted: goal.isCompleted || false,
          completedAt: goal.completedAt ? new Date(goal.completedAt) : null,
          color: goal.color,
          icon: goal.icon,
          isActive: true,
          userId: userId,
        },
      });
      createdGoals.push(createdGoal);
    }

    return createdGoals;
  }

  // Test races creation utility
  async createTestRaces(userId: string, races = mockRaces) {
    const createdRaces = [];

    for (const race of races) {
      const createdRace = await this.prisma.race.create({
        data: {
          name: race.name,
          raceDate: new Date(race.raceDate),
          distance: race.distance,
          targetTime: race.targetTime,
          actualTime: race.actualTime,
          notes: race.notes,
          userId: userId,
        },
      });
      createdRaces.push(createdRace);
    }

    return createdRaces;
  }

  // Generate test JWT token (matching production token format)
  generateTestToken(userId: string, email: string = 'test@example.com') {
    const payload = {
      id: userId,
      email,
      iat: Math.floor(Date.now() / 1000),
      jti: crypto.randomUUID(),
      type: 'access' as const,
    };

    return jwt.sign(payload, process.env.JWT_SECRET || 'test-secret', {
      expiresIn: '1h',
      issuer: 'running-app',
      audience: 'running-app-users',
    });
  }

  // Test training plans creation utility
  async createTestTrainingPlans(userId: string, plans = mockTrainingPlans) {
    const createdPlans = [];

    for (const plan of plans) {
      const createdPlan = await this.prisma.trainingPlan.create({
        data: {
          name: plan.name,
          description: plan.description,
          goal: plan.goal,
          targetRaceId: plan.targetRaceId,
          startDate: new Date(plan.startDate),
          endDate: new Date(plan.endDate),
          isActive: plan.isActive,
          difficulty: plan.difficulty,
          weeklyMileageStart: plan.weeklyMileageStart,
          weeklyMileageTarget: plan.weeklyMileageTarget,
          userId: userId,
        },
      });
      createdPlans.push(createdPlan);
    }

    return createdPlans;
  }

  // Test workout templates creation utility
  async createTestWorkouts(trainingPlanId: string, workouts = mockWorkoutTemplates) {
    const createdWorkouts = [];

    for (const workout of workouts) {
      if (workout.trainingPlanId === 'plan-1' || workout.trainingPlanId === 'plan-2') {
        const createdWorkout = await this.prisma.workoutTemplate.create({
          data: {
            trainingPlanId,
            weekNumber: workout.weekNumber,
            dayOfWeek: workout.dayOfWeek,
            type: workout.type,
            name: workout.name,
            description: workout.description,
            targetDistance: workout.targetDistance,
            targetDuration: workout.targetDuration,
            targetPace: workout.targetPace,
            intensity: workout.intensity,
            notes: workout.notes,
            isCompleted: workout.isCompleted,
            completedRunId: workout.completedRunId,
          },
        });
        createdWorkouts.push(createdWorkout);
      }
    }

    return createdWorkouts;
  }

  // Clean up database utility
  async cleanupDatabase() {
    await this.prisma.workoutTemplate.deleteMany();
    await this.prisma.trainingPlan.deleteMany();
    await this.prisma.race.deleteMany();
    await this.prisma.goal.deleteMany();
    await this.prisma.run.deleteMany();
    await this.prisma.user.deleteMany();
  }

  // Find user by email
  async findUserByEmail(email: string) {
    return await this.prisma.user.findUnique({
      where: { email },
    });
  }

  // Database seed for tests
  async seedTestDatabase() {
    // Clean existing data
    await this.cleanupDatabase();

    // Create test user
    const user = await this.createTestUser();

    // Create test runs
    const runs = await this.createTestRuns(user.id);

    return { user, runs };
  }

  // Test runs with GPS data (for heatmap testing)
  async createTestRunsWithGPS(
    userId: string,
    runs: Array<{
      date: string;
      distance: number;
      duration: number;
      tag?: string;
      notes?: string;
      routeGeoJson: string;
    }>
  ) {
    const createdRuns = [];

    for (const run of runs) {
      const createdRun = await this.prisma.run.create({
        data: {
          date: new Date(run.date),
          distance: run.distance,
          duration: run.duration,
          tag: run.tag,
          notes: run.notes,
          routeGeoJson: run.routeGeoJson,
          userId: userId,
        },
      });
      createdRuns.push(createdRun);
    }

    return createdRuns;
  }

  // Test runs with RunDetail data (heart rate, elevation, etc.)
  async createTestRunsWithDetails(
    userId: string,
    runsWithDetails: Array<{
      run: {
        date: string;
        distance: number;
        duration: number;
        tag?: string;
        notes?: string;
      };
      detail: {
        avgHeartRate?: number;
        maxHeartRate?: number;
        hrZoneDistribution?: string;
        elevationGain?: number;
        elevationLoss?: number;
        temperature?: number;
        weatherCondition?: string;
      };
    }>
  ) {
    const createdRuns = [];

    for (const item of runsWithDetails) {
      const createdRun = await this.prisma.run.create({
        data: {
          date: new Date(item.run.date),
          distance: item.run.distance,
          duration: item.run.duration,
          tag: item.run.tag,
          notes: item.run.notes,
          userId: userId,
          detail: {
            create: item.detail,
          },
        },
        include: {
          detail: true,
        },
      });
      createdRuns.push(createdRun);
    }

    return createdRuns;
  }

  // Seed analytics scenario with specific pattern
  async seedAnalyticsScenario(userId: string, pattern: Array<any>) {
    // Determine if pattern has RunDetail data
    const hasDetails = pattern.some((item: any) => item?.detail);
    const hasGPS = pattern.some((item: any) => item?.routeGeoJson);

    if (hasDetails) {
      return await this.createTestRunsWithDetails(userId, pattern);
    } else if (hasGPS) {
      return await this.createTestRunsWithGPS(userId, pattern);
    } else {
      return await this.createTestRuns(userId, pattern);
    }
  }
}

// Backward compatibility: Export default shared instance using old singleton pattern
// This maintains compatibility with existing code while allowing new code to use isolated instances
const defaultTestDb = new TestDatabase();

// Legacy function exports for backward compatibility
export const createTestUser = defaultTestDb.createTestUser.bind(defaultTestDb);
export const createTestRuns = defaultTestDb.createTestRuns.bind(defaultTestDb);
export const createTestRunsWithGPS = defaultTestDb.createTestRunsWithGPS.bind(defaultTestDb);
export const createTestRunsWithDetails =
  defaultTestDb.createTestRunsWithDetails.bind(defaultTestDb);
export const seedAnalyticsScenario = defaultTestDb.seedAnalyticsScenario.bind(defaultTestDb);
export const createTestGoals = defaultTestDb.createTestGoals.bind(defaultTestDb);
export const createTestRaces = defaultTestDb.createTestRaces.bind(defaultTestDb);
export const createTestTrainingPlans = defaultTestDb.createTestTrainingPlans.bind(defaultTestDb);
export const createTestWorkouts = defaultTestDb.createTestWorkouts.bind(defaultTestDb);
export const generateTestToken = defaultTestDb.generateTestToken.bind(defaultTestDb);
export const cleanupDatabase = defaultTestDb.cleanupDatabase.bind(defaultTestDb);
export const seedTestDatabase = defaultTestDb.seedTestDatabase.bind(defaultTestDb);
export const findUserByEmail = defaultTestDb.findUserByEmail.bind(defaultTestDb);

// Export testDb object with all utilities (legacy compatibility)
export const testDb = {
  prisma: defaultTestDb.prisma,
  createTestUser,
  createTestRuns,
  createTestRunsWithGPS,
  createTestRunsWithDetails,
  seedAnalyticsScenario,
  createTestGoals,
  createTestRaces,
  createTestTrainingPlans,
  createTestWorkouts,
  generateTestToken,
  cleanupDatabase,
  seedTestDatabase,
  findUserByEmail,
};

export default testDb;
