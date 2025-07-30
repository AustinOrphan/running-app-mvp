#!/usr/bin/env tsx

/**
 * CI Environment Verification Script
 *
 * This script verifies that the CI environment is properly configured
 * to run unit tests successfully. It checks:
 * - Environment variables
 * - Database connectivity
 * - Test configuration files
 * - Dependencies
 * - File permissions
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, accessSync, constants } from 'fs';
import { PrismaClient } from '@prisma/client';
import path from 'path';

interface VerificationResult {
  category: string;
  check: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  details?: string;
}

class CIEnvironmentVerifier {
  private results: VerificationResult[] = [];
  private criticalFailures = 0;
  private warnings = 0;

  constructor() {
    console.log('🔍 CI Environment Verification');
    console.log('='.repeat(50));
  }

  private addResult(
    category: string,
    check: string,
    status: 'pass' | 'fail' | 'warn',
    message: string,
    details?: string
  ): void {
    this.results.push({ category, check, status, message, details });

    if (status === 'fail') {
      this.criticalFailures++;
      console.log(`❌ ${category} - ${check}: ${message}`);
      if (details) console.log(`   Details: ${details}`);
    } else if (status === 'warn') {
      this.warnings++;
      console.log(`⚠️  ${category} - ${check}: ${message}`);
      if (details) console.log(`   Details: ${details}`);
    } else {
      console.log(`✅ ${category} - ${check}: ${message}`);
    }
  }

  async verifyEnvironmentVariables(): Promise<void> {
    const category = 'Environment Variables';

    // Critical environment variables for tests
    const criticalVars = [
      {
        name: 'NODE_ENV',
        expected: 'test',
        description: 'Should be set to test for proper test environment detection',
      },
      {
        name: 'DATABASE_URL',
        pattern: /^file:\.\/prisma\/.*\.db$/,
        description: 'Should point to SQLite test database',
      },
      {
        name: 'JWT_SECRET',
        minLength: 32,
        description: 'Should be at least 32 characters for security',
      },
    ];

    for (const envVar of criticalVars) {
      const value = process.env[envVar.name];

      if (!value) {
        this.addResult(
          category,
          envVar.name,
          'fail',
          `Missing required environment variable`,
          envVar.description
        );
        continue;
      }

      // Check expected value
      if (envVar.expected && value !== envVar.expected) {
        this.addResult(
          category,
          envVar.name,
          'warn',
          `Expected '${envVar.expected}', got '${value}'`,
          envVar.description
        );
        continue;
      }

      // Check pattern match
      if (envVar.pattern && !envVar.pattern.test(value)) {
        this.addResult(
          category,
          envVar.name,
          'fail',
          `Value doesn't match expected pattern`,
          `Expected: ${envVar.pattern}, Got: ${value}`
        );
        continue;
      }

      // Check minimum length
      if (envVar.minLength && value.length < envVar.minLength) {
        this.addResult(
          category,
          envVar.name,
          'fail',
          `Value too short (${value.length} chars)`,
          `Minimum required: ${envVar.minLength} characters`
        );
        continue;
      }

      this.addResult(category, envVar.name, 'pass', `Properly configured`);
    }

    // Check optional but recommended variables
    const optionalVars = ['CI', 'BCRYPT_ROUNDS', 'LOG_LEVEL'];
    for (const varName of optionalVars) {
      const value = process.env[varName];
      if (value) {
        this.addResult(category, varName, 'pass', `Set to '${value}'`);
      } else {
        this.addResult(
          category,
          varName,
          'warn',
          'Not set (optional)',
          'Consider setting for consistent behavior'
        );
      }
    }
  }

  async verifyDatabaseConnection(): Promise<void> {
    const category = 'Database';

    try {
      // Check if Prisma client can be instantiated
      const prisma = new PrismaClient();
      this.addResult(category, 'Prisma Client', 'pass', 'Successfully instantiated');

      // Test database connection
      try {
        await prisma.$connect();
        this.addResult(category, 'Database Connection', 'pass', 'Successfully connected');

        // Test a simple query
        try {
          await prisma.$queryRaw`SELECT 1 as test`;
          this.addResult(category, 'Database Query', 'pass', 'Can execute queries');
        } catch (queryError) {
          this.addResult(
            category,
            'Database Query',
            'fail',
            'Cannot execute queries',
            String(queryError)
          );
        }

        await prisma.$disconnect();
      } catch (connectionError) {
        this.addResult(
          category,
          'Database Connection',
          'fail',
          'Cannot connect to database',
          String(connectionError)
        );
      }
    } catch (clientError) {
      this.addResult(
        category,
        'Prisma Client',
        'fail',
        'Cannot instantiate Prisma client',
        String(clientError)
      );
    }

    // Check database file path
    const dbUrl = process.env.DATABASE_URL;
    if (dbUrl && dbUrl.startsWith('file:')) {
      const dbPath = dbUrl.replace('file:', '');
      const fullPath = path.resolve(process.cwd(), dbPath);

      if (existsSync(fullPath)) {
        this.addResult(category, 'Database File', 'pass', `Database file exists at ${fullPath}`);

        // Check file permissions
        try {
          accessSync(fullPath, constants.R_OK | constants.W_OK);
          this.addResult(
            category,
            'Database Permissions',
            'pass',
            'Database file is readable and writable'
          );
        } catch {
          this.addResult(
            category,
            'Database Permissions',
            'fail',
            'Database file is not readable/writable'
          );
        }
      } else {
        this.addResult(
          category,
          'Database File',
          'warn',
          `Database file does not exist at ${fullPath}`,
          'Will be created during test setup'
        );
      }
    }
  }

  async verifyTestConfiguration(): Promise<void> {
    const category = 'Test Configuration';

    // Check critical test configuration files
    const configFiles = [
      { path: 'vitest.config.ci.ts', description: 'CI-specific Vitest configuration' },
      { path: 'vitest.setup.ts', description: 'Vitest setup file' },
      { path: 'tests/setup/testSetup.ts', description: 'Test environment setup' },
      { path: 'package.json', description: 'Package configuration with test scripts' },
    ];

    for (const file of configFiles) {
      const fullPath = path.resolve(process.cwd(), file.path);

      if (existsSync(fullPath)) {
        this.addResult(category, `Config File: ${file.path}`, 'pass', `File exists`);

        // Check file permissions
        try {
          accessSync(fullPath, constants.R_OK);
          this.addResult(category, `Config Permissions: ${file.path}`, 'pass', 'File is readable');
        } catch {
          this.addResult(
            category,
            `Config Permissions: ${file.path}`,
            'fail',
            'File is not readable'
          );
        }
      } else {
        this.addResult(
          category,
          `Config File: ${file.path}`,
          'fail',
          `Missing required file`,
          file.description
        );
      }
    }

    // Verify npm scripts exist
    try {
      const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'));
      const requiredScripts = ['test:coverage:unit:ci', 'ci-db-setup', 'ci-db-teardown'];

      for (const script of requiredScripts) {
        if (packageJson.scripts?.[script]) {
          this.addResult(category, `NPM Script: ${script}`, 'pass', 'Script exists');
        } else {
          this.addResult(category, `NPM Script: ${script}`, 'fail', 'Missing required npm script');
        }
      }
    } catch (error) {
      this.addResult(category, 'Package.json', 'fail', 'Cannot read package.json', String(error));
    }
  }

  async verifyDependencies(): Promise<void> {
    const category = 'Dependencies';

    try {
      // Check if node_modules exists
      if (existsSync('node_modules')) {
        this.addResult(category, 'Node Modules', 'pass', 'Dependencies installed');
      } else {
        this.addResult(
          category,
          'Node Modules',
          'fail',
          'Dependencies not installed',
          'Run npm ci'
        );
        return;
      }

      // Check critical test dependencies
      const criticalDeps = [
        '@prisma/client',
        'vitest',
        '@vitest/coverage-v8',
        '@testing-library/jest-dom',
        '@testing-library/react',
        'jsdom',
      ];

      for (const dep of criticalDeps) {
        const depPath = path.join('node_modules', dep);
        if (existsSync(depPath)) {
          this.addResult(category, `Dependency: ${dep}`, 'pass', 'Installed');
        } else {
          this.addResult(category, `Dependency: ${dep}`, 'fail', 'Missing critical dependency');
        }
      }

      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);

      if (majorVersion >= 20) {
        this.addResult(category, 'Node.js Version', 'pass', `Version ${nodeVersion} (>= 20.0.0)`);
      } else {
        this.addResult(
          category,
          'Node.js Version',
          'fail',
          `Version ${nodeVersion} is too old`,
          'Requires Node.js >= 20.0.0'
        );
      }
    } catch (error) {
      this.addResult(
        category,
        'Dependencies Check',
        'fail',
        'Error checking dependencies',
        String(error)
      );
    }
  }

  async verifyTestExecution(): Promise<void> {
    const category = 'Test Execution';

    try {
      // Test database setup script
      console.log('\n🧪 Testing database setup...');
      execSync('npm run ci-db-setup', {
        stdio: 'pipe',
        timeout: 30000,
        env: { ...process.env, NODE_ENV: 'test' },
      });
      this.addResult(
        category,
        'Database Setup',
        'pass',
        'Database setup script executed successfully'
      );

      // Test a simple unit test run (dry run)
      console.log('🧪 Testing unit test configuration...');
      try {
        const output = execSync(
          'npm run test:coverage:unit:ci -- --run --reporter=basic tests/unit/utils',
          {
            stdio: 'pipe',
            timeout: 60000,
            env: { ...process.env, NODE_ENV: 'test' },
          }
        );
        this.addResult(category, 'Unit Test Execution', 'pass', 'Unit tests can be executed');
      } catch (testError: any) {
        // Check if it's just missing test files vs actual configuration issues
        if (testError.message?.includes('No test files found')) {
          this.addResult(
            category,
            'Unit Test Execution',
            'warn',
            'No test files found in sample path',
            'Test configuration appears correct'
          );
        } else {
          this.addResult(
            category,
            'Unit Test Execution',
            'fail',
            'Unit test execution failed',
            String(testError)
          );
        }
      }

      // Cleanup
      console.log('🧹 Cleaning up...');
      execSync('npm run ci-db-teardown', {
        stdio: 'pipe',
        timeout: 10000,
        env: { ...process.env, NODE_ENV: 'test' },
      });
      this.addResult(
        category,
        'Database Cleanup',
        'pass',
        'Database cleanup script executed successfully'
      );
    } catch (error) {
      this.addResult(
        category,
        'Test Infrastructure',
        'fail',
        'Test infrastructure verification failed',
        String(error)
      );
    }
  }

  async runAllVerifications(): Promise<boolean> {
    console.log('Starting comprehensive CI environment verification...\n');

    await this.verifyEnvironmentVariables();
    console.log('');

    await this.verifyDatabaseConnection();
    console.log('');

    await this.verifyTestConfiguration();
    console.log('');

    await this.verifyDependencies();
    console.log('');

    await this.verifyTestExecution();
    console.log('');

    this.printSummary();

    return this.criticalFailures === 0;
  }

  private printSummary(): void {
    console.log('📊 Verification Summary');
    console.log('='.repeat(30));

    const totalChecks = this.results.length;
    const passed = this.results.filter(r => r.status === 'pass').length;
    const failed = this.criticalFailures;
    const warnings = this.warnings;

    console.log(`Total Checks: ${totalChecks}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warnings}`);

    if (failed === 0) {
      console.log('\n🎉 All critical checks passed! CI environment is ready for unit tests.');
    } else {
      console.log(
        `\n🚨 ${failed} critical issues found. Please fix these before running CI tests.`
      );
    }

    if (warnings > 0) {
      console.log(
        `\n💡 ${warnings} warnings found. Consider addressing these for optimal CI performance.`
      );
    }

    // Show failed checks details
    if (failed > 0) {
      console.log('\n🔍 Critical Issues to Fix:');
      this.results
        .filter(r => r.status === 'fail')
        .forEach((result, index) => {
          console.log(`\n${index + 1}. ${result.category} - ${result.check}`);
          console.log(`   Problem: ${result.message}`);
          if (result.details) {
            console.log(`   Details: ${result.details}`);
          }
        });
    }
  }

  generateJSONReport(): string {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.results.length,
        passed: this.results.filter(r => r.status === 'pass').length,
        failed: this.criticalFailures,
        warnings: this.warnings,
        success: this.criticalFailures === 0,
      },
      results: this.results,
    };

    return JSON.stringify(report, null, 2);
  }
}

// CLI execution
if (require.main === module) {
  const verifier = new CIEnvironmentVerifier();

  verifier
    .runAllVerifications()
    .then(success => {
      if (process.argv.includes('--json')) {
        console.log('\n' + verifier.generateJSONReport());
      }

      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Verification failed with error:', error);
      process.exit(1);
    });
}

export { CIEnvironmentVerifier };
