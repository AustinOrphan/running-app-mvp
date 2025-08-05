/**
 * Playwright Global Teardown
 * Runs once after all test suites complete
 */

import { FullConfig } from '@playwright/test';

async function globalTeardown(_config: FullConfig) {
  console.log('🏁 Starting E2E global teardown...');

  // Perform any cleanup operations here
  // For example: clearing test data, closing connections, etc.

  // Log environment info for debugging
  if (process.env.CI) {
    console.log('📊 CI environment detected');
  }

  console.log('✅ E2E global teardown complete');
}

export default globalTeardown;
