import { defineConfig, devices } from '@playwright/test'
import { E2E_DATABASE_URL, E2E_PORT } from './tests/e2e/env.ts'

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'sh -c "mkdir -p data && rm -f data/e2e.db* && npm run db:migrate && npm start"',
    // Ready when this process logs that it listens on this port, not when something answers
    // /api/health: another checkout's server on the same port would answer too, and the suite
    // would run against its database. A bind error makes the command exit and the run fail.
    wait: { stdout: new RegExp(`"port":${E2E_PORT},"msg":"server listening"`) },
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      SESSION_SECRET: 'e2e-test-only-secret-0123456789abcdef!!',
      PORT: String(E2E_PORT),
      // The readiness line above is an info-level log; `NODE_ENV=test` or a quieter `LOG_LEVEL`
      // inherited from the shell would silence it. Any NODE_ENV but `production` also gives the
      // `/api` limiter its 20000-request budget (`apiLimitFor`); the suite spends about 940.
      NODE_ENV: 'development',
      LOG_LEVEL: 'info',
    },
  },
})
