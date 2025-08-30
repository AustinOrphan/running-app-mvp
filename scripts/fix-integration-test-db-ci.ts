#!/usr/bin/env tsx

/**
 * Integration Test Database CI Fix Script
 *
 * This script addresses integration test database setup issues in CI by:
 * - Fixing environment variable inconsistencies
 * - Ensuring proper database isolation between tests
 * - Adding better error handling and diagnostics
 * - Fixing database connection and cleanup issues
 * - Implementing robust test database lifecycle management
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import path from 'path';

class IntegrationTestDBFixer {
  private fixes: Array<{
    name: string;
    status: 'success' | 'failed' | 'skipped';
    message: string;
  }> = [];

  constructor() {
    console.log('🔧 Integration Test Database CI Fixer');
    console.log('='.repeat(50));
  }

  private logFix(name: string, status: 'success' | 'failed' | 'skipped', message: string): void {
    this.fixes.push({ name, status, message });

    const icon = status === 'success' ? '✅' : status === 'failed' ? '❌' : '⏭️';
    console.log(`${icon} ${name}: ${message}`);
  }

  async fixEnvironmentVariableConsistency(): Promise<void> {
    console.log('\n🌍 Fixing Environment Variable Consistency...');

    try {
      // Check testDbSetup.ts for environment variable usage
      const testDbSetupPath = 'tests/integration/utils/testDbSetup.ts';
      if (existsSync(testDbSetupPath)) {
        let content = readFileSync(testDbSetupPath, 'utf-8');

        // Fix TEST_DATABASE_URL vs DATABASE_URL inconsistency
        if (content.includes('TEST_DATABASE_URL')) {
          content = content.replace(
            'process.env.TEST_DATABASE_URL',
            '(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)'
          );
          writeFileSync(testDbSetupPath, content);
          this.logFix(
            'Environment Variables',
            'success',
            'Fixed TEST_DATABASE_URL fallback to DATABASE_URL'
          );
        } else {
          this.logFix('Environment Variables', 'skipped', 'No TEST_DATABASE_URL found to fix');
        }
      }

      // Ensure all integration tests use consistent database URL
      const integrationTestFiles = ['tests/integration/test-db-connection.test.ts'];

      for (const file of integrationTestFiles) {
        if (existsSync(file)) {
          let content = readFileSync(file, 'utf-8');

          // Ensure proper environment variable fallback
          if (content.includes("process.env.DATABASE_URL || 'file:./prisma/test.db'")) {
            content = content.replace(
              "process.env.DATABASE_URL || 'file:./prisma/test.db'",
              "(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/test.db')"
            );
            writeFileSync(file, content);
            this.logFix('Test Files', 'success', `Fixed environment variables in ${file}`);
          }
        }
      }
    } catch (error) {
      this.logFix(
        'Environment Variables',
        'failed',
        `Failed to fix environment variables: ${error}`
      );
    }
  }

  async createImprovedDbSetup(): Promise<void> {
    console.log('\n🗄️ Creating Improved Database Setup...');

    try {
      const improvedDbSetup = `#!/usr/bin/env tsx

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
    const dbUrl = process.env.TEST_DATABASE_URL || 
                  process.env.DATABASE_URL || 
                  \`file:./prisma/\${dbName}\`;
    
    this.dbPath = path.join(process.cwd(), 'prisma', dbName);
    
    this.prisma = new PrismaClient({
      datasources: {
        db: { url: dbUrl }
      },
      log: this.options.verbose ? ['query', 'info', 'warn', 'error'] : ['error']
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
      this.dbPath + '-shm'
    ];

    for (const file of dbFiles) {
      if (existsSync(file)) {
        try {
          unlinkSync(file);
          this.log(\`  Removed: \${path.basename(file)}\`);
        } catch (error) {
          console.warn(\`  Could not remove \${file}:\`, error);
        }
      }
    }
  }

  async initializeDatabase(): Promise<void> {
    this.log('📋 Initializing database with migrations...');
    
    try {
      // Run migrations for integration tests
      execSync('npx prisma migrate deploy', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 120000, // 2 minute timeout
        env: {
          ...process.env,
          DATABASE_URL: \`file:\${this.dbPath}\`
        }
      });
      
      // Generate Prisma client
      execSync('npx prisma generate', {
        stdio: this.options.verbose ? 'inherit' : 'pipe',
        timeout: 60000
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
        { name: 'Goal', fn: () => this.prisma.goal.count() }
      ];

      for (const table of tables) {
        try {
          await table.fn();
          this.log(\`  ✅ \${table.name} table accessible\`);
        } catch (error) {
          throw new Error(\`\${table.name} table inaccessible: \${error}\`);
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
          this.log(\`  Cleaned \${table} table\`);
        } catch (error) {
          console.warn(\`  Warning cleaning \${table}:\`, error);
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
    forceClean: args.includes('--force-clean')
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
if (import.meta.url === \`file://\${process.argv[1]}\`) {
  main().catch(error => {
    console.error('❌ CI integration database setup failed:', error);
    process.exit(1);
  });
}

export { CIIntegrationDBManager };
`;

      writeFileSync('scripts/ci-integration-db-setup.ts', improvedDbSetup);
      this.logFix(
        'Database Setup Script',
        'success',
        'Created enhanced CI integration database setup script'
      );
    } catch (error) {
      this.logFix(
        'Database Setup Script',
        'failed',
        `Failed to create database setup script: ${error}`
      );
    }
  }

  async updateJestConfiguration(): Promise<void> {
    console.log('\n⚙️ Updating Jest Configuration...');

    try {
      const jestConfigPath = 'jest.config.ci.js';
      if (existsSync(jestConfigPath)) {
        let content = readFileSync(jestConfigPath, 'utf-8');

        // Add database-specific setup
        if (!content.includes('globalTeardown')) {
          content = content.replace(
            "globalSetup: '<rootDir>/tests/setup/globalSetup.ts',",
            `globalSetup: '<rootDir>/tests/setup/globalSetup.ts',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.ts',`
          );
        }

        // Ensure proper environment variables
        if (!content.includes('TEST_DATABASE_URL')) {
          content = content.replace(
            "DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/test.db',",
            `DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/integration-test.db',
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'file:./prisma/integration-test.db',`
          );
        }

        writeFileSync(jestConfigPath, content);
        this.logFix(
          'Jest Configuration',
          'success',
          'Updated Jest config with database improvements'
        );
      }
    } catch (error) {
      this.logFix('Jest Configuration', 'failed', `Failed to update Jest configuration: ${error}`);
    }
  }

  async createGlobalTeardown(): Promise<void> {
    console.log('\n🧹 Creating Global Teardown...');

    try {
      const globalTeardown = `#!/usr/bin/env tsx

/**
 * Global Jest teardown for integration tests
 * Ensures proper cleanup after all tests complete
 */

import { CIIntegrationDBManager } from '../../scripts/ci-integration-db-setup.js';

export default async function globalTeardown() {
  console.log('🧹 Running global teardown for integration tests...');
  
  try {
    const manager = new CIIntegrationDBManager({ verbose: false });
    await manager.teardownForCI();
    console.log('✅ Global teardown completed successfully');
  } catch (error) {
    console.error('❌ Global teardown failed:', error);
    // Don't fail the test run if teardown fails
  }
}
`;

      writeFileSync('tests/setup/globalTeardown.ts', globalTeardown);
      this.logFix('Global Teardown', 'success', 'Created global teardown for proper cleanup');
    } catch (error) {
      this.logFix('Global Teardown', 'failed', `Failed to create global teardown: ${error}`);
    }
  }

  async updateCIWorkflow(): Promise<void> {
    console.log('\n🔄 Updating CI Workflow...');

    try {
      const ciWorkflowPath = '.github/workflows/ci.yml';
      if (existsSync(ciWorkflowPath)) {
        let content = readFileSync(ciWorkflowPath, 'utf-8');

        // Replace the integration test database setup with enhanced version
        if (content.includes('npm run ci-db-setup')) {
          content = content.replace(
            /- name: 🗄️ Setup database for integration tests\s+run: npm run ci-db-setup/g,
            `- name: 🗄️ Setup database for integration tests
        run: |
          # Use enhanced integration test database setup
          npm run ci-integration-db-setup setup --verbose
          
      - name: 🔍 Verify integration database setup
        run: npm run ci-integration-db-setup verify`
          );

          // Update the cleanup step
          content = content.replace(
            /- name: 🧹 Cleanup database after tests\s+if: always\(\)\s+run: npm run ci-db-teardown/g,
            `- name: 🧹 Cleanup integration database after tests
        if: always()
        run: npm run ci-integration-db-setup teardown`
          );

          writeFileSync(ciWorkflowPath, content);
          this.logFix('CI Workflow', 'success', 'Updated CI workflow with enhanced database setup');
        }
      }
    } catch (error) {
      this.logFix('CI Workflow', 'failed', `Failed to update CI workflow: ${error}`);
    }
  }

  async addNpmScripts(): Promise<void> {
    console.log('\n📝 Adding NPM Scripts...');

    try {
      const packageJsonPath = 'package.json';
      if (existsSync(packageJsonPath)) {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));

        // Add new scripts for integration test database management
        const newScripts = {
          'ci-integration-db-setup': 'tsx scripts/ci-integration-db-setup.ts setup',
          'ci-integration-db-clean': 'tsx scripts/ci-integration-db-setup.ts clean',
          'ci-integration-db-teardown': 'tsx scripts/ci-integration-db-setup.ts teardown',
          'ci-integration-db-verify': 'tsx scripts/ci-integration-db-setup.ts verify',
          'test:integration:db-setup': 'npm run ci-integration-db-setup',
          'test:integration:isolated':
            'npm run ci-integration-db-setup && npm run test:integration:ci && npm run ci-integration-db-teardown',
        };

        let added = 0;
        for (const [script, command] of Object.entries(newScripts)) {
          if (!packageJson.scripts[script]) {
            packageJson.scripts[script] = command;
            added++;
          }
        }

        if (added > 0) {
          writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
          this.logFix(
            'NPM Scripts',
            'success',
            `Added ${added} new npm scripts for integration test database management`
          );
        } else {
          this.logFix('NPM Scripts', 'skipped', 'All required npm scripts already exist');
        }
      }
    } catch (error) {
      this.logFix('NPM Scripts', 'failed', `Failed to add npm scripts: ${error}`);
    }
  }

  async createDatabaseIsolationFix(): Promise<void> {
    console.log('\n🔒 Creating Database Isolation Fix...');

    try {
      const isolationFix = `#!/usr/bin/env tsx

/**
 * Database Isolation Helper for Integration Tests
 * Ensures each test gets a clean database state
 */

import { PrismaClient } from '@prisma/client';

class DatabaseIsolationHelper {
  private static prismaInstance: PrismaClient | null = null;

  static getPrismaInstance(): PrismaClient {
    if (!this.prismaInstance) {
      const dbUrl = process.env.TEST_DATABASE_URL || 
                   process.env.DATABASE_URL || 
                   'file:./prisma/integration-test.db';
      
      this.prismaInstance = new PrismaClient({
        datasources: {
          db: { url: dbUrl }
        },
        log: process.env.DEBUG_TESTS ? ['query', 'error'] : ['error']
      });
    }
    return this.prismaInstance;
  }

  static async cleanDatabase(): Promise<void> {
    const prisma = this.getPrismaInstance();
    
    try {
      await prisma.$connect();
      
      // Use transaction for atomic cleanup
      await prisma.$transaction(async (tx) => {
        // Delete in order to respect foreign key constraints
        await tx.race.deleteMany();
        await tx.goal.deleteMany();
        await tx.run.deleteMany();
        await tx.user.deleteMany();
      });
      
    } catch (error) {
      console.error('Failed to clean database:', error);
      throw error;
    }
  }

  static async closeConnection(): Promise<void> {
    if (this.prismaInstance) {
      await this.prismaInstance.$disconnect();
      this.prismaInstance = null;
    }
  }
}

export { DatabaseIsolationHelper };
`;

      writeFileSync('tests/utils/databaseIsolation.ts', isolationFix);
      this.logFix(
        'Database Isolation',
        'success',
        'Created database isolation helper for better test isolation'
      );
    } catch (error) {
      this.logFix(
        'Database Isolation',
        'failed',
        `Failed to create database isolation helper: ${error}`
      );
    }
  }

  async runDiagnostics(): Promise<void> {
    console.log('\n🧪 Running Integration Test Diagnostics...');

    try {
      // Test the new database setup
      console.log('   Testing enhanced database setup...');
      execSync('npm run ci-integration-db-setup setup --verbose', {
        stdio: 'pipe',
        timeout: 60000,
      });

      // Verify database connectivity
      console.log('   Verifying database connectivity...');
      execSync('npm run ci-integration-db-setup verify', {
        stdio: 'pipe',
        timeout: 30000,
      });

      // Test cleanup
      console.log('   Testing database cleanup...');
      execSync('npm run ci-integration-db-setup teardown', {
        stdio: 'pipe',
        timeout: 30000,
      });

      this.logFix(
        'Integration Test Diagnostics',
        'success',
        'All database operations working correctly'
      );
    } catch (error: any) {
      if (error.message?.includes('no such table') || error.message?.includes('database')) {
        this.logFix(
          'Integration Test Diagnostics',
          'failed',
          'Database schema issues detected - check migrations'
        );
      } else {
        this.logFix(
          'Integration Test Diagnostics',
          'failed',
          `Diagnostics failed: ${error.message?.substring(0, 100)}...`
        );
      }
    }
  }

  async runAllFixes(): Promise<boolean> {
    console.log('Starting integration test database CI fixes...\\n');

    await this.fixEnvironmentVariableConsistency();
    await this.createImprovedDbSetup();
    await this.updateJestConfiguration();
    await this.createGlobalTeardown();
    await this.updateCIWorkflow();
    await this.addNpmScripts();
    await this.createDatabaseIsolationFix();
    await this.runDiagnostics();

    console.log('\\n📊 Fix Summary');
    console.log('='.repeat(30));

    const successful = this.fixes.filter(f => f.status === 'success').length;
    const failed = this.fixes.filter(f => f.status === 'failed').length;
    const skipped = this.fixes.filter(f => f.status === 'skipped').length;

    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⏭️ Skipped: ${skipped}`);

    if (failed === 0) {
      console.log('\\n🎉 All integration test database fixes applied successfully!');
    } else {
      console.log(`\\n🚨 ${failed} fixes failed. Please review the errors above.`);

      // Show failed fixes
      console.log('\\n❌ Failed Fixes:');
      this.fixes
        .filter(f => f.status === 'failed')
        .forEach(fix => {
          console.log(`  • ${fix.name}: ${fix.message}`);
        });
    }

    return failed === 0;
  }
}

// CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixer = new IntegrationTestDBFixer();

  fixer
    .runAllFixes()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Fix process failed:', error);
      process.exit(1);
    });
}

export { IntegrationTestDBFixer };
