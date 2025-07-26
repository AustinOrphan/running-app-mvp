#!/usr/bin/env tsx

/**
 * Enhanced CI Integration Test Database Setup
 * Provides robust database lifecycle management for CI environments
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';

interface CIDatabaseOptions {
  verbose?: boolean;
  isolated?: boolean;
  forceClean?: boolean;
}

class CIIntegrationDBManager {
  private prisma: PrismaClient;
  private dbPath: string;
  private options: CIDatabaseOptions;

  constructor(options: CIDatabaseOptions = {}) {
    this.options = options;

    // Use integration-specific database in CI
    const dbName = process.env.CI ? 'integration-test.db' : 'test.db';
    const dbUrl =
      process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || `file:./prisma/${dbName}`;

    this.dbPath = path.join(process.cwd(), 'prisma', dbName);

    this.prisma = new PrismaClient({
      datasources: {
        db: { url: dbUrl },
      },
      log: this.options.verbose ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      console.log(message);
    }
  }

  async setupForCI(): Promise<void> {
    this.log('🚀 Setting up integration test database for CI...');

    try {
      // Clean any existing database
      await this.forceCleanDatabase();

      // Initialize fresh database
      await this.initializeDatabase();

      // Verify database is working
      await this.verifyDatabase();

      this.log('✅ Integration test database ready for CI');
    } catch (error) {
      console.error('❌ Failed to setup integration test database:', error);
      throw error;
    }
  }

  async forceCleanDatabase(): Promise<void> {
    this.log('🧹 Force cleaning database...');

    try {
      // Disconnect any existing connections
      await this.prisma.$disconnect();
    } catch (error) {
      // Ignore connection errors during cleanup
    }

    // Remove database files
    const dbFiles = [
      this.dbPath,
      this.dbPath + '-journal',
      this.dbPath + '-wal',
      this.dbPath + '-shm',
    ];

    for (const file of dbFiles) {
      if (existsSync(file)) {
        try {
          unlinkSync(file);
          this.log(`  Removed: ${path.basename(file)}`);
        } catch (error) {
          console.warn(`  Could not remove ${file}:`, error);
        }
      }
    }
  }

  async initializeDatabase(): Promise<void> {
    this.log('📋 Initializing database with migrations...');

    try {
      // Ensure prisma directory exists
      const prismaDir = path.dirname(this.dbPath);
      execSync(`mkdir -p "${prismaDir}"`, { stdio: 'pipe' });

      // Run migrations for integration tests
      execSync('npx prisma migrate deploy', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 120000, // 2 minute timeout
        env: {
          ...process.env,
          DATABASE_URL: `file:${this.dbPath}`,
        },
      });

      // Generate Prisma client
      execSync('npx prisma generate', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 60000,
      });

      this.log('✅ Database initialized successfully');
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  async verifyDatabase(): Promise<void> {
    this.log('🔍 Verifying database connectivity...');

    try {
      await this.prisma.$connect();

      // Test core table access
      const tables = [
        { name: 'User', fn: () => this.prisma.user.count() },
        { name: 'Run', fn: () => this.prisma.run.count() },
        { name: 'Goal', fn: () => this.prisma.goal.count() },
      ];

      for (const table of tables) {
        try {
          await table.fn();
          this.log(`  ✅ ${table.name} table accessible`);
        } catch (error) {
          throw new Error(`${table.name} table inaccessible: ${error}`);
        }
      }
    } catch (error) {
      console.error('❌ Database verification failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  async cleanBetweenTests(): Promise<void> {
    this.log('🧽 Cleaning database between tests...');

    try {
      await this.prisma.$connect();

      // Delete in order to respect foreign key constraints
      const tables = ['race', 'goal', 'run', 'user'];

      for (const table of tables) {
        try {
          await (this.prisma[table] as any).deleteMany();
          this.log(`  Cleaned ${table} table`);
        } catch (error) {
          console.warn(`  Warning cleaning ${table}:`, error);
        }
      }
    } catch (error) {
      console.error('❌ Failed to clean database between tests:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  async teardownForCI(): Promise<void> {
    this.log('🧹 Tearing down integration test database...');

    try {
      await this.prisma.$disconnect();
      await this.forceCleanDatabase();
      this.log('✅ Integration test database torn down');
    } catch (error) {
      console.error('❌ Failed to teardown database:', error);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'setup';

  const options: CIDatabaseOptions = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    isolated: args.includes('--isolated'),
    forceClean: args.includes('--force-clean'),
  };

  const manager = new CIIntegrationDBManager(options);

  try {
    switch (command) {
      case 'setup':
        await manager.setupForCI();
        break;
      case 'clean':
        await manager.cleanBetweenTests();
        break;
      case 'teardown':
        await manager.teardownForCI();
        break;
      case 'verify':
        await manager.verifyDatabase();
        break;
      default:
        console.error('❌ Unknown command. Use: setup, clean, teardown, or verify');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Operation failed:', error);
    process.exit(1);
  }
}

// Auto-run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ CI integration database setup failed:', error);
    process.exit(1);
  });
}

export { CIIntegrationDBManager };
