import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';

// Ensure test database is migrated before running tests
if (!process.env.CI) {
  // In local development, ensure test database is set up
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'file:./prisma/test.db';

  try {
    // Run migrations on test database
    execSync('npx prisma migrate deploy', { stdio: 'ignore' });
  } catch {
    console.warn('Warning: Could not run migrations on test database. Running prisma generate...');
    try {
      execSync('npx prisma generate', { stdio: 'ignore' });
      execSync('npx prisma migrate deploy', { stdio: 'ignore' });
    } catch (e) {
      console.error('Error setting up test database:', e);
    }
  }
}

// Test database setup
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.TEST_DATABASE_URL || 'file:./prisma/test.db',
    },
  },
});

// Clean up database before each test
beforeEach(async () => {
  await prisma.race.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
});

// Clean up and disconnect after all tests
afterAll(async () => {
  await prisma.race.deleteMany();
  await prisma.goal.deleteMany();
  await prisma.run.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

export { prisma };
