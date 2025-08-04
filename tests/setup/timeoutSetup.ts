/**
 * Test Timeout Setup
 *
 * Automatically configures appropriate timeouts for different test types
 * and environments. This should be imported by test setup files.
 */

import { slowTestTimeouts } from '../config/slowTestTimeouts';
import { platformUtils } from '../utils/platformUtils';
import { retry, RetryOptions } from '../utils/retryUtils';

/**
 * Configure timeouts based on the current test environment
 */
export function configureTestTimeouts(): void {
  const platform = platformUtils.getPlatformInfo();

  // Determine if we're in a specific test framework
  const isJest = typeof jest !== 'undefined';
  const isVitest = typeof vi !== 'undefined';
  const isPlaywright = typeof expect !== 'undefined' && 'toHaveURL' in expect;

  // Apply global timeout configurations
  if (isJest) {
    configureJestTimeouts();
  }

  if (isVitest) {
    configureVitestTimeouts();
  }

  if (process.env.DEBUG_TESTS) {
    console.log(`🔧 Timeout configuration applied for ${platform.platform}`);
  }
}

/**
 * Configure Jest-specific timeouts
 */
function configureJestTimeouts(): void {
  // Default timeout for integration tests
  const defaultTimeout = slowTestTimeouts.getTestTimeout('integration');

  if (jest?.setTimeout) {
    jest.setTimeout(defaultTimeout);

    if (process.env.DEBUG_TESTS) {
      console.log(`⏱️  Jest default timeout set to ${defaultTimeout}ms`);
    }
  }
}

/**
 * Configure Vitest-specific timeouts
 */
function configureVitestTimeouts(): void {
  // 30s global baseline timeout
  const defaultTimeout = 30000;
  const adjustedTimeout = platformUtils.getAdjustedTimeout(defaultTimeout);

  try {
    if (vi?.setConfig) {
      vi.setConfig({
        testTimeout: adjustedTimeout,
        hookTimeout: Math.floor(adjustedTimeout * 0.8),
      });

      if (process.env.DEBUG_TESTS) {
        console.log(`⏱️  Vitest timeout set to ${adjustedTimeout}ms`);
      }
    }
  } catch (error) {
    // Config might not be mutable at this point
    if (process.env.DEBUG_TESTS) {
      console.warn('Could not set Vitest config:', error.message);
    }
  }
}

/**
 * Set timeout for a specific test file
 */
export function setTimeoutForFile(testFilePath: string): void {
  const filename = testFilePath.split('/').pop() || testFilePath;
  const timeout = slowTestTimeouts.getTimeoutForTestFile(filename);

  // Apply to Jest
  if (typeof jest !== 'undefined' && jest.setTimeout) {
    jest.setTimeout(timeout);
  }

  // Apply to Vitest
  if (typeof vi !== 'undefined') {
    try {
      vi.setConfig?.({
        testTimeout: timeout,
        hookTimeout: Math.floor(timeout * 0.8),
      });
    } catch (error) {
      // Ignore config errors
    }
  }

  if (process.env.DEBUG_TESTS) {
    console.log(`⏱️  File-specific timeout set to ${timeout}ms for ${filename}`);
  }
}

/**
 * Set timeout for a specific test case within a file
 * Usage: setTimeoutForTest('auth.test.ts', 'complex authentication flow');
 */
export function setTimeoutForTest(testFilePath: string, testName?: string): void {
  const filename = testFilePath.split('/').pop() || testFilePath;
  const timeout = slowTestTimeouts.getSpecificTestTimeout(filename, testName);

  // Apply to Jest
  if (typeof jest !== 'undefined' && jest.setTimeout) {
    jest.setTimeout(timeout);
  }

  // Apply to Vitest
  if (typeof vi !== 'undefined') {
    try {
      vi.setConfig?.({
        testTimeout: timeout,
        hookTimeout: Math.floor(timeout * 0.8),
      });
    } catch (error) {
      // Ignore config errors
    }
  }

  if (process.env.DEBUG_TESTS) {
    const testDescription = testName ? `"${testName}"` : 'test';
    console.log(
      `⏱️  Specific test timeout set to ${timeout}ms for ${testDescription} in ${filename}`
    );
  }
}

/**
 * Create a timeout helper for slow operations within tests
 */
export function createTimeoutHelper(baseTimeoutMs: number = 30000) {
  const adjustedTimeout = platformUtils.getAdjustedTimeout(baseTimeoutMs);

  return {
    timeout: adjustedTimeout,

    /**
     * Wait with timeout
     */
    waitFor: async <T>(
      operation: () => Promise<T>,
      description: string = 'operation'
    ): Promise<T> => {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`${description} timed out after ${adjustedTimeout}ms`));
        }, adjustedTimeout);

        operation()
          .then(result => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch(error => {
            clearTimeout(timer);
            reject(error);
          });
      });
    },

    /**
     * Retry operation with timeout and smart error detection
     */
    retry: async <T>(
      operation: () => Promise<T>,
      options: Partial<RetryOptions> = {}
    ): Promise<T> => {
      const retryOptions = {
        maxAttempts: 3,
        delayMs: 1000,
        description: 'operation',
        ...options,
      };

      return retry(operation, retryOptions);
    },

    /**
     * Wait for condition with retry logic
     */
    waitForCondition: async (
      condition: () => Promise<boolean> | boolean,
      options: { timeoutMs?: number; intervalMs?: number; description?: string } = {}
    ): Promise<void> => {
      const timeoutMs = options.timeoutMs || adjustedTimeout;
      const intervalMs = options.intervalMs || 100;
      const description = options.description || 'condition';
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        try {
          const result = await condition();
          if (result) {
            return;
          }
        } catch (error) {
          // Ignore errors during condition checking, continue polling
        }

        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }

      throw new Error(`${description} did not become true within ${timeoutMs}ms`);
    },
  };
}

/**
 * Environment-specific timeout recommendations
 */
export const TIMEOUT_RECOMMENDATIONS = {
  // Database operations (aligned with 30s baseline)
  database: {
    connect: 15000,
    query: 10000,
    migration: process.env.CI ? 60000 : 30000,
    cleanup: 20000,
  },

  // Network operations (aligned with 30s baseline)
  network: {
    request: 15000,
    upload: 30000,
    download: process.env.CI ? 45000 : 30000,
  },

  // File operations (aligned with 30s baseline)
  file: {
    read: 10000,
    write: 15000,
    large_operation: 30000,
  },

  // UI operations (for E2E tests) - aligned with 30s baseline
  ui: {
    load: 20000,
    animation: 5000,
    form_submission: 15000,
    navigation: 30000,
  },
};

/**
 * Get recommended timeout for a specific operation type
 */
export function getRecommendedTimeout(
  category: keyof typeof TIMEOUT_RECOMMENDATIONS,
  operation: string
): number {
  const categoryTimeouts = TIMEOUT_RECOMMENDATIONS[category] as Record<string, number>;
  const baseTimeout = categoryTimeouts[operation] || categoryTimeouts.default || 5000;

  return platformUtils.getAdjustedTimeout(baseTimeout);
}

/**
 * Auto-configure timeouts when imported
 */
if (!process.env.SKIP_TIMEOUT_SETUP) {
  configureTestTimeouts();
}

/**
 * Auto-detect and apply timeout for current test file
 * This uses stack trace analysis to determine the calling test file
 */
export function autoApplyTimeout(): void {
  try {
    const stack = new Error().stack;
    if (stack) {
      // Look for test files in the stack trace
      const testFileMatch = stack.match(/\/(\w+\.test\.(ts|js|tsx|jsx))/);
      if (testFileMatch) {
        const testFileName = testFileMatch[1];
        setTimeoutForFile(testFileName);
        return;
      }
    }
  } catch (error) {
    // Fallback to default timeout
    if (process.env.DEBUG_TESTS) {
      console.warn('Could not auto-detect test file for timeout setup:', error.message);
    }
  }

  // Apply default timeout if auto-detection fails
  const defaultTimeout = 30000;
  const adjustedTimeout = platformUtils.getAdjustedTimeout(defaultTimeout);

  if (typeof jest !== 'undefined' && jest.setTimeout) {
    jest.setTimeout(adjustedTimeout);
  }

  if (typeof vi !== 'undefined') {
    try {
      vi.setConfig?.({
        testTimeout: adjustedTimeout,
        hookTimeout: Math.floor(adjustedTimeout * 0.8),
      });
    } catch (error) {
      // Ignore config errors
    }
  }
}

/**
 * Wrapper for flaky test operations with built-in retry logic
 */
export function withRetry<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const defaultOptions: RetryOptions = {
    maxAttempts: process.env.CI ? 3 : 2, // More retries in CI
    delayMs: 1000,
    backoffMultiplier: 1.5,
    logRetries: !!process.env.CI || !!process.env.DEBUG_TESTS,
    description: 'test operation',
  };

  return retry(operation, { ...defaultOptions, ...options });
}

export default {
  configureTestTimeouts,
  setTimeoutForFile,
  setTimeoutForTest,
  autoApplyTimeout,
  createTimeoutHelper,
  getRecommendedTimeout,
  withRetry,
  TIMEOUT_RECOMMENDATIONS,
};
