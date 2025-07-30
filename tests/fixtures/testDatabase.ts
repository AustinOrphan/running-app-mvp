import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import { mockRuns, mockTestUser, mockGoals, mockRaces } from './mockData.js';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'file:./prisma/test.db',
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

// Test runs creation utility - optimized with batch insert
export const createTestRuns = async (userId: string, runs = mockRuns) => {
  // Use createMany for batch insert - much faster than individual creates
  const runData = runs.map(run => ({
    date: new Date(run.date),
    distance: run.distance,
    duration: run.duration,
    tag: run.tag,
    notes: run.notes,
    userId: userId,
  }));

  // Batch insert all runs at once
  await prisma.run.createMany({
    data: runData,
  });

  // Fetch the created runs to return them
  // This is still faster than creating one by one
  const createdRuns = await prisma.run.findMany({
    where: {
      userId: userId,
      date: {
        in: runData.map(r => r.date),
      },
    },
    orderBy: {
      date: 'desc',
    },
  });

  return createdRuns;
};

// Test goals creation utility - optimized with batch insert
export const createTestGoals = async (userId: string, goals = mockGoals) => {
  // Use createMany for batch insert
  const goalData = goals.map(goal => ({
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
  }));

  await prisma.goal.createMany({
    data: goalData,
  });

  const createdGoals = await prisma.goal.findMany({
    where: {
      userId: userId,
      title: {
        in: goalData.map(g => g.title),
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return createdGoals;
};

// Test races creation utility - optimized with batch insert
export const createTestRaces = async (userId: string, races = mockRaces) => {
  // Use createMany for batch insert
  const raceData = races.map(race => ({
    name: race.name,
    raceDate: new Date(race.raceDate),
    distance: race.distance,
    targetTime: race.targetTime,
    actualTime: race.actualTime,
    notes: race.notes,
    userId: userId,
  }));

  await prisma.race.createMany({
    data: raceData,
  });

  const createdRaces = await prisma.race.findMany({
    where: {
      userId: userId,
      name: {
        in: raceData.map(r => r.name),
      },
    },
    orderBy: {
      raceDate: 'desc',
    },
  });

  return createdRaces;
};

// Generate test JWT token
export const generateTestToken = (userId: string) => {
  const secret = process.env.JWT_SECRET || 'test-secret';
  const payload = {
    id: userId,
    email: 'test@example.com',
    type: 'access',
    jti: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };
  return jwt.sign(payload, secret, {
    expiresIn: '1h',
    issuer: 'running-app',
    audience: 'running-app-users',
  });
};

// Clean up database utility - optimized with transaction
export const cleanupDatabase = async () => {
  // Use transaction for atomic cleanup - faster and safer
  await prisma.$transaction([
    prisma.race.deleteMany(),
    prisma.goal.deleteMany(),
    prisma.run.deleteMany(),
    prisma.user.deleteMany(),
  ]);
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
  generateTestToken,
  cleanupDatabase,
  seedTestDatabase,
  findUserByEmail,
};

export default testDb;
