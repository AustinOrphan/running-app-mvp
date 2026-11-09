import { describe, expect, test } from 'vitest'
import {
  darkBands,
  fuelTickPositions,
  raceProfileFor,
  type TimedPoint,
} from '../../../shared/domain/raceProfile.ts'
import { racePlanFor } from '../../../shared/engine/racePlan.ts'
import { replayLadder } from '../../../shared/engine/fuel.ts'
import type { GoalModel } from '../../../shared/engine/types.ts'

const HOUR = 3600
const KM = 1000

// A 100 km race starting at 06:00: the fast end of the range is 20 h, the slow end 24 h.
const STOPS: TimedPoint[] = [
  { distanceM: 50 * KM, lowSec: 10 * HOUR, highSec: 12 * HOUR },
  { distanceM: 100 * KM, lowSec: 20 * HOUR, highSec: 24 * HOUR },
]
const BASE = { startMin: 360, dawnMin: 360, duskMin: 1200, stops: STOPS }

describe('darkBands', () => {
  test('is firm where both ends of the range are dark and possible where one is', () => {
    const bands = darkBands(BASE)
    expect(bands).toHaveLength(2)
    // Dusk is 14 h in: 70 km at the fast end, 58.3 km at the slow end. Both finish in the dark.
    expect(bands[0]).toMatchObject({ firm: false, toM: 70 * KM })
    expect(bands[0]!.fromM).toBeCloseTo(58_333, -1)
    expect(bands[1]).toEqual({ fromM: 70 * KM, toM: 100 * KM, firm: true })
  })

  test('is empty when the race ends before dusk', () => {
    expect(
      darkBands({
        ...BASE,
        stops: [{ distanceM: 100 * KM, lowSec: 6 * HOUR, highSec: 8 * HOUR }],
      }),
    ).toEqual([])
  })

  test('draws the night at the start of a race that begins before dawn', () => {
    const bands = darkBands({
      ...BASE,
      startMin: 240,
      stops: [{ distanceM: 100 * KM, lowSec: 10 * HOUR, highSec: 10 * HOUR }],
    })
    // 04:00 to 06:00 is the first 2 h of 10 h: the first 20 km, dark at both ends.
    expect(bands).toEqual([{ fromM: 0, toM: 20 * KM, firm: true }])
  })

  test('counts a second night of a race that runs past two days', () => {
    const bands = darkBands({
      ...BASE,
      stops: [{ distanceM: 100 * KM, lowSec: 40 * HOUR, highSec: 40 * HOUR }],
    })
    // Dark from 14 h to 24 h (the stretches either side of midnight join), then from 38 h on.
    expect(bands.map((b) => b.firm)).toEqual([true, true])
    expect(bands[0]!.fromM).toBeCloseTo(35 * KM)
    expect(bands[0]!.toM).toBeCloseTo(60 * KM)
    expect(bands[1]!.fromM).toBeCloseTo(95 * KM)
  })

  test('is empty without points', () => {
    expect(darkBands({ ...BASE, stops: [] })).toEqual([])
  })
})

describe('fuelTickPositions', () => {
  test('puts a tick at each full hour of the middle of the expected time', () => {
    const ticks = fuelTickPositions([
      { distanceM: 50 * KM, sec: 11 * HOUR },
      { distanceM: 100 * KM, sec: 22 * HOUR },
    ])
    expect(ticks).toHaveLength(21)
    expect(ticks[0]).toBeCloseTo(50 * KM * (1 / 11))
    expect(ticks[10]).toBeCloseTo(50 * KM)
  })

  test('puts none at the finish itself, and none for a race of under an hour', () => {
    expect(fuelTickPositions([{ distanceM: 100 * KM, sec: 2 * HOUR }])).toHaveLength(1)
    expect(fuelTickPositions([{ distanceM: 5 * KM, sec: 0.5 * HOUR }])).toEqual([])
    expect(fuelTickPositions([])).toEqual([])
  })
})

const goal: GoalModel = {
  goalId: 'goal-1',
  name: 'Example 100',
  date: '2026-03-20',
  distanceM: 100 * KM,
  gainM: 3000,
  lossM: 3000,
  surface: 'trail',
  goalType: 'finish',
  targetTimeSec: null,
  startTime: '06:00',
  isUltra: true,
  distanceClass: 'ultra100k',
  expectedDurationSec: 20 * HOUR,
  crossesDarkness: true,
  raceWbgtC: 12,
}

function planOf(over: Partial<GoalModel> = {}) {
  return racePlanFor({
    goal: { ...goal, ...over },
    supportLevel: 'aided',
    prediction: { predictedSec: 20 * HOUR, lowSec: 18 * HOUR, highSec: 23 * HOUR },
    z1CeilingBpm: 142,
    ladder: replayLadder({
      settings: { optIn90: true, optInAdvanced: true, giDisease: false },
      runs: [],
      gutTrainingWeeks: [],
    }),
    weightKg: 70,
    acclimationCredit: 0,
    checkpoints: [
      { name: 'Aid 1', distanceM: 30 * KM, gainM: 500, lossM: 100, cutoffSec: 8 * HOUR },
      { name: 'Aid 2', distanceM: 70 * KM, gainM: 800, lossM: 400, cutoffSec: null },
    ],
    today: '2026-03-18',
  })
}

const COURSE = [
  { distanceM: 0, relM: 0 },
  { distanceM: 30 * KM, relM: 400 },
  { distanceM: 70 * KM, relM: 800 },
  { distanceM: 100 * KM, relM: 300 },
]

describe('raceProfileFor', () => {
  test('takes the stops and cutoffs from the arrival table, never the finish', () => {
    const profile = raceProfileFor(planOf(), COURSE)!
    expect(profile.totalM).toBe(100 * KM)
    expect(profile.stops.map((s) => [s.name, s.distanceM, s.cutoffSec])).toEqual([
      ['Aid 1', 30 * KM, 8 * HOUR],
      ['Aid 2', 70 * KM, null],
    ])
    expect(profile.stops[0]!.cutoffClock).toEqual({ time: '14:00', day: 0 })
  })

  test('has a dark band and fuel ticks when the plan has a start time and a rate', () => {
    const profile = raceProfileFor(planOf(), COURSE)!
    expect(profile.dark.length).toBeGreaterThan(0)
    expect(profile.fuelTicks.length).toBeGreaterThan(15)
    expect(profile.fuelTicks.every((m) => m > 0 && m < 100 * KM)).toBe(true)
  })

  test('draws no band without a start time, and no cutoff clock either', () => {
    const profile = raceProfileFor(planOf({ startTime: null }), COURSE)!
    expect(profile.dark).toEqual([])
    expect(profile.stops[0]!.cutoffClock).toBeNull()
    expect(profile.stops[0]!.cutoffSec).toBe(8 * HOUR)
  })

  test('is null without a course to draw', () => {
    expect(raceProfileFor(planOf(), null)).toBeNull()
    expect(raceProfileFor(planOf(), undefined)).toBeNull()
    expect(raceProfileFor(planOf(), [{ distanceM: 0, relM: 0 }])).toBeNull()
  })
})
