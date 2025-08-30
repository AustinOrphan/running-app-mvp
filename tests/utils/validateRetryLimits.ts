/**
 * Retry Limits Validation
 *
 * Utility to validate that all retry configurations respect the maximum 3 attempts limit.
 * This helps ensure consistent retry behavior across all test types.
 */

import { RETRY_CONFIG, getRetryCount, getRetrySettings } from '../config/retryConfig';

interface ValidationResult {
  valid: boolean;
  violations: string[];
  warnings: string[];
  summary: {
    totalConfigurations: number;
    validConfigurations: number;
    violations: number;
    warnings: number;
  };
}

/**
 * Validate that all retry configurations respect the 3-attempt maximum
 */
export function validateRetryLimits(): ValidationResult {
  const violations: string[] = [];
  const warnings: string[] = [];
  let totalConfigurations = 0;

  // Check default retry counts
  Object.entries(RETRY_CONFIG.defaultRetries).forEach(([testType, retries]) => {
    totalConfigurations++;
    if (retries > 3) {
      violations.push(`Default retries for ${testType}: ${retries} exceeds maximum of 3`);
    }
  });

  // Check CI retry counts
  Object.entries(RETRY_CONFIG.ciRetries).forEach(([testType, retries]) => {
    totalConfigurations++;
    if (retries > 3) {
      violations.push(`CI retries for ${testType}: ${retries} exceeds maximum of 3`);
    }
  });

  // Check flaky test configurations
  Object.entries(RETRY_CONFIG.flakyTests).forEach(([testId, config]) => {
    totalConfigurations++;
    if (config.maxRetries > 3) {
      violations.push(`Flaky test "${testId}": ${config.maxRetries} exceeds maximum of 3`);
    }

    // Warn about high retry counts that might indicate test quality issues
    if (config.maxRetries === 3) {
      warnings.push(
        `Flaky test "${testId}" uses maximum retries (3) - consider fixing the underlying issue`
      );
    }
  });

  // Test the getRetryCount function with various inputs
  const testTypes = ['unit', 'integration', 'e2e', 'performance', 'accessibility'] as const;
  const sampleTests = [
    'auth.test.ts',
    'visual-regression.test.ts',
    'performance-benchmark.ts',
    'regular-test.test.ts',
  ];

  sampleTests.forEach(testPath => {
    testTypes.forEach(testType => {
      totalConfigurations++;
      const retryCount = getRetryCount(testPath, 'sample test', testType);
      if (retryCount > 3) {
        violations.push(
          `getRetryCount(${testPath}, "sample test", ${testType}) returned ${retryCount}, exceeds maximum of 3`
        );
      }
    });
  });

  // Test the getRetrySettings function
  testTypes.forEach(testType => {
    totalConfigurations++;
    const settings = getRetrySettings(testType);
    if (settings.maxAttempts > 3) {
      violations.push(
        `getRetrySettings(${testType}) returned maxAttempts=${settings.maxAttempts}, exceeds maximum of 3`
      );
    }
  });

  const validConfigurations = totalConfigurations - violations.length;

  return {
    valid: violations.length === 0,
    violations,
    warnings,
    summary: {
      totalConfigurations,
      validConfigurations,
      violations: violations.length,
      warnings: warnings.length,
    },
  };
}

/**
 * Generate a validation report
 */
export function generateValidationReport(): string {
  const result = validateRetryLimits();

  let report = '\n🔍 Retry Configuration Validation Report\n';
  report += '=========================================\n';
  report += `Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}\n`;
  report += `Total configurations checked: ${result.summary.totalConfigurations}\n`;
  report += `Valid configurations: ${result.summary.validConfigurations}\n`;
  report += `Violations: ${result.summary.violations}\n`;
  report += `Warnings: ${result.summary.warnings}\n\n`;

  if (result.violations.length > 0) {
    report += '❌ VIOLATIONS (Must be fixed):\n';
    result.violations.forEach((violation, index) => {
      report += `  ${index + 1}. ${violation}\n`;
    });
    report += '\n';
  }

  if (result.warnings.length > 0) {
    report += '⚠️  WARNINGS (Recommended to address):\n';
    result.warnings.forEach((warning, index) => {
      report += `  ${index + 1}. ${warning}\n`;
    });
    report += '\n';
  }

  if (result.valid) {
    report += '✅ All retry configurations respect the 3-attempt maximum limit.\n';
    report += '   This ensures consistent and reasonable retry behavior across all test types.\n';
  } else {
    report += '❌ Some configurations exceed the 3-attempt limit and must be fixed.\n';
    report += '   Please update the violating configurations to respect the maximum limit.\n';
  }

  return report;
}

/**
 * Validate specific test configuration
 */
export function validateTestRetries(
  testPath: string,
  testName: string,
  testType: 'unit' | 'integration' | 'e2e' | 'performance' | 'accessibility'
): { valid: boolean; actualRetries: number; message: string } {
  const retries = getRetryCount(testPath, testName, testType);
  const valid = retries <= 3;

  return {
    valid,
    actualRetries: retries,
    message: valid
      ? `Test retries (${retries}) are within the maximum limit of 3`
      : `Test retries (${retries}) exceed the maximum limit of 3`,
  };
}

/**
 * Assert that retry configuration is valid (for use in tests)
 */
export function assertValidRetryConfiguration(): void {
  const result = validateRetryLimits();

  if (!result.valid) {
    const errorMessage = `Retry configuration validation failed:\n${result.violations.join('\n')}`;
    throw new Error(errorMessage);
  }
}

/**
 * Get retry limits summary for monitoring
 */
export function getRetryLimitsSummary() {
  const validation = validateRetryLimits();

  return {
    isValid: validation.valid,
    totalConfigurations: validation.summary.totalConfigurations,
    violations: validation.summary.violations,
    warnings: validation.summary.warnings,
    maxRetryLimit: 3,
    enforcementLevel: 'strict',
    lastValidated: new Date().toISOString(),
  };
}

export default {
  validateRetryLimits,
  generateValidationReport,
  validateTestRetries,
  assertValidRetryConfiguration,
  getRetryLimitsSummary,
};
