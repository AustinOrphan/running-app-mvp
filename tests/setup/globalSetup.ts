import path from 'path';
import { globalDbCleanup } from './inMemoryDbSetup';

export default async function globalSetup(): Promise<() => void> {
  // Check if in-memory database should be used
  // Disable in-memory database for now due to sharing issues between connections
  const useInMemoryDb = process.env.USE_IN_MEMORY_DB === 'true' && false;

  if (useInMemoryDb) {
    // Use in-memory database for faster tests
    console.log('🚀 Using in-memory database for tests');

    // Use proper Prisma-compatible in-memory SQLite URL
    process.env.DATABASE_URL = 'file::memory:?cache=shared';
    process.env.TEST_DATABASE_URL = 'file::memory:?cache=shared';
    process.env.USE_IN_MEMORY_DB = 'true';

    // Apply schema to in-memory database immediately
    try {
      const { execSync } = await import('child_process');
      console.log('📋 Applying schema to in-memory database...');
      execSync('npx prisma db push --force-reset --skip-generate', {
        stdio: 'pipe',
        env: { ...process.env },
      });
      console.log('✅ Schema applied successfully');
    } catch (error) {
      console.error('❌ Failed to apply schema to in-memory database:', error);
      throw error;
    }
  } else {
    // Use file-based database (legacy mode)
    console.log('📁 Using file-based database for tests');

    const testDbPath = path.join(process.cwd(), 'prisma', 'test.db');
    // Convert Windows backslashes to forward slashes for SQLite file URLs
    const dbUrl = `file:${testDbPath.replace(/\\/g, '/')}`;

    process.env.DATABASE_URL = dbUrl;
    process.env.TEST_DATABASE_URL = dbUrl;

    // Apply schema to file-based test database
    try {
      const { execSync } = await import('child_process');
      console.log('📋 Applying schema to test database...');
      execSync('npx prisma db push --force-reset --skip-generate', {
        stdio: 'pipe',
        env: { ...process.env, DATABASE_URL: dbUrl },
      });
      console.log('✅ Test database schema applied successfully');
    } catch (error) {
      console.error('❌ Failed to apply schema to test database:', error);
      throw error;
    }
  }

  // Common test environment variables
  process.env.JWT_SECRET = 'test-secret-key-for-ci-environment-must-be-longer-than-32-characters';
  process.env.NODE_ENV = 'test';
  process.env.RUN_MIGRATIONS = 'false'; // Skip migrations in tests
  process.env.TEST_DB_LOGGING = process.env.TEST_DB_LOGGING || 'false';

  // Return teardown function
  return async () => {
    if (useInMemoryDb) {
      // Clean up all in-memory databases
      await globalDbCleanup();
    }
  };
}
