// The sample of the rest-window sweep [phase 3a design 9.8, rule J9]: every matrix athlete takes
// every reason and mode, at start offsets from 14 days back to 14 days ahead and in lengths of 1, 3,
// 7, 14 and 28 days. The whole product is 14 000 plans; the seed picks a sample that covers every
// athlete with every reason and mode, so a failure names a combination to replay. Shared by
// `disruption-sweep.test.ts` and the plan report (`tests/reports/plan-report.ts`).
import { addDays } from '../../../shared/dates.ts'
import type { DisruptionWindow } from '../../../shared/engine/types.ts'
import { mulberry32, windowOf } from './disruption-fixtures.ts'
import { TODAY, type MatrixAthlete } from './matrix-fixtures.ts'

export const REST_SWEEP_SEED = 20_261_023
export const REST_SWEEP_ROUNDS = 6
export const REST_SWEEP_LENGTHS = [1, 3, 7, 14, 28] as const
const OFFSET_MIN = -14
const OFFSET_MAX = 14

export type RestWindowKind = Pick<DisruptionWindow, 'reason' | 'mode' | 'maxRunMin'>
export const REST_SWEEP_KINDS: RestWindowKind[] = [
  { reason: 'illness-above-neck', mode: 'rest', maxRunMin: null },
  { reason: 'illness-below-neck', mode: 'rest', maxRunMin: null },
  { reason: 'niggle', mode: 'rest', maxRunMin: null },
  { reason: 'niggle', mode: 'limited', maxRunMin: 30 },
  { reason: 'short-on-time', mode: 'rest', maxRunMin: null },
  { reason: 'short-on-time', mode: 'limited', maxRunMin: 30 },
  { reason: 'travel', mode: 'rest', maxRunMin: null },
  { reason: 'travel', mode: 'limited', maxRunMin: 45 },
]

/** One athlete with one window of the sample. */
export interface RestWindowCombo {
  name: string
  athlete: MatrixAthlete
  window: DisruptionWindow
}

/** The sample for `athletes`: the same seed and athletes always give the same combinations. */
export function restWindowCombos(athletes: readonly MatrixAthlete[]): RestWindowCombo[] {
  const rnd = mulberry32(REST_SWEEP_SEED)
  const pick = <T>(list: readonly T[]) => list[Math.floor(rnd() * list.length)]!
  const out: RestWindowCombo[] = []
  for (let round = 0; round < REST_SWEEP_ROUNDS; round += 1) {
    for (const athlete of athletes) {
      for (const kind of REST_SWEEP_KINDS) {
        const offset = OFFSET_MIN + Math.floor(rnd() * (OFFSET_MAX - OFFSET_MIN + 1))
        const length = pick(REST_SWEEP_LENGTHS)
        const start = addDays(TODAY, offset)
        // a window ends no later than the race (the form refuses a later last day)
        const end = [addDays(start, length - 1), athlete.input.goal.date].sort()[0]!
        out.push({
          name: `${athlete.id} ${kind.reason}/${kind.mode} ${start}..${end}`,
          athlete,
          window: windowOf({
            ...kind,
            startDate: start,
            endDate: end,
            pain: kind.reason === 'niggle' ? (rnd() < 0.5 ? 6 : 2) : null,
            gaitChange: kind.reason === 'niggle' && rnd() < 0.25,
          }),
        })
      }
    }
  }
  return out
}
