/**
 * Test Retry Configuration
 *
 * Central configuration for retry logic across all test types
 * with environment-specific settings and flaky test management.
 */

export interface RetryConfiguration {
  /** Default retry attempts for each test type */
  defaultRetries: {
    unit: number;
    integration: number;
    e2e: number;
    performance: number;
    accessibility: number;
  };

  /** CI-specific retry overrides */
  ciRetries: {
    unit: number;
    integration: number;
    e2e: number;
    performance: number;
    accessibility: number;
  };

  /** Known flaky tests with specific retry counts */
  flakyTests: Record<
    string,
    {
      maxRetries: number;
      reason: string;
      testType: 'unit' | 'integration' | 'e2e' | 'performance' | 'accessibility';
      lastUpdated: string;
    }
  >;

  /** Retry behavior settings */
  retrySettings: {
    /** Base delay between retries in milliseconds */
    baseDelayMs: number;
    /** Exponential backoff multiplier */
    backoffMultiplier: number;
    /** Maximum delay between retries */
    maxDelayMs: number;
    /** Whether to log retry attempts */
    logRetries: boolean;
    /** Auto-enable retries in CI */
    autoRetryInCI: boolean;
  };
}

/**
 * Default retry configuration
 */
export const RETRY_CONFIG: RetryConfiguration = {
  defaultRetries: {
    unit: 0, // Unit tests should be deterministic
    integration: 1, // Database operations can be flaky
    e2e: 2, // Browser tests are inherently flaky
    performance: 1, // Performance tests can have timing variations
    accessibility: 1, // A11y tests can have timing issues
  },

  ciRetries: {
    unit: 1, // Allow 1 retry in CI for unit tests
    integration: 2, // More retries for database operations in CI
    e2e: 3, // HARD MAXIMUM: 3 attempts total for E2E in CI
    performance: 2, // Performance tests need more retries in CI
    accessibility: 2, // A11y tests get more retries in CI
  },

  flakyTests: {
    // E2E tests known to be flaky (MAXIMUM 3 attempts total)
    'auth.test.ts:should handle complex authentication flow': {
      maxRetries: 3, // 3 total attempts (2 retries + 1 original)
      reason: 'Timing-sensitive authentication flow with external dependencies',
      testType: 'e2e',
      lastUpdated: '2025-08-01',
    },
    'visual-regression.test.ts:should capture consistent screenshots': {
      maxRetries: 3, // CAPPED AT 3 (was 4, now limited to max 3)
      reason: 'Screenshot comparison sensitive to rendering timing',
      testType: 'e2e',
      lastUpdated: '2025-08-01',
    },
    'accessibility.test.ts:should pass comprehensive WCAG checks': {
      maxRetries: 3,
      reason: 'axe-core analysis can be timing-sensitive',
      testType: 'accessibility',
      lastUpdated: '2025-08-01',
    },

    // Integration tests known to be flaky
    'auth.test.ts:should handle concurrent user creation': {
      maxRetries: 3,
      reason: 'Database race conditions with concurrent operations',
      testType: 'integration',
      lastUpdated: '2025-08-01',
    },
    'goals-transactions.test.ts:should handle complex transaction rollback': {
      maxRetries: 2,
      reason: 'Database locking and transaction timing issues',
      testType: 'integration',
      lastUpdated: '2025-08-01',
    },

    // Unit tests that occasionally fail
    'clientLogger.test.ts:should handle rapid log generation': {
      maxRetries: 2,
      reason: 'Timing-sensitive log buffer operations',
      testType: 'unit',
      lastUpdated: '2025-08-01',
    },
    'dataEncryption.test.ts:should encrypt large payloads consistently': {
      maxRetries: 2,
      reason: 'CPU-intensive operations can timeout under load',
      testType: 'unit',
      lastUpdated: '2025-08-01',
    },

    // Performance tests
    'performance-benchmark.ts:should meet performance thresholds': {
      maxRetries: 3,
      reason: 'Performance measurements vary with system load',
      testType: 'performance',
      lastUpdated: '2025-08-01',
    },
  },

  retrySettings: {
    baseDelayMs: 1000,
    backoffMultiplier: 1.5,
    maxDelayMs: 10000,
    logRetries: process.env.CI === 'true' || process.env.DEBUG_TESTS === 'true',
    autoRetryInCI: true,
  },
};

/**
 * Get retry count for a specific test
 */
export function getRetryCount(
  testPath: string,
  testName: string,
  testType: keyof RetryConfiguration['defaultRetries']
): number {
  const fullTestId = `${testPath}:${testName}`;

  // Check for specific flaky test configuration
  if (RETRY_CONFIG.flakyTests[fullTestId]) {
    // ENFORCE MAXIMUM 3 ATTEMPTS LIMIT
    return Math.min(RETRY_CONFIG.flakyTests[fullTestId].maxRetries, 3);
  }

  // Check for file-level flaky test patterns
  const fileName = testPath.split('/').pop() || testPath;
  const fileTestId = `${fileName}:${testName}`;
  if (RETRY_CONFIG.flakyTests[fileTestId]) {
    // ENFORCE MAXIMUM 3 ATTEMPTS LIMIT
    return Math.min(RETRY_CONFIG.flakyTests[fileTestId].maxRetries, 3);
  }

  // Use environment-specific defaults with 3-attempt cap
  const isCI = process.env.CI === 'true';
  if (isCI && RETRY_CONFIG.retrySettings.autoRetryInCI) {
    return Math.min(RETRY_CONFIG.ciRetries[testType], 3);
  }

  return Math.min(RETRY_CONFIG.defaultRetries[testType], 3);
}

/**
 * Check if a test is known to be flaky
 */
export function isFlakyTest(testPath: string, testName: string): boolean {
  const fullTestId = `${testPath}:${testName}`;
  const fileName = testPath.split('/').pop() || testPath;
  const fileTestId = `${fileName}:${testName}`;

  return !!(RETRY_CONFIG.flakyTests[fullTestId] || RETRY_CONFIG.flakyTests[fileTestId]);
}

/**
 * Get retry settings for a specific test type
 */
export function getRetrySettings(testType: keyof RetryConfiguration['defaultRetries']) {
  const isCI = process.env.CI === 'true';
  const baseAttempts = isCI
    ? RETRY_CONFIG.ciRetries[testType]
    : RETRY_CONFIG.defaultRetries[testType];

  return {
    maxAttempts: Math.min(baseAttempts, 3), // ENFORCE 3-ATTEMPT MAXIMUM
    delayMs: RETRY_CONFIG.retrySettings.baseDelayMs,
    backoffMultiplier: RETRY_CONFIG.retrySettings.backoffMultiplier,
    maxDelayMs: RETRY_CONFIG.retrySettings.maxDelayMs,
    logRetries: RETRY_CONFIG.retrySettings.logRetries,
  };
}

/**
 * Update flaky test configuration
 */
export function updateFlakyTest(
  testPath: string,
  testName: string,
  config: Partial<RetryConfiguration['flakyTests'][string]>
) {
  const fullTestId = `${testPath}:${testName}`;
  const existing = RETRY_CONFIG.flakyTests[fullTestId] || {};

  RETRY_CONFIG.flakyTests[fullTestId] = {
    ...existing,
    ...config,
    lastUpdated: new Date().toISOString().split('T')[0], // YYYY-MM-DD format
  };
}

/**
 * Get flaky test statistics
 */
export function getFlakyTestStats() {
  const flakyTests = Object.entries(RETRY_CONFIG.flakyTests);
  const byTestType = flakyTests.reduce(
    (acc, [_, config]) => {
      acc[config.testType] = (acc[config.testType] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    totalFlakyTests: flakyTests.length,
    byTestType,
    averageRetries:
      flakyTests.reduce((sum, [_, config]) => sum + config.maxRetries, 0) / flakyTests.length || 0,
  };
}

/**
 * Generate retry configuration report
 */
export function generateRetryReport(): string {
  const stats = getFlakyTestStats();
  const isCI = process.env.CI === 'true';

  let report = `\n🔄 Test Retry Configuration Report\n`;
  report += `==================================\n`;
  report += `Environment: ${isCI ? 'CI' : 'Local'}\n`;
  report += `Auto-retry in CI: ${RETRY_CONFIG.retrySettings.autoRetryInCI ? 'Enabled' : 'Disabled'}\n`;
  report += `Total flaky tests tracked: ${stats.totalFlakyTests}\n\n`;

  // Default retry counts
  report += `Default Retry Counts:\n`;
  Object.entries(isCI ? RETRY_CONFIG.ciRetries : RETRY_CONFIG.defaultRetries).forEach(
    ([type, count]) => {
      report += `  - ${type}: ${count} retries\n`;
    }
  );

  // Flaky test breakdown
  if (stats.totalFlakyTests > 0) {
    report += `\nFlaky Tests by Type:\n`;
    Object.entries(stats.byTestType).forEach(([type, count]) => {
      report += `  - ${type}: ${count} tests\n`;
    });

    report += `\nTop Flaky Tests:\n`;
    const sortedFlaky = Object.entries(RETRY_CONFIG.flakyTests)
      .sort(([, a], [, b]) => b.maxRetries - a.maxRetries)
      .slice(0, 5);

    sortedFlaky.forEach(([testId, config]) => {
      report += `  - ${testId}: ${config.maxRetries} retries (${config.reason})\n`;
    });
  }

  return report;
}

export default {
  RETRY_CONFIG,
  getRetryCount,
  isFlakyTest,
  getRetrySettings,
  updateFlakyTest,
  getFlakyTestStats,
  generateRetryReport,
};
