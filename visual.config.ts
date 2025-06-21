import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/visual-regression.test.ts',
  
  /* Run tests in files in parallel */
  fullyParallel: true,
  
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['html', { outputFolder: 'test-results/visual-regression-report' }],
    ['json', { outputFile: 'test-results/visual-regression-results.json' }],
    ['list']
  ],
  
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3001',
    
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
    
    /* Record video on failure */
    video: 'retain-on-failure',
    
    /* Visual testing specific settings */
    ignoreHTTPSErrors: true,
    
    /* Consistent viewport for visual testing */
    viewport: { width: 1280, height: 720 },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { 
        ...require('@playwright/test').devices['Desktop Chrome'],
        // Ensure consistent rendering for visual tests
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--force-color-profile=srgb',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection',
          ],
        },
      },
    },

    {
      name: 'firefox',
      use: { 
        ...require('@playwright/test').devices['Desktop Firefox'],
        // Firefox-specific settings for visual consistency
        launchOptions: {
          firefoxUserPrefs: {
            'gfx.canvas.azure.backends': 'cairo',
            'gfx.content.azure.backends': 'cairo',
          },
        },
      },
    },

    {
      name: 'webkit',
      use: { 
        ...require('@playwright/test').devices['Desktop Safari'],
      },
    },

    /* Test against mobile viewports. */
    {
      name: 'Mobile Chrome',
      use: { 
        ...require('@playwright/test').devices['Pixel 5'],
      },
    },
    
    {
      name: 'Mobile Safari',
      use: { 
        ...require('@playwright/test').devices['iPhone 12'],
      },
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { 
    //     ...devices['Desktop Edge'], 
    //     channel: 'msedge' 
    //   },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { 
    //     ...devices['Desktop Chrome'], 
    //     channel: 'chrome' 
    //   },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/running_app_visual_test',
      JWT_SECRET: 'visual-test-secret-key',
    },
  },

  /* Visual testing specific configuration */
  expect: {
    // Global threshold for visual comparisons
    threshold: 0.2,
    
    // Animation handling
    toHaveScreenshot: {
      threshold: 0.2,
      maxDiffPixels: 1000,
      animations: 'disabled',
    },
    
    // Page screenshot defaults
    toMatchSnapshot: {
      threshold: 0.3,
      maxDiffPixels: 2000,
    },
  },

  /* Global test timeout */
  timeout: 60 * 1000,

  /* Global setup and teardown */
  globalSetup: require.resolve('./tests/setup/visual-global-setup.ts'),
  globalTeardown: require.resolve('./tests/setup/visual-global-teardown.ts'),
});