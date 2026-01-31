import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../setup/jestSetup.js';

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
  const password = userData?.password || 'testpassword123';
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

// Generate test JWT token
export const generateTestToken = (userId: string) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' });
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

// Test database utilities
export const testDb = {
  prisma,
  createTestUser,
  createTestRuns,
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
