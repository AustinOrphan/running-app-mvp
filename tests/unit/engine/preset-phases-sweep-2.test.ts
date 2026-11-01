// The phases of a longer-base plan [rule P4, task M5 review] on runners 51 to 100 of the history
// sweep (`sweepCases(20261025, 150)`), with the race moved later in steps of 7 days from 0 to 175. The
// 150 runners are split over three files so that the plans are built on three workers. See
// `preset-phases.ts`.
import { SWEEP_COUNT, SWEEP_SEED, sweepCases } from './history-sweep.ts'
import { describePhases } from './preset-phases.ts'

describePhases(
  'the phases of a longer-base plan: sweep runners 51 to 100',
  sweepCases(SWEEP_SEED, SWEEP_COUNT).slice(50, 100),
)
