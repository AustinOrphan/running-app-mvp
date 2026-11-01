import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'
import { MOCKED_FILES, SWEEP_FILES, SWEEP_TIMEOUT_MS } from './tests/vitestProjects.ts'

// `tests/unit/engine` and `tests/unit/shared` test pure code (no database, no network, no module
// state of its own), so their files share a worker and its module cache (`isolate: false`) instead
// of loading the engine again for each file: the `pure` and `sweep` projects. The files that mock a
// module keep a worker each (`mocked`), as do the projects that touch module state: `running` in
// `server/services/sync.ts` and `replanning` in the scheduler (`server`), the DOM and the router
// (`web`). The lists are in `tests/vitestProjects.ts`.
const PURE = ['tests/unit/engine/**/*.test.ts', 'tests/unit/shared/**/*.test.ts']

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...PURE],
          globalSetup: ['tests/globalSetup.ts'],
        },
      },
      {
        test: {
          name: 'pure',
          environment: 'node',
          include: PURE,
          exclude: [...configDefaults.exclude, ...SWEEP_FILES, ...MOCKED_FILES],
          isolate: false,
        },
      },
      {
        test: {
          name: 'mocked',
          environment: 'node',
          include: [...MOCKED_FILES],
        },
      },
      {
        // The long engine files, in their own project so that CI runs them in their own jobs
        // (`npm run test:sweep`). The one test timeout is here.
        test: {
          name: 'sweep',
          environment: 'node',
          include: [...SWEEP_FILES],
          testTimeout: SWEEP_TIMEOUT_MS,
          isolate: false,
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
