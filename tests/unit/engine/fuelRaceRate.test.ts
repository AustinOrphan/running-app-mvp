import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { raceRateHold, replayLadder, type LadderInput } from '../../../shared/engine/fuel.ts'
import type {
  FuelRunInput,
  FuelSettingsInput,
  RaceRateHold,
  RunWeather,
} from '../../../shared/engine/types.ts'

// The race-rate read-out (rule H7, amendment FT1): the longest run and the latest day 2 of a
// back-to-back on which the race rung was tolerated. Synthetic logs only. The sentences are in
// `fuel.test.ts` (the lint over every fuel template) and `tests/web/fuel.test.tsx`.

const OPEN: FuelSettingsInput = { optIn90: true, optInAdvanced: true, giDisease: false }
const GUT_CONDITION: FuelSettingsInput = { optIn90: false, optInAdvanced: false, giDisease: true }
const COOL: RunWeather = { tempC: 12, humidityPct: 60, windKph: 5 }
/** 22 C at 80% humidity: hot for fuel, under 25 C of air. */
const HOT: RunWeather = { tempC: 22, humidityPct: 80, windKph: 0 }

interface Spec {
  id: string
  date: string
  hours?: number
  gPerH?: number
  gut?: number
  weather?: RunWeather | null
  skipped?: boolean
}

function run(spec: Spec): FuelRunInput {
  const hours = spec.hours ?? 3
  return {
    activityId: spec.id,
    date: spec.date,
    startTime: null,
    elapsedSec: hours * 3600,
    weather: spec.weather === undefined ? COOL : spec.weather,
    sessionFlags: null,
    log: {
      skipped: spec.skipped ?? false,
      items: [
        {
          name: 'Gel',
          carbsG: (spec.gPerH ?? 125) * hours,
          sodiumMg: null,
          kcal: null,
          multiCarb: true,
          servings: 1,
        },
      ],
      gut: spec.gut ?? 0,
      nausea: null,
      hotOverride: null,
    },
  }
}

/** Two tolerated runs a week apart: the floor, then 60 g/h, are tolerated, so the race rate is 60. */
const SETUP = [run({ id: 'setup1', date: '2026-02-02' }), run({ id: 'setup2', date: '2026-02-09' })]

function inputOf(
  extra: Spec[],
  options: { settings?: FuelSettingsInput; setup?: FuelRunInput[] } = {},
): LadderInput {
  return {
    settings: options.settings ?? OPEN,
    runs: [...(options.setup ?? SETUP), ...extra.map(run)],
    gutTrainingWeeks: [],
  }
}

function hold(
  extra: Spec[],
  options: { settings?: FuelSettingsInput; setup?: FuelRunInput[] } = {},
): RaceRateHold {
  const input = inputOf(extra, options)
  return raceRateHold(input, replayLadder(input))
}

describe('raceRateHold: the rate it measures against', () => {
  it('is the race rung: 60 g/h after two tolerated runs, the floor with none or a gut condition', () => {
    expect(hold([]).rate).toEqual({ gPerH: 60, range: null })
    expect(hold([], { setup: [] }).rate).toEqual({ gPerH: 30, range: [30, 50] })
    expect(hold([], { settings: GUT_CONDITION }).rate.gPerH).toBe(30)
  })
})

describe('raceRateHold: the longest run', () => {
  it('lists the setup runs when nothing longer was logged, and none for an empty log', () => {
    expect(hold([]).longest).toMatchObject({ elapsedSec: 3 * 3600 })
    expect(hold([], { setup: [] }).longest).toBeNull()
  })

  it('a 6 h tolerated run at the rung is the longest, over a shorter one', () => {
    const result = hold([
      { id: 'long', date: '2026-03-01', hours: 6 },
      { id: 'mid', date: '2026-03-08', hours: 4 },
    ])
    expect(result.longest).toEqual({
      activityId: 'long',
      date: '2026-03-01',
      elapsedSec: 6 * 3600,
      hot: false,
    })
  })

  it('a longer run below the race rung does not count', () => {
    // 8 h at 40 g/h is under 0.9 of 60 g/h (54), so the 3 h setup run stays the longest.
    const result = hold([{ id: 'low', date: '2026-03-01', hours: 8, gPerH: 40 }])
    expect(result.longest?.activityId).not.toBe('low')
    expect(result.longest?.elapsedSec).toBe(3 * 3600)
  })

  it('a run scored 2 does not count, and neither does a skipped one', () => {
    const result = hold([
      { id: 'bad', date: '2026-03-01', hours: 7, gut: 2 },
      { id: 'skip', date: '2026-03-08', hours: 7, skipped: true },
    ])
    expect(result.longest?.elapsedSec).toBe(3 * 3600)
  })

  it('a run under the logging length does not count', () => {
    const result = hold([{ id: 'short', date: '2026-03-01', hours: 1.5 }])
    expect(result.longest?.elapsedSec).toBe(3 * 3600)
  })

  it('the earliest of equal lengths is the one named', () => {
    const result = hold([{ id: 'same', date: '2026-03-01', hours: 3 }])
    expect(result.longest?.activityId).toBe('setup1')
  })

  it('does not depend on the order of the runs', () => {
    const forward = inputOf([
      { id: 'a', date: '2026-03-01', hours: 5 },
      { id: 'b', date: '2026-03-02', hours: 4 },
    ])
    const backward: LadderInput = { ...forward, runs: [...forward.runs].reverse() }
    expect(raceRateHold(backward, replayLadder(backward))).toEqual(
      raceRateHold(forward, replayLadder(forward)),
    )
  })
})

describe('raceRateHold: heat', () => {
  it('lists a tolerated run on a hot day, marked hot, though the ladder moved nothing on it', () => {
    const input = inputOf([{ id: 'hot', date: '2026-03-01', hours: 6, weather: HOT }])
    const ladder = replayLadder(input)
    expect(ladder.steps.at(-1)?.outcome).toBe('warm-tolerated')
    expect(ladder.toleratedIndex).toBe(1)
    expect(raceRateHold(input, ladder).longest).toMatchObject({ activityId: 'hot', hot: true })
  })
})

describe('raceRateHold: day 2 of a back-to-back', () => {
  const day1: Spec = { id: 'd1', date: '2026-03-07', hours: 3 }

  it('names day 2 when the run the day after a counted run was tolerated at the rung', () => {
    const result = hold([day1, { id: 'd2', date: '2026-03-08', hours: 3 }])
    expect(result.dayTwo).toMatchObject({ activityId: 'd2', date: '2026-03-08' })
  })

  it('is none without a counted run the day before, and not for a gap of two days', () => {
    expect(hold([{ id: 'solo', date: '2026-03-08' }]).dayTwo).toBeNull()
    expect(hold([day1, { id: 'gap', date: '2026-03-09' }]).dayTwo).toBeNull()
  })

  it('is none when day 2 scored 2', () => {
    expect(hold([day1, { id: 'd2', date: '2026-03-08', gut: 2 }]).dayTwo).toBeNull()
  })

  it('is none when day 2 was too short to count', () => {
    expect(hold([day1, { id: 'd2', date: '2026-03-08', hours: 1 }]).dayTwo).toBeNull()
  })

  it('is none when day 2 ran under the race rate', () => {
    expect(hold([day1, { id: 'd2', date: '2026-03-08', gPerH: 30 }]).dayTwo).toBeNull()
  })

  it('is none when day 1 did not count (short, or skipped)', () => {
    expect(
      hold([
        { ...day1, hours: 1 },
        { id: 'd2', date: '2026-03-08' },
      ]).dayTwo,
    ).toBeNull()
    expect(
      hold([
        { ...day1, skipped: true },
        { id: 'd2', date: '2026-03-08' },
      ]).dayTwo,
    ).toBeNull()
  })

  it('accepts a day 1 that scored 2: the fact is about day 2', () => {
    const result = hold([
      { ...day1, gut: 2 },
      { id: 'd2', date: '2026-03-08' },
    ])
    expect(result.dayTwo?.activityId).toBe('d2')
  })

  it('takes the latest day 2, and marks one on a hot day', () => {
    const result = hold([
      day1,
      { id: 'd2', date: '2026-03-08' },
      { id: 'e1', date: addDays('2026-03-08', 14) },
      { id: 'e2', date: addDays('2026-03-08', 15), weather: HOT },
    ])
    expect(result.dayTwo).toMatchObject({ activityId: 'e2', hot: true })
  })
})
