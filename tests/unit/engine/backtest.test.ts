import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  daysBefore,
  isComparableCourse,
  median,
  scorePredictions,
  scoreRace,
  summariseRecord,
  weeksBefore,
  type CourseSnapshot,
  type LoggedPrediction,
  type RaceResultInput,
  type RaceScore,
} from '../../../shared/engine/backtest.ts'
import { P } from '../../../shared/engine/params/index.ts'

// The race is on a Sunday; its week starts Monday 2026-11-09. All dates are fixed and synthetic.
const RACE_DATE = '2026-11-15'
const RACE_M = 161_000
const GAIN_M = 1_800
const COURSE: CourseSnapshot = { distanceM: RACE_M, gainM: GAIN_M }

/** 3:20:00, with a range of 6% either side. */
const PREDICTED = 12_000
const LOW = 11_280
const HIGH = 12_720

function logged(loggedOn: string, overrides: Partial<LoggedPrediction> = {}): LoggedPrediction {
  return {
    weekStart: loggedOn,
    loggedOn,
    predictedSec: PREDICTED,
    lowSec: LOW,
    highSec: HIGH,
    course: COURSE,
    ...overrides,
  }
}

function finished(timeSec: number | null, overrides: Partial<RaceResultInput> = {}) {
  return {
    date: RACE_DATE,
    outcome: 'finished',
    timeSec,
    distanceM: RACE_M,
    gainM: GAIN_M,
    ...overrides,
  } satisfies RaceResultInput
}

const DID_NOT_FINISH: RaceResultInput = {
  date: RACE_DATE,
  outcome: 'did-not-finish',
  timeSec: null,
  distanceM: RACE_M,
  gainM: GAIN_M,
}

/** A race whose headline holds `errorSec` against a prediction of 12 000 s, for the summary. */
function raceWith(errorSec: number, date = RACE_DATE): RaceScore {
  return scoreRace([logged('2026-11-10')], finished(PREDICTED + errorSec, { date }))
}

describe('sign convention', () => {
  test('error is the result minus the prediction: slower is positive, faster negative', () => {
    const [slower] = scorePredictions([logged('2026-11-10')], finished(PREDICTED + 250))
    expect(slower?.errorSec).toBe(250)
    expect(slower?.errorPct).toBeCloseTo((250 / PREDICTED) * 100, 10)
    expect(slower?.errorPct).toBeGreaterThan(0)

    const [faster] = scorePredictions([logged('2026-11-10')], finished(PREDICTED - 250))
    expect(faster?.errorSec).toBe(-250)
    expect(faster?.errorPct).toBeLessThan(0)
    expect(faster?.errorPct).toBeCloseTo(-(250 / PREDICTED) * 100, 10)

    const [exact] = scorePredictions([logged('2026-11-10')], finished(PREDICTED))
    expect(exact?.errorSec).toBe(0)
    expect(exact?.errorPct).toBe(0)
  })

  test('the percentage is a share of the prediction, not of the result', () => {
    const [point] = scorePredictions(
      [logged('2026-11-10', { predictedSec: 10_000, lowSec: 9_000, highSec: 11_000 })],
      finished(11_000),
    )
    expect(point?.errorSec).toBe(1_000)
    expect(point?.errorPct).toBeCloseTo(10, 10)
  })
})

describe('range edges', () => {
  test.each([
    ['the low edge', LOW, true],
    ['the high edge', HIGH, true],
    ['just under the low edge', LOW - 1, false],
    ['just over the high edge', HIGH + 1, false],
    ['the middle of the range', PREDICTED, true],
  ])('%s: inside is %s', (_name, resultSec, inside) => {
    const [point] = scorePredictions([logged('2026-11-10')], finished(resultSec))
    expect(point?.inside).toBe(inside)
  })
})

describe('horizon', () => {
  test('daysBefore counts whole days from the day logged to race day', () => {
    expect(daysBefore(RACE_DATE, '2026-11-14')).toBe(1)
    expect(daysBefore(RACE_DATE, '2026-11-11')).toBe(4)
    expect(daysBefore(RACE_DATE, '2026-10-18')).toBe(28)
    expect(daysBefore(RACE_DATE, RACE_DATE)).toBe(0)
    expect(daysBefore(RACE_DATE, '2026-11-16')).toBe(-1)
  })

  test('weeksBefore counts calendar weeks, whatever weekday the prediction was made', () => {
    expect(weeksBefore(RACE_DATE, '2026-11-09')).toBe(0) // Monday of the race week
    expect(weeksBefore(RACE_DATE, '2026-11-11')).toBe(0)
    expect(weeksBefore(RACE_DATE, '2026-11-08')).toBe(1) // the Sunday before
    expect(weeksBefore(RACE_DATE, '2026-11-02')).toBe(1)
    expect(weeksBefore(RACE_DATE, '2026-10-19')).toBe(3)
    // weeks logged on a Wednesday and on a Sunday still count 3, 2, 1, 0 without a gap or a repeat
    expect(weeksBefore(RACE_DATE, '2026-10-28')).toBe(2)
    expect(weeksBefore(RACE_DATE, '2026-11-01')).toBe(2)
  })

  test('each scored point carries its horizon', () => {
    const points = scorePredictions(
      [logged('2026-10-28'), logged('2026-11-08'), logged('2026-11-11')],
      finished(PREDICTED),
    )
    expect(points.map((p) => [p.loggedOn, p.daysBefore, p.weeksBefore])).toEqual([
      ['2026-10-28', 18, 2],
      ['2026-11-08', 7, 1],
      ['2026-11-11', 4, 0],
    ])
  })
})

describe('what is scored', () => {
  test('a prediction made on race day, after it or after the fact is never scored', () => {
    const points = scorePredictions(
      [logged('2026-11-14'), logged(RACE_DATE), logged('2026-11-16'), logged('2026-12-01')],
      finished(PREDICTED),
    )
    expect(points.map((p) => p.loggedOn)).toEqual(['2026-11-14'])
    const race = scoreRace(
      [logged('2026-11-14'), logged(RACE_DATE), logged('2026-11-16')],
      finished(PREDICTED),
    )
    // after-the-fact rows are not counted as unscored either: they were never part of the record
    expect(race.unscoredCount).toBe(0)
  })

  test('points come oldest first whatever the input order', () => {
    const points = scorePredictions(
      [logged('2026-11-11'), logged('2026-10-21'), logged('2026-11-04')],
      finished(PREDICTED),
    )
    expect(points.map((p) => p.loggedOn)).toEqual(['2026-10-21', '2026-11-04', '2026-11-11'])
  })

  test('a prediction with unusable times is left out and counted as unscored', () => {
    const rows = [
      logged('2026-11-10', { predictedSec: 0 }),
      logged('2026-11-11', { lowSec: Number.NaN }),
      logged('2026-11-12', { lowSec: HIGH + 1 }),
      logged('2026-11-13'),
    ]
    const race = scoreRace(rows, finished(PREDICTED))
    expect(race.points.map((p) => p.loggedOn)).toEqual(['2026-11-13'])
    expect(race.unscoredCount).toBe(3)
  })

  test('the input is not changed and the same input gives the same score', () => {
    const rows = [logged('2026-11-11'), logged('2026-10-21')]
    const before = JSON.stringify(rows)
    const first = scoreRace(rows, finished(PREDICTED + 90))
    expect(JSON.stringify(rows)).toBe(before)
    expect(scoreRace(rows, finished(PREDICTED + 90))).toEqual(first)
  })
})

describe('headline and per-race coverage', () => {
  test('the headline is the last prediction before race day, in any input order', () => {
    const rows = [logged('2026-11-13'), logged('2026-10-21'), logged('2026-11-06')]
    const race = scoreRace(rows, finished(PREDICTED))
    expect(race.headline?.loggedOn).toBe('2026-11-13')
    expect(race.headline).toBe(race.points[race.points.length - 1])
  })

  test('coverage is counted on the headline, not on the weekly points', () => {
    // Earlier weeks hold the result; the final prediction, narrower, does not.
    const rows = [
      logged('2026-10-21'),
      logged('2026-11-04'),
      logged('2026-11-13', { predictedSec: 11_000, lowSec: 10_800, highSec: 11_200 }),
    ]
    const race = scoreRace(rows, finished(PREDICTED))
    expect(race.points.map((p) => p.inside)).toEqual([true, true, false])
    expect(race.inside).toBe(false)

    // The reverse: weekly points miss, the final prediction holds the result.
    const reverse = scoreRace(
      [
        logged('2026-10-21', { predictedSec: 10_000, lowSec: 9_500, highSec: 10_500 }),
        logged('2026-11-13'),
      ],
      finished(PREDICTED),
    )
    expect(reverse.points.map((p) => p.inside)).toEqual([false, true])
    expect(reverse.inside).toBe(true)
  })

  test('the headline skips a last prediction made for another course', () => {
    const rows = [
      logged('2026-11-04'),
      logged('2026-11-13', { course: { distanceM: 100_000, gainM: GAIN_M } }),
    ]
    const race = scoreRace(rows, finished(PREDICTED))
    expect(race.headline?.loggedOn).toBe('2026-11-04')
    expect(race.unscoredCount).toBe(1)
  })

  test('with nothing scored there is no headline and no coverage', () => {
    const race = scoreRace([], finished(PREDICTED))
    expect(race).toMatchObject({ points: [], headline: null, inside: null, unscoredCount: 0 })
    expect(race.resultSec).toBe(PREDICTED)
  })
})

describe('did not finish', () => {
  test('is recorded and not scored, with the predictions it leaves unscored counted', () => {
    const rows = [logged('2026-10-21'), logged('2026-11-04'), logged('2026-11-13')]
    const race = scoreRace(rows, DID_NOT_FINISH)
    expect(race).toMatchObject({
      outcome: 'did-not-finish',
      resultSec: null,
      points: [],
      headline: null,
      inside: null,
      unscoredCount: 3,
    })
    expect(scorePredictions(rows, DID_NOT_FINISH)).toEqual([])
  })

  test('a time recorded with a did-not-finish is ignored', () => {
    const race = scoreRace([logged('2026-11-13')], { ...DID_NOT_FINISH, timeSec: PREDICTED })
    expect(race.points).toEqual([])
    expect(race.resultSec).toBeNull()
  })

  test('a finished result without a usable time is not scored either', () => {
    for (const timeSec of [null, 0, -5, Number.NaN]) {
      const race = scoreRace([logged('2026-11-13')], finished(timeSec))
      expect(race.points, String(timeSec)).toEqual([])
      expect(race.unscoredCount, String(timeSec)).toBe(1)
    }
  })

  test('does not count towards the summary', () => {
    const races = [
      raceWith(100),
      raceWith(-100),
      raceWith(200),
      scoreRace([logged('2026-11-13')], DID_NOT_FINISH),
    ]
    const summary = summariseRecord(races)
    expect(summary.raceCount).toBe(3)
  })
})

describe('median', () => {
  test('is the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([7])).toBe(7)
    expect(median([-2, 5])).toBe(1.5)
  })

  test('is null for no values and leaves its input alone', () => {
    expect(median([])).toBeNull()
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })
})

describe('summary across races', () => {
  test('shows no pattern before the threshold of L7, and says how many races are missing', () => {
    const min = P.l7.minRacesForSummary.value
    expect(min).toBe(3)
    for (let n = 0; n < min; n++) {
      const summary = summariseRecord(Array.from({ length: n }, () => raceWith(100)))
      expect(summary).toEqual({
        raceCount: n,
        insideCount: null,
        medianSignedPct: null,
        medianAbsPct: null,
        enough: false,
        needed: min - n,
      })
    }
  })

  test('shows the pattern from the threshold on', () => {
    const races = [raceWith(600), raceWith(-300), raceWith(1_200)] // +5%, -2.5%, +10%
    const summary = summariseRecord(races)
    expect(summary.enough).toBe(true)
    expect(summary.needed).toBe(0)
    expect(summary.raceCount).toBe(3)
    expect(summary.insideCount).toBe(2) // 600 is inside the 720 half-width, 1200 is not
    expect(summary.medianSignedPct).toBeCloseTo(5, 10)
    expect(summary.medianAbsPct).toBeCloseTo(5, 10)
  })

  test('median signed and absolute error differ when the errors cancel', () => {
    const summary = summariseRecord([raceWith(600), raceWith(-600), raceWith(0), raceWith(-600)])
    expect(summary.medianSignedPct).toBeCloseTo(-2.5, 10) // -5, -5, 0, +5: middle two -5 and 0
    expect(summary.medianAbsPct).toBeCloseTo(5, 10)
  })

  test('uses one point per race: the headline, not the weekly points', () => {
    const weekly = [
      logged('2026-10-14', { predictedSec: 20_000, lowSec: 18_000, highSec: 22_000 }),
      logged('2026-10-21', { predictedSec: 20_000, lowSec: 18_000, highSec: 22_000 }),
      logged('2026-10-28', { predictedSec: 20_000, lowSec: 18_000, highSec: 22_000 }),
      logged('2026-11-04', { predictedSec: 20_000, lowSec: 18_000, highSec: 22_000 }),
      logged('2026-11-13'),
    ]
    const heavy = scoreRace(weekly, finished(PREDICTED + 120))
    expect(heavy.points).toHaveLength(5)
    const summary = summariseRecord([heavy, raceWith(0), raceWith(240)])
    expect(summary.raceCount).toBe(3)
    // headline errors: +1%, 0%, +2%; the four far-off weekly points do not move the median
    expect(summary.medianSignedPct).toBeCloseTo(1, 10)
  })

  test('takes the threshold from the Params unless one is given', () => {
    const min = P.l7.minRacesForSummary.value
    const races = Array.from({ length: min }, () => raceWith(0))
    expect(summariseRecord(races).enough).toBe(true)
    expect(summariseRecord(races.slice(1)).enough).toBe(false)
    expect(summariseRecord(races, min + 1)).toMatchObject({ enough: false, needed: 1 })
    expect(summariseRecord(races, 1).enough).toBe(true)
  })
})

describe('comparable course', () => {
  test('a course that was not recorded is comparable: nothing says it differs', () => {
    expect(isComparableCourse(null, COURSE)).toBe(true)
    expect(isComparableCourse({ distanceM: null, gainM: null }, COURSE)).toBe(true)
    expect(isComparableCourse(COURSE, { distanceM: null, gainM: null })).toBe(true)
  })

  test('the distance must be within the tolerance of the raced distance, edge included', () => {
    const tolerance = P.l7.courseTolerancePct.value
    expect(tolerance).toBe(2)
    const road = (distanceM: number): CourseSnapshot => ({ distanceM, gainM: null })
    expect(isComparableCourse(road(100_000), road(100_000))).toBe(true)
    expect(isComparableCourse(road(102_000), road(100_000))).toBe(true)
    expect(isComparableCourse(road(98_000), road(100_000))).toBe(true)
    expect(isComparableCourse(road(102_001), road(100_000))).toBe(false)
    expect(isComparableCourse(road(97_999), road(100_000))).toBe(false)
    // a tolerance given by the caller replaces the Param
    expect(isComparableCourse(road(105_000), road(100_000), 5)).toBe(true)
    expect(isComparableCourse(road(105_001), road(100_000), 5)).toBe(false)
  })

  test('a goal re-entered as another distance does not compare', () => {
    expect(
      isComparableCourse({ distanceM: 100_000, gainM: null }, { distanceM: 160_934, gainM: null }),
    ).toBe(false)
    expect(
      isComparableCourse({ distanceM: 42_195, gainM: null }, { distanceM: 21_097, gainM: null }),
    ).toBe(false)
  })

  test('climb counts as flat distance when both courses state it', () => {
    const base: CourseSnapshot = { distanceM: 161_000, gainM: 2_000 }
    expect(isComparableCourse(base, { distanceM: 161_000, gainM: 2_000 })).toBe(true)
    // 100 m more climb is 1 km more flat distance: 0.5% of the effort distance
    expect(isComparableCourse(base, { distanceM: 161_000, gainM: 2_100 })).toBe(true)
    // 1 000 m more climb is 10 km more flat distance, well over 2%
    expect(isComparableCourse(base, { distanceM: 161_000, gainM: 3_000 })).toBe(false)
    // one side without a climb figure: only the distances are compared
    expect(isComparableCourse(base, { distanceM: 161_000, gainM: null })).toBe(true)
    expect(
      isComparableCourse({ distanceM: 161_000, gainM: null }, { distanceM: 161_000, gainM: 3_000 }),
    ).toBe(true)
  })

  test('scoring leaves a prediction for another course unscored and counted', () => {
    const race = scoreRace(
      [logged('2026-11-04', { course: { distanceM: 100_000, gainM: null } }), logged('2026-11-11')],
      finished(PREDICTED),
    )
    expect(race.points.map((p) => p.loggedOn)).toEqual(['2026-11-11'])
    expect(race.unscoredCount).toBe(1)
  })

  test('a row logged before course snapshots is scored', () => {
    const points = scorePredictions([logged('2026-11-11', { course: null })], finished(PREDICTED))
    expect(points).toHaveLength(1)
  })
})

describe('purity', () => {
  test('the module reads no clock, randomness, environment or Node module', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../../shared/engine/backtest.ts'),
      'utf8',
    )
    const code = source.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    expect(code).not.toMatch(/Date\.now|new Date\(|Math\.random|process\.|from 'node:|require\(/)
    expect(code).not.toMatch(/\bfetch\(|\bawait\b|\basync\b/)
  })

  test('states the sign convention in a doc comment', () => {
    const source = readFileSync(
      join(import.meta.dirname, '../../../shared/engine/backtest.ts'),
      'utf8',
    )
    expect(source).toMatch(/SIGN CONVENTION/)
    expect(source).toMatch(/errorSec = resultSec - predictedSec/)
    expect(source).toMatch(/negative error means faster/)
  })
})
