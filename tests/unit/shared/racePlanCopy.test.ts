// The words of the race plan (rule H14, ADR 0010, ADR 0018): the G5 lint over every rendered
// sentence of a plan in every state, each figure that restates a Param next to its Param, and the
// things the plan never says.
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { RACE_CARB_ROUND_G } from '../../../shared/copy/limits.ts'
import {
  clockRangeText,
  clockText,
  describeRaceCard,
  describeRaceCourse,
  raceCopyNoteText,
  describeRaceCourseProfile,
  describeRaceCourseProposal,
  describeRacePlan,
  describeRacePoints,
  describeRacePointsEditor,
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
import { TERRAIN_BINS_VERSION, TERRAIN_EDGES_PCT } from '../../../shared/domain/terrainShape.ts'
import type { Activity, Units } from '../../../shared/types.ts'
import { makeActivity } from '../../factories.ts'

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
    checkpoints: [],
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
  [
    'own climbing moved the time',
    racePlanFor(
      input({
        prediction: {
          predictedSec: 31 * HOUR,
          lowSec: 27 * HOUR,
          highSec: 37 * HOUR,
          climb: {
            runs: 23,
            defaultM: 10,
            personalM: 7,
            usedM: 9.25,
            shiftSec: -900,
            capped: false,
          },
        },
      }),
    ),
  ],
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

  it('says a prediction from training rests on training efforts that were not races (A6)', () => {
    const from = racePlanFor(
      input({
        prediction: {
          predictedSec: 31 * HOUR,
          lowSec: 20 * HOUR,
          highSec: 41 * HOUR,
          trainingSince: '2026-08-11',
        },
      }),
    )
    const expected = describeRacePlan(from, 'km').expected
    const notes = expected.notes.join(' ')
    expect(expected.source).toMatch(/^At most about this long\./)
    expect(notes).toMatch(/best efforts in training since 11 Aug/)
    expect(notes).toMatch(/not on races/)
    expect(lintText(notes)).toEqual([])
    expect(base.expected.notes.join(' ')).not.toMatch(/in training/)
    expect(base.expected.source).toMatch(/^Most likely time/)
  })

  it('says a prediction from older training efforts is no "at most" and may be stale (A6)', () => {
    const from = racePlanFor(
      input({
        prediction: {
          predictedSec: 31 * HOUR,
          lowSec: 18 * HOUR,
          highSec: 46 * HOUR,
          trainingSince: '2026-06-01',
          trainingWidened: true,
        },
      }),
    )
    const expected = describeRacePlan(from, 'km').expected
    const notes = expected.notes.join(' ')
    expect(expected.source).not.toMatch(/At most/)
    expect(expected.source).toMatch(/^Most likely time/)
    expect(notes).toMatch(
      /From your best efforts in training since 1 Jun, some older than three months/,
    )
    expect(notes).toMatch(/Fitness may have changed since\. A short test narrows it/)
    expect(notes).not.toMatch(/not on races/)
    expect(lintText(notes)).toEqual([])
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

describe('clockRangeText', () => {
  it('prints one clock when both ends read alike, with the day once', () => {
    expect(clockRangeText({ time: '17:10', day: 1 }, { time: '17:10', day: 1 })).toBe(
      '17:10 the next day',
    )
    expect(clockRangeText({ time: '17:10', day: 0 }, { time: '17:10', day: 0 })).toBe('17:10')
  })
  it('names a shared later day once and each day when they differ', () => {
    expect(clockRangeText({ time: '17:10', day: 1 }, { time: '19:30', day: 1 })).toBe(
      '17:10 to 19:30 the next day',
    )
    expect(clockRangeText({ time: '05:00', day: 0 }, { time: '07:30', day: 0 })).toBe(
      '05:00 to 07:30',
    )
    expect(clockRangeText({ time: '23:10', day: 0 }, { time: '01:30', day: 1 })).toBe(
      '23:10 to 01:30 the next day',
    )
    expect(clockRangeText({ time: '17:10', day: 1 }, { time: '03:30', day: 2 })).toBe(
      '17:10 the next day to 03:30 on day 3',
    )
  })
})

describe('the words of the checkpoint table', () => {
  const POINTS = [
    { name: 'Checkpoint A', distanceM: 50_000, gainM: 2000, lossM: 300, cutoffSec: 9 * HOUR },
    { name: 'Checkpoint B', distanceM: 110_000, gainM: null, lossM: null, cutoffSec: null },
    { name: 'Checkpoint C', distanceM: 170_000, gainM: null, lossM: null, cutoffSec: null },
  ]
  const WITH_ROWS: Array<[string, RacePlan]> = [
    ['aided', racePlanFor(input({ checkpoints: POINTS, ladder: ladderOf([run(0), run(1)]) }))],
    ['self-supported', racePlanFor(input({ checkpoints: POINTS, supportLevel: 'self' }))],
    ['no start time', racePlanFor(input({ checkpoints: POINTS, goal: goal({ startTime: null }) }))],
    ['no course climb', racePlanFor(input({ checkpoints: POINTS, goal: goal({ gainM: 0 }) }))],
  ]

  it.each(WITH_ROWS)('pass the G5 lint in both unit systems: %s', (_name, plan) => {
    for (const units of UNITS) {
      const lines = allText(describeRacePoints(plan, units))
      expect(lines.length).toBeGreaterThan(5)
      for (const line of lines) expect(lintText(line), line).toEqual([])
    }
  })

  it('says the empty state when the runner has no rows, in the words of the support level', () => {
    expect(describeRacePoints(PLANS[0]![1], 'km').empty).toMatch(/The plan works without them/)
    expect(describeRacePoints(PLANS[0]![1], 'km').heading).toBe('Checkpoints')
    expect(describeRacePoints(PLANS[1]![1], 'km').heading).toBe('Course points')
    expect(describeRacePoints(PLANS[1]![1], 'km').rows).toEqual([])
  })

  it('calls the rows course points and shows no aid wording or grams for a self-supported race', () => {
    const text = describeRacePoints(WITH_ROWS[1]![1], 'km')
    const joined = allText(text).join('\n')
    expect(text.heading).toBe('Course points')
    expect(text.edit).toBe('Edit course points')
    expect(joined).not.toMatch(/aid|checkpoint(?!\s[A-C])/i)
    expect(text.rows.every((row) => row.carry === null)).toBe(true)
    const aided = describeRacePoints(WITH_ROWS[0]![1], 'km')
    expect(aided.rows.every((row) => row.carry !== null)).toBe(true)
    expect(aided.notes.join(' ')).toMatch(/estimate/)
  })

  it('carries the few-hours label with the grams, once a rung above the floor was tolerated', () => {
    expect(describeRacePoints(WITH_ROWS[0]![1], 'km').notes.join(' ')).toMatch(/few hours/)
  })

  it('states the weights from l5.gainEquivalentM and says the later end of a range is the likelier one', () => {
    const notes = describeRacePoints(WITH_ROWS[0]![1], 'km').notes.join(' ')
    expect(notes).toContain(`climb as ${String(P.l5.gainEquivalentM.value)} units of flat`)
    expect(notes).toMatch(/the later end of each range is the likelier one/)
    expect(notes).toMatch(/defaults/)
  })

  it('says when the runner own climbing moved the weights, and only then', () => {
    const own = racePlanFor(
      input({
        checkpoints: [
          { name: 'Checkpoint A', distanceM: 40_000, gainM: null, lossM: null, cutoffSec: null },
        ],
        prediction: {
          predictedSec: 31 * HOUR,
          lowSec: 27 * HOUR,
          highSec: 37 * HOUR,
          climb: {
            runs: 23,
            defaultM: 10,
            personalM: 7,
            usedM: 9.25,
            shiftSec: -900,
            capped: false,
          },
        },
      }),
    )
    const expected = describeRacePlan(own, 'km').expected.notes.join(' ')
    expect(expected).toContain(
      'Includes your own speed on climbs from 23 runs, moving this by -15 min.',
    )
    expect(expected).toContain('at most 3%')
    expect(describeRacePoints(own, 'km').notes.join(' ')).toContain(
      'each unit of climb counts as 9.3 units of flat, not 10',
    )
    const same = racePlanFor(
      input({
        checkpoints: [
          { name: 'Checkpoint A', distanceM: 40_000, gainM: null, lossM: null, cutoffSec: null },
        ],
        prediction: {
          predictedSec: 31 * HOUR,
          lowSec: 27 * HOUR,
          highSec: 37 * HOUR,
          climb: {
            runs: 23,
            defaultM: 10,
            personalM: 10,
            usedM: 10.02,
            shiftSec: 60,
            capped: false,
          },
        },
      }),
    )
    expect(describeRacePoints(same, 'km').notes.join(' ')).not.toMatch(/blended in/)
    const plain = describeRacePlan(PLANS[0]![1], 'km').expected.notes.join(' ')
    expect(plain).not.toMatch(/your own speed/i)
  })

  it('shows a cutoff and an arrival range as two lines that never mention each other', () => {
    for (const [name, plan] of WITH_ROWS) {
      for (const units of UNITS) {
        for (const row of describeRacePoints(plan, units).rows) {
          expect(row.arrival, name).toMatch(/^About /)
          expect(row.arrival, name).not.toMatch(/cutoff/i)
          for (const line of row.cutoff) {
            expect(line, name).toMatch(/^Cutoff /)
            expect(line, name).not.toMatch(/about|arriv|range/i)
          }
          const text = allText(row).join(' ')
          expect(text, name).not.toMatch(
            /\b(before|after|inside|within|ahead|beat|margin|safe|enough)\b/i,
          )
        }
      }
    }
    const first = describeRacePoints(WITH_ROWS[0]![1], 'km').rows[0]!
    expect(first.cutoff).toEqual(['Cutoff 15:00', 'Cutoff 9 h into the race'])
    expect(describeRacePoints(WITH_ROWS[2]![1], 'km').rows[0]!.cutoff).toEqual([
      'Cutoff 9 h into the race',
    ])
  })

  it('gives the clock with a start time and the time into the race without one', () => {
    const clock = describeRacePoints(WITH_ROWS[0]![1], 'km').rows[0]!
    const elapsed = describeRacePoints(WITH_ROWS[2]![1], 'km').rows[0]!
    expect(clock.arrival).toMatch(/^About \d\d:\d\d( the next day)? to \d\d:\d\d/)
    expect(elapsed.arrival).toMatch(/into the race$/)
  })

  it('names the finish, the climb as entered or shared, the descent as not counted, and the tags', () => {
    const rows = describeRacePoints(WITH_ROWS[0]![1], 'km').rows
    expect(rows.map((row) => row.name)).toEqual(['Checkpoint A', 'Checkpoint B', 'Finish'])
    expect(rows[0]?.climb).toBe('2000 m of climb, as entered.')
    expect(rows[1]?.climb).toMatch(/^About \d+ m of climb, shared out from the course total\.$/)
    expect(rows[0]?.descent).toBe('300 m of descent, shown and not counted.')
    expect(rows[0]?.tags).toContain('Climb by effort')
    expect(rows[0]?.tags.some((tag) => tag === 'Day' || tag === 'Night')).toBe(true)
    const miles = describeRacePoints(WITH_ROWS[0]![1], 'mi').rows[0]!
    expect(miles.climb).toMatch(/ft of climb/)
    expect(miles.distance).toMatch(/mi from the start$/)
  })

  it('says what the table leaves out, and when the climb cannot be shared', () => {
    const past = racePlanFor(
      input({
        checkpoints: [...POINTS, { ...POINTS[0]!, name: 'Checkpoint D', distanceM: 999_999 }],
      }),
    )
    expect(describeRacePoints(past, 'km').notices).toEqual([
      'Points at or past the finish are left out: 2.',
    ])
    const over = racePlanFor(
      input({
        goal: goal({ gainM: 1000 }),
        checkpoints: [{ ...POINTS[0]!, gainM: 1500 }],
      }),
    )
    expect(describeRacePoints(over, 'km').notices.join(' ')).toMatch(/adds up to more than/)
    const none = describeRacePoints(WITH_ROWS[3]![1], 'km').notices.join(' ')
    expect(none).toMatch(/holds no course climb/)
  })

  it('says one time, not a range from a time to itself, when both ends are the same', () => {
    // With no prediction the expected time is the goal's own, so the ends are equal.
    const clock = racePlanFor(input({ checkpoints: POINTS, prediction: null }))
    const elapsed = racePlanFor(
      input({ checkpoints: POINTS, prediction: null, goal: goal({ startTime: null }) }),
    )
    for (const units of UNITS) {
      for (const plan of [clock, elapsed]) {
        // The finish row is the expected time itself, so its two ends are one value.
        const finish = describeRacePoints(plan, units).rows.at(-1)
        expect(finish?.arrival).not.toMatch(/ to /)
        expect(finish?.arrival).toMatch(/^About /)
      }
    }
    const finishClock = describeRacePoints(clock, 'km').rows.at(-1)?.arrival ?? ''
    expect(finishClock).toMatch(/^About \d\d:\d\d( the next day| on day \d)?$/)
    expect(describeRacePoints(elapsed, 'km').rows.at(-1)?.arrival).toBe('About 30 h into the race')
    // A real range keeps its two ends.
    expect(describeRacePoints(WITH_ROWS[0]![1], 'km').rows.at(-1)?.arrival).toMatch(/ to /)
  })

  it('leaves out a carry line that rounds to 0 g and a climb line that rounds to 0 m', () => {
    const tiny = racePlanFor(
      input({
        goal: goal({ gainM: 3 }),
        checkpoints: [
          { name: 'Checkpoint A', distanceM: 20, gainM: null, lossM: null, cutoffSec: null },
        ],
      }),
    )
    const rows = describeRacePoints(tiny, 'km').rows
    expect(rows[0]?.carry).toBeNull()
    expect(rows[0]?.climb).toBeNull()
    expect(rows.at(-1)?.carry).toMatch(/^Carry about \d+ to \d+ g of carbohydrate\.$/)
    for (const units of UNITS) {
      for (const row of describeRacePoints(tiny, units).rows) {
        expect(row.carry ?? '').not.toMatch(/about 0 to 0/)
        expect(row.climb ?? '').not.toMatch(/About 0 (m|ft)/)
      }
    }
    // An entered climb of 1 m is said; the 3 m left over rounds to 0 and is not.
    const rounded = racePlanFor(
      input({
        goal: goal({ gainM: 4 }),
        checkpoints: [
          { name: 'Checkpoint A', distanceM: 80_467, gainM: 1, lossM: null, cutoffSec: null },
        ],
      }),
    )
    const [first, second] = describeRacePoints(rounded, 'km').rows
    expect(first?.climb).toBe('1 m of climb, as entered.')
    expect(second?.climb).toBeNull()
  })

  it('has an editor whose words follow the support level and the room left', () => {
    const aided = describeRacePointsEditor({ supportLevel: 'aided' }, 'km')
    const self = describeRacePointsEditor({ supportLevel: 'self' }, 'mi')
    expect(aided.add).toBe('Add a checkpoint')
    expect(self.add).toBe('Add a course point')
    expect(self.distance).toBe('Distance from the start (mi)')
    expect(aided.pointN(2)).toBe('Point 2')
    expect(aided.dayN(0)).toBe('Race day')
    expect(aided.dayN(1)).toBe('Day 2')
    expect(aided.errCount(P.r1.maxCheckpoints.value)).toBe(
      `There is room for ${String(P.r1.maxCheckpoints.value)} points.`,
    )
    for (const editor of [aided, self]) {
      for (const [key, value] of Object.entries(editor)) {
        if (typeof value === 'string') expect(lintText(value), key).toEqual([])
      }
    }
  })
})

describe('the words of the course import', () => {
  const facts = {
    distanceM: 161_000,
    gainM: 6_200,
    lossM: 6_100,
    basis: 'waypoints' as const,
    waypoints: 18,
    spacingM: 15_000,
    offTrack: 2,
    offTrackM: 300,
    merged: 1,
    mergeM: 50,
    edge: 2,
    beyondGoal: 2,
    capped: 3,
    max: 40,
    goalDistanceM: 150_000,
    lengthDiffers: true,
  }

  it.each(UNITS)('pass the G5 lint in %s', (units) => {
    const proposals = [
      describeRaceCourseProposal(facts, units),
      describeRaceCourseProposal({ ...facts, basis: 'spaced', gainM: null, lossM: null }, units),
    ]
    const words = [
      allText(describeRaceCourse(units)),
      allText(proposals),
      allText(describeRaceCourseProfile({ lowM: 300, highM: 900 }, units)),
      [describeRaceCourse(units).errLarge(25), describeRaceCourse(units).pointName(3)],
    ].flat()
    expect(words.length).toBeGreaterThan(20)
    for (const line of words) expect(lintText(line), line).toEqual([])
  })

  it('says each fact once and nothing that sets a pace or a target', () => {
    const text = describeRaceCourseProposal(facts, 'km')
    expect(text.summary).toBe('Course in the file: 161 km, 6200 m of climb and 6100 m of descent.')
    expect(text.source).toBe(
      'Proposed from the waypoints in the file: 18. Rename, drop or add points, then type the cutoffs.',
    )
    expect(text.notices).toHaveLength(6)
    expect(text.notices.join(' ')).toMatch(/goal distance of 150 km are left out: 2/)
    expect(text.notices.join(' ')).toMatch(
      /room for 40 points, so the first 40 are kept and 3 are left out/,
    )
    expect(text.notices.join(' ')).toMatch(/goal 150 km/)
    const joined = [text.summary, text.source, ...text.notices].join('\n')
    expect(joined).not.toMatch(/\d:\d\d ?\/ ?(km|mi)|\b(pace|split|target time|goal time)\b/i)
  })

  it('says the beyond-goal notice even when the track is within two percent of the goal', () => {
    const near = describeRaceCourseProposal(
      {
        ...facts,
        lengthDiffers: false,
        goalDistanceM: 50_000,
        distanceM: 50_900,
        edge: 0,
        merged: 0,
        offTrack: 0,
        capped: 0,
        beyondGoal: 1,
      },
      'km',
    )
    expect(near.notices).toEqual([
      'Waypoints at or past the goal distance of 50 km are left out: 1.',
    ])
  })

  it('reads the climb in feet for miles, and names the axes', () => {
    expect(describeRaceCourseProposal(facts, 'mi').summary).toContain('ft of climb')
    const profile = describeRaceCourseProfile({ lowM: 300, highM: 900 }, 'mi')
    expect(profile.distanceUnit).toBe('mi')
    expect(profile.elevationUnit).toBe('ft')
    expect(profile.caption).toBe(
      'Elevation in ft against distance in mi. Dots mark the checkpoints.',
    )
  })

  it('says no climb when the file holds no elevation', () => {
    const flat = describeRaceCourseProposal({ ...facts, gainM: null, lossM: null }, 'km')
    expect(flat.summary).toContain('no elevation')
  })
})

describe("the note for the phone's copy", () => {
  const now = new Date('2026-10-23T18:00:00Z')

  it('names the time of a copy kept today, in the given zone', () => {
    expect(raceCopyNoteText('2026-10-23T11:12:00Z', now, 'km', 'UTC')).toBe(
      'Offline. Showing the race plan saved at 11:12.',
    )
  })

  it('names the day too when the copy was kept on another day', () => {
    expect(raceCopyNoteText('2026-10-22T21:50:00Z', now, 'mi', 'UTC')).toBe(
      'Offline. Showing the race plan saved on Thu 22 Oct at 21:50.',
    )
  })

  it('reads the day in the zone given, not in UTC', () => {
    expect(raceCopyNoteText('2026-10-23T03:30:00Z', now, 'km', 'America/Chicago')).toBe(
      'Offline. Showing the race plan saved on Thu 22 Oct at 22:30.',
    )
  })

  it("says only that the copy is the phone's own when it carries no time", () => {
    for (const savedAt of [undefined, 'not a time']) {
      expect(raceCopyNoteText(savedAt, now, 'km', 'UTC')).toBe(
        'Offline. Showing the race plan saved on this phone.',
      )
    }
  })

  it('passes the G5 lint', () => {
    for (const line of [
      raceCopyNoteText('2026-10-22T21:50:00Z', now, 'km', 'UTC'),
      raceCopyNoteText('2026-10-23T11:12:00Z', now, 'km', 'UTC'),
      raceCopyNoteText(undefined, now, 'km', 'UTC'),
    ]) {
      expect(lintText(line), line).toEqual([])
    }
  })
})

describe('the words of the race card', () => {
  const POINTS = [
    { name: 'Checkpoint A', distanceM: 50_000, gainM: 2000, lossM: 300, cutoffSec: 9 * HOUR },
    { name: 'Checkpoint B', distanceM: 110_000, gainM: null, lossM: null, cutoffSec: null },
    { name: 'Checkpoint C', distanceM: 150_000, gainM: 40, lossM: null, cutoffSec: 28 * HOUR },
  ]
  const aided = racePlanFor(input({ checkpoints: POINTS, ladder: ladderOf([run(0), run(1)]) }))
  const CARDS: Array<[string, RacePlan]> = [
    ['aided', aided],
    ['self-supported', racePlanFor(input({ checkpoints: POINTS, supportLevel: 'self' }))],
    ['no start time', racePlanFor(input({ checkpoints: POINTS, goal: goal({ startTime: null }) }))],
    [
      'no darkness',
      racePlanFor(input({ checkpoints: POINTS, goal: goal({ crossesDarkness: false }) })),
    ],
    ['no course climb', racePlanFor(input({ checkpoints: POINTS, goal: goal({ gainM: 0 }) }))],
  ]

  it.each(CARDS)('passes the G5 lint in both unit systems: %s', (_name, plan) => {
    for (const units of UNITS) {
      const lines = allText(describeRaceCard(plan, units))
      expect(lines.length).toBeGreaterThan(20)
      for (const line of lines) expect(lintText(line), line).toEqual([])
    }
  })

  it('has a block for the start, each checkpoint and the finish, in that order', () => {
    const card = describeRaceCard(aided, 'km')
    expect(card.blocks.map((block) => block.name)).toEqual([
      'Start',
      'Checkpoint A',
      'Checkpoint B',
      'Checkpoint C',
      'Finish',
    ])
    expect(card.blocks.map((block) => block.key)).toEqual([
      'start',
      'point-500-checkpoint-a',
      'point-1100-checkpoint-b',
      'point-1500-checkpoint-c',
      'finish',
    ])
  })

  it('says the arrival and the cutoff of a stop as two separate facts', () => {
    const [, a, , c, finish] = describeRaceCard(aided, 'km').blocks
    expect(a!.windowLabel).toBe('Expected arrival')
    expect(a!.window).toMatch(/^\d\d:\d\d to \d\d:\d\d/)
    expect(a!.window).not.toMatch(/about|cutoff/i)
    expect(a!.cutoff).toEqual(['Cutoff 15:00', 'Cutoff 9 h into the race'])
    expect(c!.cutoff).toHaveLength(2)
    expect(finish!.cutoff).toEqual([])
    expect(finish!.next).toBeNull()
  })

  it('reads the leg ahead from the next row: where it goes, its carbohydrate and its climb', () => {
    const card = describeRaceCard(aided, 'km')
    const rows = aided.splits!.rows
    const [start, a, b, , finish] = card.blocks
    expect(start!.next).toBe('Next: Checkpoint A, 50 km on.')
    expect(a!.next).toBe('Next: Checkpoint B, 60 km on.')
    expect(card.blocks[3]!.next).toBe('Next: the finish, 10.9 km on.')
    const fact = (block: typeof start, key: string) => block!.facts.find((f) => f.key === key)
    expect(fact(start, 'climb')).toMatchObject({ value: '2000 m', note: 'as entered' })
    expect(fact(start, 'descent')).toMatchObject({ value: '300 m', note: 'not used for the times' })
    expect(fact(a, 'climb')!.value).toMatch(/^About [\d ]+ m$/)
    expect(fact(a, 'climb')!.note).toBe('shared out from the course total')
    expect(fact(a, 'descent')).toBeUndefined()
    expect(fact(b, 'climb')).toMatchObject({ value: '40 m', note: 'as entered' })
    // The grams are those the table gives the same leg: one rate, one source (`raceFuelFor`).
    const round = (g: number) => Math.round(g / RACE_CARB_ROUND_G) * RACE_CARB_ROUND_G
    const grams = (low: number, high: number) =>
      round(low) === round(high)
        ? `About ${String(round(high))} g`
        : `About ${String(round(low))} to ${String(round(high))} g`
    expect(fact(start, 'fuel')!.value).toBe(grams(rows[0]!.carryG![0], rows[0]!.carryG![1]))
    expect(fact(a, 'fuel')!.value).toBe(grams(rows[1]!.carryG![0], rows[1]!.carryG![1]))
    expect(finish!.facts).toEqual([])
  })

  it("says one figure when a leg's two ends round alike, and two when the rate is a range", () => {
    const fuelOf = (b: { facts: Array<{ key: string; value: string }> }) =>
      b.facts.find((f) => f.key === 'fuel')?.value ?? null
    const fixed = fuelOf(describeRaceCard(aided, 'km').blocks[0]!)
    expect(fixed).toMatch(/^About \d+ g$/)
    const ranged = racePlanFor(
      input({ checkpoints: POINTS, ladder: ladderOf([run(0), run(1), run(2)]) }),
    )
    const lines = describeRaceCard(ranged, 'km')
      .blocks.map((b) => fuelOf(b))
      .filter((line): line is string => line !== null)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) expect(line).toMatch(/^About \d+( to \d+)? g$/)
  })

  it('names the headlamp only for an arrival the plan holds as outside daylight', () => {
    const card = describeRaceCard(aided, 'km')
    const dark = aided.dark!
    for (const [index, row] of aided.splits!.rows.entries()) {
      const block = card.blocks[index + 1]!
      if (row.night === true) {
        expect(block.headlamp).toBe(
          `Headlamp: this arrival is outside daylight. Dusk is ${dark.dusk} and dawn ${dark.dawn}.`,
        )
      } else {
        expect(block.headlamp).toBeNull()
      }
    }
    expect(card.blocks.some((block) => block.headlamp !== null)).toBe(true)
    expect(card.blocks[0]!.headlamp).toBeNull()
    const noDark = describeRaceCard(CARDS[3]![1], 'km')
    expect(noDark.blocks.every((block) => block.headlamp === null)).toBe(true)
  })

  it('lists no fuel for a self-supported race, and says why once', () => {
    const card = describeRaceCard(CARDS[1]![1], 'km')
    expect(card.blocks.every((block) => block.facts.every((f) => f.key !== 'fuel'))).toBe(true)
    expect(card.sheet!.showFuel).toBe(false)
    expect(card.notes[0]).toBe(
      'You carry everything on this course, so no fuel is listed for each leg.',
    )
  })

  it('gives the start block the start time, and none without one', () => {
    expect(describeRaceCard(aided, 'km').blocks[0]).toMatchObject({
      windowLabel: 'Start time',
      window: '06:00',
    })
    expect(describeRaceCard(CARDS[2]![1], 'km').blocks[0]!.window).toBeNull()
  })

  it('builds the split sheet from the same rows: a row for the start, each stop and the finish', () => {
    const card = describeRaceCard(aided, 'km')
    const sheet = card.sheet!
    expect(sheet.rows.map((r) => r.name)).toEqual(card.blocks.map((b) => b.name))
    expect(sheet.rows.map((r) => r.arrival)).toEqual(card.blocks.map((b) => b.window))
    expect(sheet.rows.map((r) => r.distance)).toEqual([
      'At the start',
      '50 km',
      '110 km',
      '150 km',
      '160.9 km',
    ])
    expect(sheet.rows[1]!.cutoff).toEqual(['15:00', '9 h into the race'])
    expect(sheet.rows[2]!.cutoff).toEqual([])
    expect(sheet.rows[4]!.fuel).toBeNull()
    expect(sheet.rows[0]!.fuel).toBe(card.blocks[0]!.facts.find((f) => f.key === 'fuel')!.value)
    expect(sheet.showCutoff).toBe(true)
    expect(sheet.showFuel).toBe(true)
  })

  it('builds the caption from the columns shown, and never says None for an unknown value', () => {
    const full = describeRaceCard(aided, 'km').sheet!
    expect(full.caption).toMatch(/cutoff and the fuel for the leg after it$/)
    const self = describeRaceCard(CARDS[1]![1], 'km').sheet!
    expect(self.showFuel).toBe(false)
    expect(self.caption).toBe('Each stop with its distance, expected arrival and cutoff')
    const noStart = describeRaceCard(CARDS[2]![1], 'km').sheet!
    expect(noStart.elapsed).toBe(true)
    expect(noStart.arrival).toBe('Expected arrival, into the race')
    expect(noStart.rows[0]!.arrival).toBe('Start')
    expect(full.arrival).toBe('Expected arrival')
    expect(full.rows[0]!.arrival).toBe('06:00')
    for (const text of [full.noCutoff, full.noFuel]) expect(text).not.toMatch(/^none$/i)
  })

  it('leaves the cutoff column out when no stop has a cutoff, and the sheet out without rows', () => {
    const none = racePlanFor(
      input({
        checkpoints: POINTS.map((p) => ({ ...p, cutoffSec: null })),
        ladder: ladderOf([run(0), run(1)]),
      }),
    )
    expect(describeRaceCard(none, 'km').sheet!.showCutoff).toBe(false)
    expect(describeRaceCard(PLANS[0]![1], 'km').sheet).toBeNull()
  })

  it('says the arrival in elapsed time when there is no start time', () => {
    const card = describeRaceCard(CARDS[2]![1], 'km')
    expect(card.blocks[1]!.windowLabel).toBe('Expected arrival, into the race')
    expect(card.blocks[1]!.window).toMatch(/ to /)
  })

  it('says the empty state, with no blocks, for a plan with no rows', () => {
    const card = describeRaceCard(PLANS[0]![1], 'km')
    expect(card.blocks).toEqual([])
    expect(card.empty).toMatch(/Add checkpoints, or import the course/)
  })

  it.each(CARDS)('states no pace, no split and no rate: %s', (_name, plan) => {
    for (const units of UNITS) {
      const card = describeRaceCard(plan, units)
      const joined = allText({ ...card, heading: '' }).join('\n')
      expect(joined).not.toMatch(/\d:\d\d ?\/ ?(km|mi)|\b(pace|split|splits|negative split)\b/i)
      expect(joined).not.toMatch(/g\/h|g per hour|\bper hour\b/i)
      expect(joined).not.toMatch(
        /\b(behind|ahead of|catch up|make up for|target time|goal time)\b/i,
      )
    }
  })

  it('keys a block by its place to 100 m and its name, so a note follows a re-imported or nudged stop', () => {
    const renamed = racePlanFor(
      input({
        checkpoints: POINTS.map((p, i) => (i === 0 ? { ...p, name: 'Lower station' } : p)),
        ladder: ladderOf([run(0), run(1)]),
      }),
    )
    const keys = describeRaceCard(aided, 'km').blocks.map((b) => b.key)
    expect(keys).toEqual([
      'start',
      'point-500-checkpoint-a',
      'point-1100-checkpoint-b',
      'point-1500-checkpoint-c',
      'finish',
    ])
    // renamed, the stop gets a new key: its note is left behind, not given to another stop
    const after = describeRaceCard(renamed, 'km').blocks.map((b) => b.key)
    expect(after[1]).toBe('point-500-lower-station')
    expect(after.filter((key, i) => key !== keys[i])).toEqual(['point-500-lower-station'])
    // nudged a few metres, it keeps its key
    const nudged = racePlanFor(
      input({
        checkpoints: POINTS.map((p, i) => (i === 0 ? { ...p, distanceM: p.distanceM + 30 } : p)),
        ladder: ladderOf([run(0), run(1)]),
      }),
    )
    expect(describeRaceCard(nudged, 'km').blocks.map((b) => b.key)).toEqual(keys)
  })
})

describe('the name of a later pass', () => {
  it('reads as plain ordinals', () => {
    const words = describeRaceCourse('km')
    expect(words.passName('Station', 2)).toBe('Station (2nd pass)')
    expect(words.passName('Station', 3)).toBe('Station (3rd pass)')
    expect(words.passName('Station', 4)).toBe('Station (4th pass)')
    expect(words.passName('Station', 11)).toBe('Station (11th pass)')
    expect(words.passName('Station', 22)).toBe('Station (22nd pass)')
    expect(lintText(words.passName('Station', 2))).toEqual([])
  })

  it('leaves the card in distance order whatever order the rows were given in', () => {
    const rows = [
      { name: 'B (2nd pass)', distanceM: 120_000, gainM: null, lossM: null, cutoffSec: null },
      { name: 'A', distanceM: 30_000, gainM: null, lossM: null, cutoffSec: null },
      { name: 'B', distanceM: 70_000, gainM: null, lossM: null, cutoffSec: null },
      { name: 'A (2nd pass)', distanceM: 150_000, gainM: null, lossM: null, cutoffSec: null },
    ]
    const card = describeRaceCard(racePlanFor(input({ checkpoints: rows })), 'km')
    expect(card.blocks.map((b) => b.name)).toEqual([
      'Start',
      'A',
      'B',
      'B (2nd pass)',
      'A (2nd pass)',
      'Finish',
    ])
    expect(card.blocks.map((b) => b.next)).toEqual([
      'Next: A, 30 km on.',
      'Next: B, 40 km on.',
      'Next: B (2nd pass), 50 km on.',
      'Next: A (2nd pass), 30 km on.',
      'Next: the finish, 10.9 km on.',
      null,
    ])
  })
})

describe('the start block of the race card', () => {
  const POINTS = [
    { name: 'Checkpoint A', distanceM: 50_000, gainM: null, lossM: null, cutoffSec: null },
  ]
  const headlamp = (startTime: string | null) =>
    describeRaceCard(racePlanFor(input({ checkpoints: POINTS, goal: goal({ startTime }) })), 'km')
      .blocks[0]!.headlamp

  it('names the headlamp when the race starts outside daylight', () => {
    expect(headlamp('04:00')).toMatch(/^Headlamp: this arrival is outside daylight\. Dusk is /)
  })

  it('says nothing for a start in daylight or with no start time', () => {
    expect(headlamp('06:00')).toBeNull()
    expect(headlamp(null)).toBeNull()
  })

  it('says the notes stay on the phone and go at sign-out', () => {
    expect(describeRaceCard(PLANS[0]![1], 'km').noteHint).toBe(
      'Notes stay on this phone and are cleared when you sign out.',
    )
  })
})

describe('the rehearsal block', () => {
  const chicago = { homeLat: 41.88, homeLng: -87.63 }
  const bins = (downSec: number) => {
    const sec = new Array<number>(TERRAIN_EDGES_PCT.length + 1).fill(0)
    sec[2] = downSec
    sec[4] = 3000
    return {
      v: TERRAIN_BINS_VERSION,
      windowM: 60,
      walkMps: 1,
      edgesPct: [...TERRAIN_EDGES_PCT],
      sec,
      m: sec,
      walkSec: sec.map(() => 0),
      flatCv: null,
    }
  }
  const at = (id: string, date: string, startUtc: string | null, over: Partial<Activity> = {}) =>
    makeActivity({ id, date, type: 'run', startUtc, durationSec: 3600, movingSec: 3600, ...over })
  const withRuns = (runs: Activity[], overrides: Partial<RacePlanInput> = {}) =>
    describeRacePlan(
      racePlanFor(input({ history: { activities: runs, ...chicago }, ...overrides })),
      'km',
    )

  it('carries no block without history or when the plan asks for neither kind', () => {
    expect(describeRacePlan(racePlanFor(input()), 'km').rehearsal).toBeNull()
    const flat = goal({ crossesDarkness: false, lossM: 0 })
    expect(withRuns([], { goal: flat }).rehearsal).toBeNull()
  })

  it('says what the runs hold, without a target or a comparison', () => {
    const runs = [
      at('n1', '2026-06-01', '2026-06-02T02:00:00Z'),
      at('n2', '2026-06-03', '2026-06-04T03:00:00Z'),
      at('d1', '2026-06-05', '2026-06-05T15:00:00Z', {
        durationSec: 7200,
        terrainBins: bins(1800),
      }),
    ]
    const block = withRuns(runs).rehearsal!
    expect(block.heading).toBe('Rehearsal')
    expect(block.lines[0]).toMatch(/^Night runs: 2 since .*, 2 h in the dark\.$/)
    expect(block.lines).toContain('Downhill: 30 min on grades of 6% or steeper.')
    expect(block.lines).toContain('Long runs with 10 min or more of it: 1.')
    expect(block.lines.some((l) => /no altitude/.test(l))).toBe(true)
  })

  it('says none plainly and counts runs it cannot place', () => {
    const block = withRuns([
      at('day', '2026-06-05', '2026-06-05T15:00:00Z'),
      at('nostart', '2026-06-06', null),
    ]).rehearsal!
    expect(block.lines[0]).toMatch(/^Night runs: none since /)
    expect(block.lines).toContain(
      '1 run has no start time or home place, so the sun cannot place it.',
    )
  })

  it('says when no run recorded altitude and when there are no runs', () => {
    const noAlt = withRuns([at('a', '2026-06-05', '2026-06-05T15:00:00Z')], {
      goal: goal({ crossesDarkness: false }),
    }).rehearsal!
    expect(noAlt.lines).toEqual([expect.stringMatching(/^No run since .* recorded altitude/)])
    expect(withRuns([]).rehearsal!.lines).toEqual([expect.stringMatching(/^No runs since /)])
  })

  it('passes the G5 lint in both unit systems for each state', () => {
    const states = [
      [],
      [at('n1', '2026-06-01', '2026-06-02T02:00:00Z', { terrainBins: bins(1800) })],
      [
        at('d', '2026-06-01', '2026-06-01T15:00:00Z', { terrainBins: bins(0) }),
        at('x', '2026-06-02', null),
      ],
    ]
    for (const runs of states) {
      for (const units of UNITS) {
        const text = describeRacePlan(
          racePlanFor(input({ history: { activities: runs, ...chicago } })),
          units,
        ).rehearsal
        for (const line of allText(text)) {
          expect(lintText(line), line).toEqual([])
          expect(line).not.toMatch(/behind|missed|streak|should/i)
        }
      }
    }
  })

  it('reads dark time under two hours in minutes and from two hours in hours, in km and mi', () => {
    const night = (sec: number) =>
      at('n', '2026-06-03', '2026-06-04T05:00:00Z', { durationSec: sec, movingSec: sec })
    for (const units of UNITS) {
      const lines = (sec: number) =>
        describeRacePlan(
          racePlanFor(input({ history: { activities: [night(sec)], ...chicago } })),
          units,
        ).rehearsal!.lines
      expect(lines(5400)[0]).toMatch(/, 90 min in the dark\.$/)
      expect(lines(7800)[0]).toMatch(/, 2 h 10 min in the dark\.$/)
    }
  })

  it('names the place the sun was read at: home, or the place of each run', () => {
    const home = withRuns([at('h', '2026-06-03', '2026-06-04T05:00:00Z')]).rehearsal!.lines
    expect(home).toContain(
      'Dark here means the sun is more than 6 degrees below the horizon at your home place.',
    )
    const away = withRuns([
      at('a', '2026-06-03', '2026-06-04T05:00:00Z', { startLat: 51.5, startLng: 0 }),
      at('b', '2026-06-04', '2026-06-05T05:00:00Z'),
    ]).rehearsal!.lines
    expect(away).toContain(
      'Dark here means the sun is more than 6 degrees below the horizon at the place of each run.',
    )
    expect(away.join(' ')).not.toMatch(/your home place/)
  })

  it('stays out of the summary and the race card', () => {
    const plan = racePlanFor(input({ history: { activities: [], ...chicago } }))
    expect(JSON.stringify(summaryOf(plan, RACE))).not.toMatch(/rehearsal/i)
    expect(JSON.stringify(describeRaceCard(plan, 'km'))).not.toMatch(/Rehearsal/)
  })
})
