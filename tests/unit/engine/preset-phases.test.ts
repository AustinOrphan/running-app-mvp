// The phases of a longer-base plan [rule P4, task M5 review] on the twelve matrix athletes, with the
// race moved later in steps of 7 days from 0 to 175: the plans that put a start path ahead of a base (a
// novice, a ladder, a floor) are in the sample at their own distances to the race. See `preset-phases.ts`.
import { athletes } from './matrix-fixtures.ts'
import { describePhases } from './preset-phases.ts'

describePhases(
  'the phases of a longer-base plan: the matrix',
  athletes().map((a) => ({ name: a.id, input: a.input })),
  30,
)
