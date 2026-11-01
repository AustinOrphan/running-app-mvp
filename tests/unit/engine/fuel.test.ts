import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COPY_MAX_CHARS } from '../../../shared/copy/limits.ts'
import { assertCleanCopy, lintText } from '../../../shared/copy/lint.ts'
import {
  placeholdersOf,
  render,
  sampleSlots,
  type Template,
} from '../../../shared/copy/template.ts'
import { TEMPLATES } from '../../../shared/copy/templates.ts'
import { addDays } from '../../../shared/dates.ts'
import {
  ceilingIndex,
  eahCard,
  fuelEligible,
  fuelLineForSession,
  fuelRungs,
  fuelTargetFor,
  fuelTargetsFor,
  fuelWatchLine,
  isBlockRun,
  isHotForFuel,
  replayLadder,
  runIsHot,
  runScore,
  type FuelContext,
  type LadderInput,
} from '../../../shared/engine/fuel.ts'
import {
  countsLine,
  describeFuelTarget,
  eahText,
  FUEL_TEMPLATES,
  fluidLine,
  fluidReferenceNote,
  fuelDisclaimer,
  fuelWatchText,
  lowCertaintyLine,
  gutTrainingText,
  loggedTotalText,
  rateText,
  rungStateLabel,
  stepNote,
} from '../../../shared/engine/fuelCopy.ts'
import { isHotForSteering, weatherIndex, type WeatherIndex } from '../../../shared/engine/heat.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  FuelRunInput,
  FuelSessionInput,
  FuelSettingsInput,
  FuelTarget,
  LadderResult,
  LadderStep,
  RunWeather,
  RungState,
  SessionFlag,
} from '../../../shared/engine/types.ts'
import type { PlanSessionStatus } from '../../../shared/types.ts'
import { SESSION_KINDS } from './fixtures.ts'

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

const NO_OPT_IN: FuelSettingsInput = {
  optIn90: false,
  optInAdvanced: false,
  giDisease: false,
}
const OPT_IN_90: FuelSettingsInput = { optIn90: true, optInAdvanced: false, giDisease: false }
const OPEN: FuelSettingsInput = { optIn90: true, optInAdvanced: true, giDisease: false }
const GUT_CONDITION: FuelSettingsInput = { optIn90: false, optInAdvanced: false, giDisease: true }

/** A cool day: not hot for fuel. */
const COOL: RunWeather = { tempC: 12, humidityPct: 60, windKph: 5 }
/** 22 C at 80% humidity is under 25 C of air but a shade WBGT of about 19.7: hot for fuel. */
const HOT: RunWeather = { tempC: 22, humidityPct: 80, windKph: 0 }
/** 20 C at 80% humidity is a shade WBGT of about 17.7: just under the fuel threshold. */
const WARM: RunWeather = { tempC: 20, humidityPct: 80, windKph: 0 }

const START = '2026-03-02' // a Monday

interface RunSpec {
  /** Carbohydrate per hour of elapsed time; the default clears every rung. */
  gPerH?: number
  hours?: number
  /** Share of the carbohydrate from multiple-source products. */
  multiShare?: number
  gut?: number
  nausea?: number | null
  weather?: RunWeather | null
  hotOverride?: boolean | null
  skipped?: boolean
  flags?: SessionFlag[] | null
  date?: string
  startTime?: string | null
}

/** The nth logged run, one a week from START, 3 h long and eating well above any rung. */
function run(n: number, spec: RunSpec = {}): FuelRunInput {
  const hours = spec.hours ?? 3
  const carbsG = (spec.gPerH ?? 125) * hours
  const share = spec.multiShare ?? 1
  const base = { name: 'Gel', sodiumMg: null, kcal: null, servings: 1 }
  return {
    activityId: `a${String(n).padStart(3, '0')}`,
    date: spec.date ?? addDays(START, n * 7),
    startTime: spec.startTime ?? null,
    elapsedSec: hours * 3600,
    weather: spec.weather === undefined ? COOL : spec.weather,
    sessionFlags: spec.flags ?? null,
    log: {
      skipped: spec.skipped ?? false,
      items: [
        { ...base, carbsG: carbsG * share, multiCarb: true },
        { ...base, name: 'Chew', carbsG: carbsG * (1 - share), multiCarb: false },
      ],
      gut: spec.gut ?? 0,
      nausea: spec.nausea ?? null,
      hotOverride: spec.hotOverride ?? null,
    },
  }
}

/** A series of runs numbered from 0, each with its own spec. */
const runs = (...specs: RunSpec[]): FuelRunInput[] => specs.map((spec, n) => run(n, spec))

const OK: RunSpec = {}
const BAD: RunSpec = { gut: 2 }
const SEVERE: RunSpec = { gut: 4 }

function replay(
  list: readonly FuelRunInput[],
  settings: FuelSettingsInput = OPEN,
  gutTrainingWeeks: readonly string[] = [],
): LadderResult {
  const input: LadderInput = { settings, runs: list, gutTrainingWeeks }
  return replayLadder(input)
}

function rungOf(index: number) {
  const rung = fuelRungs()[index]
  if (rung === undefined) throw new Error(`no rung ${String(index)}`)
  return rung
}

function stepOf(result: LadderResult, index: number): LadderStep {
  const step = result.steps[index]
  if (step === undefined) throw new Error(`no step ${String(index)}`)
  return step
}

const lastStep = (result: LadderResult) => stepOf(result, result.steps.length - 1)

function context(
  ladder: LadderResult,
  peaks: Record<string, WeatherIndex | null> = {},
  settings: FuelSettingsInput = NO_OPT_IN,
): FuelContext {
  return { settings, ladder, peaks }
}

const SESSION_DAY = '2026-07-18'

function session(overrides: Partial<FuelSessionInput> = {}): FuelSessionInput {
  return {
    id: 'session-1',
    date: SESSION_DAY,
    kind: 'long',
    durationMin: 150,
    flags: [],
    status: 'planned',
    ...overrides,
  }
}

const HOT_PEAK: Record<string, WeatherIndex> = {
  [SESSION_DAY]: { value: 20, index: 'wbgt' },
}

/** Sets a registry value for the length of `fn`, then puts it back. */
function withParam<T>(param: { value: T }, value: T, fn: () => void): void {
  const saved = param.value
  param.value = value
  try {
    fn()
  } finally {
    param.value = saved
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}

// ---------------------------------------------------------------------------------------------
// Rungs and the ceiling
// ---------------------------------------------------------------------------------------------

describe('fuelRungs', () => {
  it('is the floor, then the first higher tier, then steps to the top of the advanced range', () => {
    const rungs = fuelRungs()
    expect(rungs.map((r) => r.gPerH)).toEqual([30, 60, 70, 80, 90, 100, 110, 120])
    expect(rungs.map((r) => r.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(rungs[0]?.range).toEqual([30, 50])
    expect(rungs.slice(1).every((r) => r.range === null)).toBe(true)
  })

  it('takes every figure from the registry', () => {
    const [low, high] = P.h7.carbFloorGPerH.value
    const rungs = fuelRungs()
    expect(rungs[0]).toMatchObject({ gPerH: low, range: [low, high] })
    expect(rungs[1]?.gPerH).toBe(P.h7.carbTier1GPerH.value)
    expect(rungs.at(-1)?.gPerH).toBe(P.h7.carbAdvancedGPerH.value[1])
    // from the first higher tier on, each rung is one step above the one before
    rungs.slice(2).forEach((rung, i) => {
      expect(rung.gPerH - (rungs[i + 1]?.gPerH ?? 0), `rung ${String(rung.index)}`).toBe(
        P.h7.gutStepGPerH.value,
      )
    })
  })

  it('grades each rung by the Param that names it, the steps between by the step Param', () => {
    const rungs = fuelRungs()
    expect(rungs.map((r) => r.grade)).toEqual(['A', 'C', 'D', 'D', 'C', 'D', 'D', 'C'])
    expect(rungs[1]?.grade).toBe(P.h7.carbTier1GPerH.grade)
    expect(rungs[4]?.grade).toBe(P.h7.carbTier2GPerH.grade)
    expect(rungs[2]?.grade).toBe(P.h7.gutStepGPerH.grade)
  })

  it('marks low certainty above the floor and multiple-source carbohydrate above the first tier', () => {
    const rungs = fuelRungs()
    expect(rungs.map((r) => r.lowCertainty)).toEqual([
      false,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ])
    expect(rungs.map((r) => r.multiCarbRequired)).toEqual([
      false,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ])
  })

  it('opens rungs 70 to 90 with the first opt-in and the rest with the second', () => {
    expect(fuelRungs().map((r) => r.opens)).toEqual([
      'always',
      'always',
      'first-opt-in',
      'first-opt-in',
      'first-opt-in',
      'second-opt-in',
      'second-opt-in',
      'second-opt-in',
    ])
  })
})

describe('ceilingIndex', () => {
  const cases: Array<[string, FuelSettingsInput, number]> = [
    ['no opt-in stops at the first higher tier', NO_OPT_IN, 1],
    ['the first opt-in opens up to the second tier', OPT_IN_90, 4],
    ['both opt-ins open the top', OPEN, 7],
    [
      'the second opt-in without the first opens nothing more',
      { optIn90: false, optInAdvanced: true, giDisease: false },
      1,
    ],
    ['a gut condition locks the floor', GUT_CONDITION, 0],
    ['a gut condition beats both opt-ins', { ...OPEN, giDisease: true }, 0],
  ]
  it.each(cases)('%s', (_name, settings, expected) => {
    expect(ceilingIndex(settings)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------------

describe('runScore', () => {
  it('is the higher of the gut and nausea scores', () => {
    expect(runScore({ gut: 1, nausea: 3 })).toBe(3)
    expect(runScore({ gut: 3, nausea: 1 })).toBe(3)
    expect(runScore({ gut: 2, nausea: 2 })).toBe(2)
  })

  it('reads an unanswered nausea score as none', () => {
    expect(runScore({ gut: 0, nausea: null })).toBe(0)
    expect(runScore({ gut: 3, nausea: null })).toBe(3)
  })

  it('keeps a score on the scale, and reads a score that is not a number as the worst', () => {
    const max = P.h7.gutSymptomScaleMax.value
    expect(runScore({ gut: 9, nausea: null })).toBe(max)
    expect(runScore({ gut: -3, nausea: null })).toBe(0)
    expect(runScore({ gut: Number.NaN, nausea: 0 })).toBe(max)
    expect(runScore({ gut: 0, nausea: Number.NaN })).toBe(max)
  })
})

describe('isBlockRun', () => {
  const weeks = ['2026-03-02']

  it('lets a linked run follow its session flag, whatever the week', () => {
    expect(isBlockRun({ date: '2026-03-04', sessionFlags: ['fuel-practice'] }, [])).toBe(true)
    expect(isBlockRun({ date: '2026-03-04', sessionFlags: ['fuel-practice', 'heat'] }, [])).toBe(
      true,
    )
    expect(isBlockRun({ date: '2026-03-04', sessionFlags: [] }, weeks)).toBe(false)
    expect(isBlockRun({ date: '2026-03-04', sessionFlags: ['heat'] }, weeks)).toBe(false)
  })

  it('counts an unlinked run when its date falls in a gut-training week', () => {
    expect(isBlockRun({ date: '2026-03-02', sessionFlags: null }, weeks)).toBe(true)
    expect(isBlockRun({ date: '2026-03-08', sessionFlags: null }, weeks)).toBe(true)
    expect(isBlockRun({ date: '2026-03-09', sessionFlags: null }, weeks)).toBe(false)
    expect(isBlockRun({ date: '2026-03-01', sessionFlags: null }, weeks)).toBe(false)
    expect(isBlockRun({ date: '2026-03-04', sessionFlags: null }, [])).toBe(false)
  })
})

describe('isHotForFuel and runIsHot', () => {
  it('takes a WBGT at the fuel threshold, and an air temperature only at its own', () => {
    const wbgt = P.h7.hotDayWbgtC.value
    const air = P.h7.hotDayAirTempC.value
    expect(isHotForFuel({ value: wbgt, index: 'wbgt' })).toBe(true)
    expect(isHotForFuel({ value: wbgt - 0.1, index: 'wbgt' })).toBe(false)
    expect(isHotForFuel({ value: air, index: 'air-temperature' })).toBe(true)
    expect(isHotForFuel({ value: air - 0.1, index: 'air-temperature' })).toBe(false)
    // an air temperature is never read against the WBGT threshold
    expect(isHotForFuel({ value: wbgt + 1, index: 'air-temperature' })).toBe(false)
    expect(isHotForFuel(null)).toBe(false)
  })

  it('is a lower bar than heat steering: a day can be hot for fuel and not for steering', () => {
    const peak: WeatherIndex = { value: P.h7.hotDayWbgtC.value + 2, index: 'wbgt' }
    expect(isHotForFuel(peak)).toBe(true)
    expect(isHotForSteering(peak, [])).toBe(false)
    const steering: WeatherIndex = { value: P.i9.warnWbgtC.value, index: 'wbgt' }
    expect(isHotForFuel(steering)).toBe(true)
    expect(isHotForSteering(steering, [])).toBe(true)
    // and the reverse never happens
    expect(P.h7.hotDayWbgtC.value).toBeLessThan(P.i9.warnWbgtC.value)
  })

  it('judges a run by its WBGT when temperature and humidity are known', () => {
    expect(
      weatherIndex({ tempC: 22, humidityPct: 80, windKph: 0, shortwaveWm2: 0 }).value,
    ).toBeGreaterThan(P.h7.hotDayWbgtC.value)
    expect(runIsHot(HOT, null)).toBe(true)
    expect(runIsHot(WARM, null)).toBe(false)
    expect(runIsHot(COOL, null)).toBe(false)
    expect(runIsHot({ tempC: 26, humidityPct: 50, windKph: 10 }, null)).toBe(true)
  })

  it('falls back to the air temperature when there is no humidity', () => {
    const air = P.h7.hotDayAirTempC.value
    expect(runIsHot({ tempC: air, humidityPct: null, windKph: null }, null)).toBe(true)
    expect(runIsHot({ tempC: air - 0.5, humidityPct: null, windKph: null }, null)).toBe(false)
    // 22 C is under the air threshold, so without humidity it is not hot
    expect(runIsHot({ tempC: 22, humidityPct: null, windKph: 3 }, null)).toBe(false)
  })

  it("lets the runner's answer win either way, and reads no weather as not hot", () => {
    expect(runIsHot(COOL, true)).toBe(true)
    expect(runIsHot(HOT, false)).toBe(false)
    expect(runIsHot(null, true)).toBe(true)
    expect(runIsHot(null, null)).toBe(false)
    expect(runIsHot({ tempC: null, humidityPct: 70, windKph: 2 }, null)).toBe(false)
  })

  it('uses the shade assumption of the execution model when no solar radiation is stored', () => {
    const shade = { ...HOT, shortwaveWm2: P.conditions.assumedShortwaveWm2.value }
    expect(runIsHot(shade, null)).toBe(runIsHot(HOT, null))
    // strong sun on the same hour raises the WBGT: 20 C / 80% is not hot in shade, hot in the sun
    expect(runIsHot(WARM, null)).toBe(false)
    expect(runIsHot({ ...WARM, shortwaveWm2: 800 }, null)).toBe(true)
  })
})

describe('fuelEligible', () => {
  it('takes the log threshold, or the block threshold in a gut-training block', () => {
    const log = P.h7.logMinDurationMin.value
    const block = P.h7.gutTrainingSessionMinMin.value
    expect(fuelEligible(log, false)).toBe(true)
    expect(fuelEligible(log - 1, false)).toBe(false)
    expect(fuelEligible(block, true)).toBe(true)
    expect(fuelEligible(block - 1, true)).toBe(false)
    expect(fuelEligible(block, false)).toBe(false)
    expect(fuelEligible(log + 60, true)).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// The replay
// ---------------------------------------------------------------------------------------------

describe('replayLadder: movement', () => {
  it('starts at the floor with nothing tolerated', () => {
    const ladder = replay([])
    expect(ladder.currentIndex).toBe(0)
    expect(ladder.toleratedIndex).toBe(-1)
    expect(ladder.held).toBe(false)
    expect(ladder.locked).toBe(false)
    expect(ladder.basis).toBe('start')
    expect(ladder.nauseaForward).toBe(false)
    expect(ladder.countedRuns).toBe(0)
    expect(ladder.steps).toEqual([])
    expect(ladder.rungs).toHaveLength(fuelRungs().length)
  })

  it('steps up one rung after a tolerated run', () => {
    const ladder = replay(runs(OK))
    expect(ladder.currentIndex).toBe(1)
    expect(ladder.toleratedIndex).toBe(0)
    expect(ladder.basis).toBe('next-up')
    expect(lastStep(ladder)).toMatchObject({
      rungIndex: 0,
      nextIndex: 1,
      reason: 'counted',
      outcome: 'step-up',
      score: 0,
      hot: false,
      held: false,
    })
  })

  it('climbs one rung a run to the ceiling the opt-ins open, then stays', () => {
    const all = runs(...Array.from({ length: 9 }, () => OK))
    const open = replay(all, OPEN)
    expect(open.steps.map((s) => s.rungIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 7])
    expect(open.steps.map((s) => s.outcome)).toEqual([
      ...Array.from({ length: 7 }, () => 'step-up'),
      'tolerated-top',
      'tolerated-top',
    ])
    expect(open.currentIndex).toBe(7)
    expect(open.toleratedIndex).toBe(7)
    expect(open.basis).toBe('at-ceiling')

    const first = replay(all, OPT_IN_90)
    expect(first.currentIndex).toBe(4)
    expect(first.toleratedIndex).toBe(4)

    const none = replay(all, NO_OPT_IN)
    expect(none.currentIndex).toBe(1)
    expect(none.toleratedIndex).toBe(1)
    expect(none.basis).toBe('at-ceiling')
    expect(none.steps.map((s) => s.outcome)).toEqual([
      'step-up',
      ...Array.from({ length: 8 }, () => 'tolerated-top'),
    ])
  })

  it('holds the rung after one run scored 2 or more, and the next tolerated run lifts the hold', () => {
    const held = replay(runs(OK, BAD))
    expect(held.currentIndex).toBe(1)
    expect(held.toleratedIndex).toBe(0)
    expect(held.held).toBe(true)
    expect(held.basis).toBe('repeat')
    expect(lastStep(held)).toMatchObject({ outcome: 'hold', score: 2, held: true, nextIndex: 1 })

    const lifted = replay(runs(OK, BAD, OK))
    expect(lifted.held).toBe(false)
    expect(lifted.currentIndex).toBe(2)
    expect(lifted.toleratedIndex).toBe(1)
    expect(lastStep(lifted)).toMatchObject({ outcome: 'step-up', held: false })
  })

  it('scores a run by the higher of gut and nausea', () => {
    expect(replay(runs(OK, { nausea: 2 })).held).toBe(true)
    expect(replay(runs(OK, { gut: 1, nausea: 1 })).held).toBe(false)
    expect(replay(runs(OK, { gut: 0, nausea: 3 })).held).toBe(true)
    expect(lastStep(replay(runs(OK, { gut: 1, nausea: 3 }))).score).toBe(3)
  })

  it('returns to the last tolerated rung after two such runs in a row', () => {
    const ladder = replay(runs(OK, OK, BAD, BAD))
    expect(ladder.currentIndex).toBe(1)
    expect(ladder.toleratedIndex).toBe(1)
    expect(ladder.held).toBe(false)
    expect(ladder.basis).toBe('fell-back')
    expect(lastStep(ladder)).toMatchObject({ outcome: 'fall-back', rungIndex: 2, nextIndex: 1 })

    // and climbs again from there after the next tolerated run
    const again = replay(runs(OK, OK, BAD, BAD, OK))
    expect(again.currentIndex).toBe(2)
    expect(again.basis).toBe('next-up')
  })

  it('returns at once after a run scored 4, on gut or on nausea', () => {
    for (const severe of [SEVERE, { nausea: 4 }]) {
      const ladder = replay(runs(OK, OK, severe))
      expect(ladder.currentIndex).toBe(1)
      expect(ladder.basis).toBe('fell-back')
      expect(lastStep(ladder).outcome).toBe('fall-back')
    }
  })

  it('does not count a tolerated run in between as part of the two in a row', () => {
    const ladder = replay(runs(OK, OK, BAD, OK, BAD))
    expect(ladder.held).toBe(true)
    expect(ladder.currentIndex).toBe(3)
    expect(ladder.toleratedIndex).toBe(2)
  })

  it('does not count a run that moved nothing as a break in the two in a row', () => {
    const ladder = replay(runs(OK, OK, BAD, { gPerH: 10 }, BAD))
    expect(stepOf(ladder, 3).outcome).toBe('not-counted')
    expect(ladder.currentIndex).toBe(1)
    expect(lastStep(ladder).outcome).toBe('fall-back')
  })

  it('falls back to the floor when nothing was tolerated yet', () => {
    const ladder = replay(runs(BAD, BAD))
    expect(ladder.currentIndex).toBe(0)
    expect(ladder.toleratedIndex).toBe(-1)
    expect(ladder.basis).toBe('start')
    expect(lastStep(ladder).outcome).toBe('fall-back')
    expect(lastStep(ladder).nextIndex).toBe(lastStep(ladder).rungIndex)
  })

  it('does not decay a tolerated rung over time', () => {
    const early = run(0, OK)
    const late = run(1, { ...OK, date: '2027-12-06' })
    expect(replay([early, late]).currentIndex).toBe(2)
  })

  it('needs the number of tolerated runs the Param asks for before a step up', () => {
    withParam(P.h7.stepUpToleratedRuns, 2, () => {
      const first = replay(runs(OK))
      expect(first.currentIndex).toBe(0)
      expect(first.toleratedIndex).toBe(-1)
      expect(lastStep(first)).toMatchObject({ outcome: 'tolerated-more', toleratedLeft: 1 })
      const second = replay(runs(OK, OK))
      expect(second.currentIndex).toBe(1)
      expect(second.toleratedIndex).toBe(0)
      // a bad run starts the count again
      expect(replay(runs(OK, BAD, OK)).currentIndex).toBe(0)
    })
  })
})

describe('replayLadder: counting', () => {
  it('moves nothing for a skipped log, and says so', () => {
    const ladder = replay(runs(OK, { skipped: true, gut: 4 }))
    expect(lastStep(ladder)).toMatchObject({ reason: 'skipped', outcome: 'not-counted' })
    expect(ladder.currentIndex).toBe(1)
    expect(ladder.countedRuns).toBe(1)
  })

  it('moves nothing for a run that is too short', () => {
    const short = replay(runs(OK, { hours: 1.9, gut: 4 }))
    expect(lastStep(short)).toMatchObject({
      reason: 'too-short',
      outcome: 'not-counted',
      requiredMin: P.h7.logMinDurationMin.value,
    })
    expect(short.currentIndex).toBe(1)
    // exactly at the threshold it counts
    expect(lastStep(replay(runs(OK, { hours: P.h7.logMinDurationMin.value / 60 }))).reason).toBe(
      'counted',
    )
  })

  it('moves nothing for a run below the rate of the rung being tried', () => {
    // The rung being tried is the first higher tier (60 g/h): 0.9 of it is 54.
    const fraction = P.h7.rungReachFraction.value
    const tier = P.h7.carbTier1GPerH.value
    const edge = fraction * tier
    const under = replay(runs(OK, { gPerH: edge - 1, gut: 4 }))
    expect(lastStep(under)).toMatchObject({ reason: 'below-target', outcome: 'not-counted' })
    expect(under.currentIndex).toBe(1)
    expect(replay(runs(OK, { gPerH: edge })).currentIndex).toBe(2)
  })

  it('measures the floor from its low end', () => {
    const low = P.h7.carbFloorGPerH.value[0]
    const edge = P.h7.rungReachFraction.value * low
    expect(lastStep(replay(runs({ gPerH: edge - 1 }))).reason).toBe('below-target')
    expect(lastStep(replay(runs({ gPerH: edge }))).reason).toBe('counted')
  })

  it('takes the carbohydrate rate over elapsed time', () => {
    const one = run(0, { hours: 4, gPerH: 60 })
    // the same grams over 4 h 20 min of elapsed time are a lower rate
    const stops = { ...one, elapsedSec: one.elapsedSec + 20 * 60 }
    expect(lastStep(replay([one])).rateGPerH).toBe(60)
    expect(lastStep(replay([stops])).rateGPerH).toBeCloseTo(240 / (260 / 60), 6)
    expect(lastStep(replay([{ ...one, elapsedSec: 0 }])).rateGPerH).toBeNull()
    expect(lastStep(replay([{ ...one, elapsedSec: 0 }])).reason).toBe('too-short')
  })

  it('needs multiple-source carbohydrate above the first higher tier, and not at or below it', () => {
    const share = P.h7.multiCarbMinShare.value
    // at the first higher tier, a single-source run counts
    expect(lastStep(replay(runs(OK, { multiShare: 0 }))).reason).toBe('counted')
    // one rung higher the share matters
    const under = replay(runs(OK, OK, { multiShare: share - 0.05, gut: 4 }))
    expect(lastStep(under)).toMatchObject({
      reason: 'too-little-multi-carb',
      outcome: 'not-counted',
    })
    expect(under.currentIndex).toBe(2)
    const enough = replay(runs(OK, OK, { multiShare: share }))
    expect(lastStep(enough).reason).toBe('counted')
    expect(lastStep(enough).multiCarbShare).toBeCloseTo(share, 9)
  })

  it('counts a shorter run in a gut-training block, linked or not', () => {
    const week = [START]
    const sixty = { hours: P.h7.gutTrainingSessionMinMin.value / 60 }
    // unlinked, in a block week
    expect(lastStep(replay(runs({ ...sixty }), NO_OPT_IN, week)).reason).toBe('counted')
    // unlinked, outside it
    expect(lastStep(replay(runs({ ...sixty }), NO_OPT_IN, [])).reason).toBe('too-short')
    // linked to a flagged session
    expect(lastStep(replay(runs({ ...sixty, flags: ['fuel-practice'] }))).reason).toBe('counted')
    // linked to an unflagged session in a block week: the session decides
    expect(lastStep(replay(runs({ ...sixty, flags: [] }), NO_OPT_IN, week)).reason).toBe(
      'too-short',
    )
    // still not an hour
    expect(
      lastStep(replay(runs({ hours: sixty.hours - 0.1, flags: ['fuel-practice'] }))).reason,
    ).toBe('too-short')
    expect(lastStep(replay(runs({ ...sixty, flags: ['fuel-practice'] }))).requiredMin).toBe(
      P.h7.gutTrainingSessionMinMin.value,
    )
  })
})

describe('replayLadder: heat', () => {
  const hot = { weather: HOT }

  it('never steps up on a hot day, and a tolerated hot run moves nothing', () => {
    const ladder = replay(runs(OK, hot))
    expect(ladder.currentIndex).toBe(1)
    expect(ladder.toleratedIndex).toBe(0)
    expect(lastStep(ladder)).toMatchObject({ hot: true, outcome: 'warm-tolerated', nextIndex: 1 })
    // a first hot run does not open the first step either
    expect(replay(runs(hot)).currentIndex).toBe(0)
  })

  it('lets the next cool run step up as usual', () => {
    expect(replay(runs(OK, hot, OK)).currentIndex).toBe(2)
  })

  it('counts a bad hot run toward the hold and the fall-back', () => {
    const held = replay(runs(OK, OK, { ...hot, gut: 2 }))
    expect(held.held).toBe(true)
    expect(lastStep(held)).toMatchObject({ hot: true, outcome: 'hold' })
    const back = replay(runs(OK, OK, { ...hot, gut: 2 }, { ...hot, gut: 2 }))
    expect(back.currentIndex).toBe(1)
    expect(lastStep(back).outcome).toBe('fall-back')
    expect(replay(runs(OK, OK, { ...hot, gut: 4 })).currentIndex).toBe(1)
  })

  it('does not let a tolerated hot run lift a hold or end a run of bad scores', () => {
    const stillHeld = replay(runs(OK, OK, BAD, hot))
    expect(stillHeld.held).toBe(true)
    expect(stillHeld.currentIndex).toBe(2)
    const back = replay(runs(OK, OK, BAD, hot, BAD))
    expect(back.currentIndex).toBe(1)
    expect(lastStep(back).outcome).toBe('fall-back')
  })

  it("lets the runner's answer overrule the weather either way", () => {
    expect(replay(runs(OK, { weather: HOT, hotOverride: false })).currentIndex).toBe(2)
    expect(replay(runs(OK, { weather: COOL, hotOverride: true })).currentIndex).toBe(1)
    expect(lastStep(replay(runs(OK, { weather: COOL, hotOverride: true }))).hot).toBe(true)
  })

  it('judges a run by the weather it has on every replay: late weather re-judges it', () => {
    const noWeather = replay(runs(OK, { weather: null }))
    expect(noWeather.currentIndex).toBe(2)
    expect(lastStep(noWeather).hot).toBe(false)
    const loaded = replay(runs(OK, { weather: HOT }))
    expect(loaded.currentIndex).toBe(1)
    expect(lastStep(loaded).hot).toBe(true)
    // a run the runner answered is not re-judged
    expect(replay(runs(OK, { weather: HOT, hotOverride: false })).currentIndex).toBe(2)
  })

  it('judges the day by the fuel threshold, not the steering threshold', () => {
    withParam(P.h7.hotDayWbgtC, 21, () => {
      expect(lastStep(replay(runs(OK, hot))).hot).toBe(false)
    })
    expect(lastStep(replay(runs(OK, hot))).hot).toBe(true)
  })
})

describe('replayLadder: the nausea plan', () => {
  it('comes forward after a counted run whose nausea score reaches the cut-off', () => {
    const cut = P.h7.nauseaContingencyScore.value
    expect(replay(runs(OK, { nausea: cut })).nauseaForward).toBe(true)
    expect(replay(runs(OK, { nausea: cut - 1 })).nauseaForward).toBe(false)
    // judged by nausea alone, not by the gut score
    expect(replay(runs(OK, { gut: 3, nausea: 0 })).nauseaForward).toBe(false)
  })

  it('goes again after the next counted run, and ignores a run that did not count', () => {
    expect(replay(runs(OK, { nausea: 3 }, OK)).nauseaForward).toBe(false)
    expect(replay(runs(OK, { nausea: 3 }, { gPerH: 5, nausea: 0 })).nauseaForward).toBe(true)
    expect(replay(runs(OK, { gPerH: 5, nausea: 4 })).nauseaForward).toBe(false)
  })
})

describe('replayLadder: opt-ins and the gut condition', () => {
  it('clamps at the ceiling the settings open', () => {
    const all = runs(...Array.from({ length: 6 }, () => OK))
    expect(replay(all, OPEN).currentIndex).toBe(6)
    // opting out of 90 clamps the same history at once
    expect(replay(all, NO_OPT_IN).currentIndex).toBe(1)
    expect(replay(all, NO_OPT_IN).toleratedIndex).toBe(1)
    expect(replay(all, OPT_IN_90).currentIndex).toBe(4)
    // the second opt-in alone does nothing without the first
    expect(
      replay(all, { optIn90: false, optInAdvanced: true, giDisease: false }).currentIndex,
    ).toBe(1)
  })

  it('only reaches the advanced rungs through a tolerated run at the second tier', () => {
    const upToNinety = runs(...Array.from({ length: 4 }, () => OK))
    const at90 = replay(upToNinety, OPEN)
    expect(rungOf(at90.currentIndex).gPerH).toBe(P.h7.carbTier2GPerH.value)
    expect(at90.toleratedIndex).toBe(3)
    expect(replay([...upToNinety, run(4, BAD)], OPEN).currentIndex).toBe(4)
  })

  it('locks the ladder at the floor with a gut condition', () => {
    const ladder = replay(runs(OK, OK, OK), GUT_CONDITION)
    expect(ladder.locked).toBe(true)
    expect(ladder.currentIndex).toBe(0)
    expect(ladder.ceilingIndex).toBe(0)
    expect(ladder.basis).toBe('locked')
    expect(ladder.steps.map((s) => s.outcome)).toEqual([
      'tolerated-top',
      'tolerated-top',
      'tolerated-top',
    ])
  })
})

describe('replayLadder: the rung states', () => {
  const states = (ladder: LadderResult): RungState[] => ladder.rungs.map((r) => r.state)

  it('shows the start: the floor is next, one more is open, the rest wait for opt-ins', () => {
    expect(states(replay([], NO_OPT_IN))).toEqual([
      'next-up',
      'later',
      'opt-in',
      'opt-in',
      'opt-in',
      'opens-after-second-tier',
      'opens-after-second-tier',
      'opens-after-second-tier',
    ])
  })

  it('marks what was tolerated, the next rung, and a repeated rung', () => {
    expect(states(replay(runs(OK), NO_OPT_IN)).slice(0, 3)).toEqual([
      'tolerated',
      'next-up',
      'opt-in',
    ])
    expect(states(replay(runs(OK, BAD), NO_OPT_IN)).slice(0, 3)).toEqual([
      'tolerated',
      'repeat',
      'opt-in',
    ])
  })

  it('opens every rung to climb with both opt-ins', () => {
    expect(states(replay([], OPEN))).toEqual([
      'next-up',
      'later',
      'later',
      'later',
      'later',
      'later',
      'later',
      'later',
    ])
  })

  it('offers the second opt-in once the second tier was tolerated', () => {
    const ladder = replay(runs(...Array.from({ length: 5 }, () => OK)), OPT_IN_90)
    expect(states(ladder)).toEqual([
      'tolerated',
      'tolerated',
      'tolerated',
      'tolerated',
      'tolerated',
      'opt-in',
      'opt-in',
      'opt-in',
    ])
  })

  it('shows every rung above the floor as unavailable with a gut condition', () => {
    const [floor, ...rest] = states(replay([], GUT_CONDITION))
    expect(floor).toBe('next-up')
    expect(rest.every((s) => s === 'gut-condition')).toBe(true)
  })

  it('carries the rung data with each state', () => {
    const ladder = replay([])
    expect(ladder.rungs.map((r) => r.gPerH)).toEqual(fuelRungs().map((r) => r.gPerH))
    expect(ladder.rungs[0]?.range).toEqual(P.h7.carbFloorGPerH.value)
  })
})

describe('replayLadder: determinism', () => {
  const sample = [
    ...runs(OK, OK, BAD, { weather: HOT }, { gPerH: 5 }, OK, BAD, BAD, OK),
    run(20, { date: START, startTime: '06:30' }),
    run(21, { date: START, startTime: '17:45', gut: 3 }),
    run(22, { date: START, startTime: null }),
  ]

  function shuffled<T>(list: readonly T[], seed: number): T[] {
    const out = [...list]
    let state = seed
    for (let i = out.length - 1; i > 0; i--) {
      state = (state * 1103515245 + 12345) % 2147483648
      const j = state % (i + 1)
      const a = out[i]
      const b = out[j]
      if (a !== undefined && b !== undefined) {
        out[i] = b
        out[j] = a
      }
    }
    return out
  }

  it('does not depend on the order of the runs', () => {
    const expected = replay(sample, OPEN)
    expect(replay([...sample].reverse(), OPEN)).toEqual(expected)
    for (const seed of [1, 7, 42, 1234]) {
      expect(replay(shuffled(sample, seed), OPEN), `seed ${String(seed)}`).toEqual(expected)
    }
  })

  it('orders two runs on one day by time of day, then by id', () => {
    const early = run(1, { date: START, startTime: '06:30' })
    const late = run(0, { date: START, startTime: '17:45' })
    expect(replay([late, early]).steps.map((s) => s.activityId)).toEqual([
      early.activityId,
      late.activityId,
    ])
    const a = run(3, { date: START })
    const b = run(2, { date: START })
    expect(replay([a, b]).steps.map((s) => s.activityId)).toEqual([b.activityId, a.activityId])
  })

  it('is the same on a second call, leaves its input alone and returns plain data', () => {
    const input = deepFreeze(sample.map((r) => structuredClone(r)))
    const first = replay(input, OPEN, [START])
    expect(replay(input, OPEN, [START])).toEqual(first)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })

  it('reports every logged run, oldest first', () => {
    const ladder = replay(sample, OPEN)
    expect(ladder.steps).toHaveLength(sample.length)
    const dates = ladder.steps.map((s) => s.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('replayLadder: the Params decide', () => {
  it('uses the score that holds a rung', () => {
    withParam(P.h7.gutStopScore, 3, () => {
      expect(replay(runs(OK, BAD)).currentIndex).toBe(2)
      expect(replay(runs(OK, { gut: 3 })).held).toBe(true)
    })
  })

  it('uses the count of bad runs that falls back', () => {
    withParam(P.h7.gutStopConsecutiveSessions, 3, () => {
      expect(replay(runs(OK, OK, BAD, BAD)).held).toBe(true)
      expect(replay(runs(OK, OK, BAD, BAD)).currentIndex).toBe(2)
      expect(replay(runs(OK, OK, BAD, BAD, BAD)).currentIndex).toBe(1)
    })
  })

  it('uses the score that falls back at once', () => {
    withParam(P.h7.immediateFallbackScore, 3, () => {
      expect(replay(runs(OK, OK, { gut: 3 })).currentIndex).toBe(1)
    })
    expect(replay(runs(OK, OK, { gut: 3 })).currentIndex).toBe(2)
  })

  it('uses the fraction of the rung a run must reach', () => {
    withParam(P.h7.rungReachFraction, 0.5, () => {
      expect(lastStep(replay(runs(OK, { gPerH: 35 }))).reason).toBe('counted')
    })
    expect(lastStep(replay(runs(OK, { gPerH: 35 }))).reason).toBe('below-target')
  })

  it('uses the multiple-source share and the log thresholds', () => {
    withParam(P.h7.multiCarbMinShare, 0.2, () => {
      expect(lastStep(replay(runs(OK, OK, { multiShare: 0.25 }))).reason).toBe('counted')
    })
    withParam(P.h7.logMinDurationMin, 90, () => {
      expect(lastStep(replay(runs({ hours: 1.6 }))).reason).toBe('counted')
    })
  })

  it('uses the nausea cut-off', () => {
    withParam(P.h7.nauseaContingencyScore, 3, () => {
      expect(replay(runs(OK, { nausea: 2 })).nauseaForward).toBe(false)
      expect(replay(runs(OK, { nausea: 3 })).nauseaForward).toBe(true)
    })
  })

  it('builds the rungs from the first tier, the step and the top of the advanced range', () => {
    withParam(P.h7.carbTier1GPerH, 50, () => {
      withParam(P.h7.gutStepGPerH, 20, () => {
        expect(fuelRungs().map((r) => r.gPerH)).toEqual([30, 50, 70, 90, 110])
      })
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

describe('fuelTargetFor', () => {
  const ladderAfterOne = replay(runs(OK))

  it('serves the sessions still to be run and none that are settled', () => {
    // Typed as a full record: a status added to PlanSessionStatus is a compile error here until it
    // is classified (`adjusted`, a shortened session, is still to be run).
    const expected: Record<PlanSessionStatus, boolean> = {
      planned: true,
      moved: true,
      downgraded: true,
      adjusted: true,
      completed: false,
      partial: false,
      skipped: false,
    }
    for (const [status, served] of Object.entries(expected)) {
      const target = fuelTargetFor(
        context(ladderAfterOne),
        session({ status: status as PlanSessionStatus }),
      )
      expect(target !== null, status).toBe(served)
    }
  })

  it('gives a target for every run kind but the race, and none for a session that is not a run', () => {
    const served: string[] = []
    for (const kind of SESSION_KINDS) {
      if (fuelTargetFor(context(ladderAfterOne), session({ kind })) !== null) served.push(kind)
    }
    expect(served.sort()).toEqual(
      SESSION_KINDS.filter(
        (k) => !['race', 'strength', 'mobility', 'rest', 'cross'].includes(k),
      ).sort(),
    )
  })

  it('needs the planned minutes of a log, or a fuel-practice session of an hour', () => {
    const ctx = context(ladderAfterOne)
    const log = P.h7.logMinDurationMin.value
    const block = P.h7.gutTrainingSessionMinMin.value
    expect(fuelTargetFor(ctx, session({ durationMin: log }))).not.toBeNull()
    expect(fuelTargetFor(ctx, session({ durationMin: log - 1 }))).toBeNull()
    expect(
      fuelTargetFor(ctx, session({ durationMin: block, flags: ['fuel-practice'] })),
    ).not.toBeNull()
    expect(
      fuelTargetFor(ctx, session({ durationMin: block - 1, flags: ['fuel-practice'] })),
    ).toBeNull()
    expect(fuelTargetFor(ctx, session({ durationMin: block }))).toBeNull()
    expect(
      fuelTargetFor(ctx, session({ durationMin: log - 1, flags: ['heat', 'night'] })),
    ).toBeNull()
  })

  it('serves a moved or an eased long run on its own day', () => {
    const peaks = { '2026-07-20': { value: 22, index: 'wbgt' as const } }
    const ctx = context(ladderAfterOne, peaks)
    const moved = fuelTargetFor(ctx, session({ status: 'moved', date: '2026-07-20' }))
    expect(moved).toMatchObject({ date: '2026-07-20', hot: true, basis: 'warm-held' })
    // the eased run: kind easy, the same minutes, the flags dropped except heat
    const eased = fuelTargetFor(
      ctx,
      session({ status: 'downgraded', kind: 'easy', flags: ['heat'] }),
    )
    expect(eased).toMatchObject({ date: SESSION_DAY, hot: false, rungIndex: 1 })
  })

  it('reads the ladder: rung, range at the floor, certainty and multiple-source advice', () => {
    const floor = fuelTargetFor(context(replay([])), session())
    expect(floor).toMatchObject({
      sessionId: 'session-1',
      date: SESSION_DAY,
      rungIndex: 0,
      gPerH: 30,
      range: [30, 50],
      lowCertainty: false,
      multiCarbRequired: false,
      basis: 'start',
      lastTolerated: null,
      heldBack: null,
      hot: false,
      nauseaPlanForward: false,
      locked: false,
    })
    const open = replay(runs(OK, OK), OPEN)
    const seventy = fuelTargetFor(context(open, {}, OPEN), session())
    expect(seventy).toMatchObject({
      rungIndex: 2,
      gPerH: 70,
      range: null,
      lowCertainty: true,
      multiCarbRequired: true,
      basis: 'next-up',
      lastTolerated: { gPerH: 60, range: null },
    })
  })

  it('stays at the last tolerated rung on a hot forecast instead of stepping up', () => {
    const open = replay(runs(OK, OK), OPEN)
    const target = fuelTargetFor(context(open, HOT_PEAK, OPEN), session())
    expect(target).toMatchObject({
      rungIndex: 1,
      gPerH: 60,
      basis: 'warm-held',
      hot: true,
      heldBack: { gPerH: 70, range: null },
      nauseaPlanForward: true,
    })
    // the same ladder on a cool day steps up
    expect(fuelTargetFor(context(open, {}, OPEN), session())?.gPerH).toBe(70)
  })

  it('stays at the last tolerated rung on a hot forecast when the current rung repeats', () => {
    const repeating = replay(runs(OK, OK, BAD), OPEN)
    expect(repeating.held).toBe(true)
    const target = fuelTargetFor(context(repeating, HOT_PEAK, OPEN), session())
    expect(target).toMatchObject({ gPerH: 60, basis: 'warm-repeat', heldBack: { gPerH: 70 } })
  })

  it('has nothing to hold back when the target is already the last tolerated rung', () => {
    const ceiling = replay(runs(OK, OK), NO_OPT_IN)
    const target = fuelTargetFor(context(ceiling, HOT_PEAK), session())
    expect(target).toMatchObject({ gPerH: 60, basis: 'warm-steady', heldBack: null, hot: true })
    const start = fuelTargetFor(context(replay([]), HOT_PEAK), session())
    expect(start).toMatchObject({ rungIndex: 0, basis: 'warm-steady', hot: true })
  })

  it('judges the forecast by the fuel threshold on the index it was measured on', () => {
    const open = replay(runs(OK, OK), OPEN)
    const at = (peak: WeatherIndex | null) =>
      fuelTargetFor(context(open, { [SESSION_DAY]: peak }, OPEN), session())?.hot
    expect(at({ value: P.h7.hotDayWbgtC.value, index: 'wbgt' })).toBe(true)
    expect(at({ value: P.h7.hotDayWbgtC.value - 0.5, index: 'wbgt' })).toBe(false)
    expect(at({ value: P.h7.hotDayAirTempC.value, index: 'air-temperature' })).toBe(true)
    expect(at({ value: P.h7.hotDayAirTempC.value - 0.5, index: 'air-temperature' })).toBe(false)
    expect(at({ value: 24, index: 'air-temperature' })).toBe(false)
    expect(at(null)).toBe(false)
    // a day with no entry is not hot
    expect(
      fuelTargetFor(context(open, { '2030-01-01': { value: 30, index: 'wbgt' } }, OPEN), session())
        ?.hot,
    ).toBe(false)
  })

  it('brings the nausea plan forward after a hard run, with or without heat', () => {
    const queasy = replay(runs(OK, { nausea: 3 }))
    expect(fuelTargetFor(context(queasy), session())?.nauseaPlanForward).toBe(true)
    expect(fuelTargetFor(context(replay(runs(OK))), session())?.nauseaPlanForward).toBe(false)
  })

  it('keeps a gut condition at the floor, with the lock, hot or not', () => {
    const ladder = replay(runs(OK, OK), GUT_CONDITION)
    const cool = fuelTargetFor(context(ladder, {}, GUT_CONDITION), session())
    expect(cool).toMatchObject({
      rungIndex: 0,
      locked: true,
      basis: 'locked',
      nauseaPlanForward: false,
    })
    const hot = fuelTargetFor(context(ladder, HOT_PEAK, GUT_CONDITION), session())
    expect(hot).toMatchObject({
      rungIndex: 0,
      locked: true,
      basis: 'locked',
      nauseaPlanForward: true,
    })
  })

  it('is plain data and leaves the context alone', () => {
    const ctx = deepFreeze(context(replay(runs(OK, OK), OPEN), HOT_PEAK, OPEN))
    const target = fuelTargetFor(ctx, deepFreeze(session()))
    expect(JSON.parse(JSON.stringify(target))).toEqual(target)
  })
})

describe('fuelTargetsFor and fuelLineForSession', () => {
  const ctx = context(replay(runs(OK)))

  it('keeps the sessions that have a target, in the order given', () => {
    const list = [
      session({ id: 'b', date: '2026-07-19' }),
      session({ id: 'x', kind: 'strength', durationMin: 45 }),
      session({ id: 'c', status: 'completed' }),
      session({ id: 'a', date: '2026-07-18' }),
      session({ id: 'd', durationMin: 90 }),
    ]
    expect(fuelTargetsFor(ctx, list).map((t) => t.sessionId)).toEqual(['b', 'a'])
    expect(fuelTargetsFor(ctx, [])).toEqual([])
  })

  it('gives the watch line synchronously, or nothing', () => {
    expect(fuelLineForSession(ctx, session())).toBe('Fuel 60 g/h carbs. Drink to thirst.')
    expect(fuelLineForSession(context(replay([])), session())).toBe(
      'Fuel 30 to 50 g/h carbs. Drink to thirst.',
    )
    expect(fuelLineForSession(ctx, session({ durationMin: 45 }))).toBeNull()
    expect(fuelLineForSession(ctx, session({ status: 'skipped' }))).toBeNull()
    expect(fuelLineForSession(ctx, session({ kind: 'race' }))).toBeNull()
  })

  it('follows the target on a hot day', () => {
    const hot = context(replay(runs(OK, OK), OPEN), HOT_PEAK, OPEN)
    expect(fuelLineForSession(hot, session())).toBe('Fuel 60 g/h carbs. Drink to thirst.')
  })
})

describe('fuelWatchLine', () => {
  const symptoms =
    /nausea|nauseous|gut|stomach|vomit|sick|queasy|pain|cramp|symptom|diarrh|bloat|score/i

  it('is at most 60 characters with no symptom word, at every rung', () => {
    for (const rung of fuelRungs()) {
      const line = fuelWatchLine(rung)
      expect(line.length, line).toBeLessThanOrEqual(60)
      expect(line, line).not.toMatch(symptoms)
      expect(line, line).toContain('Drink to thirst.')
      assertCleanCopy(line, 'the watch line')
    }
  })

  it('says the rate, or the range at the floor, and the thirst-led fluid wording', () => {
    expect(fuelWatchLine({ gPerH: 90, range: null })).toBe('Fuel 90 g/h carbs. Drink to thirst.')
    expect(fuelWatchLine({ gPerH: 30, range: [30, 50] })).toBe(
      'Fuel 30 to 50 g/h carbs. Drink to thirst.',
    )
  })

  it('holds when the figures grow to three digits', () => {
    expect(fuelWatchLine({ gPerH: 120, range: null }).length).toBeLessThanOrEqual(60)
    expect(fuelWatchLine({ gPerH: 100, range: [100, 150] }).length).toBeLessThanOrEqual(60)
  })
})

describe('eahCard', () => {
  it('is the standard card for a short event on a mild day', () => {
    const card = eahCard({ eventHours: 5, hot: false })
    expect(card.stronger).toBe(false)
    expect(card.lines).toHaveLength(3)
    expect(card.lines.join(' ')).toMatch(/Drink to thirst/)
    expect(card.lines.join(' ')).toMatch(/Never force fluids/)
    expect(card.lines.join(' ')).toMatch(/do not prevent low blood sodium/)
    expect(card.lines.join(' ')).toMatch(/Get medical care/)
  })

  it('is stronger above the alert hours, in heat, or both', () => {
    const hours = P.n7.eahStrongerAlertHours.value
    expect(eahCard({ eventHours: hours, hot: false }).stronger).toBe(false)
    expect(eahCard({ eventHours: hours + 0.01, hot: false }).stronger).toBe(true)
    expect(eahCard({ eventHours: null, hot: true }).stronger).toBe(true)
    expect(eahCard({ eventHours: 3, hot: true }).stronger).toBe(true)
    expect(eahCard({ eventHours: null, hot: false }).stronger).toBe(false)
  })

  it('adds one line, with the hours from the registry, to the stronger card', () => {
    const standard = eahCard({ eventHours: 3, hot: false })
    const stronger = eahCard({ eventHours: 30, hot: false })
    expect(stronger.lines.slice(0, 3)).toEqual(standard.lines)
    expect(stronger.lines).toHaveLength(4)
    expect(stronger.lines[3]).toContain(`${String(P.n7.eahStrongerAlertHours.value)} hours`)
    expect(stronger.heading).toBe(standard.heading)
  })
})

// ---------------------------------------------------------------------------------------------
// Copy
// ---------------------------------------------------------------------------------------------

/** Every string the fuel module can say, over a grid of ladders and inputs. */
function everyFuelString(): { sentences: string[]; labels: string[] } {
  const sentences: string[] = []
  const labels: string[] = []

  const scenarios: Array<[string, LadderResult, FuelSettingsInput]> = [
    ['start', replay([], NO_OPT_IN), NO_OPT_IN],
    ['next-up', replay(runs(OK), NO_OPT_IN), NO_OPT_IN],
    ['repeat', replay(runs(OK, BAD), NO_OPT_IN), NO_OPT_IN],
    ['fell-back', replay(runs(OK, OK, BAD, BAD), OPEN), OPEN],
    ['at-ceiling', replay(runs(OK, OK), NO_OPT_IN), NO_OPT_IN],
    ['locked', replay(runs(OK), GUT_CONDITION), GUT_CONDITION],
    ['queasy', replay(runs(OK, OK, { nausea: 3 }), OPEN), OPEN],
    ['open', replay(runs(...Array.from({ length: 8 }, () => OK)), OPEN), OPEN],
  ]
  for (const [, ladder, settings] of scenarios) {
    for (const peaks of [{}, HOT_PEAK]) {
      for (const rung of ladder.rungs) {
        // a target on every rung, as the ladder or a warm day would hand it out
        const target = fuelTargetFor(
          context({ ...ladder, currentIndex: rung.index }, peaks, settings),
          session(),
        )
        if (target === null) continue
        const text = describeFuelTarget(target)
        sentences.push(
          text.basis,
          text.fluid,
          text.sodium,
          ...text.nausea.lines,
          text.watch,
          ...(text.certainty === null ? [] : [text.certainty]),
          ...(text.multiCarb === null ? [] : [text.multiCarb]),
          ...(text.lock === null ? [] : [text.lock]),
        )
        labels.push(text.heading, text.nausea.heading)
      }
    }
    for (const step of ladder.steps) sentences.push(stepNote(step), countsLine(step))
    for (const rung of ladder.rungs) labels.push(rungStateLabel(rung.state))
  }

  // every outcome and reason, including the ones the grid above does not reach
  const reasons: LadderResult[] = [
    replay(runs(OK, { skipped: true })),
    replay(runs({ hours: 1 })),
    replay(runs({ gPerH: 5 })),
    replay(runs(OK, OK, { multiShare: 0 })),
    replay(runs(OK, OK, { hours: 1 }), NO_OPT_IN, [START]),
    replay(runs(OK, { weather: HOT })),
    replay(runs(OK, OK, BAD, BAD)),
    replay(runs(BAD, BAD)),
    replay(runs(OK, SEVERE)),
  ]
  for (const ladder of reasons) {
    for (const step of ladder.steps) sentences.push(stepNote(step), countsLine(step))
  }
  withParam(P.h7.stepUpToleratedRuns, 2, () => {
    for (const step of replay(runs(OK)).steps) sentences.push(stepNote(step))
  })

  const states: RungState[] = [
    'tolerated',
    'next-up',
    'repeat',
    'later',
    'opt-in',
    'opens-after-second-tier',
    'gut-condition',
  ]
  labels.push(...states.map(rungStateLabel))
  for (const stronger of [false, true]) {
    const card = eahText(stronger)
    labels.push(card.heading)
    sentences.push(...card.lines)
  }
  sentences.push(fluidLine(), ...gutTrainingText(), fuelDisclaimer())
  for (const rung of fuelRungs()) sentences.push(fuelWatchText(rung))
  for (const target of [
    null,
    { gPerH: 60, range: null },
    { gPerH: 30, range: [30, 50] as [number, number] },
  ]) {
    const text = loggedTotalText({ carbsG: 540, elapsedSec: 3 * 3600 + 5 * 60, target })
    if (text !== null) sentences.push(text)
  }
  const above = fluidReferenceNote(2400, 3 * 3600)
  if (above !== null) sentences.push(above)
  return { sentences, labels }
}

function expectFits(text: string, where: string): void {
  assertCleanCopy(text, where)
  expect(text.length, where).toBeGreaterThan(0)
  expect(text.length, `${where}: ${text}`).toBeLessThanOrEqual(COPY_MAX_CHARS)
  expect(text, where).not.toMatch(/[{}]|NaN|undefined|null|Infinity/)
  expect(text, where).not.toMatch(/\d{4}-\d{2}-\d{2}/)
}

describe('fuel copy', () => {
  const strings = everyFuelString()

  it('has strings to check', () => {
    expect(strings.sentences.length).toBeGreaterThan(100)
    expect(strings.labels.length).toBeGreaterThan(20)
  })

  it('passes the shared lint, fits, and finishes every sentence', () => {
    for (const text of strings.sentences) {
      expectFits(text, 'a fuel sentence')
      expect(text).toMatch(/[.?]$/)
    }
    for (const text of strings.labels) expectFits(text, 'a fuel label')
  })

  it('never calls a hard gut day a failure or a miss', () => {
    const all = [...strings.sentences, ...strings.labels].join(' ')
    expect(all).not.toMatch(
      /\b(fail\w*|miss\w*|behind|bad|poor|wrong|ruin\w*|streak\w*|badge\w*)\b/i,
    )
    expect(lintText(all)).toEqual([])
  })

  it('registers every template in the shared registry, where the generic lint renders it', () => {
    for (const [id, template] of Object.entries(FUEL_TEMPLATES)) {
      expect(Object.hasOwn(TEMPLATES, id), id).toBe(true)
      const t: Template = template
      expect(Object.keys(t.slots).sort(), id).toEqual(placeholdersOf(t.text).sort())
      for (const units of ['km', 'mi'] as const) {
        expectFits(render(t, sampleSlots(t), units), id)
      }
      expectFits(t.fallback, `${id} fallback`)
    }
  })

  it('puts no digit in a template: every number is a slot', () => {
    for (const [id, template] of Object.entries(FUEL_TEMPLATES)) {
      expect(template.text, id).not.toMatch(/\d/)
    }
  })

  it('names the only fluid figure the reference range, and never as a target', () => {
    const [low, high] = P.h8.fluidReferenceMlPerH.value
    const allowed = new Set([String(low), String(high)])
    const volume = /(\d[\d.,]*)\s*(?:mL|ml|litres?|liters?|oz|ounces?|cups?|bottles?|L)\b/g
    for (const text of strings.sentences) {
      for (const match of text.matchAll(volume)) {
        expect(allowed.has(match[1] ?? ''), `${text} -> ${match[0]}`).toBe(true)
        expect(text, 'a volume appears only as the reference range').toMatch(/reference range/)
      }
      expect(text).not.toMatch(
        /\bdrink \d|\b\d+\s*(?:mL|ml)\b[^.]*\bevery\b|\bat least\b[^.]*\bfluid/i,
      )
    }
  })

  it('leads every fluid sentence with thirst', () => {
    expect(fluidLine()).toMatch(/^Drink to thirst and never force fluids\./)
    for (const stronger of [false, true]) {
      expect(eahText(stronger).lines[0]).toMatch(/^Drink to thirst\./)
    }
  })

  it('claims no more for gut training than a possible gain in tolerance', () => {
    const text = gutTrainingText().join(' ')
    expect(text).toBe(
      'Gut training may improve how well you tolerate carbohydrate during a run. It does not promise a faster time, and it has not been shown to protect the gut lining.',
    )
    expect(text).not.toMatch(/\bprotects?\b(?! the gut lining)/i)
  })
})

describe('fuel copy agrees with the registry', () => {
  const [fluidLow, fluidHigh] = P.h8.fluidReferenceMlPerH.value
  const reference = `${String(fluidLow)} to ${String(fluidHigh)} mL/h`

  it('quotes the fluid reference range from the Param', () => {
    expect(fluidLine()).toContain(reference)
    expect(fluidReferenceNote(2400, 3 * 3600)).toContain(reference)
    withParam(P.h8.fluidReferenceMlPerH, [400, 800], () => {
      expect(fluidLine()).toContain('400 to 800 mL/h')
      expect(fluidLine()).not.toContain(reference)
      expect(fluidReferenceNote(2400, 3 * 3600)).toBeNull()
      expect(fluidReferenceNote(2700, 3 * 3600)).toContain('400 to 800 mL/h')
    })
  })

  it('says the reference note only for a fluid rate above the range', () => {
    expect(fluidReferenceNote(fluidHigh * 3, 3 * 3600)).toBeNull()
    expect(fluidReferenceNote(fluidHigh * 3 + 3, 3 * 3600)).toBe(
      `That is above the ${reference} reference range. Drink to thirst; more is not better.`,
    )
    expect(fluidReferenceNote(1000, 0)).toBeNull()
    expect(fluidReferenceNote(0, 3600)).toBeNull()
  })

  it('quotes the hours and the floor, the first tier and the second tier from the Params', () => {
    expect(eahText(true).lines.at(-1)).toContain(
      `${String(P.n7.eahStrongerAlertHours.value)} hours`,
    )
    withParam(P.n7.eahStrongerAlertHours, 12, () => {
      expect(eahText(true).lines.at(-1)).toContain('12 hours')
      expect(eahCard({ eventHours: 13, hot: false }).stronger).toBe(true)
      expect(eahCard({ eventHours: 11, hot: false }).stronger).toBe(false)
    })
    const target = fuelTargetFor(
      context(replay(runs(OK, OK), OPEN), {}, OPEN),
      session(),
    ) as FuelTarget
    const text = describeFuelTarget(target)
    expect(text.certainty).toContain(`above ${String(P.h7.carbFloorGPerH.value[1])} g/h`)
    expect(text.multiCarb).toContain(`Above ${String(P.h7.carbTier1GPerH.value)} g/h`)
    withParam(P.h7.carbFloorGPerH, [25, 45], () => {
      expect(describeFuelTarget(target).certainty).toContain('above 45 g/h')
      expect(lowCertaintyLine()).toContain('above 45 g/h')
    })
    // the line over the ladder is the target's own label, from the one template
    expect(lowCertaintyLine()).toBe(text.certainty)
    expect(lowCertaintyLine()).toMatch(/^Low certainty: .* a rehearsal, not a promise\.$/)
    expect(rungStateLabel('opens-after-second-tier')).toBe(
      `Opens after ${String(P.h7.carbTier2GPerH.value)} g/h goes well`,
    )
  })

  it('quotes the counting thresholds from the Params', () => {
    const tooShort = lastStep(replay(runs({ hours: 1 })))
    // A session length of two hours or more reads in hours: the 120 minutes of the Param read "2 h".
    expect(P.h7.logMinDurationMin.value).toBe(120)
    expect(countsLine(tooShort)).toContain('shorter than 2 h')
    const inBlock = lastStep(replay(runs({ hours: 0.5 }), NO_OPT_IN, [START]))
    expect(countsLine(inBlock)).toContain(`${String(P.h7.gutTrainingSessionMinMin.value)} min`)
    const below = lastStep(replay(runs(OK, { gPerH: 5 })))
    expect(countsLine(below)).toContain('90%')
    expect(countsLine(below)).toContain('60 g/h')
    const multi = lastStep(replay(runs(OK, OK, { multiShare: 0 })))
    expect(countsLine(multi)).toContain(`Above ${String(P.h7.carbTier1GPerH.value)} g/h`)
    expect(countsLine(multi)).toContain('50%')
    withParam(P.h7.multiCarbMinShare, 0.3, () => {
      expect(countsLine(multi)).toContain('30%')
    })
    withParam(P.h7.rungReachFraction, 0.8, () => {
      expect(countsLine(below)).toContain('80%')
    })
  })

  it('says the scale maximum and the rates of a step from the registry', () => {
    const hold = lastStep(replay(runs(OK, BAD)))
    expect(stepNote(hold)).toBe(
      `Scored 2 of ${String(P.h7.gutSymptomScaleMax.value)} at 60 g/h. The target holds there for the next long run.`,
    )
    const up = lastStep(replay(runs(OK)))
    expect(stepNote(up)).toBe('Tolerated at 30 to 50 g/h. Next long run: 60 g/h.')
    expect(countsLine(up)).toBe('Counted toward your ladder.')
    const back = lastStep(replay(runs(OK, OK, BAD, BAD)))
    expect(stepNote(back)).toBe(
      'Scored 2 of 4 at 70 g/h. The target is back at 60 g/h, the last rate that went well.',
    )
  })

  it('says the spec wording for the basis of a target', () => {
    const open = replay(runs(OK, OK), OPEN)
    const next = fuelTargetFor(context(open, {}, OPEN), session()) as FuelTarget
    expect(describeFuelTarget(next).heading).toBe('Fuel target: 70 g/h of carbohydrate')
    expect(describeFuelTarget(next).basis).toBe(
      'The last run that counted went well at 60 g/h, so this run tries 70 g/h.',
    )
    const warm = fuelTargetFor(context(open, HOT_PEAK, OPEN), session()) as FuelTarget
    expect(describeFuelTarget(warm).basis).toBe(
      'Warm day: the target stays at 60 g/h, the last rate you tolerated, instead of stepping up to 70 g/h.',
    )
    const start = fuelTargetFor(context(replay([])), session()) as FuelTarget
    expect(describeFuelTarget(start).heading).toBe('Fuel target: 30 to 50 g/h of carbohydrate')
    expect(describeFuelTarget(start).certainty).toBeNull()
    expect(describeFuelTarget(start).multiCarb).toBeNull()
    expect(describeFuelTarget(start).lock).toBeNull()
  })

  it('writes the live line of the log form in the runner-facing wording', () => {
    expect(loggedTotalText({ carbsG: 540, elapsedSec: 3 * 3600 + 5 * 60, target: null })).toBe(
      'You took 540 g of carbohydrate in 3 h 5 min: 175 g/h.',
    )
    expect(
      loggedTotalText({ carbsG: 180, elapsedSec: 3 * 3600, target: { gPerH: 60, range: null } }),
    ).toBe('You took 180 g of carbohydrate in 3 h: 60 g/h. Target was 60 g/h.')
    expect(loggedTotalText({ carbsG: 180, elapsedSec: 0, target: null })).toBeNull()
  })

  it('shows a rate through the shared formatter', () => {
    expect(rateText({ gPerH: 60, range: null })).toBe('60 g/h')
    expect(rateText({ gPerH: 30, range: [30, 50] })).toBe('30 to 50 g/h')
    expect(rateText({ gPerH: 52.5, range: null })).toBe('52.5 g/h')
  })

  it('shows the nausea plan closed, and open when it comes forward', () => {
    const ctx = context(replay(runs(OK)))
    const closed = describeFuelTarget(fuelTargetFor(ctx, session()) as FuelTarget)
    expect(closed.nausea.open).toBe(false)
    expect(closed.nausea.heading).toBe('If your stomach turns')
    expect(closed.nausea.lines).toHaveLength(3)
    const hot = describeFuelTarget(
      fuelTargetFor(context(ctx.ladder, HOT_PEAK), session()) as FuelTarget,
    )
    expect(hot.nausea.open).toBe(true)
  })

  it('carries the lock and the disclaimer wherever a gut condition shows', () => {
    const locked = fuelTargetFor(
      context(replay([], GUT_CONDITION), {}, GUT_CONDITION),
      session(),
    ) as FuelTarget
    const text = describeFuelTarget(locked)
    expect(text.lock).toMatch(/Ask a clinician/)
    expect(text.basis).toMatch(/gut condition/)
    expect(fuelDisclaimer()).toMatch(/not medical advice/)
  })
})

// ---------------------------------------------------------------------------------------------
// The module itself
// ---------------------------------------------------------------------------------------------

describe('shared/engine/fuel.ts and fuelCopy.ts', () => {
  const dir = join(import.meta.dirname, '../../../shared/engine')

  /** The source with its comments removed, so a figure in a comment is not counted. */
  function code(name: string): string {
    return readFileSync(join(dir, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
  }

  const files = ['fuel.ts', 'fuelCopy.ts']

  it('has no hard-coded registry value', () => {
    const values = new Set<number>()
    for (const group of [P.h7, P.h8, P.n7]) {
      for (const param of Object.values(group)) {
        const value: unknown = param.value
        for (const v of Array.isArray(value) ? (value as unknown[]) : [value]) {
          if (typeof v === 'number') values.add(v)
        }
      }
    }
    // 0 and 1 are counting, not rules: the first rung, the next rung, the one before the first
    values.delete(0)
    values.delete(1)
    expect(values.size).toBeGreaterThan(10)
    const found: string[] = []
    for (const name of files) {
      for (const match of code(name).matchAll(/(?<![\w$.])\d+(?:\.\d+)?(?![\w$])/g)) {
        if (values.has(Number(match[0]))) found.push(`${name}: ${match[0]}`)
      }
    }
    expect(found).toEqual([])
  })

  it('has no figure in a string of its copy', () => {
    const literals = [
      ...code('fuelCopy.ts').matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g),
    ].map((match) => match[0])
    expect(literals.length).toBeGreaterThan(100)
    // an index inside a template placeholder is code, not text
    const text = literals.map((literal) => literal.replace(/\$\{[^}]*\}/g, ''))
    expect(text.filter((literal) => /\d/.test(literal))).toEqual([])
  })

  it('reads no clock, does no I/O and imports nothing from Node', () => {
    for (const name of files) {
      const text = code(name)
      expect(text, name).not.toMatch(/\bDate\b|Math\.random|performance\.now|\bprocess\b|\bfetch\(/)
      expect(text, name).not.toMatch(
        /\bnode:|\brequire\(|\bfs\b|\bsetTimeout\b|\bawait\b|\basync\b/,
      )
    }
  })

  it('imports what the spec names', () => {
    const imports = (name: string) =>
      [...code(name).matchAll(/from '([^']+)'/g)].map((m) => m[1] ?? '').sort()
    expect(imports('fuel.ts')).toEqual(
      [
        '../dates.ts',
        '../domain/fuel.ts',
        '../domain/sessionStatus.ts',
        './fuelCopy.ts',
        './heat.ts',
        './params/index.ts',
        './types.ts',
      ].sort(),
    )
    expect(imports('fuelCopy.ts')).toEqual(
      [
        '../copy/quantity.ts',
        '../copy/template.ts',
        '../domain/fuel.ts',
        '../types.ts',
        './params/index.ts',
        './types.ts',
      ].sort(),
    )
  })

  it('does not edit heat.ts: it reads weatherIndex and takes the forecast peak from the caller', () => {
    expect(code('fuel.ts')).toMatch(/\bweatherIndex\b/)
    expect(code('fuel.ts')).not.toMatch(/trainingHeatAdvice|liljegrenWbgt/)
  })
})
