// The words of the race plan (rule H14, ADR 0010, ADR 0018): the G5 lint over every rendered
// sentence of a plan in every state, each figure that restates a Param next to its Param, and the
// things the plan never says.
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { RACE_CARB_ROUND_G } from '../../../shared/copy/limits.ts'
import { describeEstimate } from '../../../shared/copy/raceEstimate.ts'
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
import type { RacePlan, RacePlanInput, RaceWeekSession } from '../../../shared/engine/racePlan.ts'
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

function run(n: number, hours = 3, gPerH = 125): FuelRunInput {
  const base = { name: 'Gel', sodiumMg: null, kcal: null, servings: 1 }
  return {
    activityId: `a${String(n)}`,
    date: addDays('2026-03-02', n * 7),
    startTime: null,
    elapsedSec: hours * HOUR,
    weather: { tempC: 12, humidityPct: 60, windKph: 5 },
    sessionFlags: null,
    log: {
      skipped: false,
      items: [{ ...base, carbsG: gPerH * hours, multiCarb: true }],
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
    'duration floor, only short runs tolerated',
    racePlanFor(input({ ladder: ladderOf([run(0, 2), run(1, 2)]) })),
  ],
  [
    'duration floor, a lower rung tolerated on a long run',
    // 70 g/h was tolerated on a 2 h run only; the 60 g/h rung on a 4 h run, which eats too little for 70
    racePlanFor(input({ ladder: ladderOf([run(0, 3, 36), run(1, 4, 62), run(2, 2, 76)]) })),
  ],
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

  it('keeps the rule wording and no note while the saved day before is within the rule', () => {
    const week = base.raceWeek
    expect(week?.shake).toMatch(
      /^The training plan keeps the day before to at most 20 min of easy running/,
    )
    expect(week?.shakeNote).toBeNull()
  })

  it('states what the training plan holds after an edit, with the rule as a plain fact', () => {
    const sessions: RaceWeekSession[] = [
      { date: addDays(RACE, -1), kind: 'easy', durationMin: 45 },
      { date: RACE, kind: 'race', durationMin: 1800 },
    ]
    for (const units of UNITS) {
      const week = describeRacePlan(
        racePlanFor(input({ raceWeekSessions: sessions })),
        units,
      ).raceWeek
      expect(week?.shake).toBe(
        'The training plan has 45 min on the day before, and easy running only from Thu 11 Jun.',
      )
      expect(week?.shakeNote).toBe(
        `The rule for a race this long suggests at most ${String(P.k6.dayBeforeMaxMin.value)} min of easy running the day before.`,
      )
      for (const line of [week?.shake ?? '', week?.shakeNote ?? '']) {
        expect(lintText(line), line).toEqual([])
        expect(line).not.toMatch(/\b(behind|missed|too|should|must|red)\b/i)
      }
    }
  })

  it('leaves out the easy-days clause when the day before is not easy running', () => {
    const sessions: RaceWeekSession[] = [
      { date: addDays(RACE, -1), kind: 'strides', durationMin: 15 },
      { date: RACE, kind: 'race', durationMin: 1800 },
    ]
    const week = describeRacePlan(racePlanFor(input({ raceWeekSessions: sessions })), 'km').raceWeek
    expect(week?.shake).toBe('The training plan has a 15 min strides session on the day before.')
    expect(lintText(week?.shake ?? '')).toEqual([])
    expect(week?.shakeNote).not.toBeNull()
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

  it('names the two views of the page apart from the Plan tab, and says the race plan in the card intro', () => {
    const card = describeRaceCard(PLANS[0]![1], 'km')
    expect(card.viewPlan).toBe('Overview')
    expect(card.viewCard).toBe('Race card')
    expect(card.intro).toMatch(/ranges from the race plan/)
  })

  it('ends the last part at the figure of the expected time, to the minute', () => {
    for (const [name, plan] of PLANS) {
      const text = describeRacePlan(plan, 'km')
      expect(text.parts.at(-1)?.window, name).toBe(
        `${text.parts.at(-1)?.window.split(' to ')[0] ?? ''} to ${text.expected.figure} into the race`,
      )
    }
  })

  it('says the training plan for the headlamp runs and the day before, never "the plan"', () => {
    expect(base.dark?.lines.join(' ')).toMatch(
      /The training plan asks for \d+ to \d+ headlamp runs/,
    )
    expect(base.raceWeek?.shake).toMatch(/^The training plan keeps the day before/)
  })

  it('heads the carbohydrate block by what it covers, not "Race week"', () => {
    expect(base.raceWeek?.heading).toBe('The last two days')
    // Today's card in the race week keeps its own heading: it covers the whole week.
    const summary = summaryOf(PLANS[0]![1], addDays(RACE, -1))
    if (summary === null) throw new Error('expected a summary')
    expect(describeRaceSummary(summary, 'km').heading).toBe('Race week')
  })

  it('says one figure for the hours outside daylight when the two ends are the same', () => {
    const goalOnly = describeRacePlan(PLANS[5]![1], 'km').dark?.lines[0] ?? ''
    expect(goalOnly).toMatch(/^About \d+ hours of the expected time fall outside daylight\.$/)
    expect(goalOnly).not.toMatch(/ to /)
    const wide = racePlanFor(
      input({ prediction: { predictedSec: 30 * HOUR, lowSec: 20 * HOUR, highSec: 40 * HOUR } }),
    )
    expect(describeRacePlan(wide, 'km').dark?.lines[0]).toMatch(
      /^About \d+ to \d+ hours of the expected time/,
    )
  })

  it('says "1 hour" in the singular and leaves the line out when the dark hours round to 0', () => {
    const plan = PLANS[5]![1]
    const withHours = (hours: [number, number]): RacePlan => ({
      ...plan,
      dark: { ...plan.dark!, hours },
    })
    const lines = (hours: [number, number]) =>
      describeRacePlan(withHours(hours), 'km').dark?.lines ?? []
    expect(lines([1.2, 0.8])[0]).toBe('About 1 hour of the expected time falls outside daylight.')
    expect(lines([0.2, 0.4]).join(' ')).not.toMatch(/outside daylight/)
    expect(lines([0.2, 0.4])[0]).toMatch(/^Daylight here is/)
    expect(lines([0.2, 2.4])[0]).toBe(
      'About 0 to 2 hours of the expected time fall outside daylight.',
    )
  })

  it('says the rounding of the shown times, the same on every plan', () => {
    expect(base.expected.notes.join(' ')).toContain(
      'Times are rounded to the minute (to ten minutes from six hours), and the range outward.',
    )
  })

  it('words a sub-6 h estimate from the raw prediction, as Today and Goals do (PF1)', () => {
    // 4:57:10 to 5:32:20 raw; the clock window still rounds to r1.arrivalRoundMin (4:50 to 5:40).
    const raw = { predictedSec: 18_900, lowSec: 17_830, highSec: 19_940 }
    const plan = racePlanFor(input({ prediction: raw }))
    const text = describeRacePlan(plan, 'km').expected
    const sentence = 'Finish estimate 4 h 57 min to 5 h 33 min, most likely about 5 h 15 min.'
    expect(text.source).toBe(sentence)
    expect(text.figure).toBe('5 h 15 min')
    expect(describeEstimate(raw, 'km').summary).toBe(sentence)
    expect(plan.expected.lowSec).toBe(17_400)
    expect(plan.expected.highSec).toBe(20_400)
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
    expect(expected.source).toMatch(/^At most about .+\. Finish estimate /)
    expect(notes).toMatch(/best efforts in training since 11 Aug/)
    expect(notes).toMatch(/not on races/)
    expect(lintText(notes)).toEqual([])
    expect(base.expected.notes.join(' ')).not.toMatch(/in training/)
    expect(base.expected.source).toMatch(/^Finish estimate .+, most likely about /)
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
    expect(expected.source).toMatch(/^Finish estimate .+, most likely about /)
    expect(notes).toMatch(
      /The estimate is from your best efforts in training since 1 Jun, some older than three months/,
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

  it('says the cooling line (CL1) with the hot heat block only, within the record limits', () => {
    const hot = PLANS[2]![1]
    const text = describeRacePlan(hot, 'km').heat.join(' ')
    expect(text).toContain('In lab trials of short, hot efforts')
    expect(text).toContain('The gain varied between methods')
    expect(text).toContain('The trials were in men and none covered a race of hours')
    expect(text).not.toMatch(/\d+ ?%|seconds|heat day|acclimat|best|better than/)
    expect(lintText(text)).toEqual([])
    expect(hot.heat.rules).toContain('I8')
    const cool = PLANS[0]![1]
    expect(describeRacePlan(cool, 'km').heat.join(' ')).not.toContain('cooling')
    expect(cool.heat.rules).not.toContain('I8')
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

  it('keeps the tolerated words for a runner whose only tolerated rung is the floor, as before the duration floor', () => {
    const plan = racePlanFor(input({ ladder: ladderOf([run(0, 3, 36)]) }))
    expect(plan.fuel).toMatchObject({ basis: 'tolerated', rungIndex: 0, durationFloor: null })
    const fuel = describeRacePlan(plan, 'km').fuel
    expect(fuel.basis).toBe('This is the highest rate your own runs tolerated.')
    expect(fuel.durationNote).toBeNull()
    expect(fuel.fewHours).toMatch(/few hours/)
  })

  it('says, for a runner whose only tolerated rung came from short runs, what was tolerated and on what', () => {
    const plan = PLANS.find(([name]) => name.startsWith('duration floor, only'))![1]
    expect(plan.fuel).toMatchObject({ basis: 'floor', rungIndex: 0 })
    expect(plan.fuel.durationFloor).not.toBeNull()
    const fuel = describeRacePlan(plan, 'km').fuel
    expect(fuel.rate).toBe('Carbohydrate: 30 to 50 g/h.')
    expect(fuel.basis).toBe(
      'No rate above the floor was tolerated on a run of 3 h or longer, so the floor is the rate.',
    )
    expect(fuel.basis).not.toMatch(/has not tolerated/)
    expect(fuel.durationNote).toBe(
      'A higher rate, 60 g/h, was tolerated on runs up to 2 h. The race rate counts a rate tolerated on a run of 3 h or longer.',
    )
    // the few-hours label and the certainty label belong to a tolerated rate; this one is the floor
    expect(fuel.fewHours).toBeNull()
    expect(fuel.certainty).toBeNull()
    expect(fuel.multiCarb).toBeNull()
    // the totals run at the floor rate
    expect(fuel.total).toMatch(/^About 930 to 1550 g/)
  })

  it('words a lower tolerated rung that a long run carried, and names the higher rung held back', () => {
    const plan = PLANS.find(([name]) => name.startsWith('duration floor, a lower'))![1]
    expect(plan.fuel).toMatchObject({ basis: 'tolerated', gPerH: 60 })
    const fuel = describeRacePlan(plan, 'km').fuel
    expect(fuel.basis).toBe(
      'This is the highest rate your own runs tolerated on a run of 3 h or longer.',
    )
    expect(fuel.durationNote).toMatch(/^A higher rate, 70 g\/h, was tolerated on runs up to 2 h\./)
    expect(fuel.certainty).toMatch(/Low certainty/)
    expect(fuel.fewHours).toMatch(/few hours/)
  })

  it('has no duration note when the floor did not bind, in any other plan', () => {
    for (const [name, plan] of PLANS) {
      if (name.startsWith('duration floor')) continue
      expect(plan.fuel.durationFloor, name).toBeNull()
      expect(describeRacePlan(plan, 'km').fuel.durationNote, name).toBeNull()
    }
  })

  it('never words the floor as a minimum, a miss or a count of what is left', () => {
    for (const [name, plan] of PLANS) {
      const fuel = describeRacePlan(plan, 'km').fuel
      const text = [fuel.basis, fuel.durationNote ?? ''].join(' ')
      expect(text, name).not.toMatch(
        /\b(must|minimum|required|short of|only \d|still need|more runs)\b/i,
      )
    }
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

  it('states a total of one rate as one figure, never "About 360 to 360 g"', () => {
    for (const [, plan] of PLANS) {
      const total = describeRacePlan(plan, 'km').fuel.total
      expect(total).not.toMatch(/About ([\d,]+) to \1 g/)
      expect(total).toMatch(/^About [\d,]+(?: to [\d,]+)? g over the expected time\.$/)
    }
    const [low, high] = PLANS[0]![1].fuel.totalG
    const one = describeRacePlan(PLANS[0]![1], 'km').fuel.total
    if (low === high) expect(one).not.toContain(' to ')
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
    expect(describeRacePoints(PLANS[0]![1], 'km').empty).toMatch(/The race plan works without them/)
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

  it('states the weights from l5.gainEquivalentM and gives crew the early end without ranking the ends', () => {
    const notes = describeRacePoints(WITH_ROWS[0]![1], 'km').notes.join(' ')
    expect(notes).toContain(`climb as ${String(P.l5.gainEquivalentM.value)} units of flat`)
    expect(notes).toContain('Each range is an estimate at an even effort')
    expect(notes).toContain(
      'Be there by the early end; the runner may arrive anywhere in the range.',
    )
    expect(notes).toMatch(/defaults/)
  })

  it('never says one end of an arrival range is likelier, on the page or the card', () => {
    const plan = WITH_ROWS[0]![1]
    const words = [
      describeRacePoints(plan, 'km').notes.join(' '),
      describeRaceCard(plan, 'km').notes.join(' '),
    ].join(' ')
    expect(words).toContain('anywhere in the range')
    expect(words).not.toMatch(
      /(later|late|upper|slower|far)\s+(end|edge|side)[^.]*(likel|probab|more often)/i,
    )
    expect(words).not.toMatch(/(likel|probab)[^.]*(later|late|upper|slower)\s+(end|edge|side)/i)
    expect(words).not.toMatch(/Speed tends to fall/)
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

  it('shows a cutoff and an arrival range as separate lines that never mention each other', () => {
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
    // One line holds both forms of the cutoff.
    expect(first.cutoff).toEqual(['Cutoff 15:00, 9 h into the race'])
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
    expect(a!.cutoff).toEqual(['Cutoff 15:00, 9 h into the race'])
    expect(c!.cutoff).toHaveLength(1)
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

  describe('"When it gets hard"', () => {
    const quiet = racePlanFor(
      input({
        checkpoints: POINTS,
        goal: goal({
          distanceM: 50_000,
          gainM: 500,
          lossM: 500,
          expectedDurationSec: 6 * HOUR,
          distanceClass: 'ultra50',
          raceWbgtC: null,
        }),
        prediction: { predictedSec: 6 * HOUR, lowSec: 5.5 * HOUR, highSec: 6.5 * HOUR },
      }),
    )

    it('repeats the fuel lines of the Race page, word for word, when the plan holds them', () => {
      const hot = racePlanFor(
        input({ checkpoints: POINTS, goal: goal({ raceWbgtC: 27 }), ladder: ladderOf([run(0)]) }),
      )
      expect(hot.fuel.nauseaPlanOpen).toBe(true)
      expect(hot.eahStronger).toBe(true)
      for (const units of UNITS) {
        const page = describeRacePlan(hot, units).fuel
        const hard = describeRaceCard(hot, units).hard
        expect(hard).not.toBeNull()
        expect(hard!.heading).toBe('When it gets hard')
        expect(hard!.nausea).toEqual({ heading: page.nausea.heading, lines: page.nausea.lines })
        expect(hard!.fluid).toBe(page.fluid)
        expect(hard!.eah).toEqual(page.eah)
        expect(hard!.noteLabel).toBe('Crew note for When it gets hard')
        expect(lintText(hard!.crew), hard!.crew).toEqual([])
      }
    })

    it('leaves out the nausea plan while it is closed, and keeps the fluid and safety lines', () => {
      expect(aided.fuel.nauseaPlanOpen).toBe(false)
      expect(aided.eahStronger).toBe(true)
      const hard = describeRaceCard(aided, 'km').hard
      expect(hard?.nausea).toBeNull()
      expect(hard?.fluid).toBe(describeRacePlan(aided, 'km').fuel.fluid)
      expect(hard?.eah?.lines.length).toBeGreaterThan(0)
    })

    it('is absent when the plan holds no nausea plan and no stronger safety card', () => {
      expect(quiet.eahStronger).toBe(false)
      expect(quiet.fuel.nauseaPlanOpen).toBe(false)
      expect(describeRaceCard(quiet, 'km').hard).toBeNull()
    })

    it('is absent from a card with no rows', () => {
      expect(describeRaceCard(racePlanFor(input()), 'km').hard).toBeNull()
    })

    it('states no figure of its own: the only numbers are the reference range and the alert hours', () => {
      const hot = racePlanFor(
        input({ checkpoints: POINTS, goal: goal({ raceWbgtC: 27 }), ladder: ladderOf([run(0)]) }),
      )
      const hard = describeRaceCard(hot, 'km').hard!
      const numbers = allText(hard).join(' ').match(/\d+/g) ?? []
      const [low, high] = P.h8.fluidReferenceMlPerH.value
      expect(numbers.sort()).toEqual(
        [String(low), String(high), String(P.n7.eahStrongerAlertHours.value)].sort(),
      )
    })
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
    const flat = goal({ crossesDarkness: false, lossM: 0, gainM: 0 })
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
      goal: goal({ crossesDarkness: false, gainM: 0 }),
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

  describe('the climb lines', () => {
    const hilly = goal({ distanceM: 100_000, gainM: 1670, lossM: 1670, crossesDarkness: false })
    const climbBins = (climbSec: number, walkSec: number) => {
      const b = bins(0)
      b.sec[6] = climbSec
      b.walkSec[6] = walkSec
      return b
    }
    const long = (id: string, over: Partial<Activity> = {}) =>
      at(id, '2026-06-05', null, {
        durationSec: 7200,
        distanceM: 20_000,
        elevationGainM: 100,
        elevationLossM: 60,
        terrainBins: climbBins(1800, 900),
        ...over,
      })
    const linesOf = (runs: Activity[], units: 'km' | 'mi' = 'km') =>
      describeRacePlan(
        racePlanFor(input({ goal: hilly, history: { activities: runs, ...chicago } })),
        units,
      ).rehearsal!.lines

    it('sets the long runs beside the course in plain figures, in km', () => {
      const lines = linesOf([long('a'), long('b')])
      expect(lines).toContain('The course climbs 17 m and descends 17 m per km.')
      expect(lines).toContain(
        'Long runs of 90 min or more since 18 Mar: 2, with a median of 5 m climb and 3 m descent per km.',
      )
      expect(lines).toContain('Long runs with as much climb per km as the course: 0.')
      expect(lines).toContain(
        'Long runs: 60 min on uphill grades of 3% or steeper, 50% of it walking.',
      )
    })

    it('reads the same figures per mile in feet', () => {
      const lines = linesOf([long('a')], 'mi')
      expect(lines).toContain('The course climbs 88 ft and descends 88 ft per mile.')
      expect(lines.join(' ')).toMatch(/median of 26 ft climb and 16 ft descent per mile\./)
    })

    it('says plainly when there are no long runs, no climb or no band time', () => {
      const short = at('s', '2026-06-05', null, { durationSec: 3000 })
      expect(linesOf([short])).toContain('Long runs of 90 min or more since 18 Mar: none.')
      expect(linesOf([long('a', { elevationGainM: null, elevationLossM: null })])).toContain(
        'Long runs of 90 min or more since 18 Mar: 1, none with climb recorded.',
      )
      expect(linesOf([long('a', { terrainBins: null })])).toContain(
        'No long run has altitude time yet, so time on climbs cannot be counted.',
      )
      expect(linesOf([long('a', { terrainBins: bins(0) })])).toContain(
        'Long runs: none on uphill grades of 3% or steeper.',
      )
    })

    it('states no descent when the goal holds none', () => {
      const noLoss = goal({
        distanceM: 100_000,
        gainM: 1670,
        lossM: 0,
        crossesDarkness: false,
      })
      const lines = describeRacePlan(
        racePlanFor(input({ goal: noLoss, history: { activities: [long('a')], ...chicago } })),
        'km',
      ).rehearsal!.lines
      expect(lines).toContain('The course climbs 17 m per km.')
      expect(lines).toContain(
        'Long runs of 90 min or more since 18 Mar: 1, with a median of 5 m climb per km.',
      )
      expect(lines.join(' ')).not.toMatch(/descen/i)
    })

    it('says how many long runs the climbing time comes from when some have no bins', () => {
      const lines = linesOf([
        long('a'),
        long('b', { terrainBins: null }),
        long('c', { terrainBins: null }),
        long('d', { terrainBins: null }),
      ])
      expect(lines).toContain(
        'The climbing time comes from 1 of the 4 long runs; the others have no altitude time.',
      )
      expect(linesOf([long('a'), long('b')]).join(' ')).not.toMatch(/comes from/)
    })

    it('reads a cached payload from before the climb part as having none', () => {
      const plan = racePlanFor(
        input({ goal: hilly, history: { activities: [long('a')], ...chicago } }),
      )
      const old = JSON.parse(JSON.stringify(plan)) as { rehearsal: { climb?: unknown } }
      delete old.rehearsal.climb
      const lines = describeRacePlan(old as unknown as typeof plan, 'km').rehearsal!.lines
      expect(lines.join(' ')).not.toMatch(/climb/i)
    })

    it('rounds the walked share to a whole percent', () => {
      const lines = linesOf([long('a', { terrainBins: climbBins(3000, 1000) })])
      expect(lines).toContain(
        'Long runs: 50 min on uphill grades of 3% or steeper, 33% of it walking.',
      )
    })

    it('counts the long runs at or above the course and passes the G5 lint in both units', () => {
      const lines = linesOf([long('a', { elevationGainM: 400 })])
      expect(lines).toContain('Long runs with as much climb per km as the course: 1.')
      for (const units of UNITS) {
        for (const line of linesOf([long('a'), long('b', { terrainBins: null })], units)) {
          expect(lintText(line), line).toEqual([])
          expect(line).not.toMatch(/behind|missed|streak|should|target/i)
        }
      }
    })

    it('gives a goal with no gain no climb line', () => {
      const flat = goal({ gainM: 0, lossM: 0, crossesDarkness: true })
      const lines = describeRacePlan(
        racePlanFor(input({ goal: flat, history: { activities: [long('a')], ...chicago } })),
        'km',
      ).rehearsal!.lines
      expect(lines.join(' ')).not.toMatch(/climb/i)
    })
  })

  it('stays out of the summary and the race card', () => {
    const plan = racePlanFor(input({ history: { activities: [], ...chicago } }))
    expect(JSON.stringify(summaryOf(plan, RACE))).not.toMatch(/rehearsal/i)
    expect(JSON.stringify(describeRaceCard(plan, 'km'))).not.toMatch(/Rehearsal/)
  })
})
