/**
 * Test Environment Validation Utility
 * Validates test environment configuration to prevent test failures
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  recommendations: string[];
}

interface TestConfig {
  requiredEnvVars: string[];
  optionalEnvVars: string[];
  requiredFiles: string[];
  requiredDirectories: string[];
  databaseConfig?: {
    url?: string;
    provider?: string;
  };
  mockServiceConfig?: {
    enabled: boolean;
    port?: number;
  };
}

/**
 * Default test environment configuration
 */
const DEFAULT_TEST_CONFIG: TestConfig = {
  requiredEnvVars: [
    'NODE_ENV',
  ],
  optionalEnvVars: [
    'DATABASE_URL',
    'TEST_DATABASE_URL', 
    'RATE_LIMITING_ENABLED',
    'JWT_SECRET',
    'BCRYPT_ROUNDS',
    'API_BASE_URL',
    'CI',
  ],
  requiredFiles: [
    'package.json',
    'tsconfig.json',
    'vitest.config.ts',
    'playwright.config.ts',
  ],
  requiredDirectories: [
    'tests',
    'tests/unit',
    'tests/e2e',
    'tests/fixtures',
    'tests/setup',
    'src',
  ],
};

export class TestEnvironmentValidator {
  private config: TestConfig;
  private projectRoot: string;

  constructor(config: TestConfig = DEFAULT_TEST_CONFIG, projectRoot: string = process.cwd()) {
    this.config = config;
    this.projectRoot = projectRoot;
  }

  /**
   * Validate the complete test environment
   */
  async validateEnvironment(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    // Validate environment variables
    const envResult = this.validateEnvironmentVariables();
    this.mergeResults(result, envResult);

    // Validate file structure
    const fileResult = this.validateFileStructure();
    this.mergeResults(result, fileResult);

    // Validate database configuration
    const dbResult = await this.validateDatabaseConfig();
    this.mergeResults(result, dbResult);

    // Validate Node.js and npm versions
    const nodeResult = await this.validateNodeEnvironment();
    this.mergeResults(result, nodeResult);

    // Validate test dependencies
    const depsResult = await this.validateTestDependencies();
    this.mergeResults(result, depsResult);

    // Validate rate limiting configuration
    const rateLimitResult = this.validateRateLimitingConfig();
    this.mergeResults(result, rateLimitResult);

    // Validate mock service configuration
    const mockResult = this.validateMockServiceConfig();
    this.mergeResults(result, mockResult);

    // Set overall validity
    result.isValid = result.errors.length === 0;

    return result;
  }

  /**
   * Validate environment variables
   */
  private validateEnvironmentVariables(): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    // Check required environment variables
    for (const envVar of this.config.requiredEnvVars) {
      if (!process.env[envVar]) {
        result.errors.push(`Required environment variable ${envVar} is not set`);
      }
    }

    // Check optional environment variables and provide recommendations
    for (const envVar of this.config.optionalEnvVars) {
      if (!process.env[envVar]) {
        switch (envVar) {
          case 'RATE_LIMITING_ENABLED':
            result.recommendations.push(
              'Set RATE_LIMITING_ENABLED=false in test environment to avoid rate limit interference'
            );
            break;
          case 'TEST_DATABASE_URL':
            result.warnings.push(
              'TEST_DATABASE_URL not set - tests may use production database'
            );
            break;
          case 'JWT_SECRET':
            result.warnings.push(
              'JWT_SECRET not set - authentication tests may fail'
            );
            break;
          default:
            result.recommendations.push(`Consider setting ${envVar} for better test reliability`);
        }
      }
    }

    // Validate NODE_ENV
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv && !['test', 'development'].includes(nodeEnv)) {
      result.warnings.push(
        `NODE_ENV is set to '${nodeEnv}'. Consider using 'test' for test environment`
      );
    }

    return result;
  }

  /**
   * Validate required files and directories exist
   */
  private validateFileStructure(): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    // Check required files
    for (const file of this.config.requiredFiles) {
      const filePath = join(this.projectRoot, file);
      if (!existsSync(filePath)) {
        result.errors.push(`Required file not found: ${file}`);
      }
    }

    // Check required directories
    for (const dir of this.config.requiredDirectories) {
      const dirPath = join(this.projectRoot, dir);
      if (!existsSync(dirPath)) {
        result.errors.push(`Required directory not found: ${dir}`);
      }
    }

    // Check for common test files
    const commonTestFiles = [
      'tests/setup/testSetup.ts',
      'tests/fixtures/mockData.ts',
      'tests/utils/mockApiUtils.ts',
    ];

    for (const file of commonTestFiles) {
      const filePath = join(this.projectRoot, file);
      if (!existsSync(filePath)) {
        result.recommendations.push(`Consider creating ${file} for better test organization`);
      }
    }

    return result;
  }

  /**
   * Validate database configuration
   */
  private async validateDatabaseConfig(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    const databaseUrl = process.env.DATABASE_URL || process.env.TEST_DATABASE_URL;
    
    if (!databaseUrl) {
      result.warnings.push('No database URL configured - database tests may fail');
      return result;
    }

    try {
      // Basic URL validation
      new URL(databaseUrl);
      
      // Check if it's a test database
      if (!databaseUrl.includes('test') && !databaseUrl.includes('_test')) {
        result.warnings.push(
          'Database URL does not appear to be a test database. ' +
          'Ensure you are not using production data.'
        );
      }

      // Check database provider
      if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
        result.recommendations.push('PostgreSQL detected - ensure test database is properly isolated');
      } else if (databaseUrl.startsWith('mysql://')) {
        result.recommendations.push('MySQL detected - ensure test database is properly isolated');
      } else if (databaseUrl.startsWith('sqlite:')) {
        result.recommendations.push('SQLite detected - good for testing but ensure file cleanup');
      }

    } catch (error) {
      result.errors.push(`Invalid database URL format: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Validate Node.js and npm environment
   */
  private async validateNodeEnvironment(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    try {
      // Check Node.js version
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      
      if (majorVersion < 18) {
        result.warnings.push(`Node.js version ${nodeVersion} is older than recommended (18+)`);
      }

      // Check if package.json exists and has test scripts
      const packageJsonPath = join(this.projectRoot, 'package.json');
      if (existsSync(packageJsonPath)) {
        try {
          const packageJsonContent = readFileSync(packageJsonPath, 'utf-8');
          const packageJson = JSON.parse(packageJsonContent);
          
          if (!packageJson.scripts?.test) {
            result.warnings.push('No test script found in package.json');
          }
          
          if (!packageJson.scripts?.['test:e2e']) {
            result.recommendations.push('Consider adding test:e2e script for E2E tests');
          }
          
          if (!packageJson.scripts?.['test:unit']) {
            result.recommendations.push('Consider adding test:unit script for unit tests');
          }

          // Check for essential test dependencies
          const testDeps = [
            'vitest',
            '@playwright/test',
            '@testing-library/react',
            '@testing-library/jest-dom',
          ];

          const allDeps = {
            ...packageJson.dependencies,
            ...packageJson.devDependencies,
          };

          for (const dep of testDeps) {
            if (!allDeps[dep]) {
              result.recommendations.push(`Consider adding ${dep} for comprehensive testing`);
            }
          }

        } catch (error) {
          result.errors.push(`Error reading package.json: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

    } catch (error) {
      result.errors.push(`Error validating Node environment: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return result;
  }

  /**
   * Validate test dependencies are installed
   */
  private async validateTestDependencies(): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    const nodeModulesPath = join(this.projectRoot, 'node_modules');
    
    if (!existsSync(nodeModulesPath)) {
      result.errors.push('node_modules directory not found. Run npm install.');
      return result;
    }

    // Check for critical test dependencies
    const criticalDeps = ['vitest', '@playwright/test'];
    
    for (const dep of criticalDeps) {
      const depPath = join(nodeModulesPath, dep);
      if (!existsSync(depPath)) {
        result.errors.push(`Critical test dependency ${dep} not installed`);
      }
    }

    return result;
  }

  /**
   * Validate rate limiting configuration for tests
   */
  private validateRateLimitingConfig(): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    const rateLimitingEnabled = process.env.RATE_LIMITING_ENABLED;
    
    if (rateLimitingEnabled === 'true') {
      result.warnings.push(
        'Rate limiting is enabled in test environment. ' +
        'This may cause test failures due to rate limit hits. ' +
        'Consider setting RATE_LIMITING_ENABLED=false'
      );
    }

    if (rateLimitingEnabled === undefined) {
      result.recommendations.push(
        'Set RATE_LIMITING_ENABLED=false explicitly to ensure consistent test behavior'
      );
    }

    return result;
  }

  /**
   * Validate mock service configuration
   */
  private validateMockServiceConfig(): ValidationResult {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      recommendations: [],
    };

    // Check for mock server setup
    const mockServerPath = join(this.projectRoot, 'tests/setup/mockServer.ts');
    
    if (existsSync(mockServerPath)) {
      result.recommendations.push('Mock server setup detected - ensure it\'s properly configured for test isolation');
    } else {
      result.recommendations.push('Consider setting up a mock server for API testing isolation');
    }

    return result;
  }

  /**
   * Merge validation results
   */
  private mergeResults(target: ValidationResult, source: ValidationResult): void {
    target.errors.push(...source.errors);
    target.warnings.push(...source.warnings);
    target.recommendations.push(...source.recommendations);
  }

  /**
   * Generate a formatted report
   */
  generateReport(result: ValidationResult): string {
    const lines: string[] = [];
    
    lines.push('🧪 Test Environment Validation Report');
    lines.push('=====================================');
    lines.push('');
    
    if (result.isValid) {
      lines.push('✅ Environment validation PASSED');
    } else {
      lines.push('❌ Environment validation FAILED');
    }
    lines.push('');

    if (result.errors.length > 0) {
      lines.push('🚨 ERRORS (must be fixed):');
      result.errors.forEach(error => lines.push(`  ❌ ${error}`));
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push('⚠️  WARNINGS (should be addressed):');
      result.warnings.forEach(warning => lines.push(`  ⚠️  ${warning}`));
      lines.push('');
    }

    if (result.recommendations.length > 0) {
      lines.push('💡 RECOMMENDATIONS (optional improvements):');
      result.recommendations.forEach(rec => lines.push(`  💡 ${rec}`));
      lines.push('');
    }

    if (result.isValid && result.warnings.length === 0 && result.recommendations.length === 0) {
      lines.push('🎉 Perfect! Your test environment is optimally configured.');
    }

    return lines.join('\n');
  }
}

/**
 * CLI interface for environment validation
 */
export async function validateTestEnvironment(): Promise<void> {
  const validator = new TestEnvironmentValidator();
  const result = await validator.validateEnvironment();
  
  console.log(validator.generateReport(result));
  
  if (!result.isValid) {
    process.exit(1);
  }
}

// Export for use in test setup
export { DEFAULT_TEST_CONFIG, type TestConfig, type ValidationResult };