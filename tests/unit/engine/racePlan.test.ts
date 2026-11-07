// The race plan of an ultra goal (rule H14, ADR 0018): the pure function, its blocks and the
// properties the design holds it to.
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { raceFuelFor, replayLadder } from '../../../shared/engine/fuel.ts'
import { darkHoursFor, racePlanFor, summaryOf } from '../../../shared/engine/racePlan.ts'
import type { RacePlan, RacePlanInput } from '../../../shared/engine/racePlan.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { resolveTargets } from '../../../shared/engine/targets.ts'
import { shakeOutFor } from '../../../shared/engine/micro.ts'
import type {
  FuelRunInput,
  FuelSettingsInput,
  GoalModel,
  LadderResult,
  ZoneSet,
} from '../../../shared/engine/types.ts'

const TODAY = '2026-06-01'
const RACE = '2026-06-13'
const HOUR = 3600

/** A 100-mile goal on a cool climate, starting at six in the morning. */
function goal(overrides: Partial<GoalModel> = {}): GoalModel {
  return {
    goalId: 'goal-1',
    name: 'Example 100',
    date: RACE,
    distanceM: 160_934,
    gainM: 6_000,
    lossM: 6_000,
    surface: 'trail',
    goalType: 'finish',
    targetTimeSec: null,
    startTime: '06:00',
    isUltra: true,
    distanceClass: 'ultra100mi',
    expectedDurationSec: 30 * HOUR,
    crossesDarkness: true,
    raceWbgtC: 12,
    ...overrides,
  }
}

const OPEN: FuelSettingsInput = { optIn90: true, optInAdvanced: true, giDisease: false }
const LOCKED: FuelSettingsInput = { optIn90: false, optInAdvanced: false, giDisease: true }

/** The nth run: one a week, 3 hours long, eating 125 g/h on a cool day, scored `gut`. */
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
const TOLERATED_60 = ladder(OPEN, [run(0), run(1)])

function input(overrides: Partial<RacePlanInput> = {}): RacePlanInput {
  return {
    goal: goal(),
    supportLevel: 'aided',
    prediction: {
      predictedSec: 31 * HOUR + 1234,
      lowSec: 27 * HOUR + 200,
      highSec: 36 * HOUR + 5000,
    },
    z1CeilingBpm: 142,
    ladder: UNTRIED,
    weightKg: 70,
    acclimationCredit: 0.4,
    today: TODAY,
    ...overrides,
  }
}

const planOf = (overrides: Partial<RacePlanInput> = {}): RacePlan => racePlanFor(input(overrides))

describe('racePlanFor: the expected time', () => {
  it('rounds the prediction range outward to r1.arrivalRoundMin and keeps the point estimate', () => {
    const { expected } = planOf()
    const step = P.r1.arrivalRoundMin.value * 60
    expect(expected.basis).toBe('prediction')
    expect(expected.lowSec % step).toBe(0)
    expect(expected.highSec % step).toBe(0)
    expect(expected.lowSec).toBeLessThanOrEqual(27 * HOUR + 200)
    expect(expected.lowSec).toBeGreaterThan(27 * HOUR + 200 - step)
    expect(expected.highSec).toBeGreaterThanOrEqual(36 * HOUR + 5000)
    expect(expected.highSec).toBeLessThan(36 * HOUR + 5000 + step)
    expect(expected.midSec).toBe(31 * HOUR + 1234)
  })

  it('never narrows the range of an exact multiple', () => {
    const step = P.r1.arrivalRoundMin.value * 60
    const { expected } = planOf({
      prediction: { predictedSec: 30 * HOUR, lowSec: 28 * HOUR, highSec: 34 * HOUR },
    })
    expect([expected.lowSec, expected.highSec]).toEqual([28 * HOUR, 34 * HOUR])
    expect(28 * HOUR).toBe(168 * step)
  })

  it('falls back to the goal estimate, labelled, with no range', () => {
    const plan = planOf({ prediction: null })
    expect(plan.expected.basis).toBe('estimate')
    expect(plan.expected.lowSec).toBe(plan.expected.highSec)
    expect(plan.expected.midSec).toBe(goal().expectedDurationSec)
    expect(plan.notices).toContain('no-prediction')
  })

  it('carries the width label of the prediction, wide on purpose for an ultra', () => {
    const { range } = planOf().expected
    expect(range.wide).toBe(true)
    expect(range.grade).toBe('D')
    expect(planOf().expected.rules).toEqual(expect.arrayContaining(['H14', 'L4', 'L6']))
  })

  it('gives the finish clock only with a start time, with the day it falls on', () => {
    const plan = planOf()
    expect(plan.expected.start).toBe('06:00')
    expect(plan.expected.finish?.from.day).toBe(1)
    expect(plan.expected.finish?.to.day).toBeGreaterThanOrEqual(1)
    const none = planOf({ goal: goal({ startTime: null }) })
    expect(none.expected.start).toBeNull()
    expect(none.expected.finish).toBeNull()
    expect(none.notices).toContain('no-start-time')
  })
})

describe('racePlanFor: the parts', () => {
  it('splits the expected time into r1.thirds windows that meet and cover it', () => {
    const plan = planOf()
    const step = P.r1.arrivalRoundMin.value * 60
    expect(plan.thirds).toHaveLength(P.r1.thirds.value)
    expect(plan.thirds[0]?.fromSec).toBe(0)
    plan.thirds.forEach((third, i) => {
      expect(third.index).toBe(i)
      expect(third.fromSec % step).toBe(0)
      expect(third.toSec).toBeGreaterThan(third.fromSec)
      if (i > 0) expect(third.fromSec).toBe(plan.thirds[i - 1]?.toSec)
    })
    const last = plan.thirds.at(-1)
    expect(Math.abs((last?.toSec ?? 0) - plan.expected.midSec)).toBeLessThanOrEqual(step / 2)
    expect(plan.thirds.map((t) => t.late)).toEqual([false, false, true])
  })

  it('puts the same effort on every part: the plan holds one effort block', () => {
    const plan = planOf()
    expect(plan.effort.rpe).toEqual(P.h11.raceRpe.value)
    expect(plan.effort.belowVt1Pct).toBe(P.h11.belowVt1Share.value)
    expect(Object.keys(plan.thirds[0] ?? {})).not.toContain('rpe')
  })

  it('reads the clock windows from the start time and flags daylight starts', () => {
    const plan = planOf()
    expect(plan.thirds[0]?.clock?.from).toEqual({ time: '06:00', day: 0 })
    expect(plan.thirds.map((t) => t.startsInDaylight)).toEqual([
      true,
      expect.any(Boolean),
      expect.any(Boolean),
    ])
    const noStart = planOf({ goal: goal({ startTime: null }) })
    for (const third of noStart.thirds) {
      expect(third.clock).toBeNull()
      expect(third.startsInDaylight).toBeNull()
      expect(third.darkMin).toBeNull()
    }
  })

  it('counts the minutes of the parts outside daylight', () => {
    // 06:00 plus 30 h ends at noon the next day, so the only night is 20:00 to 06:00: ten hours
    const plan = planOf({
      prediction: { predictedSec: 30 * HOUR, lowSec: 30 * HOUR, highSec: 30 * HOUR },
    })
    const dark = plan.thirds.reduce((sum, t) => sum + (t.darkMin ?? 0), 0)
    const slack = P.r1.arrivalRoundMin.value * plan.thirds.length
    expect(Math.abs(dark - 10 * 60)).toBeLessThanOrEqual(slack)
  })
})

describe('darkHoursFor', () => {
  it('is null without a valid start time', () => {
    expect(darkHoursFor(null, HOUR, 2 * HOUR)).toBeNull()
    expect(darkHoursFor('25:99', HOUR, 2 * HOUR)).toBeNull()
  })

  it('counts the night between dusk and dawn for a start at dawn', () => {
    const dawn = P.d1Dark.dawnHour.value
    const dusk = P.d1Dark.duskHour.value
    const start = `${String(dawn).padStart(2, '0')}:00`
    // a race of exactly one night and one day: dawn to dawn
    const [low, high] = darkHoursFor(start, 24 * HOUR, 24 * HOUR) ?? [-1, -1]
    expect(low).toBeCloseTo(24 - (dusk - dawn), 9)
    expect(high).toBeCloseTo(low, 9)
  })

  it('is zero for a race that ends before dusk', () => {
    expect(darkHoursFor('07:00', 4 * HOUR, 6 * HOUR)).toEqual([0, 0])
  })

  it('does not fall as the race gets longer', () => {
    const [low, high] = darkHoursFor('13:00', 8 * HOUR, 20 * HOUR) ?? [-1, -1]
    expect(high).toBeGreaterThan(low)
  })

  it('counts a start in darkness', () => {
    expect(darkHoursFor('03:00', 2 * HOUR, 2 * HOUR)).toEqual([2, 2])
  })
})

describe('racePlanFor: dark hours block', () => {
  it('is present only when the race crosses darkness (D1)', () => {
    expect(planOf().dark).not.toBeNull()
    expect(planOf({ goal: goal({ crossesDarkness: false }) }).dark).toBeNull()
  })

  it('gives the hours range, the default clock and the headlamp runs of rule H6', () => {
    const dark = planOf().dark
    expect(dark?.hours?.[0]).toBeLessThanOrEqual(dark?.hours?.[1] ?? 0)
    expect(dark?.dawn).toBe('06:00')
    expect(dark?.dusk).toBe('20:00')
    expect(dark?.headlampRuns).toEqual(P.h6.headlampRehearsalRuns.value)
  })

  it('states the whole-race fact only without a start time', () => {
    expect(planOf({ goal: goal({ startTime: null }) }).dark?.hours).toBeNull()
  })
})

describe('racePlanFor: effort', () => {
  it('states the zone 1 ceiling the race session shows', () => {
    const zones: ZoneSet = {
      hrMax: null,
      hrRest: null,
      lt1Hr: null,
      lt2Hr: null,
      csMps: null,
      lt1PaceSecPerKm: null,
      thresholdPaceSecPerKm: null,
      hr: { z1: [110, 142], z2: [143, 158], z3: [159, 175] },
      pace: null,
      rpe: { z1: [2, 3], z2: [4, 5], z3: [6, 7] },
    }
    const session = {
      kind: 'race' as const,
      target: {
        zone: 'z1' as const,
        hr: null,
        paceSecPerKm: null,
        rpe: P.h11.raceRpe.value,
        heatNote: null,
      },
    }
    const resolved = resolveTargets(session, zones, { hot: false })
    expect(resolved.hrCeiling).toBe(142)
    expect(planOf({ z1CeilingBpm: zones.hr?.z1[1] ?? null }).effort.ceilingBpm).toBe(
      resolved.hrCeiling,
    )
  })

  it('drops the heart rate and leads with effort on a hot race (I7, I9)', () => {
    const hot = planOf({ goal: goal({ raceWbgtC: P.i9.warnWbgtC.value }) })
    expect(hot.effort.hot).toBe(true)
    expect(hot.effort.ceilingBpm).toBeNull()
    expect(hot.effort.rules).toEqual(expect.arrayContaining(['I7', 'I9']))
    const cool = planOf({ goal: goal({ raceWbgtC: P.i9.warnWbgtC.value - 0.1 }) })
    expect(cool.effort.hot).toBe(false)
    expect(cool.effort.ceilingBpm).toBe(142)
  })

  it('keeps the effort alone when the zones hold no heart rate', () => {
    const plan = planOf({ z1CeilingBpm: null })
    expect(plan.effort.ceilingBpm).toBeNull()
    expect(plan.notices).toContain('no-heart-rate')
  })
})

describe('raceFuelFor and the fuel block', () => {
  it('is the floor before any rung was tolerated, never the rung in trial', () => {
    expect(UNTRIED.currentIndex).toBeGreaterThan(UNTRIED.toleratedIndex)
    const fuel = raceFuelFor(UNTRIED, { hot: false, expectedSec: 30 * HOUR })
    expect(fuel.rungIndex).toBe(0)
    expect(fuel.basis).toBe('floor')
    expect(fuel.range).toEqual(P.h7.carbFloorGPerH.value)
    expect(fuel.lowCertainty).toBe(false)
  })

  it('is the highest tolerated rung, and never above it', () => {
    expect(TOLERATED_60.toleratedIndex).toBeGreaterThanOrEqual(1)
    const fuel = raceFuelFor(TOLERATED_60, { hot: false, expectedSec: 30 * HOUR })
    expect(fuel.rungIndex).toBe(TOLERATED_60.toleratedIndex)
    expect(fuel.rungIndex).toBeLessThan(TOLERATED_60.currentIndex + 1)
    expect(fuel.basis).toBe('tolerated')
    expect(fuel.lowCertainty).toBe(true)
    expect(fuel.gPerH).toBe(P.h7.carbTier1GPerH.value)
    expect(fuel.multiCarbRequired).toBe(false)
  })

  it('is never above the tolerated rung for any length of history', () => {
    let history: FuelRunInput[] = []
    for (let n = 0; n < 12; n++) {
      history = [...history, run(n, n % 5 === 4 ? 3 : 0)]
      const result = ladder(OPEN, history)
      const fuel = raceFuelFor(result, { hot: false, expectedSec: 20 * HOUR })
      expect(fuel.rungIndex).toBeLessThanOrEqual(Math.max(result.toleratedIndex, 0))
    }
  })

  it('stays at the floor with a diagnosed gut condition and says so', () => {
    const fuel = raceFuelFor(ladder(LOCKED, [run(0), run(1)]), { hot: false, expectedSec: HOUR })
    expect(fuel.rungIndex).toBe(0)
    expect(fuel.basis).toBe('locked')
  })

  it('counts the totals over the expected elapsed time', () => {
    const fuel = raceFuelFor(TOLERATED_60, { hot: false, expectedSec: 10 * HOUR })
    expect(fuel.hours).toBe(10)
    expect(fuel.totalG).toEqual([fuel.gPerH * 10, fuel.gPerH * 10])
    const floor = raceFuelFor(UNTRIED, { hot: false, expectedSec: 10 * HOUR })
    expect(floor.totalG).toEqual([
      P.h7.carbFloorGPerH.value[0] * 10,
      P.h7.carbFloorGPerH.value[1] * 10,
    ])
  })

  it('labels a hot race and opens the nausea plan', () => {
    const hotFuel = raceFuelFor(TOLERATED_60, { hot: true, expectedSec: HOUR })
    expect(hotFuel.hot).toBe(true)
    expect(hotFuel.nauseaPlanOpen).toBe(true)
    expect(raceFuelFor(TOLERATED_60, { hot: false, expectedSec: HOUR }).nauseaPlanOpen).toBe(false)
  })

  it('marks the plan hot for fuel at h7.hotDayWbgtC, a lower bar than the steering one', () => {
    expect(P.h7.hotDayWbgtC.value).toBeLessThan(P.i9.warnWbgtC.value)
    const between = planOf({ goal: goal({ raceWbgtC: P.h7.hotDayWbgtC.value }) })
    expect(between.fuel.hot).toBe(true)
    expect(between.effort.hot).toBe(false)
    expect(between.eahStronger).toBe(true)
    expect(planOf().fuel.hot).toBe(false)
  })

  it('splits the carbohydrate total across the parts', () => {
    const plan = planOf({ ladder: TOLERATED_60 })
    const sum = plan.thirds.reduce((s, t) => s + t.fuelG[0], 0)
    const step = P.r1.arrivalRoundMin.value * 60
    const [totalLow] = plan.fuel.totalG
    expect(Math.abs(sum - totalLow)).toBeLessThanOrEqual((plan.fuel.gPerH * step) / HOUR)
  })

  it('uses the stronger safety card over n7.eahStrongerAlertHours or in heat', () => {
    expect(planOf().eahStronger).toBe(true)
    const short = planOf({
      goal: goal({ expectedDurationSec: 8 * HOUR }),
      prediction: { predictedSec: 8 * HOUR, lowSec: 7 * HOUR, highSec: 9 * HOUR },
    })
    expect(short.eahStronger).toBe(false)
    expect(
      planOf({
        goal: goal({ raceWbgtC: 25 }),
        prediction: { predictedSec: 8 * HOUR, lowSec: 7 * HOUR, highSec: 9 * HOUR },
      }).eahStronger,
    ).toBe(true)
  })

  it('keeps the fluid reference range from the Param', () => {
    expect(planOf().fluid.referenceMlPerH).toEqual(P.h8.fluidReferenceMlPerH.value)
  })
})

describe('racePlanFor: heat', () => {
  it('reads the climate normal and never changes the expected time', () => {
    const cool = planOf({ goal: goal({ raceWbgtC: 10 }) })
    const hot = planOf({ goal: goal({ raceWbgtC: 28 }) })
    expect(hot.heat.wbgtC).toBe(28)
    expect(hot.heat.source).toBe('climate-normal')
    expect(hot.heat.hot).toBe(true)
    expect(cool.heat.hot).toBe(false)
    expect(hot.expected).toEqual(cool.expected)
    expect(hot.thirds.map((t) => [t.fromSec, t.toSec])).toEqual(
      cool.thirds.map((t) => [t.fromSec, t.toSec]),
    )
  })

  it('is low confidence over i6.lowConfidenceEventHours', () => {
    expect(planOf().heat.lowConfidence).toBe(true)
    const short = planOf({
      goal: goal({ expectedDurationSec: 5 * HOUR }),
      prediction: { predictedSec: 5 * HOUR, lowSec: 4 * HOUR, highSec: 6 * HOUR },
    })
    expect(short.heat.lowConfidence).toBe(false)
  })

  it('says nothing about heat without a cached climate', () => {
    const plan = planOf({ goal: goal({ raceWbgtC: null }) })
    expect(plan.heat.wbgtC).toBeNull()
    expect(plan.heat.hot).toBe(false)
    expect(plan.notices).toContain('no-climate')
  })
})

describe('racePlanFor: climbing', () => {
  it('appears when the course climbs at least h4.climbNoteGainPerHourM per hour of expected time', () => {
    expect(planOf().climbing).not.toBeNull()
    const flat = planOf({ goal: goal({ gainM: 300 }) })
    expect(flat.climbing).toBeNull()
  })

  it('carries the hiking grades, the reference rate and the late descent cost from their Params', () => {
    const climbing = planOf().climbing
    expect(climbing).toMatchObject({
      hikeGradePct: P.h4.hikeGradePct.value,
      walkCheaperGradePct: P.h4.walkCheaperGradePct.value,
      referenceMPerH: P.h4.ultraClimbReferenceMh.value,
      lateDescentCostIncrease: P.i11.lateDescentCostIncrease.value,
    })
  })
})

describe('racePlanFor: race week (K6)', () => {
  it('states the carbohydrate range, the final window and the grams for the body mass', () => {
    const week = planOf().raceWeek
    expect(week?.carbGPerKgDay).toEqual(P.k6.carbLoadGPerKgDay.value)
    expect(week?.finalHours).toEqual(P.k6.carbLoadFinalHours.value)
    expect(week?.carbG).toEqual([70 * 8, 70 * 10])
    expect(week?.from).toBe(addDays(RACE, -2))
    expect(week?.to).toBe(addDays(RACE, -1))
  })

  it('echoes the plan shake-out rather than restating it', () => {
    const plan = planOf()
    expect(plan.raceWeek?.shakeOut).toEqual(shakeOutFor(RACE, plan.expected.midSec / 60))
  })

  it('has no grams without a body mass', () => {
    const week = planOf({ weightKg: null }).raceWeek
    expect(week?.carbG).toBeNull()
    expect(week?.weightKg).toBeNull()
  })

  it('adds the heat top-up from i8.triggerWbgtC with the credit now', () => {
    const warm = planOf({
      goal: goal({ raceWbgtC: P.i8.triggerWbgtC.value }),
      acclimationCredit: 0.3,
    }).raceWeek
    expect(warm?.heatTopUp).toBe(true)
    expect(warm?.acclimationCredit).toBe(0.3)
    expect(
      planOf({ goal: goal({ raceWbgtC: P.i8.triggerWbgtC.value - 0.1 }) }).raceWeek?.heatTopUp,
    ).toBe(false)
  })
})

describe('racePlanFor: the goal and its support level', () => {
  it('refuses a goal that is not an ultra', () => {
    expect(() => planOf({ goal: goal({ isUltra: false, distanceClass: 'marathon' }) })).toThrow(
      RangeError,
    )
  })

  it('carries the support level for the words', () => {
    expect(planOf({ supportLevel: 'self' }).supportLevel).toBe('self')
    expect(planOf().supportLevel).toBe('aided')
  })

  it('counts the days from today to the race', () => {
    expect(planOf().daysToRace).toBe(12)
    expect(planOf({ today: RACE }).daysToRace).toBe(0)
  })

  it('lists every rule behind the plan once, H14 first', () => {
    const { rules } = planOf()
    expect(rules[0]).toBe('H14')
    expect(new Set(rules).size).toBe(rules.length)
    expect(rules).toEqual(expect.arrayContaining(['H11', 'H7', 'H8', 'K6', 'I6', 'D1', 'H6']))
  })
})

describe('racePlanFor: properties', () => {
  it('is deterministic and leaves its input alone', () => {
    const args = input({ ladder: TOLERATED_60 })
    const before = JSON.stringify(args)
    const a = racePlanFor(args)
    const b = racePlanFor(args)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(JSON.stringify(args)).toBe(before)
  })

  it('does not depend on the day except through the countdown', () => {
    const a = racePlanFor(input({ today: '2026-06-01' }))
    const b = racePlanFor(input({ today: '2026-06-09' }))
    expect({ ...a, daysToRace: 0 }).toEqual({ ...b, daysToRace: 0 })
  })

  it('moves only the range, the thirds, the fuel totals and the dark hours with the prediction', () => {
    const short = planOf({
      prediction: { predictedSec: 20 * HOUR, lowSec: 18 * HOUR, highSec: 23 * HOUR },
    })
    const long = planOf({
      prediction: { predictedSec: 36 * HOUR, lowSec: 32 * HOUR, highSec: 42 * HOUR },
    })
    expect(short.effort).toEqual(long.effort)
    expect(short.fluid).toEqual(long.fluid)
    expect(short.fuel.rungIndex).toBe(long.fuel.rungIndex)
    expect(long.expected.midSec).toBeGreaterThan(short.expected.midSec)
    expect(long.fuel.totalG[0]).toBeGreaterThan(short.fuel.totalG[0])
  })
})

describe('summaryOf', () => {
  it('is null before race week and after the race', () => {
    const plan = planOf()
    expect(summaryOf(plan, addDays(RACE, -(P.r1.raceWeekCardDays.value + 1)))).toBeNull()
    expect(summaryOf(plan, addDays(RACE, 1))).toBeNull()
  })

  it('appears from r1.raceWeekCardDays days before, race day included', () => {
    const plan = planOf()
    expect(summaryOf(plan, addDays(RACE, -P.r1.raceWeekCardDays.value))).not.toBeNull()
    expect(summaryOf(plan, RACE)?.daysToRace).toBe(0)
  })

  it('shows the carbohydrate line only in the final window', () => {
    const plan = planOf()
    expect(summaryOf(plan, addDays(RACE, -5))?.carbLineDue).toBe(false)
    expect(summaryOf(plan, addDays(RACE, -2))?.carbLineDue).toBe(true)
    expect(summaryOf(plan, RACE)?.carbLineDue).toBe(true)
  })

  it('is cut from the plan: the same effort, fuel and fluid objects', () => {
    const plan = planOf()
    const summary = summaryOf(plan, addDays(RACE, -1))
    expect(summary?.effort).toBe(plan.effort)
    expect(summary?.fuel).toBe(plan.fuel)
    expect(summary?.fluid).toBe(plan.fluid)
    expect(summary?.raceWeek).toBe(plan.raceWeek)
    expect(summary?.eahStronger).toBe(plan.eahStronger)
  })
})
