// BY HAND: the phases of a longer-base plan [rule P4, task M5 review] on runners 101 to 150 of the
// history sweep (`sweepCases(20261025, 150)`), each with the race moved later in steps of 7 days from
// 0 to 175: 1300 plans, about 70 seconds on a development machine, and too heavy for `npm run check`
// (`preset-phases.test.ts` runs the matrix and a sample there). The 150 runners are split over three
// files, so that the plans are built on three workers. Run it at each `PARAMS_VERSION` bump, beside
// `npm run plan:report`:
//
//   PRESET_PHASES_FULL=1 npx vitest run tests/unit/engine/preset-phases-sweep
//
// Without the variable the file is skipped. See `preset-phases.ts`.
import { SWEEP_COUNT, SWEEP_SEED, sweepCases } from './history-sweep.ts'
import { describePhases } from './preset-phases.ts'

describePhases(
  'the phases of a longer-base plan: sweep runners 101 to 150 at all 26 dates (by hand)',
  sweepCases(SWEEP_SEED, SWEEP_COUNT).slice(100, 150),
  { byHand: true },
)
