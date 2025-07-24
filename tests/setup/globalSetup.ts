// No imports needed for simple environment setup

export default async function globalSetup(): Promise<() => void> {
  // Set test environment variables
  process.env.DATABASE_URL = 'file:./prisma/test.db';
  process.env.TEST_DATABASE_URL = 'file:./prisma/test.db';
  process.env.JWT_SECRET = 'test-secret-key';
  process.env.NODE_ENV = 'test';
  process.env.RUN_MIGRATIONS = 'false'; // Skip migrations in tests

  // Return empty teardown function
  return () => {
    // Teardown if needed
  };
}
