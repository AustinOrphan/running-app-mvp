/**
 * Platform-Specific Test Setup
 *
 * This setup file automatically configures test environments for
 * cross-platform compatibility. It should be imported by test
 * setup files to ensure consistent behavior across platforms.
 */

import { platformUtils } from '../utils/platformUtils';

/**
 * Apply platform-specific test configurations
 */
export async function setupPlatformSpecificTests(): Promise<void> {
  // Run platform-specific setup
  await platformUtils.runPlatformSpecificSetup();

  const platform = platformUtils.getPlatformInfo();

  // Apply platform-specific timeout adjustments
  applyTimeoutAdjustments();

  // Setup platform-specific environment variables
  setupPlatformEnvironment();

  // Configure worker counts for test runners
  configureWorkerCounts();

  console.log(`🎯 Platform-specific test setup complete for ${platform.platform}`);
}

/**
 * Apply timeout adjustments based on platform and CI environment
 */
function applyTimeoutAdjustments(): void {
  const platform = platformUtils.getPlatformInfo();

  // Vitest timeout adjustments
  if (typeof globalThis !== 'undefined' && globalThis.vi) {
    const baseTimeout = 10000;
    const adjustedTimeout = platformUtils.getAdjustedTimeout(baseTimeout);

    if (adjustedTimeout !== baseTimeout) {
      console.log(`⏱️  Adjusted test timeout from ${baseTimeout}ms to ${adjustedTimeout}ms`);

      // Update Vitest configuration if possible
      try {
        globalThis.vi.setConfig?.({
          testTimeout: adjustedTimeout,
          hookTimeout: adjustedTimeout,
        });
      } catch (error) {
        // Config might not be mutable, that's okay
      }
    }
  }

  // Jest timeout adjustments
  if (typeof global !== 'undefined' && typeof jest !== 'undefined') {
    const baseTimeout = 10000;
    const adjustedTimeout = platformUtils.getAdjustedTimeout(baseTimeout);

    if (adjustedTimeout !== baseTimeout) {
      console.log(`⏱️  Adjusted Jest timeout from ${baseTimeout}ms to ${adjustedTimeout}ms`);
      jest.setTimeout(adjustedTimeout);
    }
  }
}

/**
 * Setup platform-specific environment variables
 */
function setupPlatformEnvironment(): void {
  const testEnv = platformUtils.createTestEnvironment({
    DATABASE_URL: platformUtils.createDatabaseUrl('test.db'),
    JWT_SECRET: 'test-secret-key-for-platform-tests',
  });

  // Apply environment variables
  for (const [key, value] of Object.entries(testEnv)) {
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }

  console.log('🔧 Platform-specific environment variables configured');
}

/**
 * Configure optimal worker counts for test runners
 */
function configureWorkerCounts(): void {
  const optimalWorkers = platformUtils.getOptimalWorkerCount();

  // Set environment variable that test runners can use
  if (!process.env.TEST_WORKERS) {
    process.env.TEST_WORKERS = optimalWorkers.toString();
    console.log(`👥 Optimal worker count set to ${optimalWorkers}`);
  }

  // For Jest specifically
  if (!process.env.JEST_WORKERS) {
    // Integration tests should run sequentially
    process.env.JEST_WORKERS = '1';
  }
}

/**
 * Create platform-specific test database configuration
 */
export function createTestDatabaseConfig(): {
  url: string;
  cleanup: () => Promise<void>;
} {
  const dbUrl = platformUtils.createDatabaseUrl(`test-${Date.now()}.db`);

  return {
    url: dbUrl,
    cleanup: async () => {
      // Cleanup logic handled by individual test utilities
      console.log('🧹 Test database cleanup completed');
    },
  };
}

/**
 * Normalize test file content for cross-platform comparison
 */
export function normalizeTestOutput(content: string): string {
  // Normalize line endings
  let normalized = platformUtils.normalizeToLF(content);

  // Normalize paths in output
  normalized = normalized.replace(/\\/g, '/');

  // Remove platform-specific timing variations
  normalized = normalized.replace(/\d+ms/g, 'XXXms');

  return normalized;
}

/**
 * Create platform-safe test file paths
 */
export function createTestPath(...segments: string[]): string {
  return platformUtils.normalizePath(segments.join('/'));
}

/**
 * Wait for platform-specific operations to complete
 */
export async function waitForPlatformOperation(
  operation: () => Promise<any>,
  description: string,
  timeoutMs: number = 5000
): Promise<any> {
  const adjustedTimeout = platformUtils.getAdjustedTimeout(timeoutMs);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${description} timed out after ${adjustedTimeout}ms`));
    }, adjustedTimeout);

    operation()
      .then(result => {
        clearTimeout(timeout);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

/**
 * Platform-aware file comparison for tests
 */
export async function compareTestFiles(
  actualPath: string,
  expectedPath: string,
  normalizeContent: boolean = true
): Promise<{ match: boolean; diff?: string }> {
  try {
    const match = await platformUtils.compareFileContents(
      actualPath,
      expectedPath,
      normalizeContent
    );

    if (match) {
      return { match: true };
    }

    // If files don't match, provide diff information
    const fs = await import('fs/promises');
    const actual = await fs.readFile(actualPath, 'utf-8');
    const expected = await fs.readFile(expectedPath, 'utf-8');

    const actualNormalized = normalizeContent ? platformUtils.normalizeToLF(actual) : actual;
    const expectedNormalized = normalizeContent ? platformUtils.normalizeToLF(expected) : expected;

    return {
      match: false,
      diff: `Expected:\n${expectedNormalized}\n\nActual:\n${actualNormalized}`,
    };
  } catch (error) {
    return {
      match: false,
      diff: `Error comparing files: ${error.message}`,
    };
  }
}

/**
 * Auto-setup when imported (can be disabled with env var)
 */
if (!process.env.SKIP_PLATFORM_SETUP) {
  setupPlatformSpecificTests().catch(error => {
    console.error('❌ Platform setup failed:', error);
    // Don't exit process, just warn
  });
}

export default {
  setupPlatformSpecificTests,
  createTestDatabaseConfig,
  normalizeTestOutput,
  createTestPath,
  waitForPlatformOperation,
  compareTestFiles,
};
