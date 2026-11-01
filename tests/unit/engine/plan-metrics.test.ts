// Hand-computed tests of the plan metrics (evaluation harness, proposal section 5.1, task H0).
// Each case is a small synthetic draft whose figures are worked by hand in the comments; the one
// case on real `buildPlan` output asserts shape and ranges only, never a target. The figures are
// descriptive: nothing here asks a plan to reach a value.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  PlanDraft,
  SessionKind,
  SessionSpec,
  Step,
  WeekDraft,
  ZoneKey,
} from '../../../shared/engine/types.ts'
import { goal, spec } from './e8-fixtures.ts'
import { weekFixture, zoneSetFixture } from './fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import {
  churnAlongChain,
  describePlan,
  distanceFromBound,
  e4Row,
  PLATEAU_TOLERANCE,
  polarizationIndex,
  TREFF_EMPTY_ZONE_FLOOR,
  type PlanContext,
} from './plan-metrics.ts'
import { replanChain } from './replan-steps.ts'

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const draftOf = (weeks: WeekDraft[], sessions: SessionSpec[] = []): PlanDraft => ({
  weeks,
  sessions,
  feasibility: {
    label: 'comfortable',
    weeksNeeded: weeks.length,
    weeksAvailable: weeks.length,
    notes: [],
  },
  warnings: [],
  checklist: [],
  prediction: null,
  zones: zoneSetFixture(),
  paramsVersion: 'test',
})

/** A half-marathon goal on Sunday 2027-01-10; `today` is the Monday the plan starts. */
const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({
  today: '2026-11-02',
  goal: { ...goal(), date: '2027-01-10' },
  options: {},
  ...over,
})

/** The Monday of week `n` of the synthetic plan: week 1 is 2026-11-02, week 10 is 2027-01-04. */
const W = (n: number): string => addDays('2026-11-02', 7 * (n - 1))

const week = (n: number, over: Partial<WeekDraft>): WeekDraft =>
  weekFixture({ weekStart: W(n), index: n - 1, runDays: 4, ...over })

const session = (
  date: string,
  kind: SessionKind,
  durationMin: number,
  over: Partial<SessionSpec> = {},
): SessionSpec => spec(date, kind, { durationMin, ...over })

const step = (kind: Step['kind'], reps: number, durationSec: number, zone: ZoneKey): Step => ({
  kind,
  reps,
  durationSec,
  distanceM: null,
  zone,
})

/** Three easy runs (Tuesday, Thursday, Saturday) of `easy` minutes and a Sunday long run. */
function fourRuns(n: number, easy: number, long: number): SessionSpec[] {
  return [
    session(addDays(W(n), 1), 'easy', easy),
    session(addDays(W(n), 3), 'easy', easy),
    session(addDays(W(n), 5), 'easy', easy),
    session(addDays(W(n), 6), 'long', long),
  ]
}

/**
 * The synthetic plan of the hand-computed cases: ten weeks, a half-marathon race on Sunday
 * 2027-01-10 (the Monday of its week is week 10).
 *
 *   week  Monday      type      target  sessions
 *   1     2026-11-02  loading   100     easy 20 x3, long 40
 *   2     2026-11-09  loading   110     easy 22 x3, long 44
 *   3     2026-11-16  loading   124     easy 24 x3, long 52
 *   4     2026-11-23  recovery   93     easy 18 x3, long 39
 *   5     2026-11-30  loading   130     easy 26 x3, long 52
 *   6     2026-12-07  loading   130     as week 5
 *   7     2026-12-14  loading   130     as week 5
 *   8     2026-12-21  taper      91     easy 18 x3, long 37
 *   9     2026-12-28  taper      65     easy 20 (Tue, Thu), long 25 (Sun): three run days
 *   10    2027-01-04  race       39     easy 13 x3, the race (Sunday, 180 min)
 *
 * Every week's sessions add up to its target; the race is no running minute.
 */
const SERIES: PlanDraft = draftOf(
  [
    week(1, { phase: 'base', targetRunMin: 100, longRunMin: 40 }),
    week(2, { phase: 'base', targetRunMin: 110, longRunMin: 44 }),
    week(3, { phase: 'base', targetRunMin: 124, longRunMin: 52 }),
    week(4, { phase: 'base', targetRunMin: 93, longRunMin: 39, isRecovery: true }),
    week(5, { phase: 'build', targetRunMin: 130, longRunMin: 52 }),
    week(6, { phase: 'build', targetRunMin: 130, longRunMin: 52 }),
    week(7, { phase: 'build', targetRunMin: 130, longRunMin: 52 }),
    week(8, {
      phase: 'taper',
      targetRunMin: 91,
      longRunMin: 37,
      isTaper: true,
      qualitySessions: 1,
    }),
    week(9, {
      phase: 'taper',
      targetRunMin: 65,
      longRunMin: 25,
      isTaper: true,
      runDays: 3,
      qualitySessions: 1,
    }),
    week(10, {
      phase: 'race',
      targetRunMin: 39,
      longRunMin: 0,
      isTaper: true,
      qualitySessions: 0,
    }),
  ],
  [
    ...fourRuns(1, 20, 40),
    ...fourRuns(2, 22, 44),
    ...fourRuns(3, 24, 52),
    ...fourRuns(4, 18, 39),
    ...fourRuns(5, 26, 52),
    ...fourRuns(6, 26, 52),
    ...fourRuns(7, 26, 52),
    ...fourRuns(8, 18, 37),
    session(addDays(W(9), 1), 'easy', 20),
    session(addDays(W(9), 3), 'easy', 20),
    session(addDays(W(9), 6), 'long', 25),
    session(addDays(W(10), 1), 'easy', 13),
    session(addDays(W(10), 3), 'easy', 13),
    session(addDays(W(10), 5), 'easy', 13),
    session(addDays(W(10), 6), 'race', 180),
  ],
)

/** A draft of loading weeks (and the given others) with a target each and no sessions. */
const targetsOnly = (targets: Array<[number, number, 'loading' | 'recovery']>): PlanDraft =>
  draftOf(
    targets.map(([n, target, type]) =>
      week(n, { targetRunMin: target, isRecovery: type === 'recovery' }),
    ),
  )

// ---------------------------------------------------------------------------------------------
// The weekly series, steps, headroom under G-2, peak and plateau
// ---------------------------------------------------------------------------------------------

describe('the weekly series', () => {
  const d = describePlan(SERIES, ctx())

  it('types each week and counts its minutes, longest run and run days from the sessions', () => {
    expect(d.weeks.map((w) => [w.weekStart, w.type])).toEqual([
      [W(1), 'loading'],
      [W(2), 'loading'],
      [W(3), 'loading'],
      [W(4), 'recovery'],
      [W(5), 'loading'],
      [W(6), 'loading'],
      [W(7), 'loading'],
      [W(8), 'taper'],
      [W(9), 'taper'],
      [W(10), 'race'],
    ])
    // planned minutes = target by construction; the race's 180 minutes are no running minute
    expect(d.weeks.map((w) => w.plannedMin)).toEqual([100, 110, 124, 93, 130, 130, 130, 91, 65, 39])
    expect(d.weeks.map((w) => w.targetMin)).toEqual([100, 110, 124, 93, 130, 130, 130, 91, 65, 39])
    // the longest volume session: the Sunday long run; week 10 has three easy runs of 13
    expect(d.weeks.map((w) => w.longRunMin)).toEqual([40, 44, 52, 39, 52, 52, 52, 37, 25, 13])
    // distinct dates with a RUN_KINDS session: week 9 has three; week 10 counts its race day
    expect(d.weeks.map((w) => w.runDays)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 3, 4])
    expect(d.weeks.map((w) => w.declaredRunDays)).toEqual([4, 4, 4, 4, 4, 4, 4, 4, 3, 4])
    expect(d.weeks.every((w) => !w.partial)).toBe(true)
  })

  it('is read in date order whatever the order of the draft', () => {
    const shuffled = draftOf([...SERIES.weeks].reverse(), [...SERIES.sessions].reverse())
    expect(describePlan(shuffled, ctx())).toEqual(d)
  })

  it('marks the week in progress as partial, from input.today', () => {
    // Wednesday of week 1: week 1 started before today
    const mid = describePlan(SERIES, ctx({ today: addDays(W(1), 2) }))
    expect(mid.weeks.map((w) => w.partial)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  it('reads run days over the loading weeks', () => {
    expect(d.runDays.value).toEqual({ min: 4, max: 4, median: 4 })
  })
})

describe('steps between loading weeks', () => {
  const d = describePlan(SERIES, ctx())

  it('measures each loading week against the previous loading week, skipping recovery', () => {
    // Loading targets 100, 110, 124, 130, 130, 130 (week 4 is a recovery week and week 8 on are
    // taper): 110/100 - 1 = 0.10, 124/110 - 1 = 0.12727, 130/124 - 1 = 0.04839, then 0 and 0.
    const rows = d.steps.value.rows
    expect(rows.map((r) => [r.weekStart, r.fromWeekStart])).toEqual([
      [W(2), W(1)],
      [W(3), W(2)],
      [W(5), W(3)],
      [W(6), W(5)],
      [W(7), W(6)],
    ])
    expect(rows.map((r) => r.change)).toEqual([
      expect.closeTo(0.1, 12),
      expect.closeTo(124 / 110 - 1, 12),
      expect.closeTo(130 / 124 - 1, 12),
      0,
      0,
    ])
    // sorted 0, 0, 0.04839, 0.10, 0.12727: the median is the third, the maximum the fifth
    expect(d.steps.value.median).toBeCloseTo(130 / 124 - 1, 12)
    expect(d.steps.value.max).toBeCloseTo(124 / 110 - 1, 12)
  })

  it('says when a step is measured from a partial week', () => {
    const mid = describePlan(SERIES, ctx({ today: addDays(W(1), 2) }))
    expect(mid.steps.value.rows.map((r) => r.fromPartial)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ])
  })

  it('has no median without two loading weeks', () => {
    const one = describePlan(targetsOnly([[1, 100, 'loading']]), ctx())
    expect(one.steps.value).toEqual({ rows: [], median: null, max: null })
  })
})

describe('headroom under G-2', () => {
  const d = describePlan(SERIES, ctx())

  it('takes the limit shares from the Params', () => {
    expect(d.headroom.soft.value.limitShare).toBe(P.g2.rampSoft.value)
    expect(d.headroom.ceiling.value.limitShare).toBe(P.g2.rampCeilingTwoWeeks.value)
  })

  it('soft step: the highest of the 2 preceding loading weeks, plus rampSoft', () => {
    // With rampSoft 0.10 (g2.rampSoft) and baselineWeeks 2 (g2.baselineWeeks), the baseline of
    // week n is the highest loading target among the Mondays 7 and 14 days earlier:
    //   week 2: week 1 = 100                      limit 110.0  headroom   0.0 (exactly at the step)
    //   week 3: weeks 2, 1 = 110, 100 -> 110      limit 121.0  headroom  -3.0 (124 is above it)
    //   week 5: week 4 is recovery, week 3 = 124  limit 136.4  headroom   6.4
    //   week 6: weeks 5, 4 -> 130                 limit 143.0  headroom  13.0
    //   week 7: weeks 6, 5 -> 130                 limit 143.0  headroom  13.0
    // Week 1 has no earlier loading week in the draft, so it has no row.
    const rows = d.headroom.soft.value.rows
    expect(rows.map((r) => r.weekStart)).toEqual([W(2), W(3), W(5), W(6), W(7)])
    expect(rows.map((r) => r.baseMin)).toEqual([100, 110, 124, 130, 130])
    expect(rows.map((r) => r.limitMin)).toEqual([
      expect.closeTo(110, 9),
      expect.closeTo(121, 9),
      expect.closeTo(136.4, 9),
      expect.closeTo(143, 9),
      expect.closeTo(143, 9),
    ])
    expect(rows.map((r) => r.headroomMin)).toEqual([
      expect.closeTo(0, 9),
      expect.closeTo(-3, 9),
      expect.closeTo(6.4, 9),
      expect.closeTo(13, 9),
      expect.closeTo(13, 9),
    ])
    expect(rows[1]!.usedShare).toBeCloseTo(124 / 110 - 1, 12)
    expect(d.headroom.soft.value.tightestMin).toBeCloseTo(-3, 9)
  })

  it('2-week ceiling: the highest loading week among those ending 2 weeks earlier, plus rampCeilingTwoWeeks', () => {
    // With rampCeilingTwoWeeks 0.30 and ceilingWindowWeeks 2, the baseline of week n is the
    // highest loading target among the Mondays 14 and 21 days earlier:
    //   week 2: nothing that early in the draft  -> no row
    //   week 3: week 1 = 100                      limit 130.0  headroom   6.0
    //   week 5: weeks 3, 2 = 124, 110 -> 124      limit 161.2  headroom  31.2
    //   week 6: week 4 is recovery, week 3 = 124  limit 161.2  headroom  31.2
    //   week 7: weeks 5, 4 -> 130                 limit 169.0  headroom  39.0
    const rows = d.headroom.ceiling.value.rows
    expect(rows.map((r) => r.weekStart)).toEqual([W(3), W(5), W(6), W(7)])
    expect(rows.map((r) => r.baseMin)).toEqual([100, 124, 124, 130])
    expect(rows.map((r) => r.headroomMin)).toEqual([
      expect.closeTo(6, 9),
      expect.closeTo(31.2, 9),
      expect.closeTo(31.2, 9),
      expect.closeTo(39, 9),
    ])
    expect(d.headroom.ceiling.value.tightestMin).toBeCloseTo(6, 9)
  })

  it('looks further back when every week of the window is a recovery week', () => {
    // loading 100, 110, then two recovery weeks, then a loading week of 115 (week 5).
    // Soft: weeks 4 and 3 are recovery, so the search goes back to week 2 = 110 and stops:
    //   limit 110 x 1.10 = 121, headroom 6. Ceiling (lag 2): weeks 3 and 2 -> week 2 is found: 110
    //   x 1.30 = 143, headroom 28.
    const back = describePlan(
      targetsOnly([
        [1, 100, 'loading'],
        [2, 110, 'loading'],
        [3, 80, 'recovery'],
        [4, 75, 'recovery'],
        [5, 115, 'loading'],
      ]),
      ctx(),
    )
    const soft = back.headroom.soft.value.rows.find((r) => r.weekStart === W(5))!
    expect(soft.baseMin).toBe(110)
    expect(soft.headroomMin).toBeCloseTo(121 - 115, 9)
    const ceiling = back.headroom.ceiling.value.rows.find((r) => r.weekStart === W(5))!
    expect(ceiling.baseMin).toBe(110)
    expect(ceiling.headroomMin).toBeCloseTo(143 - 115, 9)
  })

  it('gives a loading week no baseline when the draft holds none of the weeks before it', () => {
    const alone = describePlan(targetsOnly([[3, 100, 'loading']]), ctx())
    expect(alone.headroom.soft.value).toMatchObject({ rows: [], tightestMin: null })
    expect(alone.headroom.ceiling.value).toMatchObject({ rows: [], tightestMin: null })
  })
})

describe('peak and plateau', () => {
  const d = describePlan(SERIES, ctx())

  it('finds the first loading week at the highest target and its distance from the race week', () => {
    // highest loading target 130, first reached in week 5 (2026-11-30), the 5th week of the draft;
    // the race week begins 2027-01-04, 35 days (5 weeks) later
    expect(d.peak.value).toEqual({
      weekStart: W(5),
      targetMin: 130,
      position: 5,
      weeksBeforeRace: 5,
    })
  })

  it('counts loading weeks within 5% of the peak and the longest run of them', () => {
    expect(PLATEAU_TOLERANCE).toBe(0.05)
    // 130 x 0.95 = 123.5. Loading targets 100, 110, 124, 130, 130, 130: 124 is inside by half a
    // minute, so four of the six weeks are within, in one run (the recovery week between weeks 3
    // and 5 is skipped), starting with week 3.
    expect(d.plateau.value).toEqual({
      toleranceShare: 0.05,
      loadingWeeks: 6,
      weeksWithin: 4,
      longestRun: 4,
      firstWeekStart: W(3),
    })
  })

  it('splits a plateau in two runs when a loading week falls out of it', () => {
    // 100, 100, 80, 100: 80 is below 95, so two runs of 2 and 1; three weeks are within
    const gap = describePlan(
      targetsOnly([
        [1, 100, 'loading'],
        [2, 100, 'loading'],
        [3, 80, 'loading'],
        [4, 100, 'loading'],
      ]),
      ctx(),
    )
    expect(gap.plateau.value).toMatchObject({ weeksWithin: 3, longestRun: 2, firstWeekStart: W(1) })
    expect(gap.peak.value).toMatchObject({ weekStart: W(1), position: 1, weeksBeforeRace: 9 })
  })

  it('puts the edge of the plateau at 5% below the peak', () => {
    // peak 200, edge 190: 191 is within, 189 is not
    const edge = describePlan(
      targetsOnly([
        [1, 200, 'loading'],
        [2, 191, 'loading'],
        [3, 189, 'loading'],
      ]),
      ctx(),
    )
    expect(edge.plateau.value).toMatchObject({ loadingWeeks: 3, weeksWithin: 2, longestRun: 2 })
  })

  it('has no peak or plateau without a loading week', () => {
    const none = describePlan(targetsOnly([[1, 60, 'recovery']]), ctx())
    expect(none.peak.value).toBeNull()
    expect(none.plateau.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Long-run share, distribution, polarization
// ---------------------------------------------------------------------------------------------

describe('long-run share', () => {
  it('is the longest session over the planned minutes, per loading week', () => {
    // week 1 40/100 = 0.4; week 2 44/110 = 0.4; week 3 52/124 = 0.41935; weeks 5-7 52/130 = 0.4
    const share = describePlan(SERIES, ctx()).longRunShare.value
    expect(share.rows.map((r) => r.weekStart)).toEqual([W(1), W(2), W(3), W(5), W(6), W(7)])
    expect(share.rows.map((r) => r.share)).toEqual([
      expect.closeTo(0.4, 12),
      expect.closeTo(0.4, 12),
      expect.closeTo(52 / 124, 12),
      expect.closeTo(0.4, 12),
      expect.closeTo(0.4, 12),
      expect.closeTo(0.4, 12),
    ])
    // mean (5 x 0.4 + 0.41935) / 6 = 0.403226; max 0.41935
    expect(share.mean).toBeCloseTo((5 * 0.4 + 52 / 124) / 6, 12)
    expect(share.max).toBeCloseTo(52 / 124, 12)
  })
})

describe('realised against declared distribution', () => {
  /**
   * One loading week of 225 planned minutes, declared 80/12/8:
   *   Tue easy 40         no steps            -> Z1 40
   *   Wed threshold 50    10 z1, 20 z2, 10 z1 -> Z1 30 (10 + 10 + the 10 min the steps do not
   *                                              name), Z2 20
   *   Fri intervals 45    10 z1, 4 x 3 z3 work, 4 x 3 z1 recover, 10 z1 -> Z3 12, Z1 33
   *   Sun long 90         no steps            -> Z1 90
   * Z1 = 40 + 30 + 33 + 90 = 193, Z2 = 20, Z3 = 12 (of 225): 85.78 / 8.89 / 5.33 percent.
   */
  const monday = W(1)
  const day = (d: number) => addDays(monday, d)
  const zoned = draftOf(
    [week(1, { phase: 'build', targetRunMin: 225, tid: { z1: 80, z2: 12, z3: 8 } })],
    [
      session(day(1), 'easy', 40),
      session(day(2), 'threshold', 50, {
        structure: [
          step('warmup', 1, 600, 'z1'),
          step('work', 1, 1200, 'z2'),
          step('cooldown', 1, 600, 'z1'),
        ],
      }),
      session(day(4), 'intervals', 45, {
        structure: [
          step('warmup', 1, 600, 'z1'),
          step('work', 4, 180, 'z3'),
          step('recover', 4, 180, 'z1'),
          step('cooldown', 1, 600, 'z1'),
        ],
      }),
      session(day(6), 'long', 90),
    ],
  )

  it('reads the declared shares from the week and the realised ones from the steps', () => {
    const { rows, declared, realised } = describePlan(zoned, ctx()).distribution.value
    expect(rows).toHaveLength(1)
    expect(rows[0]!.declared).toEqual({ z1: 80, z2: 12, z3: 8 })
    expect(rows[0]!.realised!.z1).toBeCloseTo((193 / 225) * 100, 9)
    expect(rows[0]!.realised!.z2).toBeCloseTo((20 / 225) * 100, 9)
    expect(rows[0]!.realised!.z3).toBeCloseTo((12 / 225) * 100, 9)
    // one week: the plan's figures are the week's
    expect(declared).toEqual({ z1: 80, z2: 12, z3: 8 })
    expect(realised!.z1).toBeCloseTo(85.7778, 4)
    expect(realised!.z2).toBeCloseTo(8.8889, 4)
    expect(realised!.z3).toBeCloseTo(5.3333, 4)
  })

  it('weights the declared shares by target minutes and the realised ones by planned minutes', () => {
    // second loading week: declared 90/6/4, target 75, one easy run of 75 minutes (all Z1)
    const two = draftOf(
      [
        ...zoned.weeks,
        week(2, { phase: 'build', targetRunMin: 75, tid: { z1: 90, z2: 6, z3: 4 } }),
      ],
      [...zoned.sessions, session(addDays(W(2), 1), 'easy', 75)],
    )
    const { declared, realised } = describePlan(two, ctx()).distribution.value
    // declared: z1 (80 x 225 + 90 x 75) / 300 = 82.5, z2 (12 x 225 + 6 x 75) / 300 = 10.5,
    // z3 (8 x 225 + 4 x 75) / 300 = 7
    expect(declared.z1).toBeCloseTo(82.5, 9)
    expect(declared.z2).toBeCloseTo(10.5, 9)
    expect(declared.z3).toBeCloseTo(7, 9)
    // realised: Z1 193 + 75 = 268, Z2 20, Z3 12, of 300
    expect(realised!.z1).toBeCloseTo((268 / 300) * 100, 9)
    expect(realised!.z2).toBeCloseTo((20 / 300) * 100, 9)
    expect(realised!.z3).toBeCloseTo((12 / 300) * 100, 9)
  })

  it('counts race-pace work in Z2 above 10 km and in Z3 at 5 and 10 km, and strides in Z3', () => {
    // race-pace 40: 10 z1, 20 race-pace, 10 z1; strides 30: 22 min steady, 6 x 20 s strides, 6 x 60 s recovery
    const mix = draftOf(
      [week(1, { phase: 'specific', targetRunMin: 70 })],
      [
        session(addDays(W(1), 1), 'race-pace', 40, {
          structure: [
            step('warmup', 1, 600, 'z1'),
            step('work', 1, 1200, 'race-pace'),
            step('cooldown', 1, 600, 'z1'),
          ],
        }),
        session(addDays(W(1), 3), 'strides', 30, {
          structure: [
            step('steady', 1, 1320, 'z1'),
            step('work', 6, 20, 'strides'),
            step('recover', 6, 60, 'z1'),
          ],
        }),
      ],
    )
    // half: Z1 20 + 28, Z2 20, Z3 2 (6 x 20 s) of 70 minutes
    const half = describePlan(mix, ctx()).distribution.value.realised!
    expect(half.z1).toBeCloseTo((48 / 70) * 100, 9)
    expect(half.z2).toBeCloseTo((20 / 70) * 100, 9)
    expect(half.z3).toBeCloseTo((2 / 70) * 100, 9)
    // 5 km: the race-pace minutes move to Z3
    const fiveK = describePlan(
      mix,
      ctx({ goal: { ...goal(), distanceClass: '5k', date: '2027-01-10' } }),
    ).distribution.value.realised!
    expect(fiveK.z2).toBeCloseTo(0, 9)
    expect(fiveK.z3).toBeCloseTo((22 / 70) * 100, 9)
  })

  it('has no realised distribution for a week without planned minutes', () => {
    const empty = describePlan(draftOf([week(1, { targetRunMin: 60 })]), ctx())
    expect(empty.distribution.value.rows[0]!.realised).toBeNull()
    expect(empty.distribution.value.realised).toBeNull()
    expect(empty.polarization.value.realised).toBeNull()
  })
})

describe('the E4 row', () => {
  const tolerance = P.e4.priorTolerancePp.value

  it('reads the build row from the prior and the tolerance Param: 80/12/8 within 5 points', () => {
    const row = e4Row('build', 'marathon')
    expect(row.z1).toEqual({
      lo: P.e4.z1Prior.value - tolerance,
      hi: P.e4.z1Prior.value + tolerance,
    })
    expect(row.z2).toEqual({
      lo: P.e4.z2Prior.value - tolerance,
      hi: P.e4.z2Prior.value + tolerance,
    })
    expect(row.z3).toEqual({
      lo: P.e4.z3Prior.value - tolerance,
      hi: P.e4.z3Prior.value + tolerance,
    })
    // by hand, with the registry at 80/12/8 and 5: 75 to 85, 7 to 17, 3 to 13
    expect([row.z1, row.z2, row.z3]).toEqual([
      { lo: 75, hi: 85 },
      { lo: 7, hi: 17 },
      { lo: 3, hi: 13 },
    ])
    // the label is the weakest grade of the four Params it rests on, with the rule
    expect(row.basis).toEqual({ value: null, grade: 'C', rule: 'E4' })
  })

  it('base: Z1 at least 80, Z2 at most 12, Z3 the point 5, for 5 km to marathon alike', () => {
    for (const goalClass of ['5k', '10k', 'half', 'marathon'] as const) {
      const row = e4Row('base', goalClass)
      expect(row.z1).toEqual({ lo: 80, hi: null })
      expect(row.z2).toEqual({ lo: null, hi: 12 })
      expect(row.z3).toEqual({ lo: 5, hi: 5 })
    }
  })

  it('specific: Z2 at most 25 and Z1 at least the floor, with no figure for Z3', () => {
    for (const goalClass of ['5k', '10k', 'half', 'marathon'] as const) {
      const row = e4Row('specific', goalClass)
      expect(row.z1).toEqual({ lo: P.e4.z1Floor.value, hi: null })
      expect(row.z2).toEqual({ lo: null, hi: 25 })
      expect(row.z3).toBeNull()
    }
    expect(e4Row('specific', 'marathon').basis.rule).toBe('E4')
  })

  it('taper and race week read the hard rules only: intensity kept, volume cut', () => {
    const row = e4Row('taper', 'half')
    expect(row.z1).toEqual({ lo: P.e4.z1Floor.value, hi: null })
    expect(row.z2).toEqual({ lo: null, hi: P.e4.z2CapAnyPhase.value })
    expect(row.z3).toBeNull()
  })

  it('an ultra goal: Z1 at least 85 in every phase, and in base Z3 at most 5, graded D', () => {
    for (const goalClass of ['ultra50', 'ultra100k', 'ultra100mi', 'beyond'] as const) {
      expect(e4Row('base', goalClass)).toMatchObject({
        z1: { lo: 85, hi: null },
        z2: null,
        z3: { lo: null, hi: 5 },
        basis: { grade: 'D', rule: 'E4' },
      })
      for (const phase of ['build', 'specific', 'taper'] as const) {
        expect(e4Row(phase, goalClass)).toMatchObject({
          z1: { lo: 85, hi: null },
          z2: null,
          z3: null,
        })
      }
    }
  })

  it('prints the distance from a bound: 0 inside, else signed to the nearest edge', () => {
    const band = { lo: 75, hi: 85 }
    expect(distanceFromBound(band, 80)).toBe(0)
    expect(distanceFromBound(band, 75)).toBe(0)
    expect(distanceFromBound(band, 85)).toBe(0)
    expect(distanceFromBound(band, 91.5)).toBeCloseTo(6.5, 12)
    expect(distanceFromBound(band, 70)).toBe(-5)
    expect(distanceFromBound({ lo: 80, hi: null }, 99)).toBe(0)
    expect(distanceFromBound({ lo: null, hi: 12 }, 14)).toBe(2)
    expect(distanceFromBound({ lo: 5, hi: 5 }, 1)).toBe(-4)
    expect(distanceFromBound(null, 50)).toBeNull()
    expect(distanceFromBound(band, null)).toBeNull()
  })
})

describe('the distribution of each phase and the work above zone 1', () => {
  /**
   * Two base weeks and a build week of a half-marathon plan, a taper week and the race week.
   *
   *   week 1 base, 100 min, tid 83/12/5     easy 30 x2, long 40                -> Z1 100
   *   week 2 base, 100 min, tid 83/12/5     easy 40, strides 20 (6 x 20 s), long 40
   *                                         -> Z1 98, Z3 2 (strides)
   *   week 3 build, 225 min, tid 80/12/8    easy 40, threshold 50 (20 min Z2), intervals 45
   *                                         (4 x 3 min Z3), long 90 -> Z1 193, Z2 20, Z3 12
   *   week 4 taper, 60 min, tid 80/15/5     easy 20 x3
   *   week 5 race, 30 min, tid 80/15/5      easy 15 x2 and the race (not a running minute)
   *   week 6 base, flagged post-race        easy 20 (left out of every phase)
   *   week 7 base, recovery week            strides 20 x2 (left out: a phase is read over its
   *                                         loading weeks, as every other distribution figure is)
   */
  const day = (n: number, d: number) => addDays(W(n), d)
  const strides = (n: number, d: number) =>
    session(day(n, d), 'strides', 20, {
      structure: [
        step('steady', 1, 840, 'z1'),
        step('work', 6, 20, 'strides'),
        step('recover', 6, 60, 'z1'),
      ],
    })
  const draft = draftOf(
    [
      week(1, { phase: 'base', targetRunMin: 100, tid: { z1: 83, z2: 12, z3: 5 } }),
      week(2, { phase: 'base', targetRunMin: 100, tid: { z1: 83, z2: 12, z3: 5 } }),
      week(3, { phase: 'build', targetRunMin: 225, tid: { z1: 80, z2: 12, z3: 8 } }),
      week(4, {
        phase: 'taper',
        targetRunMin: 60,
        isTaper: true,
        tid: { z1: 80, z2: 15, z3: 5 },
      }),
      week(5, {
        phase: 'race',
        targetRunMin: 30,
        isTaper: true,
        tid: { z1: 80, z2: 15, z3: 5 },
      }),
      week(6, { phase: 'base', targetRunMin: 20, flags: ['post-race'] }),
      week(7, { phase: 'base', targetRunMin: 40, isRecovery: true }),
    ],
    [
      session(day(1, 1), 'easy', 30),
      session(day(1, 3), 'easy', 30),
      session(day(1, 6), 'long', 40),
      session(day(2, 1), 'easy', 40),
      strides(2, 3),
      session(day(2, 6), 'long', 40),
      session(day(3, 1), 'easy', 40),
      session(day(3, 2), 'threshold', 50, {
        structure: [
          step('warmup', 1, 600, 'z1'),
          step('work', 1, 1200, 'z2'),
          step('cooldown', 1, 600, 'z1'),
        ],
      }),
      session(day(3, 4), 'intervals', 45, {
        structure: [
          step('warmup', 1, 600, 'z1'),
          step('work', 4, 180, 'z3'),
          step('recover', 4, 180, 'z1'),
          step('cooldown', 1, 600, 'z1'),
        ],
      }),
      session(day(3, 6), 'long', 90),
      session(day(4, 1), 'easy', 20),
      session(day(4, 3), 'easy', 20),
      session(day(4, 5), 'easy', 20),
      session(day(5, 1), 'easy', 15),
      session(day(5, 3), 'easy', 15),
      session(day(5, 6), 'race', 180),
      session(day(6, 1), 'easy', 20),
      strides(7, 1),
      strides(7, 3),
    ],
  )
  const d = describePlan(draft, ctx())
  const phases = d.intensityByPhase.value

  it('has a row for each phase the draft holds, the race week with the taper', () => {
    // the base row reads the two loading weeks: not the recovery week, not the post-race week
    expect(phases.map((p) => [p.phase, p.weeks])).toEqual([
      ['base', 2],
      ['build', 1],
      ['taper', 2],
    ])
  })

  it('pools the planned minutes of the phase and weights the declared shares by target', () => {
    const [base, build, taper] = phases
    // base: Z1 100 + 98, Z3 2, of 200 minutes
    expect(base!.realised!.z1).toBeCloseTo(99, 9)
    expect(base!.realised!.z2).toBeCloseTo(0, 9)
    expect(base!.realised!.z3).toBeCloseTo(1, 9)
    expect(base!.declared).toEqual({ z1: 83, z2: 12, z3: 5 })
    // build: 193 / 20 / 12 of 225
    expect(build!.realised!.z1).toBeCloseTo((193 / 225) * 100, 9)
    expect(build!.realised!.z2).toBeCloseTo((20 / 225) * 100, 9)
    expect(build!.realised!.z3).toBeCloseTo((12 / 225) * 100, 9)
    // taper and race week: 60 + 30 easy minutes, the race itself no running minute
    expect(taper!.realised).toEqual({ z1: 100, z2: 0, z3: 0 })
    // declared, weighted by target: (80 x 60 + 80 x 30) / 90, (15 x 60 + 15 x 30) / 90
    expect(taper!.declared.z1).toBeCloseTo(80, 9)
    expect(taper!.declared.z2).toBeCloseTo(15, 9)
  })

  it('leaves the recovery weeks and the post-race return steps out of every phase', () => {
    expect(phases.reduce((sum, p) => sum + p.weeks, 0)).toBe(5)
    // the recovery week's 4 strides minutes would lift the base row's zone 3 from 1 to 2.5 percent
    expect(phases[0]!.realised!.z3).toBeCloseTo(1, 9)
  })

  it('leaves out the weeks that a start path sets: they are drawn at 100/0/0, not from E4', () => {
    const programme = { z1: 100, z2: 0, z3: 0 }
    const mixed = draftOf(
      [
        week(1, { phase: 'build', targetRunMin: 60, tid: programme, flags: ['restart-floor'] }),
        week(2, {
          phase: 'build',
          targetRunMin: 60,
          tid: programme,
          flags: ['ladder-2', 'run-walk'],
        }),
        week(4, {
          phase: 'build',
          targetRunMin: 60,
          tid: programme,
          flags: ['injury-return', 'injury-level-1'],
        }),
        week(3, { phase: 'build', targetRunMin: 225, tid: { z1: 80, z2: 12, z3: 8 } }),
      ],
      [
        session(day(1, 1), 'easy', 60),
        session(day(2, 1), 'easy', 60),
        session(day(4, 1), 'easy', 60),
        ...draft.sessions.filter((s) => s.date >= W(3) && s.date < W(4)),
      ],
    )
    const rows = describePlan(mixed, ctx()).intensityByPhase.value
    // only the ordinary build week is read against the build row
    expect(rows.map((p) => [p.phase, p.weeks])).toEqual([['build', 1]])
    expect(rows[0]!.declared).toEqual({ z1: 80, z2: 12, z3: 8 })
    expect(rows[0]!.realised!.z1).toBeCloseTo((193 / 225) * 100, 9)
    expect(rows[0]!.distance.z1).toBeCloseTo((193 / 225) * 100 - 85, 9)
    // a draft of start-path weeks alone has no phase row at all
    const programmeOnly = draftOf(mixed.weeks.slice(0, 3), mixed.sessions.slice(0, 3))
    expect(describePlan(programmeOnly, ctx()).intensityByPhase.value).toEqual([])
  })

  it('prints the distance of each zone from its E4 bound, as a description', () => {
    const [base, build, taper] = phases
    // base: Z1 99 is over 80, Z2 0 is under 12, Z3 1 is 4 under the point 5
    expect(base!.distance.z1).toBe(0)
    expect(base!.distance.z2).toBe(0)
    expect(base!.distance.z3).toBeCloseTo(-4, 9)
    // build: Z1 85.78 is 0.78 over 85, Z2 8.89 is inside 7 to 17, Z3 5.33 is inside 3 to 13
    expect(build!.distance.z1).toBeCloseTo((193 / 225) * 100 - 85, 9)
    expect(build!.distance.z2).toBe(0)
    expect(build!.distance.z3).toBe(0)
    // taper: Z3 has no bound
    expect(taper!.distance).toEqual({ z1: 0, z2: 0, z3: null })
    expect(taper!.row).toEqual(e4Row('taper', 'half'))
  })

  it('labels the figure with the E4 Params it rests on', () => {
    expect(d.intensityByPhase).toMatchObject({ grade: 'C', rule: 'E4' })
  })

  it('has no phase rows, and no realised mix, for a draft without planned minutes', () => {
    const empty = describePlan(draftOf([week(1, { phase: 'build', targetRunMin: 60 })]), ctx())
    expect(empty.intensityByPhase.value).toHaveLength(1)
    expect(empty.intensityByPhase.value[0]).toMatchObject({
      realised: null,
      distance: { z1: null, z2: null, z3: null },
    })
    expect(describePlan(draftOf([]), ctx()).intensityByPhase.value).toEqual([])
  })

  it('counts the minutes above zone 1 of the quality sessions of the loading weeks', () => {
    // threshold 20 Z2 minutes and intervals 12 Z3 minutes; strides are no quality session here
    expect(d.qualityWork.value).toEqual({ sessions: 2, workMin: 32, perSession: 16 })
  })

  it('counts the minutes at or above zone 2 in each loading week', () => {
    // week 1: none; week 2: 2 (strides); week 3: 20 + 12 = 32
    expect(d.weeklyZ2Plus.value.rows).toEqual([
      { weekStart: W(1), min: 0 },
      { weekStart: W(2), min: 2 },
      { weekStart: W(3), min: 32 },
    ])
    expect(d.weeklyZ2Plus.value.mean).toBeCloseTo(34 / 3, 12)
    expect(d.weeklyZ2Plus.value.max).toBe(32)
  })

  it('has no per-session figure without a quality session', () => {
    const easyOnly = describePlan(
      draftOf([week(1, { phase: 'base', targetRunMin: 60 })], [session(day(1, 1), 'easy', 60)]),
      ctx(),
    )
    expect(easyOnly.qualityWork.value).toEqual({ sessions: 0, workMin: 0, perSession: null })
    expect(easyOnly.weeklyZ2Plus.value.mean).toBe(0)
  })

  it('labels the two figures with the rules they rest on', () => {
    expect(d.qualityWork).toMatchObject({ grade: 'D', rule: 'F2' })
    expect(d.weeklyZ2Plus).toMatchObject({ grade: 'D', rule: 'E4, F2' })
  })
})

describe("Treff's polarization index", () => {
  const twoDecimals = (shares: { z1: number; z2: number; z3: number }) =>
    Math.round(polarizationIndex(shares).value! * 100) / 100

  it('gives the three values of the proposal, to two decimals', () => {
    // log10((Z1 / Z2) x Z3 x 100) on fractions:
    //   80/12/8:  (0.80 / 0.12) x 0.08 x 100 = 53.33   -> 1.727 = 1.73
    //   80/5/15:  (0.80 / 0.05) x 0.15 x 100 = 240     -> 2.380 = 2.38
    //   80/8/12:  (0.80 / 0.08) x 0.12 x 100 = 120     -> 2.079 = 2.08 (Treff's own example)
    expect(twoDecimals({ z1: 80, z2: 12, z3: 8 })).toBe(1.73)
    expect(twoDecimals({ z1: 80, z2: 5, z3: 15 })).toBe(2.38)
    expect(twoDecimals({ z1: 80, z2: 8, z3: 12 })).toBe(2.08)
  })

  it('prints the zone order beside the value, never a label', () => {
    // Z2 above Z3 in 80/12/8: not a polarized structure by Treff's own definition, whatever the value
    expect(polarizationIndex({ z1: 80, z2: 12, z3: 8 }).order).toBe('Z1 > Z2 > Z3')
    expect(polarizationIndex({ z1: 80, z2: 5, z3: 15 }).order).toBe('Z1 > Z3 > Z2')
    expect(polarizationIndex({ z1: 80, z2: 8, z3: 12 }).order).toBe('Z1 > Z3 > Z2')
    expect(polarizationIndex({ z1: 50, z2: 25, z3: 25 }).order).toBe('Z1 > Z2 = Z3')
    expect(Object.keys(polarizationIndex({ z1: 80, z2: 5, z3: 15 })).sort()).toEqual([
      'fractions',
      'order',
      'value',
    ])
  })

  it('takes percent, minutes and fractions alike', () => {
    const percent = polarizationIndex({ z1: 80, z2: 12, z3: 8 }).value!
    expect(polarizationIndex({ z1: 0.8, z2: 0.12, z3: 0.08 }).value).toBeCloseTo(percent, 12)
    expect(polarizationIndex({ z1: 160, z2: 24, z3: 16 }).value).toBeCloseTo(percent, 12)
    expect(polarizationIndex({ z1: 160, z2: 24, z3: 16 }).fractions.z1).toBeCloseTo(0.8, 12)
  })

  it('sets an empty zone 2 to 0.01 (Eq. 2)', () => {
    expect(TREFF_EMPTY_ZONE_FLOOR).toBe(0.01)
    // 80/0/20: (0.80 / 0.01) x 0.20 x 100 = 1600 -> 3.204
    expect(polarizationIndex({ z1: 80, z2: 0, z3: 20 }).value).toBeCloseTo(Math.log10(1600), 12)
  })

  it('has no value when zone 1 or zone 3 is empty, or the distribution is', () => {
    expect(polarizationIndex({ z1: 90, z2: 10, z3: 0 }).value).toBeNull()
    expect(polarizationIndex({ z1: 0, z2: 10, z3: 90 }).value).toBeNull()
    expect(polarizationIndex({ z1: 0, z2: 0, z3: 0 })).toMatchObject({ value: null })
  })

  it("is computed for the plan's declared and realised distribution, without a label", () => {
    // Declared 80/12/8 -> 1.73. Realised 193/20/12 of 225: (193 / 20) x (12 / 225) x 100 = 51.47
    // -> 1.7115, Z1 > Z2 > Z3.
    const monday = W(1)
    const zoned = draftOf(
      [week(1, { phase: 'build', targetRunMin: 225, tid: { z1: 80, z2: 12, z3: 8 } })],
      [
        session(addDays(monday, 1), 'easy', 40),
        session(addDays(monday, 2), 'threshold', 50, {
          structure: [step('work', 1, 1200, 'z2')],
        }),
        session(addDays(monday, 4), 'intervals', 45, {
          structure: [step('work', 4, 180, 'z3')],
        }),
        session(addDays(monday, 6), 'long', 90),
      ],
    )
    const pi = describePlan(zoned, ctx()).polarization
    expect(pi.grade).toBeNull()
    expect(pi.rule).toBeNull()
    expect(pi.value.declared.value).toBeCloseTo(Math.log10((80 / 12) * 8), 12)
    expect(pi.value.declared.order).toBe('Z1 > Z2 > Z3')
    expect(pi.value.realised!.value).toBeCloseTo(Math.log10((193 / 20) * (12 / 225) * 100), 9)
    expect(pi.value.realised!.order).toBe('Z1 > Z2 > Z3')
  })
})

// ---------------------------------------------------------------------------------------------
// Planned load, monotony and strain
// ---------------------------------------------------------------------------------------------

describe('planned load', () => {
  it('is minutes times the midpoint of expectedRpe.<kind>, over the running minutes only', () => {
    // Ten minutes each of easy [2,3] -> 2.5, long [3,4] -> 3.5, threshold [5,6] -> 5.5,
    // intervals [7,8] -> 7.5, recovery [1,2] -> 1.5 and hills [6,7] -> 6.5:
    //   10 x (2.5 + 3.5 + 5.5 + 7.5 + 1.5 + 6.5) = 10 x 27 = 270.
    // Strength (60 min), a hike (30) and the race (100) are no running minutes and add nothing.
    const day = (d: number) => addDays(W(1), d)
    const draft = draftOf(
      [week(1, { phase: 'build', targetRunMin: 60 })],
      [
        session(day(0), 'easy', 10),
        session(day(1), 'long', 10),
        session(day(1), 'strength', 60),
        session(day(2), 'threshold', 10),
        session(day(3), 'intervals', 10),
        session(day(4), 'recovery', 10),
        session(day(5), 'hills', 10),
        session(day(5), 'hike', 30),
        session(day(6), 'race', 100),
      ],
    )
    const d = describePlan(draft, ctx())
    expect(d.load.value).toEqual([{ weekStart: W(1), load: 270 }])
    expect(d.weeks[0]).toMatchObject({ plannedMin: 60, longRunMin: 10, runDays: 7 })
    // the label is the proposal's: expectedRpe is grade D (rule C4), relative only
    expect(d.load.grade).toBe('D')
    expect(d.load.rule).toBe('C4')
  })

  it('is a week of seven days for monotony: mean over population SD, strain = load x monotony', () => {
    // Easy runs of 10, 20, ..., 70 minutes on Monday to Sunday -> loads 25, 50, ..., 175: mean 100,
    // deviations -75 ... 75, population variance (2 x (75^2 + 50^2 + 25^2)) / 7 = 2500, SD 50.
    // Monotony 100 / 50 = 2, weekly load 700, strain 1400.
    const draft = draftOf(
      [week(1, { phase: 'build', targetRunMin: 280 })],
      [10, 20, 30, 40, 50, 60, 70].map((min, d) => session(addDays(W(1), d), 'easy', min)),
    )
    const d = describePlan(draft, ctx())
    expect(d.load.value[0]!.load).toBe(700)
    expect(d.monotony.value[0]!.monotony).toBeCloseTo(2, 12)
    expect(d.monotony.value[0]!.strain).toBeCloseTo(1400, 9)
  })

  it('uses monotonyStrain, labelled B7 grade C, and prints no flag', () => {
    // Week 1 of the series: easy 20 on Tue, Thu, Sat (load 50 each), long 40 on Sunday (load 140),
    // nothing on Monday, Wednesday, Friday: loads 0, 50, 0, 50, 0, 50, 140; sum x = 290 and
    // sum x^2 = 3 x 50^2 + 140^2 = 27100. Monotony = sum x / sqrt(7 sum x^2 - (sum x)^2)
    // = 290 / sqrt(189700 - 84100) = 290 / sqrt(105600) = 0.8924; strain = 290 x 0.8924 = 258.8.
    // Week 5 (easy 26, long 52) has the same shape at 1.3 times the load: 377, monotony 0.8924.
    const d = describePlan(SERIES, ctx())
    const w1 = d.monotony.value.find((r) => r.weekStart === W(1))!
    expect(d.load.value.find((r) => r.weekStart === W(1))!.load).toBe(290)
    expect(w1.monotony).toBeCloseTo(290 / Math.sqrt(105600), 9)
    expect(w1.strain).toBeCloseTo((290 * 290) / Math.sqrt(105600), 9)
    const w5 = d.monotony.value.find((r) => r.weekStart === W(5))!
    expect(d.load.value.find((r) => r.weekStart === W(5))!.load).toBe(377)
    expect(w5.monotony).toBeCloseTo(290 / Math.sqrt(105600), 9)
    expect(d.monotony.grade).toBe('C')
    expect(d.monotony.rule).toBe('B7')
    expect(d.monotony.grade).toBe(P.b7.monotonyWindowDays.grade)
    // no flag: a plan has no range of its own to flag against
    expect(Object.keys(d.monotony.value[0]!).sort()).toEqual(['monotony', 'strain', 'weekStart'])
  })

  it('leaves monotony out of a partial week and a flat or empty one, and keeps its load', () => {
    const mid = describePlan(SERIES, ctx({ today: addDays(W(1), 2) }))
    expect(mid.monotony.value[0]).toEqual({ weekStart: W(1), monotony: null, strain: null })
    expect(mid.load.value[0]).toEqual({ weekStart: W(1), load: 290 })
    // seven equal days: SD 0, so no monotony
    const flat = draftOf(
      [week(1, { targetRunMin: 210 })],
      [0, 1, 2, 3, 4, 5, 6].map((d) => session(addDays(W(1), d), 'easy', 30)),
    )
    expect(describePlan(flat, ctx()).monotony.value[0]).toEqual({
      weekStart: W(1),
      monotony: null,
      strain: null,
    })
    expect(describePlan(draftOf([week(1, { targetRunMin: 0 })]), ctx()).load.value[0]!.load).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Cycle and taper
// ---------------------------------------------------------------------------------------------

describe('cycle descriptors', () => {
  it('counts the loading weeks between recovery weeks and the cut of each recovery week', () => {
    // weeks 1-3 loading, 4 recovery (93 against 124: 1 - 0.75 = 0.25), 5-7 loading, then the taper
    const { cycle } = describePlan(SERIES, ctx())
    expect(cycle.value.loadingRuns).toEqual([3, 3])
    expect(cycle.value.longestRun).toBe(3)
    expect(cycle.value.recoveryWeeks).toHaveLength(1)
    expect(cycle.value.recoveryWeeks[0]!.weekStart).toBe(W(4))
    expect(cycle.value.recoveryWeeks[0]!.cutShare).toBeCloseTo(0.25, 12)
    expect(cycle.value.meanCutShare).toBeCloseTo(0.25, 12)
    expect(cycle.value.declared).toBeNull()
    // read beside the Params; E3 is grade D
    expect(cycle.value.reference).toEqual({
      defaultWorkWeeks: P.e3.defaultCycleWorkWeeks.value,
      flaggedWorkWeeks: P.e3.flaggedCycleWorkWeeks.value,
      cutPct: P.e3.recoveryWeekCutPct.value,
      cutPctRange: P.e3.recoveryWeekCutPct.range,
    })
    expect(cycle.grade).toBe(P.e3.recoveryWeekCutPct.grade)
    expect(cycle.rule).toBe(P.e3.recoveryWeekCutPct.rule)
  })

  it('echoes the cycle the runner chose', () => {
    expect(
      describePlan(SERIES, ctx({ options: { recoveryCycle: '2:1' } })).cycle.value.declared,
    ).toBe('2:1')
  })

  it('has no cut for a recovery week with no loading week before it', () => {
    const { cycle } = describePlan(
      targetsOnly([
        [1, 60, 'recovery'],
        [2, 100, 'loading'],
      ]),
      ctx(),
    )
    expect(cycle.value.recoveryWeeks).toEqual([{ weekStart: W(1), cutShare: null }])
    expect(cycle.value.loadingRuns).toEqual([1])
    expect(cycle.value.meanCutShare).toBeNull()
  })
})

describe('taper descriptors', () => {
  const { taper } = describePlan(SERIES, ctx())

  it('reads the taper against the last loading week before it', () => {
    // taper weeks 8, 9 and the race week 10 (isTaper); the reference is week 7 (130 min, 4 run days)
    // fractions 91/130 = 0.70, 65/130 = 0.50, 39/130 = 0.30; mean 0.50
    // first taper Monday 2026-12-21 to the race on 2027-01-10: 20 days, 21 counting both ends
    const t = taper.value!
    expect(t.weeks).toBe(3)
    expect(t.days).toBe(21)
    expect(t.referenceWeekStart).toBe(W(7))
    expect(t.referenceMin).toBe(130)
    expect(t.fractions).toEqual([
      expect.closeTo(0.7, 12),
      expect.closeTo(0.5, 12),
      expect.closeTo(0.3, 12),
    ])
    expect(t.meanFraction).toBeCloseTo(0.5, 12)
  })

  it('counts run days and quality sessions of the taper weeks', () => {
    // run days 4, 3, 4 against 4: cuts 0, 0.25, 0; quality sessions as the weeks declare them
    const t = taper.value!
    expect(t.runDays).toEqual([4, 3, 4])
    expect(t.runDaysCutShare).toEqual([0, expect.closeTo(0.25, 12), 0])
    expect(t.qualitySessions).toEqual([1, 1, 0])
  })

  it('leaves the post-race return steps out of the taper run days', () => {
    // a race on Wednesday of week 10 (an easy run on Tuesday), then two return runs flagged post-race
    const withReturn = draftOf(SERIES.weeks, [
      ...SERIES.sessions.filter((s) => s.date < W(10)),
      session(addDays(W(10), 1), 'easy', 13),
      session(addDays(W(10), 2), 'race', 180),
      session(addDays(W(10), 3), 'easy', 20, { flags: ['post-race'] }),
      session(addDays(W(10), 5), 'easy', 20, { flags: ['post-race'] }),
    ])
    const raceOnWednesday = ctx({ goal: { ...goal(), date: addDays(W(10), 2) } })
    expect(describePlan(withReturn, raceOnWednesday).taper.value!.runDays).toEqual([4, 3, 2])
  })

  it('reads its reference values from the Params and carries their label', () => {
    expect(taper.value!.reference).toEqual({
      maxDays: P.k1.maxDays.value,
      meanVolumeFraction: P.k2.meanVolumeFraction.value,
      runDaysMaxCutPct: P.k3.runDaysMaxCutPct.value,
      minQualitySessionsPerWeek: P.k3.minQualitySessionsPerWeek.value,
    })
    // the weakest grade of K1 (A), K2 (A) and K3 (B)
    expect(taper.grade).toBe('B')
    expect(taper.rule).toBe('K1, K2, K3')
  })

  it('is absent from a draft without taper weeks', () => {
    expect(describePlan(targetsOnly([[1, 100, 'loading']]), ctx()).taper.value).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Labels, edges
// ---------------------------------------------------------------------------------------------

describe('labels', () => {
  const d = describePlan(SERIES, ctx())

  it('reads each figure label from the Params it rests on', () => {
    // steps and the soft headroom: G-2's soft step is grade D; the 2-week ceiling is grade C
    expect(d.steps).toMatchObject({ grade: 'D', rule: P.g2.rampSoft.rule })
    expect(d.headroom.soft).toMatchObject({ grade: P.g2.rampSoft.grade, rule: P.g2.rampSoft.rule })
    expect(d.headroom.ceiling).toMatchObject({
      grade: P.g2.rampCeilingTwoWeeks.grade,
      rule: P.g2.rampCeilingTwoWeeks.rule,
    })
    expect(d.longRunShare.grade).toBe(P.macroDesign.longRunShareOfWeek.grade)
    expect(d.distribution).toMatchObject({ grade: 'C', rule: P.e4.z1Prior.rule })
  })

  it('labels the plain descriptions of the draft with no grade', () => {
    expect(d.peak).toMatchObject({ grade: null, rule: null })
    expect(d.plateau).toMatchObject({ grade: null, rule: null })
    expect(d.runDays).toMatchObject({ grade: null, rule: null })
    expect(d.polarization).toMatchObject({ grade: null, rule: null })
  })
})

describe('edges', () => {
  it('describes an empty draft without a figure', () => {
    const d = describePlan(draftOf([]), ctx())
    expect(d.weeks).toEqual([])
    expect(d.steps.value).toEqual({ rows: [], median: null, max: null })
    expect(d.peak.value).toBeNull()
    expect(d.plateau.value).toBeNull()
    expect(d.taper.value).toBeNull()
    expect(d.cycle.value.loadingRuns).toEqual([])
    expect(d.cycle.value.longestRun).toBeNull()
    expect(d.runDays.value).toEqual({ min: null, max: null, median: null })
    expect(d.distribution.value.realised).toBeNull()
    expect(d.longRunShare.value).toEqual({ rows: [], mean: null, max: null })
  })

  it('does not change the draft, and gives the same description twice', () => {
    const before = structuredClone(SERIES)
    const first = describePlan(SERIES, ctx())
    expect(SERIES).toEqual(before)
    expect(describePlan(SERIES, ctx())).toEqual(first)
  })

  it('imports only the helpers the proposal names, no limit code and nothing from server/ or web/', () => {
    // a new import is a decision: this list changes with it. `tid.ts` is the zone counting that the
    // Why drawer reads too (EV1), so the realised distribution and the drawer's sentence are one count.
    const source = readFileSync(new URL('./plan-metrics.ts', import.meta.url), 'utf8')
    const imports = [...source.matchAll(/^import[^;]*?from '([^']+)'/gms)].map((m) => m[1]!)
    expect([...new Set(imports)].sort()).toEqual([
      '../../../shared/dates.ts',
      '../../../shared/domain/sessionIdentity.ts',
      '../../../shared/engine/adjust.ts',
      '../../../shared/engine/load.ts',
      '../../../shared/engine/params/index.ts',
      '../../../shared/engine/tid.ts',
      '../../../shared/engine/types.ts',
    ])
  })
})

// ---------------------------------------------------------------------------------------------
// Churn along a chain
// ---------------------------------------------------------------------------------------------

describe('churn along a chain', () => {
  const day = (d: number) => addDays(W(1), d)
  // Draft A, week 1: easy 40 (Mon), threshold 30 (Tue), strength 45 (Wed, not a run), easy 40 (Thu),
  // long 80 (Sun).
  const a = draftOf(
    [week(1, { targetRunMin: 190 })],
    [
      session(day(0), 'easy', 40),
      session(day(1), 'threshold', 30),
      session(day(2), 'strength', 45),
      session(day(3), 'easy', 40),
      session(day(6), 'long', 80),
    ],
  )
  // Draft B: Monday and Sunday unchanged, the threshold run 36 minutes (+6), Thursday's easy run
  // becomes a recovery run of 40 (another kind: one removal and one addition), a new easy run of 30
  // on Friday.
  const b = draftOf(
    [week(1, { targetRunMin: 226 })],
    [
      session(day(0), 'easy', 40),
      session(day(1), 'threshold', 36),
      session(day(2), 'strength', 45),
      session(day(3), 'recovery', 40),
      session(day(4), 'easy', 30),
      session(day(6), 'long', 80),
    ],
  )

  it('pairs run sessions by date, kind and occurrence, and counts the minutes moved', () => {
    // run sessions before: 4. Paired: Mon easy, Tue threshold, Sun long (3); of these only the
    // threshold run is resized (|36 - 30| = 6). Removed: Thu easy 40. Added: Thu recovery 40 and
    // Fri easy 30. Minutes moved 6 + 40 + 40 + 30 = 116. Strength is not a run and is left out.
    const churn = churnAlongChain([a, b])
    expect(churn.steps).toEqual([
      {
        from: null,
        before: 4,
        paired: 3,
        unchanged: 2,
        resized: 1,
        removed: 1,
        added: 2,
        minutesMoved: 116,
      },
    ])
    expect(churn).toMatchObject({ resized: 1, removed: 1, added: 2, minutesMoved: 116 })
  })

  it('compares only the days from the re-plan on when given them', () => {
    // from Thursday, the re-plan's day (it is in the window): before = Thu easy 40, Sun long 80
    // and after = Thu recovery 40, Fri easy 30, Sun long 80. Paired: Sun long (unchanged).
    // Removed 1, added 2, minutes moved 40 + 40 + 30 = 110. Monday's and Tuesday's sessions are
    // history and are not compared, so the resized threshold run does not show.
    const churn = churnAlongChain([a, b], { from: [day(0), day(3)] })
    expect(churn.steps[0]).toEqual({
      from: day(3),
      before: 2,
      paired: 1,
      unchanged: 1,
      resized: 0,
      removed: 1,
      added: 2,
      minutesMoved: 110,
    })
  })

  it('sums the steps of a longer chain, and a re-plan that changes nothing adds none', () => {
    const churn = churnAlongChain([a, b, b])
    expect(churn.steps).toHaveLength(2)
    expect(churn.steps[1]).toMatchObject({ resized: 0, removed: 0, added: 0, minutesMoved: 0 })
    expect(churn).toMatchObject({ resized: 1, removed: 1, added: 2, minutesMoved: 116 })
    expect(churnAlongChain([a]).steps).toEqual([])
    expect(churnAlongChain([])).toMatchObject({ steps: [], minutesMoved: 0 })
  })

  it('counts every earlier session as removed when the later draft has none in the window', () => {
    const none = churnAlongChain([a, draftOf([week(1, { targetRunMin: 0 })])])
    expect(none.steps[0]).toMatchObject({ before: 4, paired: 0, removed: 4, added: 0 })
    expect(none.minutesMoved).toBe(40 + 30 + 40 + 80)
  })
})

// ---------------------------------------------------------------------------------------------
// Real output: shape and ranges only
// ---------------------------------------------------------------------------------------------

describe('real buildPlan output', () => {
  const GRADES = ['A', 'B', 'C', 'D']
  const WEEK_TYPES = ['loading', 'recovery', 'taper', 'race', 'post-race']

  describe.each(athletes())('$label', (athlete) => {
    const draft = buildPlan(athlete.input)
    const d = describePlan(draft, athlete.input)

    it('describes every week of the draft, in date order, with a known type', () => {
      expect(d.weeks).toHaveLength(draft.weeks.length)
      expect(d.weeks.map((w) => w.weekStart)).toEqual([...d.weeks.map((w) => w.weekStart)].sort())
      expect(d.weeks.every((w) => WEEK_TYPES.includes(w.type))).toBe(true)
      expect(d.weeks.every((w) => w.runDays >= 0 && w.runDays <= 7 && w.plannedMin >= 0)).toBe(true)
      // the plan begins with the part of the current week, and only that week is partial
      expect(d.weeks.filter((w) => w.partial).length).toBeLessThanOrEqual(1)
    })

    it('keeps every figure within its range', () => {
      const loading = d.weeks.filter((w) => w.type === 'loading')
      if (loading.length > 0) {
        expect(d.peak.value!.position).toBeGreaterThanOrEqual(1)
        expect(d.peak.value!.position).toBeLessThanOrEqual(d.weeks.length)
        const plateau = d.plateau.value!
        expect(plateau.weeksWithin).toBeGreaterThanOrEqual(1)
        expect(plateau.weeksWithin).toBeLessThanOrEqual(plateau.loadingWeeks)
        expect(plateau.longestRun).toBeGreaterThanOrEqual(1)
        expect(plateau.longestRun).toBeLessThanOrEqual(plateau.weeksWithin)
      }
      for (const row of d.longRunShare.value.rows) {
        if (row.share !== null) {
          expect(row.share).toBeGreaterThan(0)
          expect(row.share).toBeLessThanOrEqual(1)
        }
      }
      // percentages of running time: each distribution adds up to 100
      const total = (z: { z1: number; z2: number; z3: number }) => z.z1 + z.z2 + z.z3
      expect(total(d.distribution.value.declared)).toBeCloseTo(100, 6)
      for (const row of d.distribution.value.rows) {
        expect(total(row.declared)).toBeCloseTo(100, 6)
        if (row.realised !== null) expect(total(row.realised)).toBeCloseTo(100, 6)
      }
      for (const row of d.monotony.value) {
        if (row.monotony !== null) expect(row.monotony).toBeGreaterThan(0)
        if (row.strain !== null) expect(row.strain).toBeGreaterThan(0)
      }
      for (const row of [...d.headroom.soft.value.rows, ...d.headroom.ceiling.value.rows]) {
        expect(Number.isFinite(row.headroomMin)).toBe(true)
        expect(row.baseMin).toBeGreaterThan(0)
      }
      const taper = d.taper.value
      if (taper !== null) {
        expect(taper.weeks).toBeGreaterThanOrEqual(1)
        expect(taper.days).toBeGreaterThanOrEqual(1)
        expect(taper.fractions.every((f) => f >= 0)).toBe(true)
      }
      expect(d.cycle.value.loadingRuns.every((n) => n >= 1)).toBe(true)
    })

    it('labels each figure with a grade from the registry or none, and is plain data', () => {
      const labelled = [
        d.steps,
        d.headroom.soft,
        d.headroom.ceiling,
        d.plateau,
        d.peak,
        d.longRunShare,
        d.distribution,
        d.polarization,
        d.load,
        d.monotony,
        d.cycle,
        d.taper,
        d.runDays,
      ]
      for (const f of labelled) {
        expect(f.grade === null || GRADES.includes(f.grade)).toBe(true)
        expect(f.grade === null).toBe(f.rule === null)
      }
      // no NaN or infinity: a JSON round trip keeps every figure
      expect(JSON.parse(JSON.stringify(d))).toEqual(d)
    })

    it('does not change the draft and is deterministic', () => {
      const before = structuredClone(draft)
      expect(describePlan(draft, athlete.input)).toEqual(d)
      expect(draft).toEqual(before)
    })
  })

  it('follows a replan chain with counts that add up', () => {
    const a = athletes().find((x) => x.id === 'half')!
    const steps = replanChain(a.input, { maxSteps: 2 })
    expect(steps.length).toBeGreaterThanOrEqual(2)
    const churn = churnAlongChain(
      steps.map((s) => s.draft),
      { from: steps.map((s) => s.input.today) },
    )
    expect(churn.steps).toHaveLength(steps.length - 1)
    for (const [i, s] of churn.steps.entries()) {
      // every session of the earlier draft is paired or removed, every one of the later paired or added
      expect(s.paired + s.removed).toBe(s.before)
      expect(s.unchanged + s.resized).toBe(s.paired)
      expect(s.from).toBe(steps[i + 1]!.input.today)
      expect(s.minutesMoved).toBeGreaterThanOrEqual(0)
    }
  })
})
