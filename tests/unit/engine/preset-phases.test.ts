// The phases of a longer-base plan [rule P4, task M5 review] in `npm run check`: the twelve matrix
// athletes with the race moved later in steps of 7 days from 0 to 175 (the plans that put a start path
// ahead of a base, a novice, a ladder, a floor, are in the sample at their own distances to the race),
// and a sample of the history sweep, every fifth of its 150 runners at the race 0, 28, 77 and 175 days
// later. See `preset-phases.ts`; the full sweep is by hand (`preset-phases-sweep-*.test.ts`,
// `PRESET_PHASES_FULL=1`), to be run at each `PARAMS_VERSION` bump.
//
// Budget: the matrix (312 plans) and the sample (120 plans) take about 19 seconds on a development
// machine, where a longer-base plan is a double generation (the default is planned beside it, rule
// G6). The file is in the `sweep` project (`tests/vitestProjects.ts`), which sets the test timeout.
import { SWEEP_COUNT, SWEEP_SEED, sweepCases } from './history-sweep.ts'
import { athletes } from './matrix-fixtures.ts'
import { describePhases } from './preset-phases.ts'

describePhases(
  'the phases of a longer-base plan: the matrix',
  athletes().map((a) => ({ name: a.id, input: a.input })),
  { minStartPlans: 30 },
)

describePhases(
  'the phases of a longer-base plan: a sample of the sweep',
  sweepCases(SWEEP_SEED, SWEEP_COUNT).filter((_, i) => i % 5 === 0),
  { shifts: [0, 28, 77, 175] },
)
