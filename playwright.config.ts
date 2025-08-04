import { defineConfig, devices } from '@playwright/test';

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// require('dotenv').config();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.test.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Global setup and teardown */
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
  /* Cache browser installations and test results */
  outputDir: 'test-results/playwright',
  /* Metadata configuration for improved caching */
  metadata: {
    'playwright-version': require('@playwright/test/package.json').version,
    'cache-enabled': true,
  },
  /* Caching configuration - improved cache directories */
  outputDir: 'playwright-results',
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only - MAXIMUM 3 attempts total (2 retries + 1 original) */
  retries: process.env.CI ? 2 : 0, // 0-2 retries in CI, 0 locally (max 3 total attempts)
  /* Configure workers for parallel/sharded execution - optimized per platform */
  workers: (() => {
    // Allow environment override
    if (process.env.PLAYWRIGHT_WORKERS) {
      return parseInt(process.env.PLAYWRIGHT_WORKERS, 10);
    }

    const os = require('os');
    const cpuCount = os.cpus().length;

    if (process.env.CI) {
      // In CI with sharding: use 2-3 workers per shard
      if (process.env.PLAYWRIGHT_SHARD) {
        return Math.min(3, Math.max(2, Math.floor(cpuCount / 2)));
      }
      // In CI without sharding: use conservative worker count
      return Math.max(1, Math.min(4, Math.floor(cpuCount / 3)));
    } else {
      // Locally: use 50% of available cores for better performance
      return Math.max(2, Math.min(8, Math.floor(cpuCount / 2)));
    }
  })(),

  /* Sharding configuration for distributed test execution */
  ...(process.env.PLAYWRIGHT_SHARD && {
    shard: {
      current: parseInt(process.env.PLAYWRIGHT_SHARD.split('/')[0], 10),
      total: parseInt(process.env.PLAYWRIGHT_SHARD.split('/')[1], 10),
    },
  }),
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
        ['./tests/reporters/accessibility-reporter.ts'],
      ]
    : 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* CI-aware timeout configuration - increased for slower CI runners */
    actionTimeout: process.env.CI ? 20000 : 10000, // 20s in CI, 10s locally
    navigationTimeout: process.env.CI ? 60000 : 30000, // 60s in CI, 30s locally
  },

  /* Test timeout configuration - extended for CI environment */
  timeout: process.env.CI ? 90000 : 30000, // 90s in CI, 30s locally

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
      testMatch: [
        '**/accessibility.test.ts',
        '**/navigation-swipe.test.ts',
        '**/mobile-responsiveness.test.ts',
      ],
    },
    {
      name: 'iPad',
      use: {
        ...devices['iPad Pro 11'],
        viewport: { width: 1024, height: 1366 },
        hasTouch: true,
        isMobile: false,
      },
      testMatch: ['**/navigation-swipe.test.ts', '**/mobile-responsiveness.test.ts'],
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev:full',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },

  /* Expect configuration for assertions - extended for CI */
  expect: {
    timeout: process.env.CI ? 45000 : 15000,
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixels: 100,
      animations: 'disabled',
    },
  },
});
