/**
 * Jest configuration with auto-retry for flaky tests
 *
 * This configuration extends the base Jest config with retry logic
 * for tests identified as flaky by the flaky test tracker.
 */

const baseConfig = require('./jest.config.js');
const fs = require('fs');
const path = require('path');

// Load flaky test configuration if available
let retryConfig = {};
const retryConfigPath = path.join(__dirname, 'reports/flaky-tests/retry-config.json');

if (fs.existsSync(retryConfigPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(retryConfigPath, 'utf8'));
    retryConfig = config.jest || {};
    console.log('✅ Loaded flaky test retry configuration');
  } catch (error) {
    console.warn('⚠️ Failed to load retry configuration:', error.message);
  }
} else {
  console.log('ℹ️ No retry configuration found, using defaults');
}

module.exports = {
  ...baseConfig,

  // Global retry settings
  retry: retryConfig.testRetries || 2,

  // Test timeout with buffer for retries
  testTimeout: 15000,

  // Retry-specific settings
  retryTimes: retryConfig.testRetries || 2,

  // Custom test name patterns for specific retry counts
  testNamePattern: process.env.FLAKY_TEST_PATTERN || undefined,

  // Setup files for retry logic
  setupFilesAfterEnv: [
    ...(baseConfig.setupFilesAfterEnv || []),
    '<rootDir>/tests/setup/retrySetup.js',
  ],

  // Reporter configuration for retry tracking
  reporters: [
    'default',
    [
      '<rootDir>/tests/reporters/retryReporter.js',
      {
        outputFile: 'reports/test-retries.json',
      },
    ],
  ],

  // Custom resolver for retry-specific test selection
  resolver: '<rootDir>/jest-retry-resolver.js',
};

// Add retry patterns if available
if (retryConfig.retryPattern && retryConfig.retryPattern.length > 0) {
  module.exports.testNamePattern = retryConfig.retryPattern
    .map(pattern => pattern.testNamePattern)
    .join('|');
}
