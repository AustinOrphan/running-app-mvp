// The words of the race plan (rule H14, ADR 0010, ADR 0018): the G5 lint over every rendered
// sentence of a plan in every state, each figure that restates a Param next to its Param, and the
// things the plan never says.
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  clockText,
  describeRacePlan,
  describeRaceSummary,
  RACE_PLAN_TEMPLATES,
} from '../../../shared/copy/racePlan.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { addDays } from '../../../shared/dates.ts'
import { replayLadder } from '../../../shared/engine/fuel.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { racePlanFor, summaryOf } from '../../../shared/engine/racePlan.ts'
import type { RacePlan, RacePlanInput } from '../../../shared/engine/racePlan.ts'
import type { FuelRunInput, GoalModel } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'

const HOUR = 3600
const RACE = '2026-06-13'

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

function run(n: number): FuelRunInput {
  const base = { name: 'Gel', sodiumMg: null, kcal: null, servings: 1 }
  return {
    activityId: `a${String(n)}`,
    date: addDays('2026-03-02', n * 7),
    startTime: null,
    elapsedSec: 3 * HOUR,
    weather: { tempC: 12, humidityPct: 60, windKph: 5 },
    sessionFlags: null,
    log: {
      skipped: false,
      items: [{ ...base, carbsG: 375, multiCarb: true }],
      gut: 0,
      nausea: null,
      hotOverride: null,
    },
  }
}

const OPEN = { optIn90: true, optInAdvanced: true, giDisease: false }
const ladderOf = (runs: FuelRunInput[], settings = OPEN) =>
  replayLadder({ settings, runs, gutTrainingWeeks: [] })

function input(overrides: Partial<RacePlanInput> = {}): RacePlanInput {
  return {
    goal: goal(),
    supportLevel: 'aided',
    prediction: { predictedSec: 31 * HOUR, lowSec: 27 * HOUR, highSec: 37 * HOUR },
    z1CeilingBpm: 142,
    ladder: ladderOf([run(0), run(1), run(2)]),
    weightKg: 70,
    acclimationCredit: 0.4,
    today: '2026-06-09',
    ...overrides,
  }
}

/** Plans in the states the page can be in. */
const PLANS: Array<[string, RacePlan]> = [
  ['aided, cool, tolerated rung', racePlanFor(input())],
  ['self-supported', racePlanFor(input({ supportLevel: 'self' }))],
  ['hot race', racePlanFor(input({ goal: goal({ raceWbgtC: 27 }) }))],
  ['warm race, heat top-up', racePlanFor(input({ goal: goal({ raceWbgtC: 20 }) }))],
  ['no start time', racePlanFor(input({ goal: goal({ startTime: null }) }))],
  ['no prediction, no zones', racePlanFor(input({ prediction: null, z1CeilingBpm: null }))],
  [
    'no climate, no weight',
    racePlanFor(input({ goal: goal({ raceWbgtC: null }), weightKg: null })),
  ],
  [
    'gut condition',
    racePlanFor(input({ ladder: ladderOf([run(0)], { ...OPEN, giDisease: true }) })),
  ],
  ['floor only', racePlanFor(input({ ladder: ladderOf([]) }))],
  ['no darkness', racePlanFor(input({ goal: goal({ crossesDarkness: false }) }))],
]

const UNITS: Units[] = ['km', 'mi']

function allText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(allText)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(allText)
  return []
}

describe('the race plan templates', () => {
  const ids = Object.keys(RACE_PLAN_TEMPLATES) as Array<keyof typeof RACE_PLAN_TEMPLATES>

  it('are registered under the race.plan prefix only', () => {
    for (const id of ids) expect(id.startsWith('race.plan.'), id).toBe(true)
  })

  it.each(ids)('%s renders clean with sample values in both unit systems', (id) => {
    const template: Template = RACE_PLAN_TEMPLATES[id]
    for (const units of UNITS) {
      const text = render(template, sampleSlots(template), units)
      expect(lintText(text), `${id}: ${text}`).toEqual([])
    }
  })
})

describe.each(PLANS)('the words of a plan: %s', (_name, plan) => {
  it.each(UNITS)('pass the G5 lint in %s', (units) => {
    const text = allText(describeRacePlan(plan, units))
    expect(text.length).toBeGreaterThan(10)
    for (const line of text) expect(lintText(line), line).toEqual([])
  })

  it.each(UNITS)('never state a pace, a split, a cutoff or a finish target in %s', (units) => {
    const joined = allText(describeRacePlan(plan, units)).join('\n')
    expect(joined).not.toMatch(/\d:\d\d ?\/ ?(km|mi)/)
    expect(joined).not.toMatch(/\b(split|splits|cutoff|negative split|catch up|make up for)\b/i)
    expect(joined).not.toMatch(/\b(target time|goal time|beat)\b/i)
  })

  it('never says a number is a promise: the plan is a sketch', () => {
    const joined = allText(describeRacePlan(plan, 'km')).join('\n')
    expect(joined).toMatch(/sketch/)
  })

  it('has one part for each of r1.thirds, each with the same instruction', () => {
    const text = describeRacePlan(plan, 'km')
    expect(text.parts).toHaveLength(P.r1.thirds.value)
    expect(new Set(text.parts.map((part) => part.instruction)).size).toBe(1)
    expect(text.parts[0]?.instruction).toBe(text.effort.instruction)
  })
})

describe('figures that restate a Param come from the Param', () => {
  const base = describeRacePlan(PLANS[0]![1], 'km')

  it('says the share of the study from h11.belowVt1Share', () => {
    expect(base.effort.study).toContain(`${String(P.h11.belowVt1Share.value)}%`)
  })

  it('says the effort from h11.raceRpe and the ceiling from the zones', () => {
    const [low, high] = P.h11.raceRpe.value
    expect(base.effort.instruction).toContain(`${String(low)} to ${String(high)} out of 10`)
    expect(base.effort.instruction).toContain('142')
  })

  it('leads with effort and drops the heart rate on a hot race', () => {
    const hot = describeRacePlan(PLANS[2]![1], 'km')
    expect(hot.effort.instruction).not.toMatch(/\d{3} bpm|heart rate at or below/i)
    expect(hot.effort.instruction).toMatch(/effort leads/)
  })

  it('says the hiking grades and the reference climb from the h4 Params', () => {
    const lines = base.climbing?.lines.join(' ') ?? ''
    expect(lines).toContain(`${String(P.h4.hikeGradePct.value)}%`)
    expect(lines).toContain(`${String(P.h4.walkCheaperGradePct.value)}%`)
    expect(lines).toContain(String(P.h4.ultraClimbReferenceMh.value))
    const mi = describeRacePlan(PLANS[0]![1], 'mi').climbing?.lines.join(' ') ?? ''
    expect(mi).toContain('ft')
  })

  it('says the late descent cost from i11.lateDescentCostIncrease in the last part only', () => {
    const last = base.parts.at(-1)?.late.join(' ') ?? ''
    expect(last).toContain(`${String(Math.round(P.i11.lateDescentCostIncrease.value * 100))}%`)
    expect(base.parts[0]?.late).toEqual([])
    expect(last).toMatch(/does not ask for it to be made up/)
    expect(last).not.toMatch(/speed up|push|faster/i)
  })

  it('says the race week from the k6 Params and the body mass', () => {
    const week = base.raceWeek
    const [lowG, highG] = P.k6.carbLoadGPerKgDay.value
    const [fromH, toH] = P.k6.carbLoadFinalHours.value
    expect(week?.carb).toContain(`${String(fromH)} to ${String(toH)} hours`)
    expect(week?.carb).toContain(`${String(lowG)} to ${String(highG)} g`)
    expect(week?.carbMass).toContain('70 kg')
    expect(week?.carbMass).toContain(`${String(70 * lowG)} to ${String(70 * highG)} g`)
    expect(week?.shake).toContain(`${String(P.k6.dayBeforeMaxMin.value)} min`)
    expect(week?.evidence).toMatch(/eight endurance-trained men 10 g per kg a day for 3 days/)
    expect(week?.evidence).toMatch(/lower end of the range .* engine choices/)
  })

  it('asks for the weight when the profile holds none', () => {
    const none = describeRacePlan(PLANS[6]![1], 'km')
    expect(none.raceWeek?.carbMass).toMatch(/Add your weight/)
  })

  it('says the heat top-up only when the race reaches i8.triggerWbgtC', () => {
    expect(describeRacePlan(PLANS[3]![1], 'km').raceWeek?.heat.join(' ')).toMatch(/40%/)
    expect(base.raceWeek?.heat).toEqual([])
  })

  it('says the dark clock from d1Dark and the headlamp runs from h6', () => {
    const dark = base.dark?.lines.join(' ') ?? ''
    expect(dark).toContain('06:00')
    expect(dark).toContain('20:00')
    const [low, high] = P.h6.headlampRehearsalRuns.value
    expect(dark).toContain(`${String(low)} to ${String(high)} headlamp runs`)
    expect(describeRacePlan(PLANS[9]![1], 'km').dark).toBeNull()
  })

  it('says the rounding step from r1.arrivalRoundMin', () => {
    expect(base.expected.notes.join(' ')).toContain(`${String(P.r1.arrivalRoundMin.value)} min`)
  })

  it('says the low-confidence hours from i6.lowConfidenceEventHours on a hot race', () => {
    const hot = describeRacePlan(PLANS[2]![1], 'km')
    expect(hot.heat.join(' ')).toContain(`${String(P.i6.lowConfidenceEventHours.value)} hours`)
    expect(hot.heat.join(' ')).toMatch(/not a forecast/)
  })
})

describe('fuel and fluid words', () => {
  it('labels the totals with the few-hours tolerance and the hot-race label', () => {
    const cool = describeRacePlan(PLANS[0]![1], 'km').fuel
    expect(cool.fewHours).toMatch(/few hours/)
    expect(cool.hot).toBeNull()
    const hot = describeRacePlan(PLANS[2]![1], 'km').fuel
    expect(hot.hot).toMatch(/no run known to be at race heat/)
    expect(hot.hot).toMatch(/without weather counts as cool/)
    expect(hot.nausea.open).toBe(true)
  })

  it('names the floor as the rate when no rung above it was tolerated', () => {
    const floor = describeRacePlan(PLANS[8]![1], 'km').fuel
    expect(floor.basis).toMatch(/floor is the rate/)
    expect(floor.certainty).toBeNull()
    // the few-hours label belongs to a tolerated rate; the floor is the tested range
    expect(floor.fewHours).toBeNull()
  })

  it('carries the low-certainty label above the floor and the clinician line with a gut condition', () => {
    expect(describeRacePlan(PLANS[0]![1], 'km').fuel.certainty).toMatch(/Low certainty/)
    expect(describeRacePlan(PLANS[7]![1], 'km').fuel.lock).toMatch(/clinician/)
  })

  it('uses aid-station wording only when the race is aided, and carry wording only when it is not', () => {
    const aided = describeRacePlan(PLANS[0]![1], 'km').fuel
    const self = describeRacePlan(PLANS[1]![1], 'km').fuel
    expect(aided.aid).toMatch(/aid stations/)
    expect(aided.carry).toBeNull()
    expect(self.aid).toBeNull()
    expect(self.carry).toMatch(/carry/)
    expect(allText(describeRacePlan(PLANS[1]![1], 'km')).join(' ')).not.toMatch(/aid station/i)
  })

  it('reuses the fluid line and the safety card of the fuel words', () => {
    const fuel = describeRacePlan(PLANS[0]![1], 'km').fuel
    expect(fuel.fluid).toContain(String(P.h8.fluidReferenceMlPerH.value[0]))
    expect(fuel.eah.heading).toMatch(/Low blood sodium/)
    expect(fuel.eah.lines.some((line) => /extra care/.test(line))).toBe(true)
  })

  it('rounds the totals to RACE_CARB_ROUND_G grams', () => {
    const total = describeRacePlan(PLANS[0]![1], 'km').fuel.total
    for (const g of total.match(/\d[\d,]*(?= g)|\d[\d,]*(?= to)/g) ?? []) {
      expect(Number(g.replace(',', '')) % 10).toBe(0)
    }
  })
})

describe('the words of Today and the race-day block', () => {
  const plan = PLANS[0]![1]

  it('reads the same objects as the page', () => {
    const summary = summaryOf(plan, addDays(RACE, -1))
    if (summary === null) throw new Error('expected a summary')
    const page = describeRacePlan(plan, 'km')
    const card = describeRaceSummary(summary, 'km')
    expect(card.instruction).toBe(page.effort.instruction)
    expect(card.fuel.rate).toBe(page.fuel.rate)
    expect(card.fuel.basis).toBe(page.fuel.basis)
    expect(card.fuel.fluid).toBe(page.fuel.fluid)
    expect(card.fuel.eah).toEqual(page.fuel.eah)
    expect(card.fuel.nausea).toEqual(page.fuel.nausea)
    expect(card.carb).toBe(page.raceWeek?.carb)
    expect(card.daysToGo).toBe('1 day to go')
  })

  it('has the carbohydrate line only inside the final window', () => {
    const early = summaryOf(plan, addDays(RACE, -6))
    const late = summaryOf(plan, addDays(RACE, -2))
    expect(early === null ? null : describeRaceSummary(early, 'km').carb).toBeNull()
    expect(late === null ? null : describeRaceSummary(late, 'km').carb).not.toBeNull()
  })

  it('names the race day and the days to go', () => {
    const day = summaryOf(plan, RACE)
    expect(day === null ? '' : describeRaceSummary(day, 'km').daysToGo).toBe('Race day')
    const six = summaryOf(plan, addDays(RACE, -6))
    expect(six === null ? '' : describeRaceSummary(six, 'km').daysToGo).toBe('6 days to go')
  })

  it('passes the G5 lint in both unit systems', () => {
    const summary = summaryOf(plan, addDays(RACE, -1))
    if (summary === null) throw new Error('expected a summary')
    for (const units of UNITS) {
      for (const line of allText(describeRaceSummary(summary, units))) {
        expect(lintText(line), line).toEqual([])
      }
    }
  })
})

describe('clockText', () => {
  it('names the day a time falls on', () => {
    expect(clockText({ time: '06:00', day: 0 })).toBe('06:00')
    expect(clockText({ time: '09:30', day: 1 })).toBe('09:30 the next day')
    expect(clockText({ time: '03:10', day: 2 })).toBe('03:10 on day 3')
  })
})
