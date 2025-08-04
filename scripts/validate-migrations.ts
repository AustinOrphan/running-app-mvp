#!/usr/bin/env tsx

/**
 * Migration Validation Script
 * Validates that migrations can run properly before running tests
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import { MigrationManager, checkMigrationStatus } from '../tests/setup/migrationManager';

interface ValidationResult {
  success: boolean;
  message: string;
  details?: string;
}

class MigrationValidator {
  private projectRoot: string;
  private testDbPath: string;
  private testDbUrl: string;

  constructor() {
    this.projectRoot = process.cwd();
    this.testDbPath = path.join(this.projectRoot, 'prisma', 'test-validation.db');
    this.testDbUrl = `file:${this.testDbPath}`;
  }

  /**
   * Validate migrations can run properly with timeout protection
   */
  async validateMigrations(): Promise<ValidationResult> {
    console.log('🔍 Starting migration validation...');

    // Add overall timeout to prevent hanging
    const validationTimeout = new Promise<ValidationResult>((_, reject) => {
      setTimeout(() => reject(new Error('Migration validation timed out after 2 minutes')), 120000);
    });

    try {
      const result = await Promise.race([
        this.performValidation(),
        validationTimeout,
      ]);
      return result;
    } catch (error) {
      console.error('❌ Migration validation failed:', error);
      return {
        success: false,
        message: 'Migration validation failed',
        details: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Cleanup test database
      await this.cleanup();
    }
  }

  /**
   * Perform the actual validation steps
   */
  private async performValidation(): Promise<ValidationResult> {
    // Ensure prisma directory exists
    const prismaDir = path.dirname(this.testDbPath);
    if (!existsSync(prismaDir)) {
      mkdirSync(prismaDir, { recursive: true });
    }

    // Remove existing test database
    if (existsSync(this.testDbPath)) {
      console.log('🗑️  Removing existing test database...');
      try {
        const fs = await import('fs/promises');
        await fs.unlink(this.testDbPath);
      } catch (error) {
        console.warn('⚠️  Could not remove existing test database:', error);
      }
    }

    // Test migration manager
    const manager = new MigrationManager({
      verbose: true,
      forceReset: true,
    });

    console.log('📋 Testing migration deployment...');
    await manager.runMigrations(this.testDbUrl);

    // Check migration status
    console.log('📊 Checking migration status...');
    const status = await checkMigrationStatus(this.testDbUrl);
    console.log('Migration status:', status);

    // Test basic database operations
    console.log('🧪 Testing basic database operations...');
    await this.testDatabaseOperations();

    console.log('✅ Migration validation completed successfully');
    return {
      success: true,
      message: 'All migrations validated successfully',
      details: status,
    };
  }

  /**
   * Test basic database operations with timeout protection
   */
  private async testDatabaseOperations(): Promise<void> {
    // Add timeout protection to prevent hanging
    const operationTimeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database operations test timed out after 30 seconds')), 30000);
    });

    try {
      await Promise.race([
        this.performDatabaseOperations(),
        operationTimeout,
      ]);
    } catch (error) {
      if (error instanceof Error && error.message.includes('timed out')) {
        throw new Error(`Database operations test failed: ${error.message}`);
      }
      throw new Error(`Database operations test failed: ${error}`);
    }
  }

  /**
   * Perform the actual database operations
   */
  private async performDatabaseOperations(): Promise<void> {
    // Import Prisma client dynamically to avoid import issues
    const { PrismaClient } = await import('@prisma/client');
    
    const prisma = new PrismaClient({
      datasources: {
        db: {
          url: this.testDbUrl,
        },
      },
    });

    try {
      // Test connection with timeout
      console.log('🔌 Testing database connection...');
      await prisma.$connect();
      console.log('✅ Database connection successful');

      // Test basic query (should work even with empty tables)
      console.log('📊 Testing basic queries...');
      const userCount = await prisma.user.count();
      console.log(`✅ Basic query successful (user count: ${userCount})`);

      // Test that all expected tables exist by trying to count each
      console.log('🔍 Verifying table accessibility...');
      const [runCount, goalCount, raceCount] = await Promise.all([
        prisma.run.count(),
        prisma.goal.count(),
        prisma.race.count(),
      ]);
      
      console.log(`✅ All tables accessible: users=${userCount}, runs=${runCount}, goals=${goalCount}, races=${raceCount}`);

    } finally {
      await prisma.$disconnect();
    }
  }

  /**
   * Cleanup test resources
   */
  private async cleanup(): Promise<void> {
    try {
      if (existsSync(this.testDbPath)) {
        const fs = await import('fs/promises');
        await fs.unlink(this.testDbPath);
        console.log('🧹 Test database cleaned up');
      }
    } catch (error) {
      console.warn('⚠️  Cleanup failed:', error);
    }
  }
}

/**
 * Main validation function
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isCI = process.env.CI === 'true';
  const isVerbose = args.includes('--verbose') || args.includes('-v');

  console.log('🚀 Migration Validation Tool');
  console.log(`Environment: ${isCI ? 'CI' : 'Local'}`);
  console.log(`Working directory: ${process.cwd()}`);
  console.log('');

  try {
    // Ensure Prisma client is generated first
    console.log('🔧 Ensuring Prisma client is generated...');
    execSync('npx prisma generate', {
      stdio: isVerbose ? 'inherit' : 'pipe',
      timeout: 60000,
    });
    console.log('✅ Prisma client ready');
    console.log('');

    // Validate migrations
    const validator = new MigrationValidator();
    const result = await validator.validateMigrations();

    if (result.success) {
      console.log('');
      console.log('🎉 Migration validation PASSED');
      console.log(`✅ ${result.message}`);
      if (result.details && isVerbose) {
        console.log('📋 Details:', result.details);
      }
      process.exit(0);
    } else {
      console.log('');
      console.log('💥 Migration validation FAILED');
      console.log(`❌ ${result.message}`);
      if (result.details) {
        console.error('📋 Error details:', result.details);
      }
      process.exit(1);
    }

  } catch (error) {
    console.error('💥 Validation tool crashed:', error);
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

export { MigrationValidator };