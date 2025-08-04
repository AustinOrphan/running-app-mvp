import { defineConfig, devices } from '@playwright/test';

/**
 * CI-optimized Playwright configuration
 * This extends the base configuration with CI-specific optimizations:
 * - Enhanced caching for faster test runs
 * - Optimized browser context reuse
 * - CI-specific timeouts and retry logic
 * - Result caching and reporting
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.test.ts',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Global setup and teardown */
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  /* Enhanced caching configuration for CI */
  outputDir: process.env.CI_CACHE_DIR
    ? `${process.env.CI_CACHE_DIR}/playwright-test-results`
    : '.playwright-cache/test-results',

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Enhanced retry logic for CI - MAXIMUM 3 attempts total (2 retries + 1 original) */
  retries: process.env.CI ? 2 : 0, // 0-2 retries in CI, 0 locally

  /* Optimized workers for CI caching - balance between speed and resource usage */
  workers: process.env.CI
    ? process.env.PLAYWRIGHT_SHARD
      ? 2
      : 1 // 2 workers per shard in CI, or 1 if no sharding
    : undefined, // Use default worker count locally

  /* Sharding configuration for distributed test execution with caching */
  ...(process.env.PLAYWRIGHT_SHARD && {
    shard: {
      current: parseInt(process.env.PLAYWRIGHT_SHARD.split('/')[0], 10),
      total: parseInt(process.env.PLAYWRIGHT_SHARD.split('/')[1], 10),
    },
  }),

  /* CI-optimized reporter configuration */
  reporter: process.env.CI
    ? [
        [
          'html',
          {
            outputFolder: process.env.CI_CACHE_DIR
              ? `${process.env.CI_CACHE_DIR}/playwright-report`
              : 'playwright-report',
            open: 'never',
          },
        ],
        [
          'junit',
          {
            outputFile: 'test-results/e2e-junit.xml',
            includeProjectInTestName: true,
          },
        ],
        ['json', { outputFile: 'test-results/e2e-results.json' }],
        ['./tests/reporters/accessibility-reporter.ts'],
      ]
    : 'html',

  /* Shared settings optimized for CI caching */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Enhanced trace collection for CI debugging */
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',

    /* Screenshots for CI debugging */
    screenshot: process.env.CI ? 'only-on-failure' : 'off',

    /* Video recording for CI failure analysis */
    video: process.env.CI ? 'retain-on-failure' : 'off',

    /* CI-aware timeout configuration - optimized for CI caching */
    actionTimeout: process.env.CI ? 30000 : 10000, // 30s in CI, 10s locally
    navigationTimeout: process.env.CI ? 90000 : 30000, // 90s in CI, 30s locally

    /* Browser context options for consistent caching */
    contextOptions: {
      // Disable animations for consistent screenshots and faster tests
      reducedMotion: 'reduce',
    },

    /* Locale for consistent test results */
    locale: 'en-US',
    timezoneId: 'America/New_York',
  },

  /* Test timeout configuration - extended for CI environment */
  timeout: process.env.CI ? 120000 : 30000, // 120s in CI, 30s locally

  /* Projects with browser-specific caching optimizations */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Browser-specific optimizations for CI
        launchOptions: {
          args: process.env.CI
            ? [
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=TranslateUI',
              ]
            : [],
        },
      },
    },

    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        launchOptions: {
          firefoxUserPrefs: process.env.CI
            ? {
                'media.navigator.streams.fake': true,
                'media.navigator.permission.disabled': true,
              }
            : {},
        },
      },
    },

    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        // Safari-specific CI optimizations
        launchOptions: process.env.CI
          ? {
              args: ['--disable-web-security'],
            }
          : {},
      },
    },

    /* Mobile testing with CI optimizations */
    {
      name: 'Mobile Safari',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        // Mobile-specific CI optimizations
        launchOptions: process.env.CI
          ? {
              args: ['--no-sandbox', '--disable-dev-shm-usage'],
            }
          : {},
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
        launchOptions: process.env.CI
          ? {
              args: ['--no-sandbox', '--disable-dev-shm-usage'],
            }
          : {},
      },
      testMatch: ['**/navigation-swipe.test.ts', '**/mobile-responsiveness.test.ts'],
    },
  ],

  /* Optimized webServer configuration for CI caching */
  webServer: {
    command: 'npm run dev:full',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI, // Always start fresh in CI for consistency
    timeout: 180 * 1000, // 3 minutes timeout for CI

    /* Environment variables for the web server */
    env: {
      NODE_ENV: 'test',
      CI: process.env.CI || 'false',
    },
  },

  /* Enhanced expect configuration for CI */
  expect: {
    timeout: process.env.CI ? 60000 : 15000, // 60s in CI, 15s locally
    toHaveScreenshot: {
      threshold: process.env.CI ? 0.3 : 0.2, // More lenient in CI
      maxDiffPixels: process.env.CI ? 200 : 100, // Allow more pixel differences in CI
      animations: 'disabled',
      // CI-specific screenshot options
      mode: 'css',
      caret: 'hide',
    },
    toMatchSnapshot: {
      threshold: process.env.CI ? 0.3 : 0.2,
    },
  },

  /* Global test configuration */
  globalTimeout: process.env.CI ? 45 * 60 * 1000 : 30 * 60 * 1000, // 45min in CI, 30min locally

  /* Metadata for result caching */
  metadata: {
    platform: process.platform,
    ci: !!process.env.CI,
    node_version: process.version,
    cache_dir: process.env.CI_CACHE_DIR || '.playwright-cache',
  },
});
