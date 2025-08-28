import { defineConfig, devices } from '@playwright/test';

/**
 * Consolidated Playwright configuration
 * Environment-aware configuration for local development, CI, and distributed testing
 * Replaces all variant configs with single source of truth
 */
export default defineConfig({
  // Test directory and patterns
  testDir: './tests/e2e',
  testMatch: '**/*.test.ts',

  // Global setup and teardown
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  // Parallel execution - environment aware
  fullyParallel: true,

  // Output directory - environment aware
  outputDir: process.env.CI
    ? 'playwright-results-ci'
    : 'playwright-results',

  // Fail build if test.only is left in CI
  forbidOnly: !!process.env.CI,

  // Environment-aware retry configuration
  retries: process.env.CI ? 2 : 0,

  // Environment-aware worker configuration
  workers: (() => {
    // Allow manual override
    if (process.env.PLAYWRIGHT_WORKERS) {
      return parseInt(process.env.PLAYWRIGHT_WORKERS, 10);
    }

    if (process.env.CI) {
      // CI with sharding: 2 workers per shard
      if (process.env.PLAYWRIGHT_SHARD) {
        return 2;
      }
      // CI without sharding: single worker for stability
      return 1;
    }

    // Local development: use system cores / 2
    return undefined; // Let Playwright decide based on system
  })(),

  // Sharding support for distributed testing
  ...(process.env.PLAYWRIGHT_SHARD && {
    shard: {
      current: parseInt(process.env.PLAYWRIGHT_SHARD.split('/')[0], 10),
      total: parseInt(process.env.PLAYWRIGHT_SHARD.split('/')[1], 10),
    },
  }),

  // Environment-aware reporter configuration
  reporter: process.env.CI ? [
    ['html', {
      outputFolder: 'playwright-report',
      open: 'never'
    }],
    ['json', {
      outputFile: 'test-results/playwright-results.json'
    }],
    ['junit', {
      outputFile: 'test-results/playwright-junit.xml'
    }],
    ['github'], // GitHub Actions integration
  ] : [
    ['html', {
      outputFolder: 'playwright-report',
      open: 'on-failure'
    }],
    ['list'],
  ],

  // Global test configuration
  use: {
    // Base URL for tests
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    // Browser context options
    viewport: { width: 1280, height: 720 },

    // Action timeouts
    actionTimeout: process.env.CI ? 15000 : 10000,
    navigationTimeout: process.env.CI ? 45000 : 30000,

    // Screenshots and videos - environment aware
    screenshot: process.env.CI ? 'only-on-failure' : 'on-first-retry',
    video: process.env.CI ? 'retain-on-failure' : 'on-first-retry',
    trace: process.env.CI ? 'retain-on-failure' : 'on-first-retry',

    // User agent
    userAgent: 'PlaywrightTests/1.0',

    // Browser launch options - environment aware
    launchOptions: {
      headless: process.env.HEADED ? false : true,
      slowMo: process.env.SLOWMO ? parseInt(process.env.SLOWMO) : 0,
      args: process.env.CI ? [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ] : [],
    },
  },

  // Test timeout configuration
  timeout: process.env.CI ? 60000 : 30000,
  expect: {
    timeout: process.env.CI ? 10000 : 5000,
  },

  // Projects for different browsers and configurations
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    // Run Firefox only if explicitly requested or in comprehensive test mode
    ...(process.env.TEST_ALL_BROWSERS || process.env.PLAYWRIGHT_FIREFOX ? [{
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    }] : []),

    // Run WebKit only if explicitly requested or in comprehensive test mode
    ...(process.env.TEST_ALL_BROWSERS || process.env.PLAYWRIGHT_WEBKIT ? [{
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    }] : []),

    // Mobile testing - only when explicitly enabled
    ...(process.env.TEST_MOBILE ? [
      {
        name: 'Mobile Chrome',
        use: { ...devices['Pixel 5'] },
      },
      {
        name: 'Mobile Safari',
        use: { ...devices['iPhone 12'] },
      },
    ] : []),
  ],

  // Web server configuration for tests
  webServer: process.env.CI || process.env.START_SERVER ? {
    command: process.env.CI
      ? 'npm run build && npm run start'
      : 'npm run dev:full',
    url: 'http://localhost:3000',
    timeout: process.env.CI ? 180000 : 120000, // 3 minutes in CI, 2 minutes locally
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      NODE_ENV: 'test',
      PORT: '3001',
      DATABASE_URL: process.env.E2E_DATABASE_URL || 'file:./prisma/e2e-test.db',
      JWT_SECRET: 'test-secret-for-e2e-tests-must-be-longer-than-32-characters',
    },
  } : undefined,

  // Metadata for improved caching and debugging
  metadata: {
    'playwright-version': require('@playwright/test/package.json').version,
    'node-version': process.version,
    'os': process.platform,
    'ci': !!process.env.CI,
    'shard': process.env.PLAYWRIGHT_SHARD || 'none',
  },
};
