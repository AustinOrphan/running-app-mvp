#!/usr/bin/env tsx

/**
 * CI Unit Test Fix Script
 *
 * This script addresses common CI unit test failures by:
 * - Ensuring proper environment setup
 * - Fixing database connectivity issues
 * - Verifying test configuration
 * - Running diagnostic tests
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import path from 'path';

class CIUnitTestFixer {
  private fixes: Array<{
    name: string;
    status: 'success' | 'failed' | 'skipped';
    message: string;
  }> = [];

  constructor() {
    console.log('🔧 CI Unit Test Fixer');
    console.log('='.repeat(40));
  }

  private logFix(name: string, status: 'success' | 'failed' | 'skipped', message: string): void {
    this.fixes.push({ name, status, message });

    const icon = status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭️';
    console.log(`${icon} ${name}: ${message}`);
  }

  async fixEnvironmentVariables(): Promise<void> {
    console.log('\n🌍 Fixing Environment Variables...');

    // Ensure critical environment variables are set
    const requiredVars = {
      NODE_ENV: 'test',
      DATABASE_URL: 'file:./prisma/test.db',
      JWT_SECRET: 'test-secret-key-for-ci-environment-must-be-longer-than-32-characters',
    };

    let fixed = 0;
    for (const [key, value] of Object.entries(requiredVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
        fixed++;
      }
    }

    if (fixed > 0) {
      this.logFix('Environment Variables', 'success', `Set ${fixed} missing environment variables`);
    } else {
      this.logFix(
        'Environment Variables',
        'skipped',
        'All required environment variables already set'
      );
    }
  }

  async fixDatabaseSetup(): Promise<void> {
    console.log('\n🗄️ Fixing Database Setup...');

    try {
      // Ensure prisma directory exists
      const prismaDir = path.join(process.cwd(), 'prisma');
      if (!existsSync(prismaDir)) {
        execSync('mkdir -p prisma');
        this.logFix('Prisma Directory', 'success', 'Created prisma directory');
      } else {
        this.logFix('Prisma Directory', 'skipped', 'Prisma directory already exists');
      }

      // Clean up any existing test database
      const dbPath = path.join(process.cwd(), 'prisma', 'test.db');
      if (existsSync(dbPath)) {
        execSync('rm -f prisma/test.db*');
        this.logFix('Database Cleanup', 'success', 'Removed existing test database');
      } else {
        this.logFix('Database Cleanup', 'skipped', 'No existing database to clean');
      }

      // Run database setup
      execSync('npm run ci-db-setup', { stdio: 'pipe' });
      this.logFix('Database Setup', 'success', 'Database initialized successfully');

      // Verify database connection
      const prisma = new PrismaClient();
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1 as test`;
      await prisma.$disconnect();
      this.logFix('Database Connection', 'success', 'Database connection verified');
    } catch (error) {
      this.logFix('Database Setup', 'failed', `Database setup failed: ${error}`);
    }
  }

  async fixTestConfiguration(): Promise<void> {
    console.log('\n⚙️ Fixing Test Configuration...');

    try {
      // Verify vitest CI configuration exists and is valid
      const vitestConfigPath = path.join(process.cwd(), 'vitest.config.ci.ts');
      if (!existsSync(vitestConfigPath)) {
        this.logFix('Vitest CI Config', 'failed', 'vitest.config.ci.ts not found');
        return;
      }

      // Verify test setup files exist
      const setupFiles = ['vitest.setup.ts', 'tests/setup/testSetup.ts'];

      let missingFiles = 0;
      for (const file of setupFiles) {
        if (!existsSync(path.join(process.cwd(), file))) {
          missingFiles++;
          this.logFix(`Setup File: ${file}`, 'failed', 'Missing required setup file');
        }
      }

      if (missingFiles === 0) {
        this.logFix('Test Configuration', 'success', 'All test configuration files present');
      }
    } catch (error) {
      this.logFix('Test Configuration', 'failed', `Configuration check failed: ${error}`);
    }
  }

  async runDiagnosticTests(): Promise<void> {
    console.log('\n🧪 Running Diagnostic Tests...');

    try {
      // Run a simple test to verify the environment
      console.log('   Running unit test configuration check...');
      execSync(
        'npm run test:coverage:unit:ci -- --run --reporter=basic --testTimeout=10000 --bail=1',
        {
          stdio: 'pipe',
          timeout: 30000,
        }
      );
      this.logFix('Unit Test Execution', 'success', 'Unit tests can run successfully');
    } catch (error: any) {
      // Check if it's a test failure vs configuration issue
      if (error.message?.includes('No test files found') || error.message?.includes('no tests')) {
        this.logFix(
          'Unit Test Execution',
          'success',
          'Test runner works (no test files found is OK)'
        );
      } else if (error.message?.includes('timeout') || error.message?.includes('ECONNREFUSED')) {
        this.logFix(
          'Unit Test Execution',
          'failed',
          'Database connection timeout - check database setup'
        );
      } else {
        this.logFix(
          'Unit Test Execution',
          'failed',
          `Test execution failed: ${error.message?.substring(0, 100)}...`
        );
      }
    }
  }

  async fixPermissions(): Promise<void> {
    console.log('\n🔐 Fixing File Permissions...');

    try {
      // Ensure script files are executable
      const scriptFiles = ['scripts/ci-db-setup.ts', 'scripts/verify-ci-environment.ts'];

      for (const script of scriptFiles) {
        const scriptPath = path.join(process.cwd(), script);
        if (existsSync(scriptPath)) {
          execSync(`chmod +x "${scriptPath}"`);
        }
      }

      this.logFix('File Permissions', 'success', 'Ensured script files are executable');
    } catch (error) {
      this.logFix('File Permissions', 'failed', `Permission fix failed: ${error}`);
    }
  }

  async createDebugInfo(): Promise<void> {
    console.log('\n📊 Creating Debug Information...');

    try {
      const debugInfo = {
        timestamp: new Date().toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
        env: {
          NODE_ENV: process.env.NODE_ENV,
          DATABASE_URL: process.env.DATABASE_URL,
          JWT_SECRET: process.env.JWT_SECRET ? '***SET***' : 'NOT_SET',
          CI: process.env.CI,
        },
        fixes: this.fixes,
      };

      writeFileSync('ci-debug-info.json', JSON.stringify(debugInfo, null, 2));
      this.logFix('Debug Info', 'success', 'Created ci-debug-info.json for troubleshooting');
    } catch (error) {
      this.logFix('Debug Info', 'failed', `Failed to create debug info: ${error}`);
    }
  }

  async runAllFixes(): Promise<boolean> {
    console.log('Starting CI unit test fixes...\n');

    await this.fixEnvironmentVariables();
    await this.fixDatabaseSetup();
    await this.fixTestConfiguration();
    await this.fixPermissions();
    await this.runDiagnosticTests();
    await this.createDebugInfo();

    console.log('\n📊 Fix Summary');
    console.log('='.repeat(30));

    const successful = this.fixes.filter(f => f.status === 'success').length;
    const failed = this.fixes.filter(f => f.status === 'failed').length;
    const skipped = this.fixes.filter(f => f.status === 'skipped').length;

    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️ Skipped: ${skipped}`);

    if (failed === 0) {
      console.log('\n🎉 All fixes applied successfully! CI unit tests should now work.');
    } else {
      console.log(`\n🚨 ${failed} fixes failed. Please review the errors above.`);

      // Show failed fixes
      console.log('\n❌ Failed Fixes:');
      this.fixes
        .filter(f => f.status === 'failed')
        .forEach(fix => {
          console.log(`  • ${fix.name}: ${fix.message}`);
        });
    }

    return failed === 0;
  }

  async cleanup(): Promise<void> {
    try {
      execSync('npm run ci-db-teardown', { stdio: 'pipe' });
      console.log('🧹 Cleanup completed');
    } catch (error) {
      console.warn('⚠️ Cleanup warning:', error);
    }
  }
}

// CLI execution
if (require.main === module) {
  const fixer = new CIUnitTestFixer();

  fixer
    .runAllFixes()
    .then(async success => {
      await fixer.cleanup();
      process.exit(success ? 0 : 1);
    })
    .catch(async error => {
      console.error('❌ Fix process failed:', error);
      await fixer.cleanup();
      process.exit(1);
    });
}

export { CIUnitTestFixer };
