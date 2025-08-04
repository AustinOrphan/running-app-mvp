#!/usr/bin/env tsx

/**
 * Ensure Test Readiness Script
 * Comprehensive test environment preparation script that ensures:
 * - Prisma client is generated
 * - Database is set up
 * - Test environment is validated
 */

import { ensurePrismaClient, verifyPrismaClientExists } from '../tests/setup/prismaSetup.js';
import { execSync } from 'child_process';

interface TestReadinessOptions {
  verbose?: boolean;
  skipPrisma?: boolean;
  skipDatabase?: boolean;
  skipValidation?: boolean;
  testType?: 'unit' | 'integration' | 'e2e' | 'all';
}

class TestReadinessManager {
  private options: TestReadinessOptions;

  constructor(options: TestReadinessOptions = {}) {
    this.options = {
      verbose: true,
      skipPrisma: false,
      skipDatabase: false,
      skipValidation: false,
      testType: 'all',
      ...options,
    };
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
   * Ensure Prisma client is available
   */
  async ensurePrismaClient(): Promise<void> {
    if (this.options.skipPrisma) {
      this.log('⏭️  Skipping Prisma client setup as requested');
      return;
    }

    this.log('🔧 Ensuring Prisma client is ready...');

    try {
      // Check if already exists
      const exists = await verifyPrismaClientExists();
      if (exists) {
        this.log('✅ Prisma client already available');
        return;
      }

      // Generate client
      await ensurePrismaClient();
      this.log('✅ Prisma client generation completed');
    } catch (error) {
      this.logError('❌ Failed to ensure Prisma client:', error);
      throw error;
    }
  }

  /**
   * Set up test database
   */
  async setupDatabase(): Promise<void> {
    if (this.options.skipDatabase) {
      this.log('⏭️  Skipping database setup as requested');
      return;
    }

    this.log('🗄️  Setting up test database...');

    try {
      // Use the appropriate database setup based on test type
      const dbSetupCommand = this.options.testType === 'integration' 
        ? 'ci-integration-db-setup'
        : 'ci-db-setup';

      execSync(`npm run ${dbSetupCommand}`, {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 60000, // 1 minute timeout
      });

      this.log('✅ Test database setup completed');
    } catch (error) {
      this.logError('❌ Failed to set up test database:', error);
      throw error;
    }
  }

  /**
   * Validate test environment
   */
  async validateEnvironment(): Promise<void> {
    if (this.options.skipValidation) {
      this.log('⏭️  Skipping environment validation as requested');
      return;
    }

    this.log('🔍 Validating test environment...');

    try {
      execSync('npm run validate-test-env', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 30000, // 30 second timeout
      });

      this.log('✅ Test environment validation completed');
    } catch (error) {
      // Environment validation warnings are often non-fatal
      this.log('⚠️  Environment validation had warnings, but continuing...');
      if (this.options.verbose) {
        console.warn(error);
      }
    }
  }

  /**
   * Full test readiness check
   */
  async ensureReadiness(): Promise<void> {
    const startTime = Date.now();
    this.log(`🚀 Ensuring test readiness for ${this.options.testType} tests...`);

    try {
      // Step 1: Ensure Prisma client
      await this.ensurePrismaClient();

      // Step 2: Set up database
      await this.setupDatabase();

      // Step 3: Validate environment (non-blocking)
      await this.validateEnvironment();

      const duration = Date.now() - startTime;
      this.log(`🎉 Test environment ready in ${duration}ms!`);
    } catch (error) {
      this.logError('💥 Failed to ensure test readiness:', error);
      throw error;
    }
  }

  /**
   * Quick readiness check (Prisma only)
   */
  async ensureQuickReadiness(): Promise<void> {
    this.log('⚡ Quick test readiness check...');

    try {
      await this.ensurePrismaClient();
      this.log('✅ Quick readiness check completed');
    } catch (error) {
      this.logError('❌ Quick readiness check failed:', error);
      throw error;
    }
  }
}

// CLI interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'full';

  const options: TestReadinessOptions = {
    verbose: !args.includes('--quiet') && !args.includes('-q'),
    skipPrisma: args.includes('--skip-prisma'),
    skipDatabase: args.includes('--skip-database') || args.includes('--skip-db'),
    skipValidation: args.includes('--skip-validation'),
    testType: (args.find(arg => arg.startsWith('--type='))?.split('=')[1] as any) || 'all',
  };

  const manager = new TestReadinessManager(options);

  try {
    switch (command) {
      case 'full':
        await manager.ensureReadiness();
        break;
      case 'quick':
        await manager.ensureQuickReadiness();
        break;
      case 'prisma':
        await manager.ensurePrismaClient();
        break;
      case 'database':
      case 'db':
        await manager.setupDatabase();
        break;
      case 'validate':
        await manager.validateEnvironment();
        break;
      default:
        console.error('❌ Unknown command. Use: full, quick, prisma, database, or validate');
        console.error('Options: --quiet, --skip-prisma, --skip-database, --skip-validation, --type=unit|integration|e2e');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test readiness check failed:', error);
    process.exit(1);
  }
}

// Auto-run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('❌ Test readiness failed:', error);
    process.exit(1);
  });
}

export { TestReadinessManager };