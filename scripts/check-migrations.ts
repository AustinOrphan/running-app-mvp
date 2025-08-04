#!/usr/bin/env tsx

/**
 * Migration Status Checker
 * Ensures database migrations are properly applied before running tests
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

interface MigrationCheckOptions {
  verbose?: boolean;
  fix?: boolean;
  timeout?: number;
}

class MigrationChecker {
  private options: MigrationCheckOptions;
  private projectRoot: string;

  constructor(options: MigrationCheckOptions = {}) {
    this.options = {
      verbose: true,
      fix: false,
      timeout: 30000,
      ...options,
    };
    this.projectRoot = process.cwd();
  }

  private log(message: string): void {
    if (this.options.verbose) {
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
   * Check if migrations directory exists
   */
  private migrationsExist(): boolean {
    const migrationsPath = path.join(this.projectRoot, 'prisma', 'migrations');
    return existsSync(migrationsPath);
  }

  /**
   * Get current migration status
   */
  async getMigrationStatus(): Promise<{ status: string; hasIssues: boolean }> {
    try {
      this.log('📊 Checking migration status...');
      
      const output = execSync('npx prisma migrate status', {
        stdio: 'pipe',
        timeout: this.options.timeout,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/test.db' },
      });

      const status = output.toString();
      
      // Check for common issues
      const hasIssues = status.includes('error') || 
                       status.includes('failed') || 
                       status.includes('pending') ||
                       status.includes('drift');

      this.log('✅ Migration status retrieved');
      if (this.options.verbose) {
        console.log('Migration Status:');
        console.log(status);
      }

      return { status, hasIssues };
    } catch (error) {
      this.logError('❌ Failed to get migration status:', error);
      return { status: 'Error getting status', hasIssues: true };
    }
  }

  /**
   * Verify database schema is valid
   */
  async verifySchema(): Promise<boolean> {
    try {
      this.log('🔍 Verifying database schema...');
      
      execSync('npx prisma validate', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: this.options.timeout,
        env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/test.db' },
      });

      this.log('✅ Schema validation passed');
      return true;
    } catch (error) {
      this.logError('❌ Schema validation failed:', error);
      return false;
    }
  }

  /**
   * Fix migration issues by running appropriate commands
   */
  async fixMigrations(): Promise<boolean> {
    if (!this.options.fix) {
      this.log('⚠️  Fix mode not enabled, skipping repairs');
      return false;
    }

    try {
      this.log('🔧 Attempting to fix migration issues...');

      if (!this.migrationsExist()) {
        this.log('📤 No migrations found, using schema push...');
        execSync('npx prisma db push --force-reset --skip-generate', {
          stdio: this.options.verbose ? 'inherit' : 'pipe',
          timeout: this.options.timeout,
          env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/test.db' },
        });
      } else {
        this.log('🗄️  Deploying migrations...');
        execSync('npx prisma migrate deploy', {
          stdio: this.options.verbose ? 'inherit' : 'pipe',
          timeout: this.options.timeout,
          env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/test.db' },
        });
      }

      this.log('✅ Migration fixes applied successfully');
      return true;
    } catch (error) {
      this.logError('❌ Failed to fix migrations:', error);
      return false;
    }
  }

  /**
   * Perform full migration check
   */
  async checkMigrations(): Promise<boolean> {
    try {
      this.log('🧪 Starting migration check...');

      // Check if schema file exists
      const schemaPath = path.join(this.projectRoot, 'prisma', 'schema.prisma');
      if (!existsSync(schemaPath)) {
        this.logError('❌ Prisma schema file not found');
        return false;
      }

      // Validate schema
      const schemaValid = await this.verifySchema();
      if (!schemaValid) {
        this.logError('❌ Schema validation failed');
        return false;
      }

      // Check migration status
      const { status, hasIssues } = await this.getMigrationStatus();
      
      if (hasIssues) {
        this.logError('⚠️  Migration issues detected');
        
        if (this.options.fix) {
          const fixed = await this.fixMigrations();
          if (!fixed) {
            return false;
          }
          
          // Re-check after fix
          const { hasIssues: stillHasIssues } = await this.getMigrationStatus();
          if (stillHasIssues) {
            this.logError('❌ Issues persist after attempted fix');
            return false;
          }
        } else {
          this.log('💡 Run with --fix flag to attempt automatic repair');
          return false;
        }
      }

      this.log('🎉 All migration checks passed');
      return true;
    } catch (error) {
      this.logError('💥 Migration check failed:', error);
      return false;
    }
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  const options: MigrationCheckOptions = {
    verbose: !args.includes('--quiet'),
    fix: args.includes('--fix'),
    timeout: args.includes('--timeout') ? 
      parseInt(args[args.indexOf('--timeout') + 1]) || 30000 : 30000,
  };

  // Set database URL if provided
  if (args.includes('--database-url')) {
    const urlIndex = args.indexOf('--database-url') + 1;
    if (args[urlIndex]) {
      process.env.DATABASE_URL = args[urlIndex];
    }
  }

  const checker = new MigrationChecker(options);
  
  try {
    const success = await checker.checkMigrations();
    process.exit(success ? 0 : 1);
  } catch (error) {
    console.error('💥 Migration check failed:', error);
    process.exit(1);
  }
}

// Export for use in other scripts
export { MigrationChecker };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}