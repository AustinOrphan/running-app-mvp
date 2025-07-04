import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

import { Goal } from '../../src/types/goals.js';

import { mockRuns, mockTestUser, mockGoals, mockRaces } from './mockData.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'file:./test.db',
    },
  },
});

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

// Clean up database utility
export const cleanupDatabase = async () => {
  await prisma.race.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
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
  generateTestToken,
  cleanupDatabase,
  seedTestDatabase,
};

export default testDb;
