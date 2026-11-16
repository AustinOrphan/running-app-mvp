// The race plan of a road goal (rule H15, ADR 0023): the pure function, its blocks and the gates the
// design holds it to. Synthetic goals and predictions only.
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { replayLadder } from '../../../shared/engine/fuel.ts'
import { goalPaceSecPerKm } from '../../../shared/engine/goal.ts'
import { heatWarning } from '../../../shared/engine/heat.ts'
import { shakeOutFor } from '../../../shared/engine/micro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { carbLineDays, raceWbgtIndex, raceWeekFor } from '../../../shared/engine/racePlan.ts'
import {
  roadRacePlanFor,
  roadSummaryOf,
  type RoadRacePlan,
  type RoadRacePlanInput,
} from '../../../shared/engine/racePlanRoad.ts'
import type {
  FuelRunInput,
  FuelSettingsInput,
  GoalModel,
  LadderResult,
} from '../../../shared/engine/types.ts'

const TODAY = '2026-06-01'
const RACE = '2026-06-13'
const MIN = 60
const HOUR = 3600
const CS = 4.2 // m/s, a synthetic critical speed

function goal(overrides: Partial<GoalModel> = {}): GoalModel {
  return {
    goalId: 'goal-1',
    name: 'Example Marathon',
    date: RACE,
    distanceM: 42_195,
    gainM: 0,
    lossM: 0,
    surface: 'road',
    goalType: 'finish',
    targetTimeSec: null,
    startTime: '08:00',
    isUltra: false,
    distanceClass: 'marathon',
    expectedDurationSec: 4 * HOUR,
    crossesDarkness: false,
    raceWbgtC: 12,
    ...overrides,
  }
}

const HALF = { distanceM: 21_097.5, distanceClass: 'half' } as const
const TEN_K = { distanceM: 10_000, distanceClass: '10k' } as const

const OPEN: FuelSettingsInput = { optIn90: true, optInAdvanced: true, giDisease: false }
const LOCKED: FuelSettingsInput = { optIn90: false, optInAdvanced: false, giDisease: true }

function run(n: number, gut = 0): FuelRunInput {
  const base = { name: 'Gel', sodiumMg: null, kcal: null, servings: 1 }
  return {
    activityId: `a${String(n).padStart(3, '0')}`,
    date: addDays('2026-03-02', n * 7),
    startTime: null,
    elapsedSec: 3 * HOUR,
    weather: { tempC: 12, humidityPct: 60, windKph: 5 },
    sessionFlags: null,
    log: {
      skipped: false,
      items: [{ ...base, carbsG: 125 * 3, multiCarb: true }],
      gut,
      nausea: null,
      hotOverride: null,
    },
  }
}

function ladder(settings: FuelSettingsInput, runs: FuelRunInput[] = []): LadderResult {
  return replayLadder({ settings, runs, gutTrainingWeeks: [] })
}

const UNTRIED = ladder(OPEN)
const TOLERATED = ladder(OPEN, [run(0), run(1), run(2)])
const LOCKED_LADDER = ladder(LOCKED)

/** A prediction with a symmetric 5% range around `midSec`; `rules` holds I2 unless told otherwise. */
function prediction(
  midSec: number,
  rules: string[] = ['L6', 'L2', 'I2'],
): NonNullable<RoadRacePlanInput['prediction']> {
  return { predictedSec: midSec, lowSec: midSec * 0.95, highSec: midSec * 1.05, rules }
}

function input(overrides: Partial<RoadRacePlanInput> = {}): RoadRacePlanInput {
  return {
    goal: goal(),
    supportLevel: 'aided',
    prediction: prediction(4 * HOUR),
    coolPredictedSec: 4 * HOUR - 6 * MIN,
    cs: { mps: CS, fromTraining: false, widened: false },
    ladder: UNTRIED,
    weightKg: 70,
    acclimationCredit: 0.4,
    today: TODAY,
    ...overrides,
  }
}

const planOf = (overrides: Partial<RoadRacePlanInput> = {}): RoadRacePlan =>
  roadRacePlanFor(input(overrides))

/** A marathon or half of `mid` seconds, with the goal's own duration following it. */
function race(kind: 'marathon' | 'half', midSec: number, over: Partial<RoadRacePlanInput> = {}) {
  return planOf({
    goal: goal({ ...(kind === 'half' ? HALF : {}), expectedDurationSec: midSec }),
    prediction: prediction(midSec),
    coolPredictedSec: midSec,
    ...over,
  })
}

describe('roadRacePlanFor: scope', () => {
  it('throws a RangeError for a 5 km and for every ultra class', () => {
    const classes = ['ultra50', 'ultra100k', 'ultra100mi', 'beyond'] as const
    expect(() =>
      roadRacePlanFor(input({ goal: goal({ distanceM: 5000, distanceClass: '5k' }) })),
    ).toThrow(RangeError)
    for (const distanceClass of classes) {
      expect(() =>
        roadRacePlanFor(input({ goal: goal({ distanceClass, isUltra: true }) })),
      ).toThrow(RangeError)
    }
  })

  it('answers for a 10 km, a half marathon and a marathon', () => {
    expect(planOf({ goal: goal(TEN_K) }).distanceClass).toBe('10k')
    expect(planOf({ goal: goal(HALF) }).distanceClass).toBe('half')
    expect(planOf().distanceClass).toBe('marathon')
  })

  it('is deterministic and does not touch its input', () => {
    const frozen = structuredClone(input())
    const deepFreeze = (value: unknown): void => {
      if (typeof value !== 'object' || value === null) return
      Object.values(value).forEach(deepFreeze)
      Object.freeze(value)
    }
    deepFreeze(frozen)
    const first = roadRacePlanFor(frozen)
    expect(roadRacePlanFor(frozen)).toEqual(first)
    expect(frozen).toEqual(input())
  })
})

describe('roadRacePlanFor: the expected time and the pace', () => {
  const cases: Array<['marathon' | 'half', number]> = [
    ['half', 95 * MIN],
    ['half', 130 * MIN],
    ['marathon', 170 * MIN],
    ['marathon', 4 * HOUR],
    ['marathon', 5 * HOUR + 15 * MIN],
  ]
  for (const [kind, midSec] of cases) {
    for (const startTime of ['08:00', null]) {
      it(`${kind} ${String(midSec / MIN)} min, start ${String(startTime)}`, () => {
        const plan = race(kind, midSec, {
          goal: goal({
            ...(kind === 'half' ? HALF : {}),
            expectedDurationSec: midSec,
            startTime,
          }),
        })
        const km = plan.distanceM / 1000
        expect(plan.expected.basis).toBe('prediction')
        expect(plan.expected.lowSec).toBe(midSec * 0.95)
        expect(plan.expected.highSec).toBe(midSec * 1.05)
        expect(plan.expected.midSec).toBe(midSec)
        expect(plan.pace?.fastSecPerKm).toBe((midSec * 0.95) / km)
        expect(plan.pace?.slowSecPerKm).toBe((midSec * 1.05) / km)
        expect(plan.expected.finish === null).toBe(startTime === null)
        expect(plan.notices.includes('no-start-time')).toBe(startTime === null)
        // the fuel rate appears only from the ladder's own run length
        expect(plan.fuel !== null).toBe(midSec >= P.h7.logMinDurationMin.value * MIN)
        expect(plan.notices.includes('short-for-ladder')).toBe(plan.fuel === null)
        // the race week appears only from 90 minutes of the goal's expected duration
        expect(plan.raceWeek !== null).toBe(midSec >= P.k6.carbLoadMinRaceMin.value * MIN)
      })
    }
  }

  it('measures the race week on the goal duration and the fuel gate on the prediction', () => {
    const plan = race('half', 92 * MIN, {
      goal: goal({ ...HALF, expectedDurationSec: 88 * MIN }),
    })
    expect(plan.raceWeek).toBeNull()
    const longer = race('half', 121 * MIN, {
      goal: goal({ ...HALF, expectedDurationSec: 118 * MIN }),
    })
    expect(longer.fuel).not.toBeNull()
    expect(longer.raceWeek).not.toBeNull()
  })

  it('shows the goal time and pace beside the range for a time goal, and nothing compares them', () => {
    const plan = planOf({ goal: goal({ goalType: 'time', targetTimeSec: 3 * HOUR + 30 * MIN }) })
    expect(plan.goal).toEqual({
      timeSec: 3 * HOUR + 30 * MIN,
      paceSecPerKm: Math.round((3 * HOUR + 30 * MIN) / 42.195),
    })
    expect(planOf().goal).toBeNull()
    expect(planOf({ goal: goal({ goalType: 'finish', targetTimeSec: 3 * HOUR }) }).goal).toBeNull()
  })

  it('falls back to the goal estimate with no pace and a notice', () => {
    const plan = planOf({ prediction: null, coolPredictedSec: null })
    expect(plan.expected).toMatchObject({
      basis: 'estimate',
      lowSec: 4 * HOUR,
      highSec: 4 * HOUR,
      midSec: 4 * HOUR,
    })
    expect(plan.pace).toBeNull()
    expect(plan.firstHalf).toBeNull()
    expect(plan.heat.inRangeSec).toBeNull()
    expect(plan.notices).toContain('no-prediction')
  })

  it('carries the A6 window and the climb through unchanged', () => {
    const plan = planOf({
      prediction: {
        ...prediction(4 * HOUR),
        trainingSince: '2026-03-01',
        trainingWidened: true,
        climb: { runs: 6, shiftSec: -90 } as never,
      },
    })
    expect(plan.expected.trainingSince).toBe('2026-03-01')
    expect(plan.expected.trainingWidened).toBe(true)
    expect(plan.expected.climb).toEqual({ runs: 6, shiftSec: -90 })
    expect(plan.rules).toContain('L5')
  })
})

describe('roadRacePlanFor: the race week', () => {
  it('is the ultra plan’s block from the same function, null under the shake-out threshold', () => {
    for (const minutes of [85, 89, 90, 95]) {
      const model = goal({ ...HALF, expectedDurationSec: minutes * MIN })
      const week = raceWeekFor({
        goal: model,
        expectedMin: minutes,
        weightKg: 70,
        wbgtC: 12,
        acclimationCredit: 0.4,
      })
      const shakeOut = shakeOutFor(RACE, minutes)
      expect(week === null).toBe(shakeOut === undefined)
      expect(week?.shakeOut).toEqual(shakeOut)
      const plan = planOf({ goal: model, prediction: prediction(minutes * MIN) })
      expect(plan.raceWeek).toEqual(week)
    }
  })

  it('carries the heat top-up from the race WBGT', () => {
    expect(planOf({ goal: goal({ raceWbgtC: 17.9 }) }).raceWeek?.heatTopUp).toBe(false)
    expect(planOf({ goal: goal({ raceWbgtC: P.i8.triggerWbgtC.value }) }).raceWeek?.heatTopUp).toBe(
      true,
    )
  })
})

describe('roadRacePlanFor: the first half', () => {
  it('equals 1000 over the fixed fraction of critical speed, exactly', () => {
    const { firstHalf } = planOf()
    expect(firstHalf?.secPerKm).toBe(1000 / (P.k6.firstHalfWarningCsFraction.value * CS))
    expect(firstHalf?.csFraction).toBe(P.k6.firstHalfWarningCsFraction.value)
    expect(firstHalf?.fromTraining).toBe(false)
  })

  it('is shown only for a marathon on a road or track course with a fresh CS and 150 min or more', () => {
    expect(planOf({ goal: goal({ surface: 'track' }) }).firstHalf).not.toBeNull()
    expect(planOf({ goal: goal(HALF) }).firstHalf).toBeNull()
    expect(planOf({ goal: goal(TEN_K) }).firstHalf).toBeNull()
    const edge = P.l2.csFractionShortMin.value * MIN
    expect(race('marathon', edge).firstHalf).not.toBeNull()
    expect(race('marathon', edge - 1).firstHalf).toBeNull()
  })

  it('says why it is missing: no CS, a widened CS; and nothing for a fast marathon', () => {
    expect(planOf({ cs: null }).notices).toContain('no-cs')
    expect(planOf({ cs: null }).firstHalf).toBeNull()
    const dated = planOf({ cs: { mps: CS, fromTraining: false, widened: true } })
    expect(dated.notices).toContain('cs-dated')
    expect(dated.firstHalf).toBeNull()
    const fast = race('marathon', 140 * MIN, { cs: null })
    expect(fast.firstHalf).toBeNull()
    expect(fast.notices).not.toContain('no-cs')
    expect(fast.notices).not.toContain('cs-dated')
  })

  it('keeps the line and the average pace together when the pace range reaches the figure', () => {
    const plan = race('marathon', 155 * MIN, {
      cs: { mps: 4.6, fromTraining: false, widened: false },
    })
    expect(plan.firstHalf).not.toBeNull()
    expect(plan.pace).not.toBeNull()
  })

  it('marks a CS from training', () => {
    expect(
      planOf({ cs: { mps: CS, fromTraining: true, widened: false } }).firstHalf?.fromTraining,
    ).toBe(true)
  })
})

describe('roadRacePlanFor: the course surface', () => {
  for (const surface of ['trail', 'mixed'] as const) {
    it(`${surface}: no pace and no first-half line, a notice, and the rest of the plan`, () => {
      const plan = planOf({ goal: goal({ surface }) })
      expect(plan.pace).toBeNull()
      expect(plan.firstHalf).toBeNull()
      expect(plan.notices).toContain('course-not-flat')
      expect(plan.fuel).not.toBeNull()
      expect(plan.raceWeek).not.toBeNull()
      expect(plan.heat.wbgtC).toBe(12)
    })
  }

  it('road and track carry no course notice', () => {
    expect(planOf().notices).not.toContain('course-not-flat')
    expect(planOf({ goal: goal({ surface: 'track' }) }).notices).not.toContain('course-not-flat')
  })
})

describe('roadRacePlanFor: heat', () => {
  const COOL = 4 * HOUR - 6 * MIN
  for (const wbgtC of [8, 15, 18, 22, 25, 27]) {
    it(`WBGT ${String(wbgtC)}`, () => {
      const marathon = planOf({ goal: goal({ raceWbgtC: wbgtC }), coolPredictedSec: COOL })
      expect(marathon.heat.wbgtC).toBe(wbgtC)
      expect(marathon.heat.source).toBe('climate-normal')
      expect(marathon.heat.inRangeSec).toBe(6 * MIN)
      expect(marathon.heat.warm).toBe(wbgtC > P.i3.slopeStartC.value)
      expect(marathon.heat.aboveModel).toBe(heatWarning(wbgtC) !== null)
      expect(marathon.heat.paceShapeFinding).toBe(wbgtC > P.i3.slopeStartC.value)
      expect(marathon.notices).not.toContain('heat-not-in-range')

      // a half marathon never carries the I5 finding
      const half = planOf({ goal: goal({ ...HALF, raceWbgtC: wbgtC }) })
      expect(half.heat.paceShapeFinding).toBe(false)
      expect(half.rules).not.toContain('I5')
      expect(JSON.stringify(marathon)).not.toMatch(/heartRate|bpm|rpe/i)
    })
  }

  it('says the range holds no heat when the prediction has no I2', () => {
    const plan = planOf({
      goal: goal({ raceWbgtC: 22 }),
      prediction: prediction(4 * HOUR, ['L6', 'L2']),
    })
    expect(plan.heat.inRangeSec).toBeNull()
    expect(plan.notices).toContain('heat-not-in-range')
    const cool = planOf({
      goal: goal({ raceWbgtC: 10 }),
      prediction: prediction(4 * HOUR, ['L6', 'L2']),
    })
    expect(cool.notices).not.toContain('heat-not-in-range')
  })

  it('is zero minutes, not a figure, when the model adds nothing at the WBGT', () => {
    const plan = planOf({ goal: goal({ raceWbgtC: 8 }), coolPredictedSec: 4 * HOUR })
    expect(plan.heat.inRangeSec).toBe(0)
  })

  it('has no climate: a notice and no heat figure', () => {
    const plan = planOf({
      goal: goal({ raceWbgtC: null }),
      prediction: prediction(4 * HOUR, ['L6', 'L2']),
      coolPredictedSec: 4 * HOUR,
    })
    expect(plan.heat.wbgtC).toBeNull()
    expect(plan.heat.warm).toBe(false)
    expect(plan.notices).toContain('no-climate')
    expect(plan.fuel?.hot).toBe(false)
  })

  it('never applies heat a second time: the expected time ignores the cool prediction', () => {
    const withCool = planOf({ coolPredictedSec: 3 * HOUR })
    const without = planOf({ coolPredictedSec: null })
    expect(withCool.expected).toEqual(without.expected)
    expect(withCool.pace).toEqual(without.pace)
    expect(without.heat.inRangeSec).toBeNull()
  })

  it('does not let a faster cool prediction go negative', () => {
    expect(planOf({ coolPredictedSec: 5 * HOUR }).heat.inRangeSec).toBe(0)
  })
})

describe('raceWbgtIndex and hot for fuel', () => {
  it('is null for no climate and a WBGT index otherwise', () => {
    expect(raceWbgtIndex({ raceWbgtC: null })).toBeNull()
    expect(raceWbgtIndex({ raceWbgtC: 14 })).toEqual({ value: 14, index: 'wbgt' })
  })

  it('sits on either side of h7.hotDayWbgtC', () => {
    const limit = P.h7.hotDayWbgtC.value
    expect(planOf({ goal: goal({ raceWbgtC: limit - 0.1 }) }).fuel?.hot).toBe(false)
    expect(planOf({ goal: goal({ raceWbgtC: limit }) }).fuel?.hot).toBe(true)
    expect(planOf({ goal: goal({ raceWbgtC: limit }) }).fuel?.nauseaPlanOpen).toBe(true)
  })
})

describe('roadRacePlanFor: fuel and fluid', () => {
  for (const [name, fuelLadder] of [
    ['untried', UNTRIED],
    ['tolerated', TOLERATED],
    ['locked', LOCKED_LADDER],
  ] as const) {
    for (const wbgtC of [10, 20]) {
      it(`${name} ladder, WBGT ${String(wbgtC)}: never above the tolerated rung`, () => {
        const plan = planOf({ ladder: fuelLadder, goal: goal({ raceWbgtC: wbgtC }) })
        const expectedRung = fuelLadder.locked ? 0 : Math.max(fuelLadder.toleratedIndex, 0)
        expect(plan.fuel?.rungIndex).toBe(expectedRung)
        expect(plan.fuel?.rungIndex).toBeLessThanOrEqual(Math.max(fuelLadder.toleratedIndex, 0))
        expect(plan.fuel?.basis).toBe(
          fuelLadder.locked ? 'locked' : fuelLadder.toleratedIndex >= 0 ? 'tolerated' : 'floor',
        )
        expect(plan.fuel?.nauseaPlanOpen).toBe(
          wbgtC >= P.h7.hotDayWbgtC.value || fuelLadder.nauseaForward,
        )
        expect(plan.fuel?.rules).toEqual(['H7', 'H15'])
      })
    }
  }

  it('has no fuel and no nausea plan under the ladder length, and keeps the fluid line', () => {
    const plan = race('half', 100 * MIN)
    expect(plan.fuel).toBeNull()
    expect(plan.fluid?.referenceMlPerH).toEqual([...P.h8.fluidReferenceMlPerH.value])
    expect(plan.notices).toContain('short-for-ladder')
  })

  it('opens the stronger safety card in heat or past n7.eahStrongerAlertHours', () => {
    expect(planOf().eahStronger).toBe(false)
    expect(planOf({ goal: goal({ raceWbgtC: 20 }) }).eahStronger).toBe(true)
    const slow = race('marathon', (P.n7.eahStrongerAlertHours.value + 1) * HOUR)
    expect(slow.eahStronger).toBe(true)
  })

  it('holds no FT1 field and no fuel timing', () => {
    const keys = JSON.stringify(Object.keys(planOf()))
    expect(keys).not.toMatch(/hold|timing|interval/i)
  })
})

describe('roadRacePlanFor: a 10 km', () => {
  const plan = planOf({ goal: goal(TEN_K), prediction: prediction(50 * MIN) })

  it('holds the time, pace and heat blocks only', () => {
    expect(plan.pace).not.toBeNull()
    expect(plan.heat.wbgtC).toBe(12)
    expect(plan.firstHalf).toBeNull()
    expect(plan.fuel).toBeNull()
    expect(plan.fluid).toBeNull()
    expect(plan.eahStronger).toBe(false)
    expect(plan.raceWeek).toBeNull()
    expect(plan.notices).not.toContain('short-for-ladder')
    expect(plan.heat.paceShapeFinding).toBe(false)
  })

  it('has no race week even when the goal runs past the threshold', () => {
    const slow = planOf({
      goal: goal({ ...TEN_K, expectedDurationSec: 100 * MIN }),
      prediction: prediction(100 * MIN),
    })
    expect(slow.raceWeek).toBeNull()
    expect(slow.fuel).toBeNull()
  })

  it('has no Today summary', () => {
    expect(roadSummaryOf(plan, RACE)).toBeNull()
  })
})

describe('roadSummaryOf', () => {
  const plan = planOf()

  it('is null outside race week and after the race', () => {
    expect(roadSummaryOf(plan, addDays(RACE, -P.r1.raceWeekCardDays.value - 1))).toBeNull()
    expect(roadSummaryOf(plan, addDays(RACE, 1))).toBeNull()
  })

  it('cuts the same objects the page shows', () => {
    const summary = roadSummaryOf(plan, addDays(RACE, -3))
    expect(summary).not.toBeNull()
    expect(summary?.daysToRace).toBe(3)
    expect(summary?.expected).toBe(plan.expected)
    expect(summary?.raceWeek).toBe(plan.raceWeek)
    expect(summary?.fuel).toBe(plan.fuel)
    expect(summary?.fluid).toBe(plan.fluid)
    expect(summary?.eahStronger).toBe(plan.eahStronger)
    // the K6 line is due inside the final window of k6.carbLoadFinalHours, not for all of race week
    expect(summary?.carbLineDue).toBe(false)
    expect(roadSummaryOf(plan, addDays(RACE, -carbLineDays()))?.carbLineDue).toBe(true)
    expect(roadSummaryOf(plan, RACE)?.daysToRace).toBe(0)
  })
})

describe('goalPaceSecPerKm', () => {
  it('is the target time over the distance for a time goal, null otherwise', () => {
    expect(goalPaceSecPerKm({ goalType: 'time', targetTimeSec: 12_600, distanceM: 42_195 })).toBe(
      Math.round(12_600 / 42.195),
    )
    expect(
      goalPaceSecPerKm({ goalType: 'finish', targetTimeSec: 12_600, distanceM: 42_195 }),
    ).toBeNull()
    expect(
      goalPaceSecPerKm({ goalType: 'time', targetTimeSec: null, distanceM: 42_195 }),
    ).toBeNull()
    expect(goalPaceSecPerKm({ goalType: 'time', targetTimeSec: 12_600, distanceM: 0 })).toBeNull()
  })
})
