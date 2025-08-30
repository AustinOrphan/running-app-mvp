#!/usr/bin/env tsx

/**
 * Ensure Migrations Script
 *
 * This script ensures database migrations run properly before tests by:
 * 1. Verifying schema exists
 * 2. Running migrations with proper error handling
 * 3. Verifying the database is ready for tests
 * 4. Providing comprehensive error diagnostics
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

interface MigrationResult {
  success: boolean;
  message: string;
  details?: string;
  fixes?: string[];
}

class MigrationEnsurer {
  private projectRoot: string;
  private testDbPath: string;
  private testDbUrl: string;
  private verbose: boolean;

  constructor(verbose = false) {
    this.projectRoot = process.cwd();
    this.testDbPath = path.join(this.projectRoot, 'prisma', 'test.db');
    this.testDbUrl = `file:${this.testDbPath.replace(/\\/g, '/')}`;
    this.verbose = verbose;
  }

  private log(message: string): void {
    if (this.verbose) {
      console.log(message);
    }
  }

  private logError(message: string, error?: any): void {
    console.error(message);
    if (error && this.verbose) {
      console.error(error);
    }
  }

  /**
   * Ensure prisma directory exists
   */
  private ensurePrismaDirectory(): void {
    const prismaDir = path.join(this.projectRoot, 'prisma');
    if (!existsSync(prismaDir)) {
      this.log('📁 Creating prisma directory...');
      mkdirSync(prismaDir, { recursive: true });
    }
  }

  /**
   * Check if migrations directory exists
   */
  private migrationsExist(): boolean {
    const migrationsPath = path.join(this.projectRoot, 'prisma', 'migrations');
    return existsSync(migrationsPath);
  }

  /**
   * Check if schema file exists
   */
  private schemaExists(): boolean {
    const schemaPath = path.join(this.projectRoot, 'prisma', 'schema.prisma');
    return existsSync(schemaPath);
  }

  /**
   * Ensure Prisma client is generated
   */
  private async ensurePrismaClient(): Promise<void> {
    this.log('🔧 Ensuring Prisma client is generated...');

    try {
      execSync('npx prisma generate', {
        stdio: this.verbose ? 'inherit' : 'pipe',
        timeout: 60000,
        cwd: this.projectRoot,
      });
      this.log('✅ Prisma client ready');
    } catch (error) {
      throw new Error(`Failed to generate Prisma client: ${error}`);
    }
  }

  /**
   * Run database migrations with comprehensive error handling
   */
  private async runMigrations(): Promise<void> {
    const env = {
      ...process.env,
      DATABASE_URL: this.testDbUrl,
    };

    this.log('📋 Running database migrations...');

    try {
      if (this.migrationsExist()) {
        // Use proper migration deployment
        this.log('🔄 Deploying migrations...');
        execSync('npx prisma migrate deploy', {
          stdio: this.verbose ? 'inherit' : 'pipe',
          env,
          timeout: 60000,
          cwd: this.projectRoot,
        });
        this.log('✅ Migrations deployed successfully');
      } else {
        // Fall back to schema push
        this.log('📤 No migrations found, using schema push...');
        execSync('npx prisma db push --force-reset --skip-generate', {
          stdio: this.verbose ? 'inherit' : 'pipe',
          env,
          timeout: 60000,
          cwd: this.projectRoot,
        });
        this.log('✅ Schema pushed successfully');
      }
    } catch (error) {
      // Try alternative approach if migration fails
      this.log('⚠️  Migration failed, attempting schema push...');
      try {
        execSync('npx prisma db push --force-reset --skip-generate', {
          stdio: this.verbose ? 'inherit' : 'pipe',
          env,
          timeout: 60000,
          cwd: this.projectRoot,
        });
        this.log('✅ Fallback schema push successful');
      } catch (fallbackError) {
        throw new Error(
          `Both migration deploy and schema push failed: ${error}. Fallback error: ${fallbackError}`
        );
      }
    }
  }

  /**
   * Verify database is ready by testing basic operations
   */
  private async verifyDatabaseReady(): Promise<void> {
    this.log('🔍 Verifying database is ready...');

    try {
      const { PrismaClient } = await import('@prisma/client');

      const prisma = new PrismaClient({
        datasources: {
          db: {
            url: this.testDbUrl,
          },
        },
        log: this.verbose ? ['error', 'warn'] : [],
      });

      try {
        // Test connection
        await prisma.$connect();
        this.log('✅ Database connection successful');

        // Test basic table access
        const userCount = await prisma.user.count();
        const runCount = await prisma.run.count();
        const goalCount = await prisma.goal.count();

        this.log(
          `✅ All tables accessible: users=${userCount}, runs=${runCount}, goals=${goalCount}`
        );
      } finally {
        await prisma.$disconnect();
      }
    } catch (error) {
      throw new Error(`Database verification failed: ${error}`);
    }
  }

  /**
   * Get migration status for diagnostics
   */
  private async getMigrationStatus(): Promise<string> {
    try {
      const env = { ...process.env, DATABASE_URL: this.testDbUrl };
      const output = execSync('npx prisma migrate status', {
        stdio: 'pipe',
        env,
        timeout: 10000,
        encoding: 'utf8',
        cwd: this.projectRoot,
      });
      return output.toString();
    } catch (error) {
      return `Migration status check failed: ${error}`;
    }
  }

  /**
   * Main migration ensure process
   */
  async ensureMigrations(): Promise<MigrationResult> {
    this.log('🚀 Ensuring migrations are ready for tests...');

    try {
      // Pre-checks
      this.ensurePrismaDirectory();

      if (!this.schemaExists()) {
        return {
          success: false,
          message: 'Prisma schema file not found',
          fixes: [
            'Ensure prisma/schema.prisma exists',
            'Run npm run setup to initialize the project',
          ],
        };
      }

      // Step 1: Ensure Prisma client is generated
      await this.ensurePrismaClient();

      // Step 2: Run migrations
      await this.runMigrations();

      // Step 3: Verify database is ready
      await this.verifyDatabaseReady();

      // Step 4: Get final status
      const status = await this.getMigrationStatus();

      this.log('🎉 Migrations are ready for tests!');
      return {
        success: true,
        message: 'All migrations completed successfully',
        details: status,
      };
    } catch (error) {
      this.logError('❌ Migration ensure failed:', error);

      // Get diagnostic information
      const status = await this.getMigrationStatus();

      return {
        success: false,
        message: 'Migration setup failed',
        details: `${error}\n\nMigration Status:\n${status}`,
        fixes: [
          'Check if Prisma schema is valid',
          'Ensure database permissions are correct',
          'Try running npm run prisma:migrate manually',
          'Check if DATABASE_URL is correct',
        ],
      };
    }
  }
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const isCI = process.env.CI === 'true';

  console.log('🔧 Migration Ensure Tool');
  console.log(`Environment: ${isCI ? 'CI' : 'Local'}`);
  console.log(`Working directory: ${process.cwd()}`);
  console.log('');

  const ensurer = new MigrationEnsurer(verbose);
  const result = await ensurer.ensureMigrations();

  if (result.success) {
    console.log('');
    console.log('✅ MIGRATION ENSURE PASSED');
    console.log(`✅ ${result.message}`);
    if (result.details && verbose) {
      console.log('📋 Details:');
      console.log(result.details);
    }
    process.exit(0);
  } else {
    console.log('');
    console.log('❌ MIGRATION ENSURE FAILED');
    console.log(`❌ ${result.message}`);
    if (result.details) {
      console.error('📋 Error details:');
      console.error(result.details);
    }
    if (result.fixes) {
      console.log('');
      console.log('🔧 Suggested fixes:');
      result.fixes.forEach((fix, index) => {
        console.log(`${index + 1}. ${fix}`);
      });
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  });
}

export { MigrationEnsurer };
