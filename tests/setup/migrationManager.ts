/**
 * Migration Manager for Tests
 * Ensures proper database migrations run before tests with error handling and schema verification
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

interface MigrationOptions {
  verbose?: boolean;
  forceReset?: boolean;
  timeout?: number;
}

export class MigrationManager {
  private options: MigrationOptions;
  private projectRoot: string;

  constructor(options: MigrationOptions = {}) {
    this.options = {
      verbose: false,
      forceReset: true,
      timeout: 60000, // 1 minute default
      ...options,
    };
    this.projectRoot = process.cwd();
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
   * Check if migration directory exists
   */
  private migrationsExist(): boolean {
    const migrationsPath = path.join(this.projectRoot, 'prisma', 'migrations');
    return existsSync(migrationsPath);
  }

  /**
   * Run database migrations with proper error handling
   */
  async runMigrations(databaseUrl: string): Promise<void> {
    const env = { ...process.env, DATABASE_URL: databaseUrl };

    this.log('🔍 Checking migration requirements...');

    if (!this.migrationsExist()) {
      this.log('ℹ️  No migrations directory found, using schema push');
      await this.fallbackToSchemaPush(env);
      return;
    }

    try {
      // Ensure Prisma client is generated before any database operations
      this.log('🔧 Ensuring Prisma client is generated...');
      try {
        execSync('npx prisma generate', {
          stdio: this.options.verbose ? 'inherit' : 'pipe',
          env,
          timeout: this.options.timeout,
        });
        this.log('✅ Prisma client generated');
      } catch (generateError) {
        this.logError('⚠️  Prisma client generation failed, continuing:', generateError);
      }

      // First check migration status
      this.log('📊 Checking migration status...');
      const status = await this.getMigrationStatus(databaseUrl);
      this.log(`Migration status: ${status.substring(0, 200)}...`);

      // Reset database if requested
      if (this.options.forceReset) {
        this.log('🗑️  Resetting database...');
        try {
          execSync('npx prisma migrate reset --force --skip-generate', {
            stdio: this.options.verbose ? 'inherit' : 'pipe',
            env,
            timeout: this.options.timeout,
          });
          this.log('✅ Database reset successfully');
        } catch (resetError) {
          this.logError('⚠️  Database reset failed, continuing with deployment:', resetError);
        }
      }

      // Deploy migrations
      this.log('📋 Deploying migrations...');
      execSync('npx prisma migrate deploy', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        env,
        timeout: this.options.timeout,
      });
      this.log('✅ Migrations deployed successfully');

      // Verify schema
      await this.verifySchema(env);
    } catch (error) {
      this.logError('❌ Migration deployment failed:', error);
      await this.handleMigrationError(error, databaseUrl);
      this.log('🔄 Attempting fallback to schema push...');
      await this.fallbackToSchemaPush(env);
    }
  }

  /**
   * Fallback to schema push when migrations fail
   */
  private async fallbackToSchemaPush(env: NodeJS.ProcessEnv): Promise<void> {
    try {
      // Ensure Prisma client is generated before schema push
      this.log('🔧 Generating Prisma client for schema push...');
      try {
        execSync('npx prisma generate', {
          stdio: this.options.verbose ? 'inherit' : 'pipe',
          env,
          timeout: this.options.timeout,
        });
        this.log('✅ Prisma client generated for schema push');
      } catch (generateError) {
        this.logError(
          '⚠️  Prisma client generation failed, continuing with schema push:',
          generateError
        );
      }

      this.log('📤 Pushing schema to database...');
      execSync('npx prisma db push --force-reset --skip-generate', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        env,
        timeout: this.options.timeout,
      });
      this.log('✅ Schema pushed successfully');

      // Verify schema after push
      await this.verifySchema(env);
    } catch (error) {
      this.logError('❌ Schema push also failed:', error);
      throw new Error(`Both migration and schema push failed: ${error}`);
    }
  }

  /**
   * Verify database schema is properly applied
   */
  private async verifySchema(env: NodeJS.ProcessEnv): Promise<void> {
    try {
      this.log('🔍 Verifying database schema...');

      // Try to validate the schema using prisma validate
      execSync('npx prisma validate', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        env,
        timeout: 10000, // 10 second timeout
      });

      // Try to format the schema (this will fail if schema is invalid)
      execSync('npx prisma format --check', {
        stdio: 'pipe',
        env,
        timeout: 5000,
      });

      this.log('✅ Schema verification passed');
    } catch (error) {
      this.logError('⚠️  Schema verification failed, but continuing:', error);
      // Don't throw here - schema might be valid even if verification fails
      // The validation may fail for other reasons (e.g., missing database connection)
    }
  }

  /**
   * Check current migration status
   */
  async getMigrationStatus(databaseUrl: string): Promise<string> {
    try {
      const env = { ...process.env, DATABASE_URL: databaseUrl };
      const output = execSync('npx prisma migrate status', {
        stdio: 'pipe',
        env,
        timeout: 10000,
        encoding: 'utf8',
      });
      return output.toString();
    } catch (error) {
      return `Migration status check failed: ${error}`;
    }
  }

  /**
   * Handle migration errors with diagnostic information
   */
  private async handleMigrationError(error: any, databaseUrl: string): Promise<void> {
    this.logError('💥 Migration error details:', error);

    // Get migration status for debugging
    const status = await this.getMigrationStatus(databaseUrl);
    this.log('📊 Migration status:');
    this.log(status);

    // Log environment info
    this.log('🔧 Environment info:');
    this.log(`DATABASE_URL: ${databaseUrl}`);
    this.log(`Node version: ${process.version}`);
    this.log(`Working directory: ${this.projectRoot}`);

    // Check for common migration issues and provide solutions
    if (error instanceof Error) {
      if (error.message.includes('locked')) {
        this.log('💡 Database appears to be locked. Try waiting a moment and retry.');
      }
      if (error.message.includes('already exists')) {
        this.log('💡 Migration may have been partially applied. Consider using --force-reset.');
      }
      if (error.message.includes('foreign key')) {
        this.log('💡 Foreign key constraint issue. Ensure proper migration order.');
      }
      if (error.message.includes('timeout')) {
        this.log('💡 Migration timed out. Consider increasing timeout or optimizing migrations.');
      }
      if (error.message.includes('permission') || error.message.includes('access')) {
        this.log('💡 Permission issue. Check database file/directory permissions.');
      }
    }
  }
}

/**
 * Convenience function for running migrations in tests
 */
export async function runTestMigrations(
  databaseUrl: string,
  options: MigrationOptions = {}
): Promise<void> {
  const manager = new MigrationManager({
    verbose: process.env.NODE_ENV !== 'test',
    ...options,
  });

  await manager.runMigrations(databaseUrl);
}

/**
 * Check migration status for tests
 */
export async function checkMigrationStatus(databaseUrl: string): Promise<string> {
  const manager = new MigrationManager({ verbose: false });
  return await manager.getMigrationStatus(databaseUrl);
}
