/**
 * Jest Retry Setup
 *
 * Configures Jest with retry logic for flaky tests.
 * This setup file is loaded for each test file.
 */

const fs = require('fs');
const path = require('path');

// Track retry attempts globally
global.retryAttempts = new Map();
global.flakyTestData = new Map();

/**
 * Load flaky test configuration
 */
function loadFlakyTestConfig() {
  const configPath = path.join(process.cwd(), 'reports/flaky-tests/retry-config.json');

  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return config.flakyTests || [];
    } catch (error) {
      console.warn('Failed to load flaky test config:', error.message);
    }
  }

  return [];
}

/**
 * Check if a test is marked as flaky
 */
function isFlakyTest(testName, suiteName = '') {
  const flakyTests = loadFlakyTestConfig();
  const fullTestName = suiteName ? `${suiteName}:${testName}` : testName;

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
function getRetryCount(testName, suiteName = '') {
  const flakyTests = loadFlakyTestConfig();
  const fullTestName = suiteName ? `${suiteName}:${testName}` : testName;

  const flakyTest = flakyTests.find(
    test =>
      test.testId === fullTestName ||
      test.testId.includes(testName) ||
      testName.includes(test.testId.split(':')[1] || test.testId)
  );

  return flakyTest ? flakyTest.recommendedRetries : 0;
}

/**
 * Custom test wrapper with retry logic
 */
function testWithRetry(name, testFn, timeout) {
  const originalTest = global.test || global.it;

  return originalTest(
    name,
    async () => {
      const retryCount = getRetryCount(name, 'unit');
      const testKey = `${expect.getState().currentTestName || name}`;

      if (!global.retryAttempts.has(testKey)) {
        global.retryAttempts.set(testKey, 0);
      }

      let lastError;
      let attempt = 0;
      const maxAttempts = retryCount > 0 ? retryCount + 1 : 1;

      while (attempt < maxAttempts) {
        try {
          global.retryAttempts.set(testKey, attempt);

          // Add retry-specific setup
          if (attempt > 0) {
            console.log(`🔄 Retry attempt ${attempt}/${maxAttempts - 1} for: ${name}`);

            // Add delay between retries to avoid race conditions
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));

            // Clear any potential state issues
            if (global.resetTestState) {
              await global.resetTestState();
            }
          }

          // Run the actual test
          await testFn();

          // Test passed, log success if it was a retry
          if (attempt > 0) {
            console.log(`✅ Test passed on retry attempt ${attempt}: ${name}`);
          }

          // Track successful retry for reporting
          global.flakyTestData.set(testKey, {
            name,
            attempts: attempt + 1,
            succeeded: true,
            isFlakyTest: isFlakyTest(name, 'unit'),
          });

          return; // Success!
        } catch (error) {
          lastError = error;
          attempt++;

          // Track failed attempt
          global.flakyTestData.set(testKey, {
            name,
            attempts: attempt,
            succeeded: false,
            lastError: error.message,
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
    timeout
  );
}

// Override global test functions for retry support
if (process.env.ENABLE_TEST_RETRIES !== 'false') {
  global.retryTest = testWithRetry;

  // Optional: Override default test function
  if (process.env.AUTO_RETRY_FLAKY_TESTS === 'true') {
    const originalTest = global.test || global.it;
    global.test = global.it = (name, testFn, timeout) => {
      if (isFlakyTest(name, 'unit')) {
        return testWithRetry(name, testFn, timeout);
      }
      return originalTest(name, testFn, timeout);
    };
  }
}

// Setup test cleanup
beforeEach(() => {
  // Reset any test-specific state
  global.testStartTime = Date.now();
});

afterEach(() => {
  // Track test duration for flaky test analysis
  const duration = Date.now() - (global.testStartTime || Date.now());
  const testName = expect.getState().currentTestName;

  if (testName && global.flakyTestData.has(testName)) {
    const data = global.flakyTestData.get(testName);
    data.duration = duration;
    global.flakyTestData.set(testName, data);
  }
});

// Export retry utilities for manual use
module.exports = {
  testWithRetry,
  isFlakyTest,
  getRetryCount,
  loadFlakyTestConfig,
};

console.log('🔄 Jest retry setup loaded - flaky test retries enabled');
