/**
 * Jest retry setup for flaky test handling
 * Adds retry capability to Jest integration tests
 */

import { getRetryConfig, isRetryableError, calculateRetryDelay } from '../config/retry-config.js';

// Track test retry attempts
const testRetryAttempts = new Map<string, number>();

/**
 * Custom Jest test wrapper with retry logic
 */
function createRetryableTest(originalTest: any) {
  return function retryableTest(
    name: string,
    fn: jest.ProvidesCallback | undefined,
    timeout?: number
  ) {
    if (!fn) {
      return originalTest(name, fn, timeout);
    }

    return originalTest(
      name,
      async () => {
        const config = getRetryConfig('integration');
        const testKey = `${expect.getState().currentTestName || name}`;
        let attempt = 1;
        let lastError: Error | null = null;

        while (attempt <= config.maxRetries + 1) {
          try {
            testRetryAttempts.set(testKey, attempt);

            if (fn.length > 0) {
              // Callback-style test
              return new Promise<void>((resolve, _reject) => {
                (fn as jest.DoneCallback)(resolve);
              });
            } else {
              // Promise-style test
              return await (fn as () => Promise<void>)();
            }
          } catch (error) {
            lastError = error as Error;

            if (attempt <= config.maxRetries && isRetryableError(lastError, config)) {
              const delay = calculateRetryDelay(attempt, config);
              console.log(
                `🔄 Retry ${attempt}/${config.maxRetries} for test "${name}" after ${delay}ms:`,
                lastError.message.split('\n')[0] // Only first line of error
              );
              await new Promise(resolve => setTimeout(resolve, delay));
              attempt++;
            } else {
              break;
            }
          }
        }

        // If we get here, all retries failed
        if (lastError) {
          const finalAttempts = testRetryAttempts.get(testKey) || 1;
          if (finalAttempts > 1) {
            console.log(`❌ Test "${name}" failed after ${finalAttempts} attempts`);
          }
          throw lastError;
        }
      },
      timeout
    );
  };
}

/**
 * Setup retry logic for Jest
 */
function setupJestRetry() {
  // Only enable retries in CI or when explicitly requested
  const enableRetries = process.env.CI === 'true' || process.env.JEST_RETRY === 'true';

  if (!enableRetries) {
    return;
  }

  // Override global test functions with retry-enabled versions
  const originalIt = global.it;
  const originalTest = global.test;

  global.it = createRetryableTest(originalIt);
  global.test = createRetryableTest(originalTest);

  // Also handle describe blocks
  const originalDescribe = global.describe;
  global.describe = function (name: string, fn: () => void) {
    return originalDescribe(name, fn);
  };

  console.log('🔄 Jest retry logic enabled with up to 3 retries for flaky tests');
}

/**
 * Generate retry statistics report
 */
function generateRetryReport() {
  if (testRetryAttempts.size === 0) {
    return;
  }

  console.log('\n📊 Jest Test Retry Report:');
  console.log('==========================');

  const retriedTests = Array.from(testRetryAttempts.entries())
    .filter(([_, attempts]) => attempts > 1)
    .sort((a, b) => b[1] - a[1]);

  if (retriedTests.length === 0) {
    console.log('✅ No tests required retries');
    return;
  }

  console.log(`🔄 ${retriedTests.length} tests required retries:`);
  retriedTests.forEach(([testName, attempts]) => {
    console.log(`  - ${testName}: ${attempts} attempts`);
  });

  // Identify consistently flaky tests (requiring max retries)
  const config = getRetryConfig('integration');
  const flakyTests = retriedTests.filter(([_, attempts]) => attempts > config.maxRetries);

  if (flakyTests.length > 0) {
    console.log(`\n⚠️  Consistently flaky tests (${flakyTests.length}):`);
    flakyTests.forEach(([testName, attempts]) => {
      console.log(`  - ${testName}: ${attempts} attempts (investigate for stability)`);
    });
  }
}

// Setup retry logic when this module is imported
setupJestRetry();

// Generate retry report on process exit
process.on('exit', () => {
  generateRetryReport();
});

// Export for testing
export { testRetryAttempts, generateRetryReport };
