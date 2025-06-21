import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { mockRuns, mockTestUser } from './mockData';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'file:./test.db'
    }
  }
});

// Test user creation utility
export const createTestUser = async (userData?: {
  email?: string;
  password?: string;
}) => {
  const email = userData?.email || mockTestUser.email;
  const password = userData?.password || 'testpassword123';
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword
    }
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
        userId: userId
      }
    });
    createdRuns.push(createdRun);
  }
  
  return createdRuns;
};

// Generate test JWT token
export const generateTestToken = (userId: string) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1h' }
  );
};

// Clean up database utility
export const cleanupDatabase = async () => {
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
  generateTestToken,
  cleanupDatabase,
  seedTestDatabase
};

export default testDb;