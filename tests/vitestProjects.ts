/**
 * The file list behind the `sweep` project of `vitest.config.ts`. It is data in a module with no
 * import so that the config and `tests/unit/reports/vitest-projects.test.ts` read one list.
 */

/**
 * The `sweep` project: the engine files that take about 10 seconds or more on a development
 * machine (measured 2026-11-01 on the whole run, two workers), plus the files that are long only by
 * hand. They run apart from the rest so that CI can give them their own jobs
 * (`npm run test:sweep -- --shard=1/2`) and so that the rest keeps the default 5 s test timeout.
 *
 * A new file that needs a longer timeout than the default is added here, not given a private
 * `vi.setConfig({ testTimeout })`; `tests/unit/reports/vitest-projects.test.ts` fails on the latter.
 *
 * Paths from the repository root, slowest first (seconds in `npm run test`, two workers).
 */
export const SWEEP_FILES: readonly string[] = [
  'tests/unit/engine/preset-chains.test.ts', // 72
  'tests/unit/engine/methods.test.ts', // 48
  'tests/unit/engine/sim-athlete.test.ts', // 38
  'tests/unit/engine/history-rebuild.test.ts', // 31
  'tests/unit/engine/disruption-integration.test.ts', // 22
  'tests/unit/engine/preset-phases.test.ts', // 19
  'tests/unit/engine/history-sweep.test.ts', // 16
  'tests/unit/engine/disruption-sweep.test.ts', // 13
  'tests/unit/engine/preset-fidelity.test.ts', // 12
  // By hand (skipped in `npm run test` without the variable named in each file's header), where
  // each runs for minutes:
  'tests/unit/engine/window-grids.test.ts', // WINDOW_GRIDS_FULL
  'tests/unit/engine/preset-phases-sweep-1.test.ts', // PRESET_PHASES_FULL
  'tests/unit/engine/preset-phases-sweep-2.test.ts',
  'tests/unit/engine/preset-phases-sweep-3.test.ts',
]

/**
 * The one test timeout of the `sweep` project, 15 minutes. It is the longest any of its files asked
 * for before (the by-hand grids and the full phases sweep, 900,000 ms each), so none of them can run
 * out of time by moving here. The files that run in `npm run test` took 1 to 6 minutes before and
 * now share it, which is looser; what bounds a sweep that grows is its own budget assertion
 * (`BUDGET_MS`, which reads the elapsed time and fails with it) and the timeout of the CI job.
 */
export const SWEEP_TIMEOUT_MS = 900_000
