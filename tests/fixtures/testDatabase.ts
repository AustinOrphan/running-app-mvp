import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../setup/prismaClient.js';

import {
  mockRuns,
  mockTestUser,
  mockGoals,
  mockRaces,
  mockTrainingPlans,
  mockWorkoutTemplates,
} from './mockData.js';

// Test user creation utility
export const createTestUser = async (userData?: { email?: string; password?: string }) => {
  const email = userData?.email || mockTestUser.email;
  const password = userData?.password || 'Test@password123';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
    },
  });

  return { ...user, plainPassword: password };
};

// Test runs creation utility
export const createTestRuns = async (userId: string, runs = mockRuns) => {
  const createdRuns = [];

  for (const run of runs) {
    const createdRun = await prisma.run.create({
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
};

// Test goals creation utility
export const createTestGoals = async (userId: string, goals = mockGoals) => {
  const createdGoals = [];

  for (const goal of goals) {
    const createdGoal = await prisma.goal.create({
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
};

// Test races creation utility
export const createTestRaces = async (userId: string, races = mockRaces) => {
  const createdRaces = [];

  for (const race of races) {
    const createdRace = await prisma.race.create({
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
};

// Generate test JWT token (matching production token format)
export const generateTestToken = (userId: string, email: string = 'test@example.com') => {
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
};

// Test training plans creation utility
export const createTestTrainingPlans = async (userId: string, plans = mockTrainingPlans) => {
  const createdPlans = [];

  for (const plan of plans) {
    const createdPlan = await prisma.trainingPlan.create({
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
};

// Test workout templates creation utility
export const createTestWorkouts = async (
  trainingPlanId: string,
  workouts = mockWorkoutTemplates
) => {
  const createdWorkouts = [];

  for (const workout of workouts) {
    if (workout.trainingPlanId === 'plan-1' || workout.trainingPlanId === 'plan-2') {
      const createdWorkout = await prisma.workoutTemplate.create({
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
};

// Clean up database utility
export const cleanupDatabase = async () => {
  await prisma.workoutTemplate.deleteMany();
  await prisma.trainingPlan.deleteMany();
  await prisma.race.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
};

// Find user by email
export const findUserByEmail = async (email: string) => {
  return await prisma.user.findUnique({
    where: { email },
  });
};

// Database seed for tests
export const seedTestDatabase = async () => {
  // Clean existing data
  await cleanupDatabase();

  // Create test user
  const user = await createTestUser();

  // Create test runs
  const runs = await createTestRuns(user.id);

  return { user, runs };
};

// Test runs with GPS data (for heatmap testing)
export const createTestRunsWithGPS = async (
  userId: string,
  runs: Array<{
    date: string;
    distance: number;
    duration: number;
    tag?: string;
    notes?: string;
    routeGeoJson: string;
  }>
) => {
  const createdRuns = [];

  for (const run of runs) {
    const createdRun = await prisma.run.create({
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
};

// Test runs with RunDetail data (heart rate, elevation, etc.)
export const createTestRunsWithDetails = async (
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
) => {
  const createdRuns = [];

  for (const item of runsWithDetails) {
    const createdRun = await prisma.run.create({
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
};

// Seed analytics scenario with specific pattern
export const seedAnalyticsScenario = async (userId: string, pattern: Array<any>) => {
  // Determine if pattern has RunDetail data
  const hasDetails = pattern.some((item: any) => item?.detail);
  const hasGPS = pattern.some((item: any) => item?.routeGeoJson);

  if (hasDetails) {
    return await createTestRunsWithDetails(userId, pattern);
  } else if (hasGPS) {
    return await createTestRunsWithGPS(userId, pattern);
  } else {
    return await createTestRuns(userId, pattern);
  }
};

// Test database utilities
export const testDb = {
  prisma,
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
