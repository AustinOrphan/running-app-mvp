// Seeded synthetic runners for the sweep of the rebuild zone [rules g-8, proposal section 5.3]: a
// block of steady weeks of random size and age, sparse weeks since, and a goal of random kind and
// distance in time. Every runner is made up; a failing case is replayed from its seed and index.
import { addDays } from '../../../shared/dates.ts'
import type { EngineInput, GoalModel } from '../../../shared/engine/types.ts'
import type { AthleteProfile } from '../../../shared/types.ts'
import { mulberry32 } from './disruption-fixtures.ts'
import { goal as halfGoal } from './e8-fixtures.ts'
import { HISTORY_TODAY, hundredMile, scenario, week, type Run } from './history-fixtures.ts'

/** The sample of the sweep tests and of the plan report (`tests/reports/plan-report.ts`). */
export const SWEEP_SEED = 20_261_025
export const SWEEP_COUNT = 150

/** One synthetic runner of the sweep. */
export interface SweepCase {
  name: string
  input: EngineInput
  /** The longest run of the last 30 days in minutes: the reference of G-1 for every planned run. */
  longest30: number
}

/** Weeks from the first Monday to the race, by goal kind (a short horizon is H15). */
const HORIZON: Record<string, readonly [number, number]> = {
  half: [12, 30],
  marathon: [16, 36],
  'ultra-100': [24, 44],
}

function goalOf(kind: string, weeksAhead: number): GoalModel {
  const date = addDays(HISTORY_TODAY, 7 * weeksAhead + 7)
  if (kind === 'ultra-100') return { ...hundredMile(), date }
  if (kind === 'marathon') {
    return {
      ...halfGoal(),
      goalId: 'g-marathon',
      name: 'Synthetic marathon',
      date,
      distanceM: 42_195,
      distanceClass: 'marathon',
      expectedDurationSec: 4 * 3600,
    }
  }
  return { ...halfGoal(), date }
}

/** `count` runners drawn from `seed`: the same seed and count always give the same runners. */
export function sweepCases(seed: number, count: number): SweepCase[] {
  const rnd = mulberry32(seed)
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
  const pick = <T>(list: readonly T[]): T => list[int(0, list.length - 1)]!
  const out: SweepCase[] = []
  for (let n = 0; n < count; n += 1) {
    // the block: 4 to 13 weeks of 2 to 5 runs (mostly 3 to 5), ended 5 to 14 weeks before the current Monday, so
    // no run of it is in the 30 days before today
    const blockWeeks = int(4, 13)
    const runsPerWeek = rnd() < 0.2 ? 2 : int(3, 5)
    const perRun = int(35, 90)
    const ended = int(5, 14)
    // the longest run of the last 30 days, which G-1 compares every planned run with, and the
    // sparse runs since, none longer than it
    const longest30 = int(25, 70)
    // sparse runs of 15 to 45 minutes mostly, now and then up to 70
    const sparseMax = rnd() < 0.7 ? 45 : 70
    const runs: Run[] = []
    for (let back = ended + blockWeeks - 1; back >= ended; back -= 1) {
      runs.push(
        ...week(
          back,
          Array.from({ length: runsPerWeek }, () =>
            Math.round(perRun * (0.9 + 0.2 * rnd()) * (rnd() < 0.2 ? 1.6 : 1)),
          ),
        ),
      )
    }
    // the weeks since: none to two runs a week, now and then three
    for (let back = ended - 1; back >= 1; back -= 1) {
      const runsThen = rnd() < 0.15 ? 3 : int(0, 2)
      runs.push(
        ...week(
          back,
          Array.from({ length: runsThen }, () => Math.min(int(15, sparseMax), longest30)),
        ),
      )
    }
    // now and then one very large week among the sparse ones, further back than 30 days
    if (ended > 5 && rnd() < 0.15) runs.push(...week(int(5, ended - 1), [180, 150, 120]))
    // the longest run of the last 30 days, a week ago on a Sunday (no sparse week uses that day)
    runs.push({ weeksBack: 1, dow: 6, min: longest30 })
    const kind = pick(['half', 'marathon', 'ultra-100'] as const)
    const [lo, hi] = HORIZON[kind]!
    const years: 1 | 3 = rnd() < 0.5 ? 1 : 3
    const profile: Partial<AthleteProfile> = rnd() < 0.2 ? { birthYear: 1978 } : {}
    const input = scenario(runs, { years, profile, goal: goalOf(kind, int(lo, hi)) })
    out.push({
      name: `#${String(n)} ${kind} ${String(years)}y block ${String(blockWeeks)}x${String(runsPerWeek)}x${String(perRun)} ended ${String(ended)}`,
      input,
      longest30,
    })
  }
  return out
}
