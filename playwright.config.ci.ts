import { defineConfig, devices } from '@playwright/test';

/**
 * CI-specific Playwright configuration
 * Optimized for CI environments with:
 * - Increased timeouts and retries
 * - Headless-only execution
 * - Single worker for stability
 * - CI-specific reporting
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.test.ts',

  /* Run tests in files in parallel - disabled in CI for stability */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only - increased for flaky tests */
  retries: process.env.CI ? 3 : 0,

  /* Single worker in CI to prevent resource conflicts */
  workers: 1,

  /* CI-specific reporter configuration */
  reporter: process.env.CI
    ? [
        ['html', { outputFolder: 'playwright-report' }],
        ['junit', { outputFile: 'test-results/e2e-junit.xml' }],
        ['line'],
      ]
    : 'html',

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying the failed test */
    trace: 'retain-on-failure',

    /* Screenshots on failure in CI */
    screenshot: 'only-on-failure',

    /* Video recording in CI */
    video: process.env.CI ? 'retain-on-failure' : 'off',

    /* CI-specific timeouts - increased for stability */
    actionTimeout: process.env.CI ? 15000 : 0, // 15s for actions in CI
    navigationTimeout: process.env.CI ? 45000 : 0, // 45s for navigation in CI

    /* Force headless mode in CI */
    headless: process.env.CI ? true : false,

    /* Disable animations for faster, more stable tests in CI */
    reducedMotion: process.env.CI ? 'reduce' : 'no-preference',

    /* CI-specific viewport - standard sizes for consistent testing */
    viewport: process.env.CI
      ? { width: 1280, height: 720 } // Standard HD viewport for CI
      : { width: 1920, height: 1080 }, // Full HD for local testing

    /* Device scale factor for high DPI testing */
    deviceScaleFactor: 1,

    /* Has touch - disabled for desktop testing */
    hasTouch: false,

    /* Is mobile - disabled for desktop testing */
    isMobile: false,
  },

  /* Global timeout for CI */
  globalTimeout: process.env.CI ? 600000 : 0, // 10 minutes max for entire test run

  /* Per-test timeout in CI */
  timeout: process.env.CI ? 60000 : 30000, // 1 minute per test in CI

  /* Configure projects for major browsers - headless only in CI */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Force headless in CI with specific Chrome args for stability
        headless: process.env.CI ? true : false,
        launchOptions: process.env.CI
          ? {
              args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-features=TranslateUI',
                '--no-first-run',
                '--no-default-browser-check',
              ],
            }
          : {},
      },
    },

    // Only test Chromium in CI to reduce execution time and resource usage
    // Firefox and WebKit can be enabled for local testing
    ...(process.env.CI
      ? []
      : [
          {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
          },
          {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
          },
        ]),

    /* Test against mobile viewports only locally */
    ...(process.env.CI
      ? []
      : [
          // {
          //   name: 'Mobile Chrome',
          //   use: { ...devices['Pixel 5'] },
          // },
          // {
          //   name: 'Mobile Safari',
          //   use: { ...devices['iPhone 12'] },
          // },
        ]),
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev:full',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 180000 : 120000, // 3 minutes in CI

    // CI-specific server settings
    stdout: process.env.CI ? 'pipe' : 'ignore',
    stderr: process.env.CI ? 'pipe' : 'ignore',

    // Port configuration
    port: 3000,
  },

  /* Expect configuration for assertions */
  expect: {
    /* Maximum time to wait for expect() conditions */
    timeout: process.env.CI ? 30000 : 15000, // 30s in CI, 15s locally

    /* Screenshot comparison configuration */
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixels: 100,
      animations: 'disabled',
    },

    /* Text matching configuration */
    toMatchSnapshot: {
      threshold: 0.2,
    },
  },

  /* Output directory for test artifacts */
  outputDir: 'test-results',

  /* Preserve output based on result */
  preserveOutput: process.env.CI ? 'failures-only' : 'always',

  /* Maximum failures before stopping */
  maxFailures: process.env.CI ? 5 : 0,
});
