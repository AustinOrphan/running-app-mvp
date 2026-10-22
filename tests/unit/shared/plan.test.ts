import { describe, expect, test } from 'vitest'
import { addDays, mondayOf, weekStartsBetween } from '../../../shared/dates.ts'
import {
  BUILD_PHASES,
  GENERATOR_VERSION,
  PEAK_MIN_BY_CLASS,
  distanceClassOf,
  generatePlan,
  isCutbackIndex,
  longRunMinutes,
  type GeneratePlanInput,
  type PlanWeekInput,
} from '../../../shared/domain/plan.ts'
import type { DistanceClass, Phase } from '../../../shared/types.ts'

const fixture: GeneratePlanInput = {
  startDate: '2026-03-02',
  raceDate: '2026-12-05',
  distanceClass: 'marathon',
  baselineRunMin: 120,
  strengthPreference: 2,
}

function planOf(weeks: number, over: Partial<GeneratePlanInput> = {}): PlanWeekInput[] {
  const startDate = over.startDate ?? fixture.startDate
  return generatePlan({
    ...fixture,
    ...over,
    raceDate: addDays(startDate, 7 * (weeks - 1) + 3),
  })
}

function countsByPhase(plan: PlanWeekInput[]): Record<Phase, number> {
  const counts: Record<Phase, number> = {
    restart: 0,
    base1: 0,
    base2: 0,
    endurance: 0,
    specific: 0,
    peak: 0,
    taper: 0,
    race: 0,
  }
  for (const week of plan) counts[week.phase] += 1
  return counts
}

function phasesOf(plan: PlanWeekInput[]): Phase[] {
  return plan.map((week) => week.phase)
}

function isBuild(week: PlanWeekInput): boolean {
  return BUILD_PHASES.includes(week.phase)
}

describe('generatePlan', () => {
  test('distanceClassOf boundaries', () => {
    const cases: Array<[number, DistanceClass]> = [
      [10000, 'short'],
      [10001, 'half'],
      [21100, 'half'],
      [21101, 'marathon'],
      [42195, 'marathon'],
      [42196, 'ultra50'],
      [80500, 'ultra50'],
      [80501, 'ultra100'],
    ]
    for (const [m, cls] of cases) expect(distanceClassOf(m)).toBe(cls)
  })

  test('allocates 37 build weeks by largest remainder (10:19:19:19:12:14), then taper 2 and race 1', () => {
    const plan = generatePlan(fixture)
    expect(countsByPhase(plan)).toEqual({
      restart: 4,
      base1: 8,
      base2: 7,
      endurance: 7,
      specific: 5,
      peak: 6,
      taper: 2,
      race: 1,
    })
    const order: Phase[] = [
      'restart',
      'base1',
      'base2',
      'endurance',
      'specific',
      'peak',
      'taper',
      'race',
    ]
    const ranks = plan.map((week) => order.indexOf(week.phase))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(plan.map((week) => week.index)).toEqual(Array.from({ length: 40 }, (_, i) => i))
    expect(plan.map((week) => week.weekStart)).toEqual(
      weekStartsBetween('2026-03-02', '2026-11-30'),
    )
    expect(plan.at(-1)?.weekStart).toBe('2026-11-30')
  })

  test('taper length by plan length', () => {
    expect(countsByPhase(planOf(24)).taper).toBe(2)
    expect(countsByPhase(planOf(23)).taper).toBe(1)
    expect(countsByPhase(planOf(8)).taper).toBe(1)
    expect(countsByPhase(planOf(7)).taper).toBe(0)
  })

  test('short plans', () => {
    expect(phasesOf(planOf(1))).toEqual(['race'])
    expect(phasesOf(planOf(2))).toEqual(['base1', 'race'])
    expect(phasesOf(planOf(3))).toEqual(['base1', 'peak', 'race'])
    expect(phasesOf(planOf(6))).toEqual(['base1', 'base1', 'base1', 'peak', 'peak', 'race'])
    const build = ['restart', 'base1', 'base2', 'endurance', 'specific', 'peak']
    expect(phasesOf(planOf(7))).toEqual([...build, 'race'])
    expect(phasesOf(planOf(8))).toEqual([...build, 'taper', 'race'])
  })

  test('restart is skipped when the baseline exceeds the Base 1 floor', () => {
    const plan = planOf(40, { baselineRunMin: 300 })
    expect(countsByPhase(plan)).toMatchObject({
      restart: 0,
      base1: 9,
      base2: 9,
      endurance: 8,
      specific: 5,
      peak: 6,
    })
  })

  test('first week is at most baseline + 15%', () => {
    expect(generatePlan(fixture)[0]?.baselineRunMin).toBe(138)
  })

  test('ramp cap: each non-cutback build week is at most +10% over the previous non-cutback build week', () => {
    const plan = generatePlan(fixture)
    expect(plan.slice(0, 5).map((week) => week.baselineRunMin)).toEqual([138, 152, 167, 129, 184])
    let reference: number | null = null
    for (const week of plan) {
      if (!isBuild(week) || isCutbackIndex(week.index, week.phase)) continue
      if (reference !== null) {
        expect(week.baselineRunMin).toBeLessThanOrEqual(Math.round(1.1 * reference))
      }
      reference = week.baselineRunMin
    }
    const short = planOf(3, { baselineRunMin: 100 })
    expect(short.map((week) => week.baselineRunMin)).toEqual([100, 110, 90])
  })

  test('cutback weeks', () => {
    const plan = generatePlan(fixture)
    const cutbacks = plan.filter((week) => isCutbackIndex(week.index, week.phase))
    expect(cutbacks.map((week) => week.index)).toEqual([3, 7, 11, 15, 19, 23, 27, 31, 35])
    const normalRunDays: Partial<Record<Phase, number>> = {
      restart: 3,
      base1: 3,
      base2: 4,
      endurance: 4,
      specific: 5,
      peak: 5,
    }
    for (const week of cutbacks) {
      const previous = plan[week.index - 1]
      if (!previous) throw new Error('cutback without a previous week')
      const ratio = week.baselineRunMin / previous.baselineRunMin
      expect(ratio).toBeGreaterThanOrEqual(0.75)
      expect(ratio).toBeLessThanOrEqual(0.8)
      expect(week.runDays).toBe((normalRunDays[week.phase] ?? 0) - 1)
    }
    expect(isCutbackIndex(3, 'taper')).toBe(false)
    expect(isCutbackIndex(3, 'race')).toBe(false)
    expect(isCutbackIndex(4, 'base1')).toBe(false)
  })

  test('peak ceilings by class', () => {
    expect(PEAK_MIN_BY_CLASS).toEqual({
      short: 300,
      half: 360,
      marathon: 480,
      ultra50: 540,
      ultra100: 570,
    })
    for (const cls of Object.keys(PEAK_MIN_BY_CLASS) as DistanceClass[]) {
      const plan = planOf(60, { distanceClass: cls })
      const ceiling = PEAK_MIN_BY_CLASS[cls]
      const max = Math.max(...plan.map((week) => week.baselineRunMin))
      expect(max).toBeLessThanOrEqual(ceiling)
      expect(max).toBeGreaterThan(0.9 * ceiling)
    }
    expect(generatePlan(fixture)[36]?.baselineRunMin).toBe(480)
  })

  test('longRunMinutes: round(27 x weekly hours), capped at 240', () => {
    expect(longRunMinutes(120)).toBe(54)
    expect(longRunMinutes(90)).toBe(41)
    expect(longRunMinutes(480)).toBe(216)
    expect(longRunMinutes(533)).toBe(240)
    expect(longRunMinutes(720)).toBe(240)
    for (const week of generatePlan(fixture)) {
      if (week.phase === 'race') continue
      expect(week.longRunMin).toBe(longRunMinutes(week.baselineRunMin))
    }
  })

  test('run days', () => {
    const expected: Partial<Record<Phase, number>> = {
      restart: 3,
      base1: 3,
      base2: 4,
      endurance: 4,
      specific: 5,
      peak: 5,
      race: 2,
    }
    const plan = generatePlan(fixture)
    for (const week of plan) {
      if (week.phase === 'taper') continue
      if (isCutbackIndex(week.index, week.phase)) continue
      expect(week.runDays).toBe(expected[week.phase])
    }
    const taper = plan.filter((week) => week.phase === 'taper')
    expect(taper.map((week) => week.runDays)).toEqual([4, 3])
    const single = planOf(10).filter((week) => week.phase === 'taper')
    expect(single.map((week) => week.runDays)).toEqual([4])
  })

  test('strength by preference', () => {
    const maxima: Record<Phase, number> = {
      restart: 2,
      base1: 2,
      base2: 2,
      endurance: 2,
      specific: 2,
      peak: 1,
      taper: 0,
      race: 0,
    }
    for (const preference of [0, 1, 2] as const) {
      for (const week of generatePlan({ ...fixture, strengthPreference: preference })) {
        expect(week.strengthSessions).toBe(Math.min(preference, maxima[week.phase]))
      }
    }
  })

  test('day 2 appears only from Endurance on, in non-cutback build weeks, as half the long run', () => {
    for (const week of generatePlan(fixture)) {
      const eligible =
        ['endurance', 'specific', 'peak'].includes(week.phase) &&
        !isCutbackIndex(week.index, week.phase)
      if (eligible) expect(week.day2Min).toBe(Math.round(week.longRunMin / 2))
      else expect(week.day2Min).toBeNull()
    }
  })

  test('taper and race week', () => {
    const plan = generatePlan(fixture)
    const taper = plan.filter((week) => week.phase === 'taper')
    expect(taper.map((week) => week.baselineRunMin)).toEqual([312, 216])
    const oneTaper = planOf(10)
    const lastBuild = oneTaper
      .filter((week) => isBuild(week) && !isCutbackIndex(week.index, week.phase))
      .at(-1)
    const only = oneTaper.filter((week) => week.phase === 'taper')
    expect(only).toHaveLength(1)
    expect(only[0]?.baselineRunMin).toBe(Math.round(0.65 * (lastBuild?.baselineRunMin ?? 0)))
    expect(only[0]?.strengthSessions).toBe(0)
    expect(plan.at(-1)).toMatchObject({
      phase: 'race',
      baselineRunMin: 90,
      runDays: 2,
      longRunMin: 0,
      day2Min: null,
      strengthSessions: 0,
      weekStart: mondayOf(fixture.raceDate),
    })
  })

  test('race in the starting week gives a race-only plan; invalid input throws', () => {
    expect(planOf(1)).toHaveLength(1)
    expect(() => generatePlan({ ...fixture, raceDate: '2026-02-20' })).toThrow(RangeError)
    for (const baselineRunMin of [0, 0.5, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => generatePlan({ ...fixture, baselineRunMin })).toThrow(RangeError)
    }
  })

  test('every week has non-empty focus text and integer minutes', () => {
    for (const week of generatePlan(fixture)) {
      expect(week.focus.length).toBeGreaterThan(0)
      for (const value of [week.baselineRunMin, week.longRunMin, week.day2Min ?? 0]) {
        expect(Number.isInteger(value)).toBe(true)
      }
    }
    expect(GENERATOR_VERSION).toBe(1)
  })
})
