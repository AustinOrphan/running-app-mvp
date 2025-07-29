/**
 * Vitest Retry Setup
 *
 * Configures Vitest with retry logic for flaky tests.
 * This setup file is loaded for each test file.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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
 * Custom test wrapper with retry logic for Vitest
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
      const retryCount = customRetries ?? getRetryCount(name, 'unit');
      const testKey = name;

      if (!globalThis.retryAttempts.has(testKey)) {
        globalThis.retryAttempts.set(testKey, 0);
      }

      let lastError: Error | undefined;
      let attempt = 0;
      const maxAttempts = retryCount > 0 ? retryCount + 1 : 1;

      while (attempt < maxAttempts) {
        try {
          globalThis.retryAttempts.set(testKey, attempt);

          // Add retry-specific setup
          if (attempt > 0) {
            console.log(`🔄 Retry attempt ${attempt}/${maxAttempts - 1} for: ${name}`);

            // Add delay between retries to avoid race conditions
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));

            // Clear any potential state issues
            if (globalThis.resetTestState) {
              await globalThis.resetTestState();
            }
          }

          // Run the actual test
          await testFn();

          // Test passed, log success if it was a retry
          if (attempt > 0) {
            console.log(`✅ Test passed on retry attempt ${attempt}: ${name}`);
          }

          // Track successful retry for reporting
          globalThis.flakyTestData.set(testKey, {
            name,
            attempts: attempt + 1,
            succeeded: true,
            isFlakyTest: isFlakyTest(name, 'unit'),
          });

          return; // Success!
        } catch (error) {
          lastError = error as Error;
          attempt++;

          // Track failed attempt
          globalThis.flakyTestData.set(testKey, {
            name,
            attempts: attempt,
            succeeded: false,
            lastError: lastError.message,
            isFlakyTest: isFlakyTest(name, 'unit'),
          });

          if (attempt >= maxAttempts) {
            console.log(`❌ Test failed after ${maxAttempts} attempts: ${name}`);
            break;
          }
        }
      }

      // All retries exhausted, throw the last error
      throw lastError;
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

// Auto-retry setup for known flaky tests
const originalTest = globalThis.test;
if (process.env.AUTO_RETRY_FLAKY_TESTS === 'true' && originalTest) {
  globalThis.test = (name: string, testFn: any, timeout?: number) => {
    if (isFlakyTest(name, 'unit')) {
      return testWithRetry(name, testFn, { timeout });
    }
    return originalTest(name, testFn, timeout);
  };
}

// Setup global test state management
beforeEach(() => {
  globalThis.testStartTime = Date.now();
});

afterEach(() => {
  // Track test duration for flaky test analysis
  // const duration = Date.now() - (globalThis.testStartTime || Date.now());
  // Note: Vitest doesn't have expect.getState() like Jest
  // We'll track this differently in the reporter
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
