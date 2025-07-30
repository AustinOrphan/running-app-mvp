import { defineConfig, devices } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * CI-specific Playwright configuration
 */
export default defineConfig({
  ...baseConfig,

  // CI optimizations
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [
        ['list'],
        ['junit', { outputFile: 'reports/playwright-results.xml' }],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
      ]
    : 'html',

  forbidOnly: !!process.env.CI,

  use: {
    ...baseConfig.use,
    // CI-specific browser settings
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Smaller set of browsers for CI
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
