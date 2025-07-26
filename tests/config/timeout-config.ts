/**
 * Centralized timeout configuration for all test types
 * Provides consistent timeout values across unit, integration, and E2E tests
 */

export interface TimeoutConfig {
  test: number;
  hook: number;
  action: number;
  navigation: number;
  expect: number;
  global?: number;
}

/**
 * Get timeout configuration based on test type and environment
 */
export function getTimeoutConfig(testType: 'unit' | 'integration' | 'e2e'): TimeoutConfig {
  const isCI = process.env.CI === 'true' || !!process.env.CI;

  // Base timeout multiplier for CI
  const ciMultiplier = 3; // 3x slower in CI

  const baseConfigs: Record<typeof testType, TimeoutConfig> = {
    unit: {
      test: 10000, // 10 seconds
      hook: 5000, // 5 seconds
      action: 5000, // 5 seconds
      navigation: 10000, // 10 seconds
      expect: 5000, // 5 seconds
    },
    integration: {
      test: 15000, // 15 seconds
      hook: 10000, // 10 seconds
      action: 10000, // 10 seconds
      navigation: 20000, // 20 seconds
      expect: 10000, // 10 seconds
    },
    e2e: {
      test: 30000, // 30 seconds
      hook: 15000, // 15 seconds
      action: 10000, // 10 seconds
      navigation: 30000, // 30 seconds
      expect: 15000, // 15 seconds
      global: 600000, // 10 minutes total
    },
  };

  const config = baseConfigs[testType];

  // Apply CI multiplier if in CI environment
  if (isCI) {
    return {
      test: config.test * ciMultiplier,
      hook: config.hook * ciMultiplier,
      action: config.action * 1.5, // Less multiplier for actions
      navigation: config.navigation * 1.5, // Less multiplier for navigation
      expect: config.expect * 2, // 2x for assertions
      global: config.global ? config.global * 1.5 : undefined,
    };
  }

  return config;
}

/**
 * Vitest timeout configuration
 */
export function getVitestTimeouts() {
  const config = getTimeoutConfig('unit');
  return {
    testTimeout: config.test,
    hookTimeout: config.hook,
  };
}

/**
 * Jest timeout configuration
 */
export function getJestTimeouts() {
  const config = getTimeoutConfig('integration');
  return {
    testTimeout: config.test,
    // Jest doesn't have separate hook timeout
  };
}

/**
 * Playwright timeout configuration
 */
export function getPlaywrightTimeouts() {
  const config = getTimeoutConfig('e2e');
  return {
    timeout: config.test,
    globalTimeout: config.global,
    use: {
      actionTimeout: config.action,
      navigationTimeout: config.navigation,
    },
    expect: {
      timeout: config.expect,
    },
  };
}

/**
 * Dynamic timeout adjustment based on specific conditions
 */
export function adjustTimeout(
  baseTimeout: number,
  conditions: {
    isDatabase?: boolean;
    isNetwork?: boolean;
    isFileIO?: boolean;
    isBrowser?: boolean;
  }
): number {
  let timeout = baseTimeout;

  // Add extra time for specific operations
  if (conditions.isDatabase) {
    timeout *= 1.5; // 50% more for database operations
  }

  if (conditions.isNetwork) {
    timeout *= 2; // 100% more for network operations
  }

  if (conditions.isFileIO) {
    timeout *= 1.3; // 30% more for file I/O
  }

  if (conditions.isBrowser) {
    timeout *= 1.5; // 50% more for browser operations
  }

  // Apply CI multiplier if needed
  if (process.env.CI) {
    timeout *= 1.5; // Additional 50% for CI
  }

  return Math.ceil(timeout);
}

/**
 * Timeout presets for common operations
 */
export const TIMEOUT_PRESETS = {
  // Database operations
  dbConnect: adjustTimeout(5000, { isDatabase: true }),
  dbQuery: adjustTimeout(3000, { isDatabase: true }),
  dbMigration: adjustTimeout(30000, { isDatabase: true }),

  // API operations
  apiRequest: adjustTimeout(5000, { isNetwork: true }),
  apiAuth: adjustTimeout(10000, { isNetwork: true }),
  apiUpload: adjustTimeout(30000, { isNetwork: true, isFileIO: true }),

  // Browser operations
  pageLoad: adjustTimeout(10000, { isBrowser: true, isNetwork: true }),
  elementVisible: adjustTimeout(5000, { isBrowser: true }),
  formSubmit: adjustTimeout(8000, { isBrowser: true, isNetwork: true }),

  // File operations
  fileRead: adjustTimeout(2000, { isFileIO: true }),
  fileWrite: adjustTimeout(3000, { isFileIO: true }),
  fileLarge: adjustTimeout(10000, { isFileIO: true }),
};

/**
 * Get timeout for specific operation
 */
export function getOperationTimeout(operation: keyof typeof TIMEOUT_PRESETS): number {
  return TIMEOUT_PRESETS[operation] || 10000;
}

/**
 * Log timeout configuration (for debugging)
 */
export function logTimeoutConfig(testType: 'unit' | 'integration' | 'e2e'): void {
  const config = getTimeoutConfig(testType);
  const isCI = process.env.CI === 'true' || !!process.env.CI;

  console.log(`\nTimeout Configuration for ${testType} tests (CI: ${isCI}):`);
  console.log(`  Test timeout: ${config.test}ms`);
  console.log(`  Hook timeout: ${config.hook}ms`);
  console.log(`  Action timeout: ${config.action}ms`);
  console.log(`  Navigation timeout: ${config.navigation}ms`);
  console.log(`  Expect timeout: ${config.expect}ms`);
  if (config.global) {
    console.log(`  Global timeout: ${config.global}ms`);
  }
  console.log('');
}
