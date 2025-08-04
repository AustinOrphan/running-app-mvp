/**
 * CI Environment Setup
 *
 * This setup script is specifically designed for CI environments
 * and addresses common CI-specific issues:
 * - Environment variable configuration
 * - Database setup with proper permissions
 * - Timeout handling for slower CI environments
 * - Resource constraint management
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { platformUtils } from '../utils/platformUtils';

export class CIEnvironmentSetup {
  private static instance: CIEnvironmentSetup;

  public static getInstance(): CIEnvironmentSetup {
    if (!CIEnvironmentSetup.instance) {
      CIEnvironmentSetup.instance = new CIEnvironmentSetup();
    }
    return CIEnvironmentSetup.instance;
  }

  /**
   * Setup CI environment variables with proper defaults
   */
  public setupEnvironmentVariables(): void {
    // Set required environment variables if not already set
    // Use cross-platform database URL
    const dbUrl = platformUtils.createDatabaseUrl('test.db');

    const defaultEnvVars = platformUtils.createTestEnvironment({
      DATABASE_URL: dbUrl,
      JWT_SECRET: 'test-secret-key-for-ci-environment-must-be-longer-than-32-characters',
      BCRYPT_ROUNDS: '10', // Reduced for CI speed
      CI: 'true',
      // Disable certain features that can cause issues in CI
      DISABLE_RATE_LIMIT_IN_TESTS: 'true',
      RUN_MIGRATIONS: 'true', // Enable migrations in CI
      DEBUG_TESTS: 'false',
      // Performance tuning for CI
      NODE_OPTIONS: '--max-old-space-size=2048', // Limit memory usage
    });

    for (const [key, value] of Object.entries(defaultEnvVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }

    console.log('✅ CI environment variables configured');
  }

  /**
   * Setup database for CI environment
   */
  public async setupDatabase(): Promise<void> {
    try {
      // Use cross-platform path for database
      const dbPath = path.join(process.cwd(), 'prisma', 'test.db');
      const prismaDir = path.join(process.cwd(), 'prisma');

      // Remove existing database if it exists
      if (existsSync(dbPath)) {
        console.log('🗄️  Removing existing test database');
        try {
          // Use cross-platform remove command
          execSync(platformUtils.removeFileCommand(dbPath), { stdio: 'inherit' });
        } catch (error) {
          console.warn('⚠️  Could not remove existing database:', error);
        }
      }

      // Ensure prisma directory exists - cross platform
      if (!existsSync(prismaDir)) {
        execSync(platformUtils.createDirectoryCommand(prismaDir), { stdio: 'inherit' });
      }

      // Run database migrations
      console.log('🗄️  Running database migrations for CI');
      try {
        platformUtils.execCommand('npx prisma migrate deploy', {
          stdio: 'inherit',
          timeout: platformUtils.getAdjustedTimeout(30000),
        });
      } catch {
        console.warn('⚠️  Migration deploy failed, trying migrate dev');
        platformUtils.execCommand('npx prisma migrate dev --name ci-init', {
          stdio: 'inherit',
          timeout: platformUtils.getAdjustedTimeout(30000),
        });
      }

      // Generate Prisma client
      console.log('🗄️  Generating Prisma client');
      platformUtils.execCommand('npx prisma generate', {
        stdio: 'inherit',
        timeout: platformUtils.getAdjustedTimeout(30000),
      });

      console.log('✅ Database setup complete for CI');
    } catch (error) {
      console.error('❌ Database setup failed:', error);
      throw error;
    }
  }

  /**
   * Configure timeouts and resource limits for CI
   */
  public configureResourceLimits(): void {
    // Set test timeouts based on CI environment
    if (process.env.CI) {
      // Increase timeouts for slower CI environments
      if (typeof global !== 'undefined') {
        // Jest timeout
        if (typeof jest !== 'undefined') {
          jest.setTimeout(20000);
        }
      }

      // Set Node.js specific configurations for CI
      process.env.UV_THREADPOOL_SIZE = '4'; // Limit thread pool size
      process.env.NODE_OPTIONS = (process.env.NODE_OPTIONS || '') + ' --max-old-space-size=2048';
    }

    console.log('✅ Resource limits configured for CI');
  }

  /**
   * Setup CI-specific directories and permissions
   */
  public setupDirectories(): void {
    const directories = [
      'test-results',
      'coverage',
      'coverage-integration',
      'playwright-report',
      'prisma',
    ];

    for (const dir of directories) {
      try {
        // Use cross-platform directory creation
        execSync(platformUtils.createDirectoryCommand(dir), { stdio: 'inherit' });
      } catch (error) {
        console.warn(`⚠️  Could not create directory ${dir}:`, error);
      }
    }

    console.log('✅ CI directories setup complete');
  }

  /**
   * Validate CI environment setup
   */
  public validateSetup(): boolean {
    const requiredEnvVars = ['DATABASE_URL', 'JWT_SECRET', 'NODE_ENV'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      console.error('❌ Missing required environment variables:', missingVars);
      return false;
    }

    // Check if Prisma client is available
    try {
      require('@prisma/client');
      console.log('✅ Prisma client is available');
    } catch (error) {
      console.error('❌ Prisma client not available:', error);
      return false;
    }

    return true;
  }

  /**
   * Complete CI environment setup
   */
  public async setupComplete(): Promise<void> {
    console.log('🚀 Starting CI environment setup...');

    this.setupEnvironmentVariables();
    this.configureResourceLimits();
    this.setupDirectories();

    await this.setupDatabase();

    if (!this.validateSetup()) {
      throw new Error('CI environment setup validation failed');
    }

    console.log('🎉 CI environment setup complete!');
  }
}

// Auto-setup when imported in CI environment
if (process.env.CI && !process.env.SKIP_CI_SETUP) {
  const setup = CIEnvironmentSetup.getInstance();
  setup.setupComplete().catch(error => {
    console.error('❌ CI setup failed:', error);
    process.exit(1);
  });
}

export default CIEnvironmentSetup;
