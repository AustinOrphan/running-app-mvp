import path from 'path';
import { globalDbCleanup } from './inMemoryDbSetup';
import { ensurePrismaClient } from './prismaSetup';
import { runTestMigrations } from './migrationManager';

export default async function globalSetup(): Promise<() => void> {
  // Ensure Prisma client is generated before any database operations
  console.log('🔧 Ensuring Prisma client is available...');
  await ensurePrismaClient();

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
      console.log('📋 Setting up in-memory database schema...');

      // For in-memory databases, we need to use db push since migrate doesn't work well
      // with shared cache in-memory databases
      execSync('npx prisma db push --force-reset --skip-generate', {
        stdio: 'pipe',
        env: { ...process.env },
      });
      console.log('✅ In-memory database schema applied successfully');
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

    // Run migrations on file-based test database using migration manager
    try {
      console.log('📋 Running migrations on test database...');
      await runTestMigrations(dbUrl, {
        verbose: process.env.NODE_ENV !== 'test' || process.env.VERBOSE_TESTS === 'true',
        forceReset: true,
      });
      console.log('✅ Test database migrations completed successfully');

      // Verify that migrations were successful by testing database connectivity
      console.log('🔍 Verifying migration success...');
      const { PrismaClient } = await import('@prisma/client');
      const testPrisma = new PrismaClient({
        datasources: {
          db: { url: dbUrl },
        },
      });

      try {
        await testPrisma.$connect();
        // Test that core tables exist and are accessible
        await Promise.all([
          testPrisma.user.count(),
          testPrisma.run.count(),
          testPrisma.goal.count(),
          testPrisma.race.count(),
        ]);
        console.log('✅ Migration verification: All core tables accessible');
      } finally {
        await testPrisma.$disconnect();
      }
    } catch (error) {
      console.error('❌ Failed to run migrations on test database:', error);
      console.error('📋 Migration error details:', error);

      // Provide helpful error context
      if (error instanceof Error) {
        if (error.message.includes('migration')) {
          console.error('💡 This appears to be a migration-specific error');
          console.error('🔧 Try running: npm run prisma:generate && npx prisma migrate deploy');
        }
        if (error.message.includes('database')) {
          console.error('💡 This appears to be a database connectivity issue');
          console.error('🔧 Check database URL:', dbUrl);
        }
      }

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
