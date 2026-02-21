import { execSync } from 'child_process';
import { prisma } from './prismaClient.js';

// Ensure migrations are applied before running tests
beforeAll(async () => {
  try {
    // Apply migrations to test database
    execSync('npx prisma migrate deploy', {
      env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL || 'file:./test.db' },
      stdio: 'pipe',
    });
  } catch (error) {
    console.error('Failed to apply migrations to test database:', error);
    throw error;
  }
});

// Clean up database before each test
beforeEach(async () => {
  await prisma.workoutTemplate.deleteMany();
  await prisma.trainingPlan.deleteMany();
  await prisma.race.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
});

// Clean up and disconnect after all tests
afterAll(async () => {
  await prisma.workoutTemplate.deleteMany();
  await prisma.trainingPlan.deleteMany();
  await prisma.race.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

export { prisma };
