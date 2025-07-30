import { defineConfig, devices } from '@playwright/test';

/**
 * Headless Browser Configuration for Playwright
 * Optimized for headless testing with proper viewport sizes and timeouts
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.test.ts',

  /* Run tests in files in parallel - disabled for stability */
  fullyParallel: false,

  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,

  /* Retry configuration */
  retries: 2,

  /* Single worker for headless stability */
  workers: 1,

  /* Reporter configuration */
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-results/playwright-results.json' }],
    ['list'],
  ],

  /* Global timeout */
  globalTimeout: 10 * 60 * 1000, // 10 minutes

  /* Per-test timeout */
  timeout: 60 * 1000, // 60 seconds

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',

    /* Headless mode configuration */
    headless: true,

    /* Screenshot configuration for debugging */
    screenshot: {
      mode: 'only-on-failure',
      fullPage: true,
    },

    /* Video recording configuration */
    video: {
      mode: 'retain-on-failure',
      size: { width: 1280, height: 720 },
    },

    /* Trace configuration for debugging */
    trace: 'retain-on-failure',

    /* Viewport sizes for different test scenarios */
    viewport: { width: 1280, height: 720 }, // Default viewport

    /* Navigation timeouts */
    navigationTimeout: 45 * 1000, // 45 seconds

    /* Action timeouts */
    actionTimeout: 15 * 1000, // 15 seconds

    /* Disable animations for stability */
    reducedMotion: 'reduce',

    /* Color scheme */
    colorScheme: 'light',

    /* Locale */
    locale: 'en-US',

    /* Timezone */
    timezoneId: 'UTC',

    /* Permissions */
    permissions: [],

    /* Geolocation */
    geolocation: undefined,

    /* HTTP credentials */
    httpCredentials: undefined,

    /* Offline mode */
    offline: false,

    /* JavaScript enabled */
    javaScriptEnabled: true,

    /* Bypass CSP */
    bypassCSP: false,

    /* Accept downloads */
    acceptDownloads: false,

    /* Ignore HTTPS errors */
    ignoreHTTPSErrors: false,

    /* Extra HTTP headers */
    extraHTTPHeaders: {},

    /* User agent */
    userAgent: undefined,

    /* Storage state */
    storageState: undefined,
  },

  /* Configure projects for different viewports and browsers */
  projects: [
    /* Desktop Browsers - Headless Configurations */
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=site-per-process',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
          ],
        },
      },
    },

    {
      name: 'chromium-laptop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1366, height: 768 },
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        },
      },
    },

    {
      name: 'chromium-tablet',
      use: {
        ...devices['iPad Pro'],
        viewport: { width: 1024, height: 1366 },
      },
    },

    /* Mobile Browsers - Headless Configurations */
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 5'],
        viewport: { width: 393, height: 851 },
        userAgent:
          'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        isMobile: true,
        hasTouch: true,
      },
    },

    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
        isMobile: true,
        hasTouch: true,
      },
    },

    /* Accessibility Testing Viewport */
    {
      name: 'chromium-accessibility',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
        // Force high contrast mode for accessibility testing
        colorScheme: 'dark',
        // Reduce animations
        reducedMotion: 'reduce',
      },
    },
  ],

  /* Test output configuration */
  outputDir: 'test-results',

  /* Preserve output */
  preserveOutput: 'failures-only',

  /* Quiet mode */
  quiet: false,

  /* Update snapshots */
  updateSnapshots: 'none',

  /* Maximum failures */
  maxFailures: 10,

  /* Web Server configuration */
  webServer: {
    command: 'npm run dev:full',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180 * 1000, // 3 minutes
    stdout: 'pipe',
    stderr: 'pipe',
  },

  /* Expect configuration */
  expect: {
    /* Maximum time to wait for expect conditions */
    timeout: 10 * 1000, // 10 seconds

    /* Configure matchers */
    toHaveScreenshot: {
      /* Threshold for screenshot comparison */
      threshold: 0.2,
      maxDiffPixels: 100,
      animations: 'disabled',
    },
  },
});
