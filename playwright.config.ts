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
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Configure workers for parallel/sharded execution */
  workers: process.env.CI
    ? process.env.PLAYWRIGHT_SHARD
      ? 2
      : 1 // 2 workers per shard in CI, or 1 if no sharding
    : undefined, // Use default worker count locally

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

    /* CI-aware timeout configuration */
    actionTimeout: process.env.CI ? 15000 : 10000, // 15s in CI, 10s locally
    navigationTimeout: process.env.CI ? 45000 : 30000, // 45s in CI, 30s locally
  },

  /* Test timeout configuration */
  timeout: process.env.CI ? 60000 : 30000, // 60s in CI, 30s locally

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

  /* Expect configuration for assertions */
  expect: {
    timeout: process.env.CI ? 30000 : 15000,
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixels: 100,
      animations: 'disabled',
    },
  },
});
