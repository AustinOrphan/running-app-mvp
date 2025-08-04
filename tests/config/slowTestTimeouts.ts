/**
 * Slow Test Timeout Configuration
 *
 * Provides timeout configurations for tests that are known to be slow
 * or resource intensive, with appropriate CI adjustments.
 */

import { platformUtils } from '../utils/platformUtils';

// Base timeout multipliers for different test types
const TIMEOUT_MULTIPLIERS = {
  // E2E tests are naturally slower
  e2e: {
    base: 30000, // 30s locally
    ci: 90000, // 90s in CI
  },
  // Integration tests with database operations
  integration: {
    base: 15000, // 15s locally
    ci: 45000, // 45s in CI
  },
  // Unit tests with heavy computation
  heavy_unit: {
    base: 10000, // 10s locally
    ci: 30000, // 30s in CI
  },
  // Visual regression tests
  visual: {
    base: 20000, // 20s locally
    ci: 60000, // 60s in CI
  },
  // Performance tests
  performance: {
    base: 30000, // 30s locally
    ci: 120000, // 120s in CI
  },
};

/**
 * Get timeout for a specific test type
 */
export function getTestTimeout(testType: keyof typeof TIMEOUT_MULTIPLIERS): number {
  const config = TIMEOUT_MULTIPLIERS[testType];
  const baseTimeout = process.env.CI ? config.ci : config.base;

  // Apply platform-specific adjustments
  return platformUtils.getAdjustedTimeout(baseTimeout);
}

/**
 * Specific timeout configurations for known slow tests
 */
export const SLOW_TESTS_CONFIG = {
  // E2E tests that are known to be slow
  e2e: [
    'auth.test.ts',
    'auth-improved.test.ts',
    'dashboard.test.ts',
    'goals.test.ts',
    'runs.test.ts',
    'stats.test.ts',
    'accessibility.test.ts',
    'mobile-responsiveness.test.ts',
    'navigation-swipe.test.ts',
    'visual-regression.test.ts',
  ],

  // Integration tests with complex database operations
  integration: [
    'auth.test.ts',
    'goals-transactions.test.ts',
    'factory-system.test.ts',
    'fixtures-usage-example.test.ts',
  ],

  // Unit tests with heavy computations
  heavyUnit: ['clientLogger.test.ts', 'dataEncryption.test.ts', 'securityUtils.test.ts'],

  // Visual and performance tests
  visual: ['visual-regression.test.ts'],

  performance: ['performance-benchmark.ts', 'benchmark-database-performance.ts'],
};

/**
 * Individual test file specific timeout overrides
 * Use this for tests that need custom timeouts beyond their category defaults
 */
export const SPECIFIC_TEST_TIMEOUTS: Record<string, { local: number; ci: number }> = {
  // E2E tests with extra long operations
  'visual-regression.test.ts': {
    local: 45000, // 45s locally for screenshot comparisons
    ci: 120000, // 2 min in CI for slower screenshot processing
  },
  'accessibility.test.ts': {
    local: 40000, // 40s locally for axe-core analysis
    ci: 90000, // 90s in CI for comprehensive a11y checks
  },
  'mobile-responsiveness.test.ts': {
    local: 35000, // 35s locally for viewport changes
    ci: 75000, // 75s in CI for mobile emulation
  },

  // Integration tests with heavy database operations
  'factory-system.test.ts': {
    local: 25000, // 25s locally for complex factory operations
    ci: 60000, // 60s in CI for database-heavy operations
  },
  'goals-transactions.test.ts': {
    local: 30000, // 30s locally for transaction handling
    ci: 75000, // 75s in CI for complex transaction scenarios
  },

  // Unit tests with encryption/security operations
  'dataEncryption.test.ts': {
    local: 20000, // 20s locally for encryption operations
    ci: 45000, // 45s in CI for slower crypto operations
  },
  'securityUtils.test.ts': {
    local: 15000, // 15s locally for security checks
    ci: 35000, // 35s in CI for comprehensive security tests
  },

  // Performance benchmarks
  'performance-benchmark.ts': {
    local: 60000, // 60s locally for performance measurements
    ci: 180000, // 3 min in CI for stable performance metrics
  },
  'benchmark-database-performance.ts': {
    local: 45000, // 45s locally for database benchmarks
    ci: 120000, // 2 min in CI for database performance tests
  },
};

/**
 * Check if a test file is known to be slow
 */
export function isSlowTest(testFilePath: string): boolean {
  const filename = testFilePath.split('/').pop() || '';

  for (const [testType, files] of Object.entries(SLOW_TESTS_CONFIG)) {
    if (files.includes(filename)) {
      return true;
    }
  }

  return false;
}

/**
 * Get the appropriate timeout for a test file
 */
export function getTimeoutForTestFile(testFilePath: string): number {
  const filename = testFilePath.split('/').pop() || '';

  // First check for specific test timeout overrides
  const specificTimeout = SPECIFIC_TEST_TIMEOUTS[filename];
  if (specificTimeout) {
    const baseTimeout = process.env.CI ? specificTimeout.ci : specificTimeout.local;
    return platformUtils.getAdjustedTimeout(baseTimeout);
  }

  // Then check test type categories
  if (SLOW_TESTS_CONFIG.e2e.includes(filename)) {
    return getTestTimeout('e2e');
  }

  if (SLOW_TESTS_CONFIG.integration.includes(filename)) {
    return getTestTimeout('integration');
  }

  if (SLOW_TESTS_CONFIG.heavyUnit.includes(filename)) {
    return getTestTimeout('heavy_unit');
  }

  if (SLOW_TESTS_CONFIG.visual.includes(filename)) {
    return getTestTimeout('visual');
  }

  if (SLOW_TESTS_CONFIG.performance.includes(filename)) {
    return getTestTimeout('performance');
  }

  // Default timeout for regular tests - 30s global baseline
  const baseTimeout = 30000;
  return platformUtils.getAdjustedTimeout(baseTimeout);
}

/**
 * Jest/Vitest timeout helper for slow tests
 */
export function setSlowTestTimeout(testFilePath: string): void {
  const timeout = getTimeoutForTestFile(testFilePath);

  // Set Jest timeout if available
  if (typeof jest !== 'undefined' && jest.setTimeout) {
    jest.setTimeout(timeout);
  }

  // Set Vitest timeout if available
  if (typeof vi !== 'undefined' && vi.setConfig) {
    try {
      vi.setConfig({
        testTimeout: timeout,
        hookTimeout: Math.floor(timeout * 0.8), // 80% of test timeout
      });
    } catch (error) {
      // Config might not be mutable, that's okay
      console.warn('Could not set Vitest timeout:', error.message);
    }
  }

  if (process.env.DEBUG_TESTS) {
    console.log(`⏱️  Set timeout to ${timeout}ms for ${testFilePath}`);
  }
}

/**
 * Playwright timeout configuration helper
 */
export function getPlaywrightTimeouts() {
  return {
    // Test timeout
    timeout: getTestTimeout('e2e'),

    // Action timeouts
    actionTimeout: process.env.CI ? 20000 : 10000,
    navigationTimeout: process.env.CI ? 60000 : 30000,

    // Expect timeout
    expectTimeout: process.env.CI ? 45000 : 15000,

    // Web server startup timeout
    webServerTimeout: process.env.CI ? 180000 : 120000, // 3 min in CI, 2 min locally
  };
}

/**
 * Get specific timeout for an individual test within a file
 * Use this for setting timeouts on specific test cases that are particularly slow
 */
export function getSpecificTestTimeout(testFileName: string, testName?: string): number {
  const baseTimeout = getTimeoutForTestFile(testFileName);

  // Known slow individual test cases that need extra time beyond their file's timeout
  const slowTestCases: Record<string, Record<string, number>> = {
    'auth.test.ts': {
      'should handle complex authentication flow with encryption': 1.5, // 50% longer
      'should perform password reset with email verification': 1.3, // 30% longer
    },
    'visual-regression.test.ts': {
      'should capture full page screenshots across devices': 2.0, // 100% longer
      'should detect visual changes in components': 1.5, // 50% longer
    },
    'performance-benchmark.ts': {
      'should measure application startup performance': 2.5, // 150% longer
      'should benchmark database query performance': 2.0, // 100% longer
    },
    'accessibility.test.ts': {
      'should run comprehensive WCAG compliance checks': 1.8, // 80% longer
      'should test keyboard navigation across all components': 1.4, // 40% longer
    },
  };

  if (testName && slowTestCases[testFileName]?.[testName]) {
    const multiplier = slowTestCases[testFileName][testName];
    return Math.floor(baseTimeout * multiplier);
  }

  return baseTimeout;
}

/**
 * Utility to apply specific timeout to a test case
 * Usage: applyTestTimeout('auth.test.ts', 'slow auth test');
 */
export function applyTestTimeout(testFileName: string, testName?: string): void {
  const timeout = getSpecificTestTimeout(testFileName, testName);

  // Apply to Jest
  if (typeof jest !== 'undefined' && jest.setTimeout) {
    jest.setTimeout(timeout);
  }

  // Apply to Vitest
  if (typeof vi !== 'undefined' && vi.setConfig) {
    try {
      vi.setConfig({
        testTimeout: timeout,
        hookTimeout: Math.floor(timeout * 0.8),
      });
    } catch (error) {
      // Config might not be mutable
    }
  }

  if (process.env.DEBUG_TESTS) {
    console.log(
      `⏱️  Applied specific timeout ${timeout}ms for "${testName || 'test'}" in ${testFileName}`
    );
  }
}

/**
 * Export default timeout configurations
 */
export const slowTestTimeouts = {
  getTestTimeout,
  getTimeoutForTestFile,
  getSpecificTestTimeout,
  setSlowTestTimeout,
  applyTestTimeout,
  getPlaywrightTimeouts,
  isSlowTest,
  SLOW_TESTS_CONFIG,
  SPECIFIC_TEST_TIMEOUTS,
  TIMEOUT_MULTIPLIERS,
};

export default slowTestTimeouts;
