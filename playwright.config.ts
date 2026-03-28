import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /\.spec\.ts$/,
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'list',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.BASE_URL || 'http://localhost:3000',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev:full',
    // Wait for backend API to be ready (more critical than frontend)
    // Frontend will be ready shortly after backend starts
    url: 'http://localhost:3001/api/health',
    reuseExistingServer: false,
    timeout: 120 * 1000,
    env: {
      // Use TEST_DATABASE_URL from environment if available (CI), otherwise default to test-e2e.db
      DATABASE_URL: process.env.TEST_DATABASE_URL || 'file:./prisma/test-e2e.db',
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'file:./prisma/test-e2e.db',
      NODE_ENV: 'test',
      RATE_LIMITING_ENABLED: 'false',
      // Server secrets (required for server to start)
      JWT_SECRET: process.env.JWT_SECRET || 'test-secret-for-local-e2e-testing-32chars',
      SESSION_SECRET: process.env.SESSION_SECRET || 'test-session-secret-local-e2e-32chars',
      LOG_SALT: process.env.LOG_SALT || 'test-salt-16chars',
    },
  },

  outputDir: './test-results',
});
