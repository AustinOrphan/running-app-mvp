/**
 * Playwright configuration with auto-retry for flaky tests
 *
 * This configuration extends the base Playwright config with retry logic
 * for tests identified as flaky by the flaky test tracker.
 */

import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Load flaky test configuration if available
let retryConfig: any = {};
const retryConfigPath = join(__dirname, 'reports/flaky-tests/retry-config.json');

if (existsSync(retryConfigPath)) {
  try {
    const config = JSON.parse(readFileSync(retryConfigPath, 'utf8'));
    retryConfig = config.playwright || {};
    console.log('✅ Loaded flaky test retry configuration for Playwright');
  } catch (error) {
    console.warn('⚠️ Failed to load Playwright retry configuration:', error);
  }
} else {
  console.log('ℹ️ No Playwright retry configuration found, using defaults');
}

export default defineConfig({
  ...baseConfig,

  // Global retry settings
  retries: process.env.CI ? retryConfig.retries || 3 : retryConfig.retries || 2,

  // Timeout settings adjusted for retries
  timeout: 30000,
  expect: {
    timeout: 10000,
  },

  // Test directory and pattern
  testDir: './tests/e2e',
  testMatch: '**/*.test.ts',

  // Failure handling
  fullyParallel: !process.env.CI, // Less parallel in CI to reduce flakiness
  forbidOnly: !!process.env.CI,

  // Retry-specific reporter configuration
  reporter: [
    ['list'],
    ['json', { outputFile: 'reports/playwright-results.json' }],
    ['html', { open: 'never', outputFolder: 'reports/playwright-report' }],
    ['./tests/reporters/playwrightRetryReporter.ts'],
  ],

  // Global setup and teardown
  globalSetup: require.resolve('./tests/setup/playwrightGlobalSetup.ts'),
  globalTeardown: require.resolve('./tests/setup/playwrightGlobalTeardown.ts'),

  // Browser projects with retry-specific configurations
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Retry-specific browser settings
        actionTimeout: 15000,
        navigationTimeout: 30000,
        // Video and screenshot settings for debugging flaky tests
        video: process.env.CI ? 'retain-on-failure' : 'off',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
      retries: retryConfig.projects?.[0]?.retries || (process.env.CI ? 3 : 2),
    },

    // Firefox project with higher retry count for known flaky browser
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        actionTimeout: 20000, // Firefox often needs more time
        navigationTimeout: 40000,
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
      },
      retries: retryConfig.projects?.[1]?.retries || 4, // Higher retry for Firefox
    },

    // Mobile Chrome with specific retry settings
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        actionTimeout: 20000, // Mobile often needs more time
        navigationTimeout: 40000,
      },
      retries: retryConfig.projects?.[2]?.retries || 3,
    },
  ],

  // Web server configuration for local testing
  webServer: {
    ...baseConfig.webServer,
    reuseExistingServer: !process.env.CI,
    timeout: 120000, // Extended timeout for retry scenarios
  },

  // Use specific test settings for retry scenarios
  use: {
    ...baseConfig.use,

    // Extended timeouts for retry scenarios
    actionTimeout: 15000,
    navigationTimeout: 30000,

    // Debugging settings for flaky tests
    video: process.env.CI ? 'retain-on-failure' : 'off',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',

    // Retry-specific browser settings
    launchOptions: {
      args: [
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
});

// Log retry configuration details
if (retryConfig.retries) {
  console.log(`🔄 Playwright retry configuration:`);
  console.log(`   Global retries: ${retryConfig.retries}`);
  console.log(`   CI retries: ${process.env.CI ? retryConfig.retries : 'N/A'}`);
  console.log(`   Projects configured: ${retryConfig.projects?.length || 0}`);
}
