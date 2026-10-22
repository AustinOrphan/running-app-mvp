import { defineConfig, devices } from '@playwright/test'
import { E2E_DATABASE_URL } from './tests/e2e/env.ts'

const port = 3101

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'sh -c "mkdir -p data && rm -f data/e2e.db* && npm run db:migrate && npm start"',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: 'e2e-test-only-secret-0123456789abcdef!!',
      PORT: String(port),
    },
  },
})
