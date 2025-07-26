import path from 'path';

export default async function globalSetup(): Promise<() => void> {
  // Set test environment variables with cross-platform paths
  const testDbPath = path.join(process.cwd(), 'prisma', 'test.db');
  // Convert Windows backslashes to forward slashes for SQLite file URLs
  const dbUrl = `file:${testDbPath.replace(/\\/g, '/')}`;

  process.env.DATABASE_URL = dbUrl;
  process.env.TEST_DATABASE_URL = dbUrl;
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.NODE_ENV = 'test';
  process.env.RUN_MIGRATIONS = 'false'; // Skip migrations in tests

  // Return empty teardown function
  return () => {
    // Teardown if needed
  };
}
