// The words of the road race plan (rule H15, ADR 0010, ADR 0023): the G5 lint over every template
// and every rendered sentence of a plan in every state, the findings each sentence is allowed to
// state, and the things the plan never says. Synthetic goals only.
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import {
  describeRoadRacePlan,
  describeRoadRaceSummary,
  RACE_PLAN_ROAD_TEMPLATES,
} from '../../../shared/copy/racePlanRoad.ts'
import { render, sampleSlots, type Template } from '../../../shared/copy/template.ts'
import { addDays } from '../../../shared/dates.ts'
import { replayLadder } from '../../../shared/engine/fuel.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { roadRacePlanFor, roadSummaryOf } from '../../../shared/engine/racePlanRoad.ts'
import type { RoadRacePlan, RoadRacePlanInput } from '../../../shared/engine/racePlanRoad.ts'
import type { FuelRunInput, GoalModel } from '../../../shared/engine/types.ts'
import type { Units } from '../../../shared/types.ts'

const MIN = 60
const HOUR = 3600
const RACE = '2026-06-13'
const UNITS: Units[] = ['km', 'mi']

function goal(overrides: Partial<GoalModel> = {}): GoalModel {
  return {
    goalId: 'goal-1',
    name: 'Example Marathon',
    date: RACE,
    distanceM: 42_195,
    gainM: 0,
    lossM: 0,
    surface: 'road',
    goalType: 'time',
    targetTimeSec: 3 * HOUR + 45 * MIN,
    startTime: '08:00',
    isUltra: false,
    distanceClass: 'marathon',
    expectedDurationSec: 4 * HOUR,
    crossesDarkness: false,
    raceWbgtC: 12,
    ...overrides,
  }
}

const HALF = { distanceM: 21_097.5, distanceClass: 'half', targetTimeSec: 105 * MIN } as const
const TEN_K = { distanceM: 10_000, distanceClass: '10k', targetTimeSec: 50 * MIN } as const

function run(n: number, hours = 3): FuelRunInput {
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
      items: [{ ...base, carbsG: 125 * hours, multiCarb: true }],
      gut: 0,
      nausea: null,
      hotOverride: null,
    },
  }
}

const OPEN = { optIn90: true, optInAdvanced: true, giDisease: false }
const ladderOf = (runs: FuelRunInput[], settings = OPEN) =>
  replayLadder({ settings, runs, gutTrainingWeeks: [] })

function pred(midSec: number, rules = ['L6', 'L2', 'I2']) {
  return { predictedSec: midSec, lowSec: midSec * 0.95, highSec: midSec * 1.05, rules }
}

function input(overrides: Partial<RoadRacePlanInput> = {}): RoadRacePlanInput {
  return {
    goal: goal(),
    supportLevel: 'aided',
    prediction: pred(4 * HOUR),
    coolPredictedSec: 4 * HOUR - 7 * MIN,
    cs: { mps: 4.2, fromTraining: false, widened: false },
    ladder: ladderOf([run(0), run(1), run(2)]),
    weightKg: 70,
    acclimationCredit: 0.4,
    today: '2026-06-09',
    ...overrides,
  }
}

const PLANS: Array<[string, RoadRacePlan]> = [
  ['marathon, cool, tolerated rung', roadRacePlanFor(input())],
  ['marathon, warm', roadRacePlanFor(input({ goal: goal({ raceWbgtC: 20 }) }))],
  ['marathon, above the model', roadRacePlanFor(input({ goal: goal({ raceWbgtC: 27 }) }))],
  [
    'marathon, no heat in the prediction',
    roadRacePlanFor(input({ goal: goal({ raceWbgtC: 22 }), prediction: pred(4 * HOUR, ['L6']) })),
  ],
  ['marathon, trail', roadRacePlanFor(input({ goal: goal({ surface: 'trail' }) }))],
  [
    'marathon, CS from training',
    roadRacePlanFor(input({ cs: { mps: 4.2, fromTraining: true, widened: false } })),
  ],
  ['marathon, no CS', roadRacePlanFor(input({ cs: null }))],
  [
    'marathon, dated CS',
    roadRacePlanFor(input({ cs: { mps: 4.2, fromTraining: false, widened: true } })),
  ],
  ['marathon, no prediction', roadRacePlanFor(input({ prediction: null, coolPredictedSec: null }))],
  [
    'marathon, no start time, no weight',
    roadRacePlanFor(input({ goal: goal({ startTime: null }), weightKg: null })),
  ],
  ['marathon, no climate', roadRacePlanFor(input({ goal: goal({ raceWbgtC: null }) }))],
  [
    'marathon, A6 window and climb',
    roadRacePlanFor(
      input({
        prediction: {
          ...pred(4 * HOUR),
          trainingSince: '2026-03-01',
          climb: { runs: 9, defaultM: 10, personalM: 7, usedM: 9, shiftSec: -90, capped: false },
        },
      }),
    ),
  ],
  [
    'marathon, gut condition',
    roadRacePlanFor(input({ ladder: ladderOf([run(0)], { ...OPEN, giDisease: true }) })),
  ],
  ['marathon, floor only', roadRacePlanFor(input({ ladder: ladderOf([]) }))],
  [
    'marathon, duration floor, a slow race and runs of 2 h',
    roadRacePlanFor(
      input({
        goal: goal({ expectedDurationSec: 330 * MIN }),
        prediction: pred(330 * MIN),
        coolPredictedSec: 330 * MIN,
        ladder: ladderOf([run(0, 2), run(1, 2)]),
      }),
    ),
  ],
  ['marathon, self-supported', roadRacePlanFor(input({ supportLevel: 'self' }))],
  [
    'half over 2 h',
    roadRacePlanFor(
      input({
        goal: goal({ ...HALF, expectedDurationSec: 130 * MIN }),
        prediction: pred(130 * MIN),
      }),
    ),
  ],
  [
    'half under 2 h, warm',
    roadRacePlanFor(
      input({
        goal: goal({ ...HALF, expectedDurationSec: 100 * MIN, raceWbgtC: 22 }),
        prediction: pred(100 * MIN),
      }),
    ),
  ],
  [
    'half, under 90 min',
    roadRacePlanFor(
      input({
        goal: goal({ ...HALF, expectedDurationSec: 80 * MIN }),
        prediction: pred(80 * MIN),
      }),
    ),
  ],
  [
    '10 km',
    roadRacePlanFor(
      input({
        goal: goal({ ...TEN_K, expectedDurationSec: 50 * MIN }),
        prediction: pred(50 * MIN),
      }),
    ),
  ],
  [
    '10 km, trail',
    roadRacePlanFor(
      input({
        goal: goal({ ...TEN_K, surface: 'trail', expectedDurationSec: 50 * MIN }),
        prediction: pred(50 * MIN),
      }),
    ),
  ],
]

const plan = (name: string): RoadRacePlan => PLANS.find(([label]) => label === name)![1]

function allText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(allText)
  if (value !== null && typeof value === 'object') return Object.values(value).flatMap(allText)
  return []
}

/** A rendered line holds one template or, for the K6 evidence, two joined by a space. */
const sentences = (text: string): string[] => text.split(/(?<=\.) (?=[A-Z])/)

const textOf = (name: string, units: Units = 'km') =>
  allText(describeRoadRacePlan(plan(name), units)).join('\n')

describe('the road race templates', () => {
  const entries = Object.entries(RACE_PLAN_ROAD_TEMPLATES) as Array<[string, Template]>

  it('are named race.plan.road.*', () => {
    for (const [id] of entries) expect(id.startsWith('race.plan.road.')).toBe(true)
  })

  for (const [id, template] of entries) {
    it(`${id} renders clean and short in both unit systems`, () => {
      for (const units of UNITS) {
        const text = render(template, sampleSlots(template), units)
        expect(lintText(text), text).toEqual([])
        expect(text.length, text).toBeLessThanOrEqual(COPY_MAX_CHARS)
        if (template.shape === 'sentence') expect(text, text).toMatch(/[.?]$/)
      }
    })
  }
})

describe('every plan renders clean in both unit systems', () => {
  for (const [label, built] of PLANS) {
    for (const units of UNITS) {
      it(`${label} (${units})`, () => {
        for (const text of allText(describeRoadRacePlan(built, units))) {
          expect(lintText(text), text).toEqual([])
          for (const sentence of sentences(text)) {
            expect(sentence.length, sentence).toBeLessThanOrEqual(COPY_MAX_CHARS)
          }
        }
        const summary = roadSummaryOf(built, addDays(RACE, -3))
        if (summary !== null) {
          for (const text of allText(describeRoadRaceSummary(summary, units))) {
            expect(lintText(text), text).toEqual([])
            for (const sentence of sentences(text)) {
              expect(sentence.length, sentence).toBeLessThanOrEqual(COPY_MAX_CHARS)
            }
          }
        }
      })
    }
  }

  it('never says what the plan must not: a faster time, behind, missed, a minimum or a limit', () => {
    for (const [label] of PLANS) {
      expect(textOf(label), label).not.toMatch(/faster time|behind|missed|minimum|\blimit/i)
    }
  })

  it('carries the sketch line on every render', () => {
    for (const [label] of PLANS) expect(textOf(label), label).toContain('Every line is a sketch')
  })
})

describe('the first half', () => {
  const text = describeRoadRacePlan(plan('marathon, cool, tolerated rung'), 'km').firstHalf!

  it('is headed First half and pins both sentences, naming its population', () => {
    expect(text.heading).toBe('First half')
    expect(text.population).toBe(
      `In more than 25,000 recreational marathon runners, a first half faster than ${String(Math.round(P.k6.firstHalfWarningCsFraction.value * 100))}% of critical speed went more often with a second half over a quarter slower.`,
    )
    expect(text.figure).toMatch(
      /^From your critical speed, that is a first-half average faster than about \d+:\d\d \/km\./,
    )
    expect(text.figure).toContain('not a pace to run')
    expect(text.figure).toContain('It is where slowing was more common')
  })

  it('reads the figure in the runner’s units', () => {
    const miles = describeRoadRacePlan(plan('marathon, cool, tolerated rung'), 'mi').firstHalf!
    expect(miles.figure).toMatch(/about \d+:\d\d \/mi\./)
  })

  it('says a CS from training may make the figure slower, and only then', () => {
    expect(text.notes).toEqual([])
    expect(
      describeRoadRacePlan(plan('marathon, CS from training'), 'km').firstHalf!.notes.join(' '),
    ).toContain('comes from training')
  })

  it('is absent for a half, a 10 km, a trail marathon, no CS and a dated CS', () => {
    for (const label of [
      'half over 2 h',
      '10 km',
      'marathon, trail',
      'marathon, no CS',
      'marathon, dated CS',
    ]) {
      expect(describeRoadRacePlan(plan(label), 'km').firstHalf, label).toBeNull()
      expect(textOf(label), label).not.toContain('First half')
    }
  })

  it('says why in a notice for no CS and a dated CS', () => {
    const notices = (label: string) =>
      describeRoadRacePlan(plan(label), 'km').notices.map((notice) => notice.text)
    expect(notices('marathon, no CS')).toContain(
      'No critical speed is fitted yet, so the race plan has no first-half line.',
    )
    expect(notices('marathon, dated CS').join(' ')).toContain('older than three months')
  })
})

describe('the average pace', () => {
  it('names the marathon population, and a half says its finding is of the marathon', () => {
    const marathon = describeRoadRacePlan(plan('marathon, cool, tolerated rung'), 'km').pace!
    expect(marathon.finding).toContain('1.7 million recreational marathon runners')
    expect(marathon.range).toContain('not a pace for any one kilometre')
    const half = describeRoadRacePlan(plan('half over 2 h'), 'km').pace!
    expect(half.finding).toContain('1.7 million recreational marathon runners')
    expect(half.notes.join(' ')).toContain('That finding is of marathon runners')
  })

  it('names the 10 km population and has no split or per-kilometre figure', () => {
    const ten = describeRoadRacePlan(plan('10 km'), 'km').pace!
    expect(ten.finding).toContain('10 km race of 16,315 runners')
    expect(JSON.stringify(ten)).not.toMatch(/split/i)
  })

  it('is absent on a trail course', () => {
    expect(describeRoadRacePlan(plan('marathon, trail'), 'km').pace).toBeNull()
    expect(describeRoadRacePlan(plan('10 km, trail'), 'km').pace).toBeNull()
    expect(textOf('marathon, trail')).toContain('trail or mixed')
  })
})

describe('the expected time', () => {
  it('puts the goal time and the range in two plain lines', () => {
    const { expected } = describeRoadRacePlan(plan('marathon, cool, tolerated rung'), 'km')
    expect(expected.goal).toMatch(/^Goal time 3 h 45 min, an average of \d+:\d\d \/km\.$/)
    expect(expected.source).toMatch(/^Finish estimate .+ to .+, most likely about /)
    expect(expected.clock).toMatch(/^Start 08:00\. Finish about /)
    expect(expected.notes.join(' ')).toContain('and the range outward')
  })

  it('says the goal is the time when there is no prediction', () => {
    const { expected } = describeRoadRacePlan(plan('marathon, no prediction'), 'km')
    expect(expected.source).toContain('From the goal')
  })

  it('names the A6 window and the climb', () => {
    const { expected } = describeRoadRacePlan(plan('marathon, A6 window and climb'), 'km')
    expect(expected.notes.join(' ')).toContain('best efforts in training since')
    expect(expected.notes.join(' ')).toContain('your own speed on climbs from 9 runs')
  })
})

describe('heat', () => {
  const heat = (label: string) => describeRoadRacePlan(plan(label), 'km').heat

  it('says the range is already slower for heat only when the prediction holds I2', () => {
    const warm = goal({ raceWbgtC: 22 })
    const cases: Array<[string, RoadRacePlan, boolean]> = [
      ['with I2', roadRacePlanFor(input({ goal: warm })), true],
      [
        'without I2',
        roadRacePlanFor(input({ goal: warm, prediction: pred(4 * HOUR, ['L6']) })),
        false,
      ],
      [
        'no prediction',
        roadRacePlanFor(input({ goal: warm, prediction: null, coolPredictedSec: null })),
        false,
      ],
    ]
    for (const [label, built, holds] of cases) {
      const text = describeRoadRacePlan(built, 'km')
      const joined = text.heat.join(' ')
      // the population lines show either way
      expect(joined, label).toContain('Japanese')
      expect(joined.includes('already slower throughout for heat'), label).toBe(holds)
      const contradiction =
        joined.includes('already slower throughout for heat') &&
        text.notices.some((notice) => notice.text.includes('holds no heat adjustment'))
      expect(contradiction, label).toBe(false)
    }
  })

  it('states the minutes of the range that are the usual weather, in the owner’s words', () => {
    expect(heat('marathon, warm').join(' ')).toContain(
      'About 7 min of this range is the usual weather for the date.',
    )
  })

  it('shows the climate normal, never a forecast', () => {
    expect(heat('marathon, warm')[0]).toBe(
      'Race heat is a WBGT of 20 °C, typical for the date and not a forecast.',
    )
  })

  it('gives the I5 sentences for a marathon above the slope, naming the population', () => {
    const lines = heat('marathon, warm').join(' ')
    expect(lines).toContain('three Japanese women’s championship marathons')
    expect(lines).toContain('elite to sub-elite')
    expect(lines).toContain(
      'the 50th and 100th places lost their time to a slower pace from the start'.replace(
        'the',
        'The',
      ),
    )
    expect(lines).toContain('sets no pacing shape')
    expect(lines).toContain('mass-casualty')
  })

  it('says the cooling line (CL1) only at or above i9.warnWbgtC, and no time, percent or ranking', () => {
    const hot = heat('marathon, above the model').join(' ')
    expect(hot).toContain('In lab trials of short, hot efforts')
    expect(hot).toContain('none covered a race of hours')
    expect(hot).not.toMatch(/\d+ ?%|seconds|minutes faster|best|better than/)
    expect(lintText(hot)).toEqual([])
    expect(plan('marathon, above the model').heat.rules).toContain('I8')
    const atWarning = roadRacePlanFor(input({ goal: goal({ raceWbgtC: P.i9.warnWbgtC.value }) }))
    expect(describeRoadRacePlan(atWarning, 'km').heat.join(' ')).toContain('lab trials')
    expect(atWarning.heat.rules).toContain('I8')
    for (const label of [
      'marathon, warm',
      'marathon, cool, tolerated rung',
      'marathon, no climate',
    ]) {
      expect(heat(label).join(' '), label).not.toContain('cooling')
      expect(plan(label).heat.rules, label).not.toContain('I8')
    }
  })

  it('gives no I5 line for a half, a 10 km, a cool marathon or a marathon with no climate', () => {
    for (const label of [
      'half under 2 h, warm',
      '10 km',
      'marathon, cool, tolerated rung',
      'marathon, no climate',
    ]) {
      expect(heat(label).join(' '), label).not.toContain('Japanese')
      expect(heat(label).join(' '), label).not.toContain('mass-casualty')
    }
  })

  it('words the climate-normal warning without "forecast" and keeps the WBGT caveat', () => {
    const line = heat('marathon, above the model').find((text) =>
      text.includes('past the heat model'),
    )!
    expect(line).toBeDefined()
    expect(line).not.toMatch(/forecast/i)
    expect(line).toContain('so this range is optimistic')
    expect(line).toContain('WBGT screens heat risk; it is no safety guarantee.')
    expect(line).toContain(`${String(P.i9.warnWbgtC.value)} °C`)
  })

  it('shows no minutes line when the prediction holds no heat, and says so in a notice', () => {
    expect(heat('marathon, no heat in the prediction').join(' ')).not.toContain('usual weather')
    const notices = describeRoadRacePlan(plan('marathon, no heat in the prediction'), 'km').notices
    expect(notices.map((notice) => notice.text).join(' ')).toContain('holds no heat adjustment')
  })

  it('shows nothing about heat with no climate, and a notice with a link', () => {
    expect(heat('marathon, no climate')).toEqual([])
    const notice = describeRoadRacePlan(plan('marathon, no climate'), 'km').notices.find(
      (entry) => entry.link !== null,
    )
    expect(notice?.to).toBe('goals')
  })

  it('states no heart rate and no effort number outside its own "not in this plan" line', () => {
    for (const [label, built] of PLANS) {
      const { notIn, ...rest } = describeRoadRacePlan(built, 'km')
      expect(allText(rest).join('\n'), label).not.toMatch(/heart rate|bpm|out of 10/i)
      expect(notIn.items.some((item) => /heart rate/i.test(item))).toBe(true)
    }
  })
})

describe('fuel, fluid and the race week', () => {
  const text = (label: string) => describeRoadRacePlan(plan(label), 'km')

  it('words the rate with the tolerated label and the lab link, never the ultra few-hours label', () => {
    const fuel = text('marathon, cool, tolerated rung').fuel!
    expect(fuel.rate).toMatch(/^Carbohydrate: /)
    expect(fuel.basis).toBe('This is the highest rate your own runs tolerated.')
    expect(fuel.labLink).toBe('Open the fuel lab')
    expect(fuel.fewHours).toBeNull()
    expect(fuel.carry).toBeNull()
    expect(fuel.aid).toBeNull()
    expect(allText(fuel).join(' ')).not.toContain('few hours')
  })

  it('says what the duration floor held back, in the road words and with no ultra label', () => {
    const fuel = text('marathon, duration floor, a slow race and runs of 2 h').fuel!
    expect(fuel.rate).toBe('Carbohydrate: 30 to 50 g/h.')
    expect(fuel.basis).toBe(
      'No rate above the floor was tolerated on a run of 2 h 45 min or longer, so the floor is the rate.',
    )
    expect(fuel.durationNote).toBe(
      'A higher rate, 60 g/h, was tolerated, but only on shorter runs. The race rate counts a rate tolerated on a run of 2 h 45 min or longer.',
    )
    expect(fuel.labLink).toBe('Open the fuel lab')
    expect(fuel.fewHours).toBeNull()
    expect(fuel.certainty).toBeNull()
    expect(text('marathon, cool, tolerated rung').fuel!.durationNote).toBeNull()
  })

  it('carries the H8 fluid wording and the EAH card wherever fuel appears', () => {
    const fuel = text('marathon, cool, tolerated rung').fuel!
    expect(fuel.fluid).toContain('Drink to thirst')
    expect(fuel.eah.lines.join(' ')).toContain('Drink to thirst')
    expect(fuel.eah.heading).toBe('Low blood sodium from drinking too much')
  })

  it('says the plan holds the clinician line for a locked ladder', () => {
    const fuel = text('marathon, gut condition').fuel!
    expect(fuel.lock).not.toBeNull()
    expect(fuel.basis).toBe(fuel.lock)
  })

  it('opens the nausea plan in heat', () => {
    expect(text('marathon, warm').fuel!.nausea.open).toBe(true)
    expect(text('marathon, cool, tolerated rung').fuel!.nausea.open).toBe(false)
  })

  it('gives a half under 2 h no rate, one fact line, the fluid line and the EAH card', () => {
    const half = text('half under 2 h, warm')
    expect(half.fuel).toBeNull()
    // 120 minutes reads "2 h" in the copy system's minutes format
    expect(P.h7.logMinDurationMin.value).toBe(120)
    expect(half.fluid?.short[0]).toBe(
      'The fuel ladder counts runs of 2 h or more, so it gives no race rate for a race this short.',
    )
    expect(half.fluid?.short[1]).toContain('no carbohydrate rate for a race of one to two hours')
    expect(half.fluid?.fluid).toContain('Drink to thirst')
    expect(half.fluid?.eah.lines.length).toBeGreaterThan(0)
    expect(half.fluid?.labLink).toBe('Open the fuel lab')
  })

  it('has no fuel block and no fluid block for a 10 km', () => {
    const ten = text('10 km')
    expect(ten.fuel).toBeNull()
    expect(ten.fluid).toBeNull()
    expect(ten.raceWeek).toBeNull()
  })

  it('keeps the FT1 hold facts off the plan and links to the lab', () => {
    for (const [label] of PLANS) {
      expect(textOf(label), label).not.toMatch(/held on runs up to|longest run|back-to-back/i)
    }
    const items = text('marathon, cool, tolerated rung').notIn.items.join(' ')
    expect(items).toContain('How long the highest tolerated rate has held on training runs.')
    expect(items).toContain('The fuel lab shows that.')
  })

  it('words the Sherman line for a half with 20.9 km and never "a half marathon"', () => {
    const extra = text('half over 2 h').raceWeek?.extra
    expect(extra).toBe(
      'In trained runners, a raised glycogen store did not shorten a 20.9 km run. The abstract gives no number of runners.',
    )
    expect(extra).not.toMatch(/half marathon/i)
    expect(text('marathon, cool, tolerated rung').raceWeek?.extra).toBeNull()
    expect(text('half, under 90 min').raceWeek).toBeNull()
  })

  it('reuses the K6 lines of the ultra plan', () => {
    const week = text('marathon, cool, tolerated rung').raceWeek!
    expect(week.evidence).toContain('eight endurance-trained men')
    expect(week.carb).toContain('per kg of body mass a day')
  })
})

describe('the Today card', () => {
  it('words the expected range, the K6 line inside the final window and the fuel block', () => {
    const built = plan('marathon, cool, tolerated rung')
    const early = describeRoadRaceSummary(roadSummaryOf(built, addDays(RACE, -5))!, 'km')
    expect(early.carb).toBeNull()
    expect(early.expected).toMatch(/^Finish estimate .+ to .+, most likely about /)
    expect(early.fuel).not.toBeNull()
    const late = describeRoadRaceSummary(roadSummaryOf(built, addDays(RACE, -1))!, 'km')
    expect(late.carb).toContain('per kg of body mass a day')
    expect(late.daysToGo).toBe('1 day to go')
    expect(describeRoadRaceSummary(roadSummaryOf(built, RACE)!, 'km').daysToGo).toBe('Race day')
  })

  it('picks the same range wording and training note as the page for a floor from training', () => {
    const floor = roadRacePlanFor(
      input({ prediction: { ...pred(4 * HOUR), trainingSince: '2026-03-01' } }),
    )
    const page = describeRoadRacePlan(floor, 'km').expected
    const card = describeRoadRaceSummary(roadSummaryOf(floor, addDays(RACE, -3))!, 'km')
    expect(page.source).toMatch(/^At most about .+\. Finish estimate /)
    expect(card.expected).toBe(page.source)
    expect(card.expectedNote).toBe(page.notes[0])
    expect(card.expectedNote).toContain('best efforts in training since')
    const plain = describeRoadRaceSummary(
      roadSummaryOf(plan('marathon, cool, tolerated rung'), addDays(RACE, -3))!,
      'km',
    )
    expect(plain.expected).toMatch(/^Finish estimate .+, most likely about /)
    expect(plain.expectedNote).toBeNull()
  })

  it('uses the fluid block for a half under 2 h', () => {
    const summary = roadSummaryOf(plan('half under 2 h, warm'), addDays(RACE, -2))!
    const text = describeRoadRaceSummary(summary, 'km')
    expect(text.fuel).toBeNull()
    expect(text.fluid?.short).toHaveLength(2)
  })
})

describe('the fuel total', () => {
  it('is one figure when the rounded ends are equal, in every road plan with a rate', () => {
    let seen = 0
    for (const [, road] of PLANS) {
      const text = describeRoadRacePlan(road, 'km').fuel
      if (text === null || road.fuel === null) continue
      seen += 1
      expect(text.total).not.toMatch(/About ([\d,]+) to \1 g/)
      if (road.fuel.totalG[0] === road.fuel.totalG[1]) {
        expect(text.total).toMatch(/^About [\d,]+ g over the expected time\.$/)
      }
    }
    expect(seen).toBeGreaterThan(0)
  })
})

describe('the unit of the sentences follows the runner', () => {
  it('names a mile in miles and a kilometre in kilometres, in the pace and the gaps', () => {
    const marathon = plan('marathon, cool, tolerated rung')
    const km = describeRoadRacePlan(marathon, 'km')
    const mi = describeRoadRacePlan(marathon, 'mi')
    expect(km.pace?.range).toContain('/km')
    expect(km.pace?.range).toContain('any one kilometre.')
    expect(mi.pace?.range).toContain('/mi')
    expect(mi.pace?.range).toContain('any one mile.')
    expect(mi.pace?.range).not.toContain('kilometre')
    expect(km.notIn.items.join('\n')).toContain('A pace for each kilometre or a split table')
    expect(mi.notIn.items.join('\n')).toContain('A pace for each mile or a split table')
    expect(mi.notIn.items.join('\n')).not.toContain('each kilometre')
  })
})

describe('what the plan says it leaves out', () => {
  it('lists the marathon’s gaps and a shorter list for a 10 km', () => {
    const marathon = describeRoadRacePlan(plan('marathon, cool, tolerated rung'), 'km').notIn
    expect(marathon.heading).toBe('Not in this plan')
    expect(marathon.items.join('\n')).toContain(
      'A finish target. The race plan shows a range, never a target.',
    )
    expect(marathon.items.join('\n')).toContain('any rate for a race under 2 h')
    const ten = describeRoadRacePlan(plan('10 km'), 'km').notIn
    expect(ten.items.join('\n')).not.toContain('carbohydrate')
    expect(ten.items.length).toBeLessThan(marathon.items.length)
  })
})
