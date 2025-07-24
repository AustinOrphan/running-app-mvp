import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { jest } from '@jest/globals';

// Make Jest globals available
(global as any).jest = jest;

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
      url: process.env.DATABASE_URL || process.env.TEST_DATABASE_URL || 'file:./prisma/test.db',
    },
  },
});

// Verify database connection before running tests
beforeAll(async () => {
  try {
    await prisma.$connect();
    // Check if key tables exist (SQLite compatible)
    const tables = await prisma.$queryRaw`SELECT name FROM sqlite_master WHERE type='table'`;
    console.log(
      `Database connected successfully. Found ${Array.isArray(tables) ? tables.length : 0} tables.`
    );
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
});

// Clean up database before each test
beforeEach(async () => {
  // Handle potential missing tables gracefully
  const tables = ['race', 'goal', 'run', 'user'] as const;

  for (const table of tables) {
    try {
      await (prisma[table] as any).deleteMany();
    } catch (error) {
      console.warn(`${table} table cleanup skipped:`, (error as Error).message);
    }
  }
});

// Clean up and disconnect after all tests
afterAll(async () => {
  const tables = ['race', 'goal', 'run', 'user'] as const;

  for (const table of tables) {
    try {
      await (prisma[table] as any).deleteMany();
    } catch (error) {
      console.warn(`${table} table cleanup skipped in afterAll:`, (error as Error).message);
    }
  }

  await prisma.$disconnect();
});

export { prisma };
