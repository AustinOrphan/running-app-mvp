#!/usr/bin/env tsx

/**
 * CI Database Setup Script
 * Comprehensive database initialization and cleanup for CI environments
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import path from 'path';

interface CISetupOptions {
  force?: boolean;
  verbose?: boolean;
  skipCleanup?: boolean;
}

class CIDatabaseSetup {
  private prisma: PrismaClient;
  private dbPath: string;
  private options: CISetupOptions;

  constructor(options: CISetupOptions = {}) {
    this.options = options;
    this.dbPath = path.join(process.cwd(), 'prisma', 'test.db');
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./prisma/test.db',
        },
      },
    });
  }

  private log(message: string): void {
    if (this.options.verbose !== false) {
      console.log(message);
    }
  }

  private logError(message: string, error?: any): void {
    console.error(message);
    if (error && this.options.verbose) {
      console.error(error);
    }
  }

  /**
   * Clean up existing database and temporary files
   */
  async cleanup(): Promise<void> {
    if (this.options.skipCleanup) {
      this.log('⏭️  Skipping cleanup as requested');
      return;
    }

    this.log('🧹 Cleaning up existing database...');

    try {
      // Disconnect any existing connections
      await this.prisma.$disconnect();
    } catch (error) {
      // Ignore connection errors during cleanup
    }

    // Remove existing database files
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
          this.log(`  ✅ Removed: ${path.basename(file)}`);
        } catch (error) {
          this.logError(`  ❌ Failed to remove ${file}:`, error);
        }
      }
    }

    // Clean up any leftover test data directories
    const tempDirs = ['tmp', 'temp', '.tmp', 'test-uploads'];

    for (const dir of tempDirs) {
      const dirPath = path.join(process.cwd(), dir);
      if (existsSync(dirPath)) {
        try {
          execSync(`rm -rf "${dirPath}"`, { stdio: 'pipe' });
          this.log(`  ✅ Cleaned temp directory: ${dir}`);
        } catch (error) {
          this.logError(`  ⚠️  Could not clean temp directory ${dir}:`, error);
        }
      }
    }
  }

  /**
   * Initialize fresh database with migrations
   */
  async initializeDatabase(): Promise<void> {
    this.log('🗄️  Initializing database...');

    // Ensure prisma directory exists
    const prismaDir = path.dirname(this.dbPath);
    try {
      execSync(`mkdir -p "${prismaDir}"`, { stdio: 'pipe' });
    } catch (error) {
      this.logError('❌ Failed to create prisma directory:', error);
      throw error;
    }

    // Run database migrations
    this.log('  📋 Running migrations...');
    try {
      // Try migrate deploy first (for production-like environments)
      execSync('npx prisma migrate deploy', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 60000, // 1 minute timeout
      });
      this.log('  ✅ Migrations deployed successfully');
    } catch (error) {
      this.log('  ⚠️  migrate deploy failed, trying migrate dev...');
      try {
        execSync('npx prisma migrate dev --name ci-setup', {
          stdio: this.options.verbose ? 'inherit' : 'pipe',
          timeout: 60000,
        });
        this.log('  ✅ Development migrations applied successfully');
      } catch (devError) {
        this.logError('❌ Both migration methods failed:', devError);
        throw devError;
      }
    }

    // Generate Prisma client
    this.log('  🔧 Generating Prisma client...');
    try {
      execSync('npx prisma generate', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 60000,
      });
      this.log('  ✅ Prisma client generated successfully');
    } catch (error) {
      this.logError('❌ Failed to generate Prisma client:', error);
      throw error;
    }

    // Verify database file was created
    if (!existsSync(this.dbPath)) {
      throw new Error(`Database file not created at ${this.dbPath}`);
    }

    this.log(`  ✅ Database file created: ${this.dbPath}`);
  }

  /**
   * Verify database connectivity and schema
   */
  async verifyDatabase(): Promise<void> {
    this.log('🔍 Verifying database...');

    try {
      // Test connection
      await this.prisma.$connect();
      this.log('  ✅ Database connection successful');

      // Test basic operations on core tables
      const tables = [
        { name: 'User', model: this.prisma.user },
        { name: 'Run', model: this.prisma.run },
        { name: 'Goal', model: this.prisma.goal },
      ];

      for (const table of tables) {
        try {
          const count = await table.model.count();
          this.log(`  ✅ ${table.name} table accessible (${count} records)`);
        } catch (error) {
          throw new Error(`Failed to access ${table.name} table: ${error}`);
        }
      }

      this.log('  ✅ All core tables verified');
    } catch (error) {
      this.logError('❌ Database verification failed:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Seed database with minimal test data if needed
   */
  async seedTestData(): Promise<void> {
    this.log('🌱 Seeding test data...');

    try {
      await this.prisma.$connect();

      // Check if we already have data
      const userCount = await this.prisma.user.count();
      if (userCount > 0) {
        this.log('  ℹ️  Database already has data, skipping seed');
        return;
      }

      // Create a test user for CI tests
      const testUser = await this.prisma.user.create({
        data: {
          email: 'ci-test@example.com',
          username: 'ci-test-user',
          password: '$2b$10$placeholder.hash.for.ci.testing.only',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      this.log(`  ✅ Created test user: ${testUser.email}`);

      // Create a sample run for testing
      await this.prisma.run.create({
        data: {
          userId: testUser.id,
          date: new Date(),
          distance: 5.0,
          duration: 1800, // 30 minutes
          pace: 360, // 6:00 per km
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      this.log('  ✅ Created sample run data');
    } catch (error) {
      this.logError('❌ Failed to seed test data:', error);
      throw error;
    } finally {
      await this.prisma.$disconnect();
    }
  }

  /**
   * Complete CI database setup process
   */
  async setupComplete(): Promise<void> {
    const startTime = Date.now();
    this.log('🚀 Starting CI database setup...\n');

    try {
      await this.cleanup();
      await this.initializeDatabase();
      await this.verifyDatabase();
      await this.seedTestData();

      const duration = Date.now() - startTime;
      this.log(`\n🎉 CI database setup completed successfully in ${duration}ms!`);
    } catch (error) {
      this.logError('\n💥 CI database setup failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup for CI teardown
   */
  async teardown(): Promise<void> {
    this.log('🧹 Running CI database teardown...');

    try {
      await this.prisma.$disconnect();

      // Aggressive cleanup for CI
      if (existsSync(this.dbPath)) {
        unlinkSync(this.dbPath);
        this.log('  ✅ Database file removed');
      }

      // Clean up any SQLite auxiliary files
      const auxFiles = ['-journal', '-wal', '-shm'];
      for (const suffix of auxFiles) {
        const auxFile = this.dbPath + suffix;
        if (existsSync(auxFile)) {
          unlinkSync(auxFile);
          this.log(`  ✅ Removed auxiliary file: ${path.basename(auxFile)}`);
        }
      }

      this.log('✅ CI database teardown completed');
    } catch (error) {
      this.logError('❌ CI database teardown failed:', error);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'setup';

  const options: CISetupOptions = {
    verbose: args.includes('--verbose') || args.includes('-v'),
    force: args.includes('--force') || args.includes('-f'),
    skipCleanup: args.includes('--skip-cleanup'),
  };

  const setup = new CIDatabaseSetup(options);

  try {
    switch (command) {
      case 'setup':
        await setup.setupComplete();
        break;
      case 'cleanup':
        await setup.cleanup();
        break;
      case 'teardown':
        await setup.teardown();
        break;
      case 'verify':
        await setup.verifyDatabase();
        break;
      case 'seed':
        await setup.seedTestData();
        break;
      default:
        console.error('❌ Unknown command. Use: setup, cleanup, teardown, verify, or seed');
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
    console.error('❌ CI database setup failed:', error);
    process.exit(1);
  });
}

export { CIDatabaseSetup };
