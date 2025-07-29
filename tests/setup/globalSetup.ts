import path from 'path';
import { globalDbCleanup } from './inMemoryDbSetup';

export default async function globalSetup(): Promise<() => void> {
  // Check if in-memory database should be used
  const useInMemoryDb = process.env.USE_IN_MEMORY_DB === 'true' || process.env.NODE_ENV === 'test';

  if (useInMemoryDb) {
    // Use in-memory database for faster tests
    console.log('🚀 Using in-memory database for tests');

    process.env.DATABASE_URL = ':memory:';
    process.env.TEST_DATABASE_URL = ':memory:';
    process.env.USE_IN_MEMORY_DB = 'true';
  } else {
    // Use file-based database (legacy mode)
    console.log('📁 Using file-based database for tests');

    const testDbPath = path.join(process.cwd(), 'prisma', 'test.db');
    // Convert Windows backslashes to forward slashes for SQLite file URLs
    const dbUrl = `file:${testDbPath.replace(/\\/g, '/')}`;

    process.env.DATABASE_URL = dbUrl;
    process.env.TEST_DATABASE_URL = dbUrl;
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
