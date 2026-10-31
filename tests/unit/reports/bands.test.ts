// The reference bands of the plan report (task H1, proposal section 5.2): Knopp's figures for the
// last 12 weeks of marathon plans and the corpus's 5 and 10 km programme records. The cases are
// hand-computed on small synthetic plans; the arithmetic is in the comments.
import { describe, expect, it } from 'vitest'
import { loadPaperFiles, paperSchema } from '../../../scripts/research-check.ts'
import { addDays } from '../../../shared/dates.ts'
import type { SessionFlag, SessionKind } from '../../../shared/engine/types.ts'
import {
  BAND_LABEL,
  distanceFromBand,
  KNOPP,
  knoppBand,
  knoppRows,
  PROGRAMMES,
  programmeRows,
  type BandPlan,
  type KnoppFigure,
  type TierFigure,
} from '../../reports/bands.ts'

const papers = new Map(
  loadPaperFiles().map(({ file, data }) => [file.replace(/\.json$/, ''), data]),
)
const paperOf = (id: string) => paperSchema.parse(papers.get(id))

describe('distanceFromBand', () => {
  const band = { lo: 5, hi: 9 }
  it('is 0 inside the band and on both edges, else the signed distance to the nearest edge', () => {
    expect(distanceFromBand(5, band)).toBe(0)
    expect(distanceFromBand(7.2, band)).toBe(0)
    expect(distanceFromBand(9, band)).toBe(0)
    expect(distanceFromBand(3.5, band)).toBe(-1.5)
    expect(distanceFromBand(12, band)).toBe(3)
  })
})

describe('Knopp 2024 fixture', () => {
  it('reads the bands of the proposal from the tier means', () => {
    expect(knoppBand('buildPctPerWeek')).toEqual({ lo: 5, hi: 9 })
    expect(knoppBand('peakWeeksBeforeRace')).toEqual({ lo: 3.6, hi: 4.4 })
    expect(knoppBand('taperMeanDecreasePct')).toEqual({ lo: 22, hi: 31 })
    expect(knoppBand('finalWeekDecreasePct')).toEqual({ lo: 46, hi: 54 })
    expect(knoppBand('runsPerWeek')).toEqual({ lo: 4.1, hi: 6.8 })
  })

  it('names a corpus record of grade D, a read date and a licence', () => {
    const record = paperOf(KNOPP.source)
    expect(record.evidenceLevel).toBe('D')
    expect(record.doi).toBe(KNOPP.doi)
    expect(KNOPP.readOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(KNOPP.licence).toBe('CC BY 4.0')
    expect(KNOPP.fullText).toBe('PMC11065819')
  })

  it("agrees with the record's build-up figures, which the corpus already holds", () => {
    const text = paperOf(KNOPP.source).findings.join(' ')
    const { high, middle, low } = KNOPP.figures.buildPctPerWeek.tiers
    expect(text).toContain(`${high.mean} +/- ${high.sd}% (high)`)
    expect(text).toContain(`${middle.mean} +/- ${middle.sd}% (middle)`)
    expect(text).toContain(`${low.mean} +/- ${low.sd}% (low volume plans)`)
  })

  it('gives each tier a mean and a standard deviation, high volume plans running most days', () => {
    for (const figure of Object.values<KnoppFigure>(KNOPP.figures)) {
      for (const tier of Object.values<TierFigure>(figure.tiers)) {
        expect(tier.mean).toBeGreaterThan(0)
        expect(tier.sd).toBeGreaterThan(0)
      }
    }
    expect(KNOPP.figures.runsPerWeek.tiers.high.mean).toBeGreaterThan(
      KNOPP.figures.runsPerWeek.tiers.low.mean,
    )
  })
})

// ---------------------------------------------------------------------------------------------
// Synthetic plans
// ---------------------------------------------------------------------------------------------

const RACE_MONDAY = '2027-03-08' // the race, a Sunday, is 2027-03-14
const RACE_DAY = '2027-03-14'
const weekOut = (k: number) => addDays(RACE_MONDAY, -7 * k)

type WeekSpec = { out: number; min: number; days: number; partial?: boolean }

/** A plan from weeks counted back from the race week, each with up to 6 run days from Tuesday on. */
function planOf(weeks: WeekSpec[], goalClass = 'marathon'): BandPlan {
  const sessions: BandPlan['sessions'][number][] = []
  for (const w of weeks) {
    for (let d = 0; d < w.days; d += 1) {
      sessions.push({
        date: addDays(weekOut(w.out), 1 + d),
        kind: 'easy',
        flags: [],
        durationMin: 30,
      })
    }
  }
  return {
    goalClass,
    goalDate: RACE_DAY,
    weeks: weeks
      .map((w) => ({
        weekStart: weekOut(w.out),
        type: 'loading' as const,
        partial: w.partial ?? false,
        plannedMin: w.min,
        longRunMin: 0,
        runDays: w.days,
      }))
      .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1)),
    sessions,
  }
}

const row = (plan: BandPlan, key: string) => {
  const found = knoppRows(plan)!.rows.find((r) => r.key === key)
  if (found === undefined) throw new Error(`no row ${key}`)
  return found
}

describe('knoppRows', () => {
  // Planned minutes by weeks before the race week, 11 to 0, and run days a week:
  //   out:   11   10   9   8   7    6    5    4    3    2    1   0
  //   min:  100  100 120  90 120  150  180  200  150  105   70  35
  //   days:   4    4   5   5   5    5    6    6    5    5    4   3
  // The peak, 200, is unique, 4 weeks out.
  const minutes = [100, 100, 120, 90, 120, 150, 180, 200, 150, 105, 70, 35]
  const days = [4, 4, 5, 5, 5, 5, 6, 6, 5, 5, 4, 3]
  const weeks = minutes.map((min, i) => ({ out: 11 - i, min, days: days[i]! }))
  const plan = planOf(weeks)

  it('measures the build-up to the peak week as the mean of the weekly changes, cuts included', () => {
    // 0, +20, -25, +33.33, +25, +20, +11.11 percent: seven changes from week 11 to week 4
    const expected = (0 + 20 - 25 + 100 / 3 + 25 + 20 + 100 / 9) / 7
    expect(row(plan, 'build').value).toBeCloseTo(expected, 9)
    // 12.06 is above the 5 to 9 band by the difference to 9
    expect(row(plan, 'build').distance).toBeCloseTo(expected - 9, 9)
  })

  it('reads the peak position as whole weeks before the race week', () => {
    expect(row(plan, 'peak-first').value).toBe(4)
    expect(row(plan, 'peak-last').value).toBe(4)
    // 4 lies inside the 3.6 to 4.4 band
    expect(row(plan, 'peak-first').distance).toBe(0)
  })

  it('measures the taper from the peak week to the race week and the final week on its own', () => {
    // -25, -30, -33.33, -50 percent: 138.33 / 4 = 34.58, above the 22 to 31 band by 3.58
    const taper = (25 + 30 + 100 / 3 + 50) / 4
    expect(row(plan, 'taper').value).toBeCloseTo(taper, 9)
    expect(row(plan, 'taper').distance).toBeCloseTo(taper - 31, 9)
    // 35 on 70: 50 percent, inside the 46 to 54 band
    expect(row(plan, 'final-week').value).toBeCloseTo(50, 9)
    expect(row(plan, 'final-week').distance).toBe(0)
  })

  it('averages the run days over the window and labels every row as a practice source', () => {
    // 4 + 4 + 5 + 5 + 5 + 5 + 6 + 6 + 5 + 5 + 4 + 3 = 57 over 12 weeks
    expect(row(plan, 'runs').value).toBeCloseTo(57 / 12, 9)
    // 4.75 lies inside 4.1 to 6.8
    expect(row(plan, 'runs').distance).toBe(0)
    const result = knoppRows(plan)!
    expect(result.windowWeeks).toBe(12)
    expect(result.rows.map((r) => r.label)).toEqual(Array(result.rows.length).fill(BAND_LABEL))
    expect(new Set(result.rows.map((r) => r.source))).toEqual(new Set([KNOPP.source]))
  })

  it('reads a plateau at both ends: the build-up to its first week, the taper from its last', () => {
    // 100 at 11, 200 from 9 to 6, then 100 at 5 and 4, 50 at 3, 2, 1, 0
    const flat = planOf([
      { out: 11, min: 100, days: 5 },
      { out: 10, min: 150, days: 5 },
      { out: 9, min: 200, days: 5 },
      { out: 8, min: 200, days: 5 },
      { out: 7, min: 200, days: 5 },
      { out: 6, min: 200, days: 5 },
      { out: 5, min: 100, days: 5 },
      { out: 4, min: 100, days: 5 },
      { out: 3, min: 50, days: 5 },
      { out: 2, min: 50, days: 5 },
      { out: 1, min: 50, days: 5 },
      { out: 0, min: 25, days: 5 },
    ])
    expect(row(flat, 'peak-first').value).toBe(9)
    expect(row(flat, 'peak-last').value).toBe(6)
    // +50 and +33.33 percent from week 11 to week 9: 41.67
    expect(row(flat, 'build').value).toBeCloseTo((50 + 100 / 3) / 2, 9)
    // from week 6: -50, 0, -50, 0, 0, -50 percent: 150 / 6 = 25
    expect(row(flat, 'taper').value).toBeCloseTo(25, 9)
    expect(row(flat, 'taper').distance).toBe(0)
    // 25 on 50
    expect(row(flat, 'final-week').value).toBeCloseTo(50, 9)
  })

  it('leaves out a part week, the weeks before the window and the weeks after the race', () => {
    const short = planOf([
      { out: 13, min: 999, days: 6 },
      { out: 12, min: 999, days: 6 },
      { out: 7, min: 500, days: 6, partial: true },
      { out: 6, min: 100, days: 4 },
      { out: 5, min: 120, days: 4 },
      { out: 4, min: 120, days: 4 },
      { out: 3, min: 90, days: 4 },
      { out: 2, min: 60, days: 4 },
      { out: 1, min: 40, days: 4 },
      { out: 0, min: 20, days: 4 },
      { out: -1, min: 999, days: 6 },
    ])
    const result = knoppRows(short)!
    expect(result.windowWeeks).toBe(7)
    // the highest week is 120, first 5 weeks before the race week and last 4
    expect(row(short, 'peak-first').value).toBe(5)
    expect(row(short, 'peak-last').value).toBe(4)
    expect(row(short, 'build').value).toBeCloseTo(20, 9)
    // from week 4: -25, -33.33, -33.33, -50 percent
    expect(row(short, 'taper').value).toBeCloseTo((25 + 100 / 3 + 100 / 3 + 50) / 4, 9)
    expect(row(short, 'runs').value).toBe(4)
  })

  it('counts a run day once, and leaves out the race, a hike and the return runs after it', () => {
    const base = planOf([
      { out: 1, min: 100, days: 3 },
      { out: 0, min: 50, days: 3 },
    ])
    const date = (out: number, d: number) => addDays(weekOut(out), d)
    const extras: Array<{ date: string; kind: SessionKind; flags: SessionFlag[] }> = [
      { date: date(0, 1), kind: 'strides', flags: [] }, // the same day as an easy run
      { date: RACE_DAY, kind: 'race', flags: [] },
      { date: date(0, 5), kind: 'hike', flags: [] },
      { date: date(0, 6), kind: 'easy', flags: ['post-race'] },
      { date: date(0, 4), kind: 'strength', flags: [] },
    ]
    const withExtras: BandPlan = {
      ...base,
      sessions: [...base.sessions, ...extras.map((e) => ({ ...e, durationMin: 20 }))],
    }
    // 3 run days in each of the two weeks
    expect(row(withExtras, 'runs').value).toBe(3)
  })

  it('counts a week with no run as zero in the mean of the run days', () => {
    const plan = planOf([
      { out: 2, min: 0, days: 0 },
      { out: 1, min: 100, days: 4 },
      { out: 0, min: 50, days: 2 },
    ])
    expect(row(plan, 'runs').value).toBe(2)
  })

  it('has no build-up, taper or final week to report when the data is not there', () => {
    // a peak in the first week of the window, so no build-up; the race week is missing
    const noRace = planOf([
      { out: 3, min: 100, days: 4 },
      { out: 2, min: 80, days: 4 },
      { out: 1, min: 60, days: 4 },
    ])
    expect(row(noRace, 'build').value).toBeNull()
    expect(row(noRace, 'taper').value).toBeNull()
    expect(row(noRace, 'final-week').value).toBeNull()
    expect(row(noRace, 'build').distance).toBeNull()
    // a peak in the race week itself has no taper
    const rising = planOf([
      { out: 1, min: 50, days: 4 },
      { out: 0, min: 80, days: 4 },
    ])
    expect(row(rising, 'taper').value).toBeNull()
    expect(row(rising, 'build').value).toBeCloseTo(60, 9)
  })

  it('applies to marathon plans only', () => {
    expect(knoppRows(planOf(weeks, 'half'))).toBeNull()
    expect(knoppRows(planOf(weeks, '10k'))).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Programme records
// ---------------------------------------------------------------------------------------------

describe('programme records', () => {
  it('are corpus records of grade D for a 5 or 10 km goal', () => {
    for (const programme of PROGRAMMES) {
      expect(paperOf(programme.id).evidenceLevel, programme.id).toBe('D')
      expect(['5k', '10k']).toContain(programme.goalClass)
      expect(programme.weeks).toBeGreaterThan(0)
      expect(programme.runDaysPerWeek).toBeGreaterThan(0)
      // a longest run is stated in minutes or in miles, not both
      expect(programme.longestRunMin === null, programme.id).not.toBe(
        programme.longestRunMiles === null,
      )
    }
  })

  it('carry the figures the records state', () => {
    const find = (id: string) => PROGRAMMES.find((p) => p.id === id)!
    expect(paperOf('higdon-2024-novice-5k').findings.join(' ')).toContain('3 run days')
    expect(find('higdon-2024-novice-5k')).toMatchObject({ runDaysPerWeek: 3, longestRunMiles: 3 })
    expect(paperOf('higdon-2024-intermediate-5k').findings.join(' ')).toContain('5 run days')
    expect(find('higdon-2024-intermediate-5k')).toMatchObject({ runDaysPerWeek: 5 })
    expect(paperOf('higdon-2024-advanced-5k').findings.join(' ')).toContain('6 run days')
    expect(find('higdon-2024-advanced-5k')).toMatchObject({ runDaysPerWeek: 6, longestRunMin: 90 })
    expect(paperOf('higdon-2024-advanced-10k').findings.join(' ')).toContain('7 runs')
    expect(find('higdon-2024-advanced-10k')).toMatchObject({ runDaysPerWeek: 7 })
    // the two ladders agree on the weeks: the first 20 minute run in week 5, 30 minutes in week 9
    for (const id of ['nhs-2026-couch-to-5k', 'clark-2026-couch-to-5k-original']) {
      expect(find(id)).toMatchObject({ firstContinuous20Week: 5, allRuns30Week: 9, weeks: 9 })
    }
    expect(paperOf('nhs-2026-couch-to-5k').findings.join(' ')).toContain('first continuous 20 min')
    expect(paperOf('nhs-2026-couch-to-5k').findings.join(' ')).toContain('week 9 is 3 x 30 min')
  })
})

describe('programmeRows', () => {
  type Run = { week: number; minutes: number; runWalk?: boolean }
  /** A plan of `count` weeks: week 1 is a part week; each run is one session on its own day. */
  function programmePlan(
    goalClass: string,
    count: number,
    runs: Run[],
    perWeek: { runDays: number | number[]; longRunMin: number | number[] },
  ): BandPlan {
    const first = '2026-10-19'
    const weekStarts = Array.from({ length: count }, (_, i) => addDays(first, 7 * i))
    const seen = new Map<number, number>()
    return {
      goalClass,
      goalDate: addDays(first, 7 * count + 5),
      weeks: weekStarts.map((weekStart, i) => ({
        weekStart,
        type: 'loading' as const,
        partial: i === 0,
        plannedMin: 0,
        longRunMin: Array.isArray(perWeek.longRunMin) ? perWeek.longRunMin[i]! : perWeek.longRunMin,
        runDays: Array.isArray(perWeek.runDays) ? perWeek.runDays[i]! : perWeek.runDays,
      })),
      sessions: runs.map((r) => {
        const n = seen.get(r.week) ?? 0
        seen.set(r.week, n + 1)
        return {
          date: addDays(weekStarts[r.week - 1]!, 1 + n),
          kind: 'easy',
          flags: r.runWalk === true ? ['run-walk'] : [],
          durationMin: r.minutes,
        }
      }),
    }
  }

  // A ladder plan like the engine's: run-walk to week 4, the first continuous 20 minutes in week 5
  // (with two run-walk sessions beside it), continuous 22 to 28 minutes in weeks 6 to 8, three
  // runs of 30 in week 9.
  const ladderRuns: Run[] = [
    ...[1, 2, 3, 4].flatMap((week) => [0, 1, 2].map(() => ({ week, minutes: 21, runWalk: true }))),
    // a continuous run of 18 minutes beside the run-walk sessions of week 4 is short of 20
    { week: 4, minutes: 18 },
    { week: 5, minutes: 21, runWalk: true },
    { week: 5, minutes: 20 },
    { week: 5, minutes: 21, runWalk: true },
    { week: 6, minutes: 22 },
    { week: 6, minutes: 24 },
    { week: 6, minutes: 24 },
    { week: 7, minutes: 25 },
    { week: 7, minutes: 25 },
    { week: 7, minutes: 25 },
    { week: 8, minutes: 28 },
    { week: 8, minutes: 28 },
    { week: 8, minutes: 28 },
    { week: 9, minutes: 30 },
    { week: 9, minutes: 30 },
    { week: 9, minutes: 30 },
  ]

  const find = (result: ReturnType<typeof programmeRows>, key: string) =>
    result!.rows.find((r) => r.key === key)

  it('reads a ladder plan against the start records, week by week', () => {
    const result = programmeRows(
      programmePlan('5k', 9, ladderRuns, { runDays: 3, longRunMin: 30 }),
    )!
    expect(result.audience).toBe('start')
    expect(result.records).toEqual([
      'higdon-2024-novice-5k',
      'nhs-2026-couch-to-5k',
      'clark-2026-couch-to-5k-original',
    ])
    expect(result.milesOnly).toEqual(['higdon-2024-novice-5k'])
    // run days: 3 in every week against 3; the longest run 30 against the 30 of the two ladders
    expect(find(result, 'run-days')).toMatchObject({ value: 3, distance: 0 })
    expect(find(result, 'longest-run')).toMatchObject({ value: 30, distance: 0 })
    expect(find(result, 'longest-run')!.source).toBe(
      'nhs-2026-couch-to-5k, clark-2026-couch-to-5k-original',
    )
    // the continuous 20 is in week 5 and every run is 30 from week 9
    expect(find(result, 'ladder-20')).toMatchObject({ value: 5, distance: 0 })
    expect(find(result, 'ladder-30')).toMatchObject({ value: 9, distance: 0 })
    for (const r of result.rows) expect(r.label).toBe(BAND_LABEL)
  })

  it('prints the distance of a ladder that runs later or with more days', () => {
    // the same ladder two weeks later: add two run-walk weeks in front
    const later = ladderRuns.map((r) => ({ ...r, week: r.week + 2 }))
    const front: Run[] = [1, 2].flatMap((week) =>
      [0, 1, 2].map(() => ({ week, minutes: 21, runWalk: true })),
    )
    const result = programmeRows(
      programmePlan('5k', 11, [...front, ...later], { runDays: 4, longRunMin: 45 }),
    )!
    expect(find(result, 'ladder-20')).toMatchObject({ value: 7, distance: 2 })
    expect(find(result, 'ladder-30')).toMatchObject({ value: 11, distance: 2 })
    expect(find(result, 'run-days')).toMatchObject({ value: 4, distance: 1 })
    expect(find(result, 'longest-run')).toMatchObject({ value: 45, distance: 15 })
  })

  it('reads a runner who already runs against the records for such a runner', () => {
    const run = (week: number): Run => ({ week, minutes: 40 })
    // the part week (the first) is left out: run days 9 and a long run of 90 there do not count;
    // the other weeks have 4, 4 and 5 run days (median 4) and long runs of 40, 60 and 50 minutes
    const result = programmeRows(
      programmePlan('5k', 4, [run(1), run(2), run(3)], {
        runDays: [9, 4, 4, 5],
        longRunMin: [90, 40, 60, 50],
      }),
    )!
    expect(result.audience).toBe('experienced')
    expect(result.records).toEqual(['higdon-2024-intermediate-5k', 'higdon-2024-advanced-5k'])
    // 5 to 6 run days; only the advanced plan states its longest run in minutes, 90
    expect(find(result, 'run-days')).toMatchObject({ value: 4, distance: -1 })
    expect(find(result, 'longest-run')).toMatchObject({ value: 60, distance: -30 })
    expect(result.milesOnly).toEqual(['higdon-2024-intermediate-5k'])
    expect(find(result, 'ladder-20')).toBeUndefined()
  })

  it('has run days only for a 10 km plan, whose record states its long run in miles', () => {
    const result = programmeRows(
      programmePlan('10k', 4, [{ week: 1, minutes: 40 }], { runDays: 3, longRunMin: 60 }),
    )!
    expect(result.records).toEqual(['higdon-2024-advanced-10k'])
    expect(result.milesOnly).toEqual(['higdon-2024-advanced-10k'])
    expect(result.rows.map((r) => r.key)).toEqual(['run-days'])
    expect(find(result, 'run-days')).toMatchObject({ value: 3, distance: -4 })
  })

  it('has no rows when the corpus holds no record for the plan, and none for other goals', () => {
    const tenOnLadder = programmeRows(
      programmePlan('10k', 4, [{ week: 1, minutes: 20, runWalk: true }], {
        runDays: 3,
        longRunMin: 20,
      }),
    )!
    expect(tenOnLadder).toMatchObject({ audience: 'start', records: [], rows: [] })
    expect(programmeRows(programmePlan('half', 4, [], { runDays: 3, longRunMin: 60 }))).toBeNull()
    expect(
      programmeRows(programmePlan('marathon', 4, [], { runDays: 3, longRunMin: 60 })),
    ).toBeNull()
  })
})
