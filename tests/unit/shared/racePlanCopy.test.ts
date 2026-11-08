// The words of the race plan (rule H14, ADR 0010, ADR 0018): the G5 lint over every rendered
// sentence of a plan in every state, each figure that restates a Param next to its Param, and the
// things the plan never says.
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import {
  clockRangeText,
  clockText,
  describeRaceCourse,
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
    goalDistanceM: 150_000,
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
    expect(text.notices).toHaveLength(4)
    expect(text.notices.join(' ')).toMatch(/goal 150 km/)
    const joined = [text.summary, text.source, ...text.notices].join('\n')
    expect(joined).not.toMatch(/\d:\d\d ?\/ ?(km|mi)|\b(pace|split|target time|goal time)\b/i)
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
