/**
 * Vitest configuration with auto-retry for flaky tests
 *
 * This configuration extends the base Vitest config with retry logic
 * for tests identified as flaky by the flaky test tracker.
 */

import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load flaky test configuration if available
let retryConfig: any = {};
const retryConfigPath = join(__dirname, 'reports/flaky-tests/retry-config.json');

if (existsSync(retryConfigPath)) {
  try {
    const config = JSON.parse(readFileSync(retryConfigPath, 'utf8'));
    retryConfig = config.vitest || {};
    console.log('✅ Loaded flaky test retry configuration for Vitest');
  } catch (error) {
    console.warn('⚠️ Failed to load Vitest retry configuration:', error);
  }
} else {
  console.log('ℹ️ No Vitest retry configuration found, using defaults');
}

export default defineConfig({
  ...baseConfig,

  test: {
    ...baseConfig.test,

    // Retry configuration
    retry: retryConfig.retry || 2,

    // Test timeout with buffer for retries
    testTimeout: retryConfig.testTimeout || 10000,

    // Bail on first failure (when not retrying)
    bail: process.env.CI ? 0 : 1,

    // Reporter configuration for retry tracking
    reporters: ['default', 'verbose', ['json', { outputFile: 'reports/vitest-results.json' }]],

    // Coverage settings adjusted for retries
    coverage: {
      ...baseConfig.test?.coverage,
      reporter: ['text', 'json', 'html'],
      reportOnFailure: true,
    },

    // Setup files for retry logic
    setupFiles: [...(baseConfig.test?.setupFiles || []), './tests/setup/vitestRetrySetup.ts'],

    // Global test configuration
    globals: true,
    environment: 'jsdom',

    // Retry-specific environment variables
    env: {
      ...baseConfig.test?.env,
      VITEST_RETRY_COUNT: String(retryConfig.retry || 2),
      VITEST_FLAKY_THRESHOLD: '0.1',
    },
  },
});

// Log retry configuration details
if (retryConfig.retry) {
  console.log(`🔄 Vitest retry configuration:`);
  console.log(`   Retry count: ${retryConfig.retry}`);
  console.log(`   Test timeout: ${retryConfig.testTimeout || 10000}ms`);
}
