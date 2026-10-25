// Synthetic runners for the history block and the 3 x 30 start [rules g-8, E6]: the runner of
// appendix A of the load-progression proposal (S3, S4 and S5) and the shapes of the H cases of its
// section 5.3. Runs are placed by the number of weeks before the current Monday, so the same shape
// serves the engine tests (a fixed day) and the API tests (the clock). No personal data: the
// profile, the goal and every run are made up.
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, GoalModel } from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile } from '../../../shared/types.ts'
import { activity, goal, input, profile } from './e8-fixtures.ts'

/**
 * Runs `fn` with `g8.creditTaperEndWeeks` set to `value` (12 or 16, the two credit windows), then
 * restores it. The parameter is read at each call, so both windows run in one process.
 */
export function withTaperEnd<T>(value: number, fn: () => T): T {
  const before = P.g8.creditTaperEndWeeks.value
  P.g8.creditTaperEndWeeks.value = value
  try {
    return fn()
  } finally {
    P.g8.creditTaperEndWeeks.value = before
  }
}

/**
 * Runs `fn` with `g8.responseWeeks` set to `value`, then restores it. A value above the weeks the
 * athlete state holds leaves the response without a mean (`recentRunMean`), so the same input gives
 * the plan with the zone and without the response: it isolates what the response adds.
 */
export function withResponseWeeks<T>(value: number, fn: () => T): T {
  const before = P.g8.responseWeeks.value
  P.g8.responseWeeks.value = value
  try {
    return fn()
  } finally {
    P.g8.responseWeeks.value = before
  }
}

/** The weeks the response reads, set far above the 16 the state holds: no response. */
export const NO_RESPONSE = 99

/** A Saturday; the week of the plan starts on Monday 2026-10-19. */
export const HISTORY_TODAY = '2026-10-24'
export const HISTORY_MONDAY = mondayOf(HISTORY_TODAY)

/** One run: the week it falls in (whole weeks before the current Monday), the day and the minutes. */
export interface Run {
  weeksBack: number
  /** Days since the Monday of that week: 0 is Monday, 6 is Sunday. */
  dow: number
  min: number
}

/** The synthetic 100-mile trail goal of appendix A. */
export function hundredMile(): GoalModel {
  return {
    goalId: 'g-100',
    name: 'Synthetic 100 mile',
    date: '2027-05-29',
    distanceM: 160_934,
    gainM: 2500,
    lossM: 2500,
    surface: 'trail',
    goalType: 'finish',
    targetTimeSec: null,
    startTime: null,
    isUltra: true,
    distanceClass: 'ultra100mi',
    expectedDurationSec: 30 * 3600,
    crossesDarkness: true,
    raceWbgtC: null,
  }
}

/** The profile of appendix A: born 1985, no injuries, every day open; one year of running. */
export function runner(over: Partial<AthleteProfile> = {}): AthleteProfile {
  return profile({ birthYear: 1985, runningSinceYear: 2025, ...over })
}

/** Runs as activities, placed against the Monday `monday`. */
export function runsOn(monday: string, runs: readonly Run[]): Activity[] {
  return runs.map((r) => {
    const date = addDays(monday, -7 * r.weeksBack + r.dow)
    return activity(date, {
      id: `h-${date}`,
      durationSec: r.min * 60,
      movingSec: r.min * 60,
      distanceM: Math.round(r.min * 170),
    })
  })
}

/** The days a week's runs fall on, in order: Tuesday, Wednesday, Friday, Saturday, then the rest. */
const RUN_DAYS = [1, 2, 4, 5, 0, 3, 6]

/** One week of runs, one run per entry of `minutes`, on the days a runner would use. */
export function week(weeksBack: number, minutes: readonly number[]): Run[] {
  return minutes.map((min, i) => ({ weeksBack, dow: RUN_DAYS[i] as number, min }))
}

/** The same week of `minutes` for every week from `from` to `to` weeks back, inclusive. */
export function weeks(from: number, to: number, minutes: readonly number[]): Run[] {
  const runs: Run[] = []
  for (let back = from; back >= to; back -= 1) runs.push(...week(back, minutes))
  return runs
}

/**
 * The summer block of appendix A: 13 weeks from 2026-06-01 (20 weeks back to 8 weeks back), four
 * runs a week (45, 50 and 40 minutes plus a Saturday long run of 130 to 150 minutes), 265 to 285
 * minutes a week. The last four weeks run 280, 280, 280 and 285 minutes, so the block is 280.
 */
export function summer(lastWeeksBack = 8): Run[] {
  const longRuns = [130, 135, 140, 135, 145, 140, 150, 145, 140, 145, 145, 145, 150]
  return longRuns.flatMap((long, i) => {
    const back = lastWeeksBack + (longRuns.length - 1 - i)
    return [
      { weeksBack: back, dow: 1, min: 45 },
      { weeksBack: back, dow: 2, min: 50 },
      { weeksBack: back, dow: 4, min: 40 },
      { weeksBack: back, dow: 5, min: long },
    ]
  })
}

/**
 * The sparse weeks after the summer in S3: weeks of 40, 80, 0, 65, 40, 30 and 75 minutes, and none
 * in the week of 2026-10-19, with a longest run of 45 minutes in the last 30 days. Nine runs, in
 * the order they were run.
 */
export const SPARSE: readonly Run[] = [
  { weeksBack: 7, dow: 2, min: 40 }, // 2 Sep
  { weeksBack: 6, dow: 2, min: 45 }, // 9 Sep
  { weeksBack: 6, dow: 6, min: 35 }, // 13 Sep
  { weeksBack: 4, dow: 1, min: 30 }, // 22 Sep
  { weeksBack: 4, dow: 5, min: 35 }, // 26 Sep
  { weeksBack: 3, dow: 3, min: 40 }, // 1 Oct
  { weeksBack: 2, dow: 3, min: 30 }, // 8 Oct
  { weeksBack: 1, dow: 2, min: 45 }, // 14 Oct
  { weeksBack: 1, dow: 6, min: 30 }, // 18 Oct
]

/** S3: the summer block, then the sparse weeks. */
export const s3Runs = (): Run[] => [...summer(), ...SPARSE]

/** S4, the control: five 45-minute runs a week for eight weeks, so weekly time never limits. */
export const s4Runs = (): Run[] => weeks(8, 1, [45, 45, 45, 45, 45])

/** S5: the summer block and the first three sparse runs, nothing after 2026-09-13 (41 days off). */
export const s5Runs = (): Run[] => [...summer(), ...SPARSE.slice(0, 3)]

/** The engine input of a runner described by runs and a few overrides, on the fixed day. */
export function scenario(
  runs: readonly Run[],
  over: Omit<Partial<EngineInput>, 'profile'> & {
    years?: 1 | 3
    profile?: Partial<AthleteProfile>
  } = {},
): EngineInput {
  const { years = 1, profile: profileOver = {}, ...rest } = over
  return input({
    today: HISTORY_TODAY,
    profile: runner({ runningSinceYear: years === 1 ? 2025 : 2023, ...profileOver }),
    activities: runsOn(HISTORY_MONDAY, runs),
    goal: hundredMile(),
    ...rest,
  })
}

/** The same input at a position of the load setting. */
export function at(base: EngineInput, loadAppetite?: 'steady' | 'standard' | 'upper'): EngineInput {
  return {
    ...base,
    options: loadAppetite === undefined ? base.options : { ...base.options, loadAppetite },
  }
}

// ---- the shapes of the H cases (proposal section 5.3) ----

/** H1 and H2: S3 with one year of running, or with three years. */
export const h1 = (years: 1 | 3 = 1): EngineInput => scenario(s3Runs(), { years })

/** H5: the summer block ended 17 weeks ago, older than either window, and S3's sparse weeks since. */
export const h5 = (): EngineInput => scenario([...summer(17), ...SPARSE])

/**
 * H6: 13 weeks of `steady` minutes (one entry per run), 20 to 8 weeks back, except one week of 600
 * minutes in three runs of 200, 12 weeks back; then S3's sparse weeks. The dropped-week rule keeps
 * the block at the steady weeks. A plain mean of the four weeks that hold the big one would put it
 * far above them.
 */
export const h6 = (steady: readonly number[]): EngineInput =>
  scenario([
    ...weeks(20, 8, steady).filter((r) => r.weeksBack !== 12),
    ...week(12, [200, 200, 200]),
    ...SPARSE,
  ])

/**
 * H7: the summer's shape with a single run a week (120 minutes) in place of four, then S3's sparse
 * weeks: a lot of minutes, but not a block, because each week holds one run.
 */
export const h7 = (): EngineInput => scenario([...weeks(20, 8, [120]), ...SPARSE])

/** The same shape with two runs a week of 60 minutes: the least that makes a block of 120. */
export const h7Twice = (): EngineInput => scenario([...weeks(20, 8, [60, 60]), ...SPARSE])

/**
 * H26: a peak block (four weeks of 280 minutes in four runs) whose last week began 14 weeks ago, a
 * week with no run, then `since` minutes a week in `runsSince` runs for the weeks 12 to 5 weeks
 * back, and the sparse weeks of S3 after that. The empty week keeps the peak and the modest weeks
 * from forming one window.
 */
export const h26Runs = (since: number, runsSince: number): Run[] => [
  ...weeks(17, 14, [70, 70, 70, 70]),
  ...weeks(
    12,
    5,
    Array.from({ length: runsSince }, () => since / runsSince),
  ),
  ...SPARSE.filter((r) => r.weeksBack <= 4),
]

export const h26 = (since: number, runsSince: number): EngineInput =>
  scenario(h26Runs(since, runsSince))

// ---- more shapes of the H cases (rebuild zone, task L3) ----

/** H4: no gap: 20 weeks of four 60-minute runs, so the recent weeks are the block itself. */
export const h4 = (): EngineInput => scenario(weeks(20, 1, [60, 60, 60, 60]))

/**
 * H10: the summer block, then one 70-minute run a week for seven weeks: a start level above 3 x 20
 * and under two runs a week, so the runner is low frequency (A5) with a block behind.
 */
export const h10 = (): EngineInput => scenario([...summer(), ...weeks(7, 1, [70])])

/**
 * H3 once the runner is back: S5 (a 41-day layoff after the summer), then three weeks of three
 * 40-minute runs, which lifts the average past two runs a week and ends the low-frequency flag.
 */
export const h3Back = (): EngineInput =>
  scenario([...summer(), ...SPARSE.slice(0, 3), ...weeks(3, 1, [40, 40, 40])])

/** H13: S3 plus a marathon raced on 2026-10-16, so the plan is built inside the window after it. */
export function h13Race(): EngineInput {
  const base = h1()
  const race = activity('2026-10-16', {
    id: 'marathon',
    type: 'race',
    durationSec: 4 * 3600,
    movingSec: 4 * 3600,
    distanceM: 42_195,
  })
  return { ...base, activities: [...base.activities, race] }
}

/** H13: S3 with a rest window that began two days ago and ends in two days. */
export const h13Window = (): EngineInput => ({
  ...h1(),
  disruptions: [
    {
      id: 'w1',
      reason: 'illness-above-neck',
      mode: 'rest',
      startDate: '2026-10-22',
      endDate: '2026-10-26',
      maxRunMin: null,
      pain: null,
      gaitChange: false,
    },
  ],
})

/**
 * H15: a strong block (four weeks of five 90-minute runs, 450 minutes a week, ended 8 weeks ago),
 * S3's sparse weeks since, and a 5 km race `weeksAhead` weeks after the first Monday: a short
 * horizon with a low peak week (180 minutes), which the zone reaches at standard and upper.
 */
export const h15 = (weeksAhead = 12, years: 1 | 3 = 1): EngineInput =>
  scenario([...weeks(11, 8, [90, 90, 90, 90, 90]), ...SPARSE], {
    years,
    goal: {
      ...goal(),
      goalId: 'g-5k',
      name: 'Synthetic 5 km',
      date: addDays(HISTORY_MONDAY, 7 * weeksAhead + 5),
      distanceM: 5000,
      distanceClass: '5k',
      expectedDurationSec: 1500,
    },
  })
