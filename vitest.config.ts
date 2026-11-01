import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'
import { SWEEP_FILES, SWEEP_TIMEOUT_MS } from './tests/vitestProjects.ts'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
          // the sweep files run in the `sweep` project, once
          exclude: [...configDefaults.exclude, ...SWEEP_FILES],
          globalSetup: ['tests/globalSetup.ts'],
        },
      },
      {
        // The long engine files, in their own project so that CI runs them in their own jobs
        // (`npm run test:sweep`). The one test timeout is here; the list is in
        // `tests/vitestProjects.ts`.
        test: {
          name: 'sweep',
          environment: 'node',
          include: [...SWEEP_FILES],
          testTimeout: SWEEP_TIMEOUT_MS,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['tests/web/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/web/setup.ts'],
        },
      },
    ],
  },
})
