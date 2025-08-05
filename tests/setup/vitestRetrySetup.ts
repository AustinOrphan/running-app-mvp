/**
 * Vitest Retry Setup
 *
 * Configures Vitest with retry logic for flaky tests.
 * This setup file is loaded for each test file.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { retry, RetryOptions, RetryStats } from '../utils/retryUtils';

// Global retry tracking
declare global {
  var retryAttempts: Map<string, number>;
  var flakyTestData: Map<string, any>;
  var resetTestState: (() => Promise<void>) | undefined;
}

globalThis.retryAttempts = new Map();
globalThis.flakyTestData = new Map();

interface FlakyTestConfig {
  testId: string;
  suite: string;
  recommendedRetries: number;
  severity: string;
}

/**
 * Load flaky test configuration
 */
function loadFlakyTestConfig(): FlakyTestConfig[] {
  const configPath = join(process.cwd(), 'reports/flaky-tests/retry-config.json');

  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.flakyTests || [];
    } catch (error) {
      console.warn('Failed to load flaky test config:', error);
    }
  }

  return [];
}

/**
 * Check if a test is marked as flaky
 */
function isFlakyTest(testName: string, suiteName = 'unit'): boolean {
  const flakyTests = loadFlakyTestConfig();
  const fullTestName = `${suiteName}:${testName}`;

  return flakyTests.some(
    test =>
      test.testId === fullTestName ||
      test.testId.includes(testName) ||
      testName.includes(test.testId.split(':')[1] || test.testId)
  );
}

/**
 * Get recommended retry count for a test
 */
function getRetryCount(testName: string, suiteName = 'unit'): number {
  const flakyTests = loadFlakyTestConfig();
  const fullTestName = `${suiteName}:${testName}`;

  const flakyTest = flakyTests.find(
    test =>
      test.testId === fullTestName ||
      test.testId.includes(testName) ||
      testName.includes(test.testId.split(':')[1] || test.testId)
  );

  return flakyTest ? flakyTest.recommendedRetries : 0;
}

/**
 * Custom test wrapper with retry logic for Vitest using enhanced retry utils
 */
export function testWithRetry(
  name: string,
  testFn: () => Promise<void> | void,
  options?: { timeout?: number; retries?: number }
) {
  return test(
    name,
    async () => {
      const customRetries = options?.retries;
      const configuredRetries = customRetries ?? getRetryCount(name, 'unit');
      // ENFORCE MAXIMUM 3 ATTEMPTS TOTAL (2 retries + 1 original)
      const retryCount = Math.min(configuredRetries, 3);
      const testKey = name;
      const maxAttempts = retryCount;

      // Use the enhanced retry utility with smart error detection
      const retryOptions: RetryOptions = {
        maxAttempts,
        delayMs: 1000,
        backoffMultiplier: 1.5,
        logRetries: !!process.env.CI || !!process.env.DEBUG_TESTS,
        description: `test "${name}"`,
        shouldRetry: (error: unknown, attempt: number) => {
          // Don't retry assertion failures for unit tests
          if (error instanceof Error) {
            const message = error.message.toLowerCase();
            if (
              message.includes('expected') ||
              message.includes('assertion') ||
              message.includes('toequal') ||
              message.includes('tocontain') ||
              message.includes('tobe')
            ) {
              return false; // Don't retry assertion failures
            }
          }

          return attempt < maxAttempts;
        },
      };

      try {
        await retry(async () => {
          // Clear any potential state issues before retry
          if (globalThis.retryAttempts.get(testKey) > 0 && globalThis.resetTestState) {
            await globalThis.resetTestState();
          }

          // Run the actual test
          await testFn();

          // Track attempt count
          const currentAttempt = globalThis.retryAttempts.get(testKey) || 0;
          globalThis.retryAttempts.set(testKey, currentAttempt + 1);
        }, retryOptions);

        // Test succeeded - record stats
        const attempts = globalThis.retryAttempts.get(testKey) || 1;
        RetryStats.recordAttempt(testKey, attempts, true);

        globalThis.flakyTestData.set(testKey, {
          name,
          attempts,
          succeeded: true,
          isFlakyTest: isFlakyTest(name, 'unit'),
        });
      } catch (error) {
        // Test failed - record stats
        const attempts = globalThis.retryAttempts.get(testKey) || maxAttempts;
        RetryStats.recordAttempt(testKey, attempts, false);

        globalThis.flakyTestData.set(testKey, {
          name,
          attempts,
          succeeded: false,
          lastError: error instanceof Error ? error.message : String(error),
          isFlakyTest: isFlakyTest(name, 'unit'),
        });

        throw error;
      }
    },
    options?.timeout
  );
}

/**
 * Retry wrapper for describe blocks
 */
export function describeWithRetry(
  name: string,
  suiteFn: () => void,
  _options?: { retries?: number }
) {
  return describe(name, () => {
    // Set default retry count for all tests in this suite
    // const defaultRetries = options?.retries ?? 2;

    beforeEach(() => {
      // Setup retry context for each test
      globalThis.testStartTime = Date.now();
    });

    afterEach(() => {
      // Track test duration for flaky test analysis
      const duration = Date.now() - (globalThis.testStartTime || Date.now());
      const testName = expect.getState()?.currentTestName;

      if (testName && globalThis.flakyTestData.has(testName)) {
        const data = globalThis.flakyTestData.get(testName);
        data.duration = duration;
        globalThis.flakyTestData.set(testName, data);
      }
    });

    suiteFn();
  });
}

// Auto-retry setup for known flaky tests with enhanced configuration
const originalTest = globalThis.test;
if ((process.env.AUTO_RETRY_FLAKY_TESTS === 'true' || process.env.CI) && originalTest) {
  globalThis.test = (name: string, testFn: any, timeout?: number) => {
    const isFlaky = isFlakyTest(name, 'unit');
    const ciRetries = process.env.CI ? 2 : 0; // Default 2 retries in CI

    if (isFlaky || ciRetries > 0) {
      const retries = isFlaky ? getRetryCount(name, 'unit') : ciRetries;
      return testWithRetry(name, testFn, { timeout, retries });
    }
    return originalTest(name, testFn, timeout);
  };

  if (process.env.DEBUG_TESTS) {
    console.log('🔄 Auto-retry enabled for flaky tests and CI environment');
  }
}

// Setup global test state management
beforeEach(() => {
  globalThis.testStartTime = Date.now();
});

afterEach(() => {
  // Track test duration for flaky test analysis

  // Generate retry report if enabled
  if (process.env.DEBUG_TESTS && RetryStats.getStats().size > 0) {
    const flakyTests = RetryStats.getFlakyTests();
    if (flakyTests.length > 0) {
      console.log(
        `🔄 Flaky tests detected: ${flakyTests.slice(0, 3).join(', ')}${flakyTests.length > 3 ? '...' : ''}`
      );
    }
  }
});

// Export utilities
export { isFlakyTest, getRetryCount, loadFlakyTestConfig };

console.log('🔄 Vitest retry setup loaded - flaky test retries enabled');

// Type declarations for better TypeScript support
declare global {
  var testStartTime: number;
}

// Add utility types for retry testing
export type RetryTestFn = (
  name: string,
  testFn: () => Promise<void> | void,
  options?: {
    timeout?: number;
    retries?: number;
  }
) => void;

export type RetryDescribeFn = (
  name: string,
  suiteFn: () => void,
  options?: {
    retries?: number;
  }
) => void;
