import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { goalModel } from '../../../shared/engine/goal.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { spikeWarnLimit } from '../../../shared/engine/limits.ts'
import { macroPlan, peakLongRunMin, redsHold } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { lastWindowDay, ownWindow, windowDay } from '../../../shared/engine/postRace.ts'
import { buildZones } from '../../../shared/engine/zones.ts'
import type {
  AthleteState,
  EngineInput,
  Feasibility,
  GoalModel,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile, Goal, WeekRow } from '../../../shared/types.ts'
import { activity, input as e8Input, profile as e8Profile } from './e8-fixtures.ts'

const TODAY = '2026-01-05' // a Monday

const DAY = { available: true, maxMin: null }
const PROFILE: AthleteProfile = {
  birthYear: 1985,
  sex: 'unspecified',
  heightCm: null,
  weightKg: null,
  hrMax: null,
  hrMaxSource: null,
  hrRest: null,
  lthr: null,
  thresholdPaceSecPerKm: null,
  runningSinceYear: 2015,
  injuries: [],
  availability: { mon: DAY, tue: DAY, wed: DAY, thu: DAY, fri: DAY, sat: DAY, sun: DAY },
  longRunDay: 'sun',
  terrain: { trail: false, hills: true, treadmill: false, track: false },
  strengthPreference: 2,
  timezone: 'UTC',
  homeLat: null,
  homeLng: null,
  useHomeWeather: false,
}

function state(over: Partial<AthleteState> = {}): AthleteState {
  return {
    asOf: TODAY,
    age: 41,
    sex: 'unspecified',
    experience: 'recreational',
    yearsRunning: 8,
    load: { metric: 'srpe', acute: 0, chronic: 0, daily: [] },
    weeks: [],
    typicalWeekMin: 240,
    longest30d: { distanceM: 16000, durationSec: 5400, gainM: 100, lossM: 100, twoDaySec: 7000 },
    gaps16w: 0,
    layoffDays: 0,
    lastRunDate: '2026-01-04',
    fitness: {
      csMps: null,
      dPrimeM: null,
      csEfforts: 0,
      exponent: null,
      races: [],
      vo2maxTrend: null,
    },
    efficiency: { current: null, trendPct: null, samples: 0 },
    durability: { decouplingMedianPct: null, samples: 0 },
    risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    lowFrequency: false,
    heatAcclimation: 0,
    ...over,
  }
}

const DISTANCES: Record<GoalModel['distanceClass'], { m: number; sec: number }> = {
  '5k': { m: 5000, sec: 1500 },
  '10k': { m: 10000, sec: 3200 },
  half: { m: 21097, sec: 7200 },
  marathon: { m: 42195, sec: 14400 },
  ultra50: { m: 50000, sec: 18000 },
  ultra100k: { m: 100000, sec: 50000 },
  ultra100mi: { m: 160934, sec: 108000 },
  beyond: { m: 200000, sec: 150000 },
}

function goal(
  distanceClass: GoalModel['distanceClass'],
  weeksOut: number,
  over: Partial<GoalModel> = {},
): GoalModel {
  const d = DISTANCES[distanceClass]
  return {
    goalId: 'g1',
    name: 'Synthetic race',
    date: addDays(TODAY, weeksOut * 7 + 5), // a Saturday of the race week
    distanceM: d.m,
    gainM: 0,
    lossM: 0,
    surface: 'road',
    goalType: d.m > 42195 ? 'finish' : 'time',
    targetTimeSec: null,
    startTime: '08:00',
    isUltra: d.m > 42200,
    distanceClass,
    expectedDurationSec: d.sec,
    crossesDarkness: false,
    raceWbgtC: null,
    ...over,
  }
}

function input(g: GoalModel, options: EngineInput['options'] = {}): EngineInput {
  return {
    today: TODAY,
    profile: PROFILE,
    activities: [],
    wellness: [],
    reviews: [],
    goal: g,
    forecast: null,
    existing: null,
    options,
  }
}

const FEASIBLE: Feasibility = {
  label: 'comfortable',
  weeksNeeded: 10,
  weeksAvailable: 20,
  notes: [],
}

function plan(
  g: GoalModel,
  st: AthleteState = state(),
  options: EngineInput['options'] = {},
): WeekDraft[] {
  return macroPlan(input(g, options), st, g, FEASIBLE)
}

const taperWeeks = (weeks: WeekDraft[]) => weeks.filter((w) => w.isTaper)
const preTaper = (weeks: WeekDraft[]) =>
  weeks.filter((w) => !w.isTaper && w.phase !== 'race' && !w.flags.includes('post-race'))
const workWeeks = (weeks: WeekDraft[]) => preTaper(weeks).filter((w) => !w.isRecovery)
const at = (weeks: WeekDraft[], i: number) => weeks[i]?.targetRunMin ?? 0

describe('macroPlan: calendar and phases', () => {
  it('returns nothing when the race date has passed', () => {
    expect(plan(goal('half', -1))).toEqual([])
  })

  it('lays out Mondays from this week to the race week, then the post-race week', () => {
    const g = goal('marathon', 20)
    const weeks = plan(g)
    expect(weeks[0]?.weekStart).toBe(mondayOf(TODAY))
    weeks.forEach((w, i) => {
      expect(w.index).toBe(i)
      expect(w.weekStart).toBe(addDays(mondayOf(TODAY), 7 * i))
    })
    const raceWeek = weeks.find((w) => w.weekStart === mondayOf(g.date))
    expect(raceWeek?.phase).toBe('race')
    expect(raceWeek?.isTaper).toBe(true)
    // the weeks after the race follow it one Monday at a time and cover the post-race window
    const post = weeks.filter((w) => w.flags.includes('post-race'))
    expect(post.length).toBeGreaterThan(0)
    post.forEach((w, k) => {
      expect(w.weekStart).toBe(addDays(raceWeek?.weekStart ?? '', 7 * (k + 1)))
    })
    const lastDay = lastWindowDay(ownWindow(input(g)))
    const last = post[post.length - 1]
    expect((last?.weekStart ?? '') <= lastDay).toBe(true)
    expect(addDays(last?.weekStart ?? '', 6) >= lastDay).toBe(true)
  })

  it('builds backwards: base, build, specific, taper, race', () => {
    const weeks = plan(goal('marathon', 24))
    const order = ['base', 'build', 'specific', 'taper', 'race']
    const seen = weeks.filter((w) => !w.flags.includes('post-race')).map((w) => w.phase)
    expect([...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(seen)
    const specific = weeks.filter((w) => w.phase === 'specific').length
    expect(specific).toBeGreaterThanOrEqual(P.e2.specificWeeksMin.value)
    expect(specific).toBeLessThanOrEqual(P.e2.specificWeeksMax.value)
    expect(weeks.filter((w) => w.phase === 'build').length).toBeLessThanOrEqual(
      P.macroDesign.buildWeeks.value,
    )
    expect(weeks.some((w) => w.phase === 'base')).toBe(true)
  })

  it('shortens a plan with little runway without a specific phase', () => {
    const weeks = plan(goal('half', 12))
    expect(weeks.some((w) => w.phase === 'base' || w.phase === 'build')).toBe(true)
    const short = plan(goal('half', 4))
    expect(short.filter((w) => w.phase === 'specific')).toHaveLength(0)
    expect(taperWeeks(short)).toHaveLength(2)
  })

  it('stays deterministic for the same input', () => {
    const g = goal('ultra100k', 26, { gainM: 3000, lossM: 3000 })
    expect(plan(g)).toEqual(plan(g))
  })
})

describe('macroPlan: taper', () => {
  const lengths: Array<[GoalModel['distanceClass'], number]> = [
    ['5k', 1],
    ['10k', 2],
    ['half', 2],
    ['marathon', 3],
    ['ultra50', 2],
    ['ultra100k', 2],
    ['ultra100mi', 2],
  ]
  it.each(lengths)('%s tapers over %i week(s) including race week', (cls, weeks) => {
    expect(taperWeeks(plan(goal(cls, 24)))).toHaveLength(weeks)
  })

  it('uses the shorter marathon taper for a low-volume build', () => {
    const low = plan(goal('marathon', 24), state({ typicalWeekMin: 120 }))
    expect(taperWeeks(low)).toHaveLength(2)
  })

  it('never tapers longer than 21 days', () => {
    for (const cls of Object.keys(DISTANCES) as Array<GoalModel['distanceClass']>) {
      expect(taperWeeks(plan(goal(cls, 24))).length).toBeLessThanOrEqual(
        Math.ceil(P.k1.maxDays.value / 7),
      )
    }
  })

  it('cuts weekly volume by the K2 multipliers from the pre-taper reference week', () => {
    const weeks = plan(goal('marathon', 24))
    const ref = Math.max(...preTaper(weeks).map((w) => w.targetRunMin))
    const mult = P.k2.threeWeekMultipliers.value
    taperWeeks(weeks).forEach((w, i) => {
      expect(w.targetRunMin).toBe(Math.floor(ref * (mult[i] ?? 0) + 1e-9))
    })
  })

  it('uses the two-week multipliers for a half-marathon taper', () => {
    const weeks = plan(goal('half', 24))
    const ref = Math.max(...preTaper(weeks).map((w) => w.targetRunMin))
    expect(taperWeeks(weeks).map((w) => w.targetRunMin)).toEqual(
      P.k2.twoWeekMultipliers.value.map((m) => Math.floor(ref * m + 1e-9)),
    )
  })

  it('decreases strictly through the taper and below the peak', () => {
    for (const cls of ['10k', 'half', 'marathon', 'ultra100k'] as const) {
      const weeks = plan(goal(cls, 24))
      let prev = Math.max(...preTaper(weeks).map((w) => w.targetRunMin))
      for (const w of taperWeeks(weeks)) {
        expect(w.targetRunMin, cls).toBeLessThan(prev)
        prev = w.targetRunMin
      }
    }
  })

  it('keeps one quality session and cuts run days by at most 20%', () => {
    const weeks = plan(goal('marathon', 24))
    const ref = workWeeks(weeks).at(-1)
    for (const w of taperWeeks(weeks)) {
      expect(w.qualitySessions).toBeGreaterThanOrEqual(P.k3.minQualitySessionsPerWeek.value)
      expect(w.runDays).toBeGreaterThanOrEqual(
        Math.ceil((ref?.runDays ?? 0) * (1 - P.k3.runDaysMaxCutPct.value / 100)),
      )
    }
  })

  it('keeps race week free of a long run and of strength', () => {
    const race = plan(goal('marathon', 24)).find((w) => w.phase === 'race')
    expect(race?.longRunMin).toBe(0)
    expect(race?.strengthSessions).toBe(0)
  })

  it('tapers from the current volume when the race is inside the taper window', () => {
    const weeks = plan(goal('marathon', 1))
    expect(taperWeeks(weeks)).toHaveLength(2)
    expect(weeks.filter((w) => w.phase === 'specific')).toHaveLength(0)
  })
})

describe('macroPlan: recovery cycles', () => {
  const expectCycle = (weeks: WeekDraft[], work: number) => {
    const pre = preTaper(weeks)
    const last = pre.length - 1
    const cycle = work + 1
    expect(pre[last]?.isRecovery).toBe(false)
    for (const w of pre) {
      // the plan never opens with a recovery week
      const expected = w.index > 0 && (last - w.index) % cycle === cycle - 1
      expect(w.isRecovery, `week ${w.index}`).toBe(expected)
    }
  }

  it('defaults to 3:1 counted back from the peak week', () => {
    expectCycle(plan(goal('marathon', 24)), P.e3.defaultCycleWorkWeeks.value)
  })

  it('uses 2:1 for a novice, a recent injury and the option', () => {
    const cases: Array<[AthleteState, EngineInput['options']]> = [
      [state({ experience: 'novice' }), {}],
      [state({ risk: { ...state().risk, recentInjury: true } }), {}],
      [state(), { recoveryCycle: '2:1' }],
    ]
    for (const [st, options] of cases) {
      expectCycle(plan(goal('marathon', 24), st, options), P.e3.flaggedCycleWorkWeeks.value)
    }
  })

  it('honours a 3:1 option for a novice', () => {
    expectCycle(
      plan(goal('marathon', 24), state({ experience: 'novice' }), { recoveryCycle: '3:1' }),
      P.e3.defaultCycleWorkWeeks.value,
    )
  })

  it('does not choose 2:1 from age alone', () => {
    expectCycle(plan(goal('marathon', 24), state({ age: 62 })), P.e3.defaultCycleWorkWeeks.value)
  })

  it('cuts recovery-week volume by 25% of the last work week and keeps run days', () => {
    const pre = preTaper(plan(goal('marathon', 24)))
    const recoveries = pre.filter((x) => x.isRecovery && x.index > 0)
    expect(recoveries.length).toBeGreaterThan(0)
    for (const w of recoveries) {
      const prevWork = [...pre].reverse().find((x) => x.index < w.index && !x.isRecovery)
      const cut = 1 - w.targetRunMin / (prevWork?.targetRunMin ?? 1)
      expect(cut).toBeGreaterThanOrEqual(0.2)
      expect(cut).toBeLessThanOrEqual(0.3)
      expect(w.runDays).toBe(prevWork?.runDays)
      expect(w.qualitySessions).toBeGreaterThanOrEqual(1)
    }
  })

  it('has no recovery week inside the taper', () => {
    expect(taperWeeks(plan(goal('marathon', 24))).some((w) => w.isRecovery)).toBe(false)
  })

  it('marks the peak week before the taper as the largest', () => {
    const pre = preTaper(plan(goal('ultra100k', 26)))
    expect(pre.at(-1)?.flags).toContain('peak')
    expect(pre.at(-1)?.targetRunMin).toBe(Math.max(...pre.map((w) => w.targetRunMin)))
  })
})

describe('macroPlan: weekly targets and ramp', () => {
  const rampOk = (work: WeekDraft[], ramp: number) => {
    for (let i = 1; i < work.length; i++) {
      const prev = at(work, i - 1)
      expect(at(work, i)).toBeLessThanOrEqual(
        Math.max(Math.floor(prev * (1 + ramp) + 1e-9), prev + 1),
      )
    }
  }

  it('starts from the typical week and stays inside the soft ramp between work weeks', () => {
    const work = workWeeks(plan(goal('marathon', 24), state({ typicalWeekMin: 200 })))
    expect(at(work, 0)).toBe(200)
    rampOk(work, P.g2.rampSoft.value)
    expect(at(work, work.length - 1)).toBeGreaterThan(200)
  })

  it('keeps growth under the 30% ceiling over any two work weeks', () => {
    const work = workWeeks(plan(goal('marathon', 30), state({ typicalWeekMin: 120 })))
    for (let i = 2; i < work.length; i++) {
      expect(at(work, i) / at(work, i - 2)).toBeLessThanOrEqual(1 + P.g2.rampCeilingTwoWeeks.value)
    }
  })

  it('caps the ramp at 5% after a bone stress injury and for two or more BSI factors', () => {
    const cases = [
      state({ risk: { ...state().risk, priorBsi: true } }),
      state({ risk: { ...state().risk, bsiFactors: 2 } }),
    ]
    for (const st of cases)
      rampOk(workWeeks(plan(goal('marathon', 24), st)), P.g3.priorBsiRampMax.value)
  })

  it('ramps no faster than 5% for a recent injury', () => {
    const st = state({ risk: { ...state().risk, recentInjury: true } })
    rampOk(workWeeks(plan(goal('marathon', 24), st)), P.g3.recentInjuryRamp.value[0])
  })

  it('moves a novice up by at least one minute a week', () => {
    // a typical week at the start-path floor: no ladder, so the ramp itself steps by time
    const work = workWeeks(
      plan(goal('10k', 20), state({ experience: 'novice', typicalWeekMin: 60 })),
    )
    expect(at(work, 1)).toBeGreaterThanOrEqual(at(work, 0) + P.g2.noviceMinStepMin.value)
  })

  it('gives a low-frequency runner the same minimum step and the 2:1 cadence', () => {
    const plain = plan(goal('10k', 24), state({ typicalWeekMin: 30 * 2, lowFrequency: false }))
    const low = plan(goal('10k', 24), state({ typicalWeekMin: 30 * 2, lowFrequency: true }))
    const firstRecovery = (weeks: WeekDraft[]) => weeks.findIndex((w) => w.isRecovery)
    expect(firstRecovery(low)).toBeLessThan(firstRecovery(plain))
    const work = workWeeks(low)
    expect(at(work, 1)).toBeGreaterThanOrEqual(at(work, 0) + P.g2.noviceMinStepMin.value)
  })

  // Task E21: no run is longer than the long run, which the 5 km table caps at 90 min for a typical
  // week above 360 min, so six run days hold at most 540 min; a week above that would hold there
  // instead of drawing minutes that cannot be placed.
  it('holds a runner already above the peak table at the most the run days can place', () => {
    const work = workWeeks(plan(goal('5k', 20), state({ typicalWeekMin: 400 })))
    const most = Math.min(
      400,
      Math.max(...work.map((w) => w.runDays)) * P.peakLongRunMin['5k'].value[2],
    )
    expect(most).toBeGreaterThan(P.peakWeeklyMin['5k'].value)
    expect(work.every((w) => w.targetRunMin === most)).toBe(true)
  })

  it('starts on rung 1 of the run-walk ladder when there is no recent running', () => {
    const weeks = plan(goal('half', 20), state({ typicalWeekMin: 0, yearsRunning: null }))
    expect(weeks[0]!.targetRunMin).toBe(63)
    expect(weeks[0]!.flags).toEqual(
      expect.arrayContaining(['restart-floor', 'run-walk', 'ladder-1']),
    )
  })

  it('starts from the start floor week when a hold stops the ladder', () => {
    const held = state({
      typicalWeekMin: 0,
      risk: { recentInjury: false, priorBsi: false, bsiFactors: 0, redsFlags: 2, noviceFlags: [] },
    })
    const work = workWeeks(plan(goal('half', 20), held))
    expect(at(work, 0)).toBe(P.macroDesign.startFloorWeekMin.value)
  })

  it('raises the peak to the D3 floor for a half-marathon time goal', () => {
    const half = goal('half', 60, { goalType: 'time', expectedDurationSec: 12000 })
    const weeks = plan(half, state({ typicalWeekMin: 200 }))
    const peak = Math.max(...preTaper(weeks).map((w) => w.targetRunMin))
    // 32 km at the training pace of a 3 h 20 min half-marathon is above the default peak
    expect(peak).toBeGreaterThan(P.peakWeeklyMin.half.value)
  })

  it('does not apply the floor to a finish goal', () => {
    const half = goal('half', 60, { goalType: 'finish', expectedDurationSec: 12000 })
    const peak = Math.max(
      ...preTaper(plan(half, state({ typicalWeekMin: 200 }))).map((w) => w.targetRunMin),
    )
    expect(peak).toBe(P.peakWeeklyMin.half.value)
  })

  it('stops growing at the peak for the distance class', () => {
    const weeks = plan(goal('10k', 40), state({ typicalWeekMin: 120 }))
    expect(Math.max(...preTaper(weeks).map((w) => w.targetRunMin))).toBe(
      P.peakWeeklyMin['10k'].value,
    )
  })

  it('keeps a finish-first ultra on the ramp-limited path', () => {
    rampOk(
      workWeeks(plan(goal('ultra100mi', 30), state({ typicalWeekMin: 300 }))),
      P.g2.rampSoft.value,
    )
  })

  it('progresses the long run no faster than the ramp from the 30-day longest run', () => {
    const weeks = plan(goal('marathon', 24))
    expect(weeks[0]?.longRunMin).toBeLessThanOrEqual(
      Math.floor((state().longest30d.durationSec / 60) * (1 + P.g2.rampSoft.value) + 1e-9),
    )
    const work = workWeeks(weeks)
    for (let i = 1; i < work.length; i++) {
      const prev = Math.max(...work.slice(0, i).map((w) => w.longRunMin))
      expect(work[i]?.longRunMin ?? 0).toBeLessThanOrEqual(
        Math.max(Math.floor(prev * 1.1 + 1e-9), prev + 1),
      )
    }
  })
})

describe('macroPlan: 5 km and 10 km long-run tiers [rules D7]', () => {
  const weekRows = (runMin: number, runM: number): WeekRow[] =>
    [4, 3, 2, 1].map((back) => ({
      weekStart: addDays(mondayOf(TODAY), -7 * back),
      runMin,
      runM,
      runSessions: 4,
      runDays: 4,
      strengthSessions: 0,
      crossMin: 0,
      raceMin: 0,
      longestRunMin: 0,
      longRunShare: null,
      avg4wRunMin: runMin,
      streak3Plus: 0,
    }))
  const longest = (weeks: WeekDraft[]) => Math.max(...weeks.map((w) => w.longRunMin))

  it('holds the tiers and the distance cap as default parameters', () => {
    expect(P.peakLongRunMin['5k'].value).toEqual([60, 75, 90])
    expect(P.peakLongRunMin['10k'].value).toEqual([75, 90, 100])
    expect(P.macroDesign.longRunTierWeeklyMin.value).toEqual([180, 360])
    expect(P.macroDesign.peakLongRunKmMax.value).toBe(16)
    for (const p of [
      P.peakLongRunMin['5k'],
      P.peakLongRunMin['10k'],
      P.macroDesign.longRunTierWeeklyMin,
      P.macroDesign.peakLongRunKmMax,
    ]) {
      expect(p.grade).toBe('D')
      expect(p.rule).toBe('D7')
    }
  })

  it('gives a 5 km goal the cap of the tier of the typical week: 60, 75 and 90 min', () => {
    const g = goal('5k', 20)
    const cap = (typicalWeekMin: number) => peakLongRunMin(g, 345, state({ typicalWeekMin }))
    expect([cap(120), cap(240), cap(400)]).toEqual([60, 75, 90])
    // the boundaries: under 180 is the first tier, 180 to 360 inclusive the second
    expect([cap(179), cap(180), cap(360), cap(361)]).toEqual([60, 75, 75, 90])
  })

  it('gives a 10 km goal 75, 90 and 100 min', () => {
    const g = goal('10k', 20)
    // 16 km take 107 min at 400 s/km, so the tiers bind
    const cap = (typicalWeekMin: number) => peakLongRunMin(g, 400, state({ typicalWeekMin }))
    expect([cap(120), cap(240), cap(400)]).toEqual([75, 90, 100])
    // at 330 s/km 16 km take 88 min, under the top two tiers
    expect(peakLongRunMin(g, 330, state({ typicalWeekMin: 400 }))).toBe(88)
  })

  it('plans the long runs of a 5 km goal up to that cap and not beyond', () => {
    const planned = (typicalWeekMin: number) =>
      longest(workWeeks(plan(goal('5k', 20), state({ typicalWeekMin }))))
    expect([planned(120), planned(240), planned(400)]).toEqual([60, 75, 90])
  })

  it('caps a fast runner at the minutes that 16 km take', () => {
    // 270 s/km over the last four weeks: 16 km take 72 min, under the 90 min of the top tier
    const fast = state({ typicalWeekMin: 400, weeks: weekRows(180, 40_000) })
    expect(peakLongRunMin(goal('5k', 20), 270, fast)).toBe(72)
    expect(peakLongRunMin(goal('10k', 20), 270, fast)).toBe(72)
    expect(longest(workWeeks(plan(goal('5k', 20), fast)))).toBe(72)
    // a slower runner keeps the tier: 16 km at 360 s/km take 96 min
    expect(peakLongRunMin(goal('5k', 20), 360, fast)).toBe(90)
  })

  it('takes the tier from the completed typical week, not from the planned weeks', () => {
    // heavy weeks in the history rows or a high planned target do not lift the tier
    const heavy = weekRows(500, 90_000)
    const middle = state({ typicalWeekMin: 300, weeks: heavy })
    expect(peakLongRunMin(goal('5k', 20), 345, middle)).toBe(75)
    const weeks = plan(goal('5k', 30), state({ typicalWeekMin: 300 }))
    expect(longest(weeks)).toBe(75)
    expect(Math.max(...weeks.map((w) => w.targetRunMin))).toBeLessThanOrEqual(360)
  })

  it('leaves the other distance classes alone', () => {
    const st = state({ typicalWeekMin: 400 })
    expect(peakLongRunMin(goal('half', 20, { goalType: 'finish' }), 345, st)).toBe(
      P.peakLongRunMin.half.value,
    )
    expect(peakLongRunMin(goal('marathon', 20, { goalType: 'finish' }), 345, st)).toBe(
      P.peakLongRunMin.marathon.value,
    )
  })

  it('measures the 16 km at the pace the long run is carried at, not the training pace', () => {
    const st = state({ typicalWeekMin: 400 })
    // logged runs at 390 s/km: 16 km take 104 min, above the 100 min of the top 10 km tier
    expect(peakLongRunMin(goal('10k', 20), 390, st)).toBe(100)
    // a long run carried at 300 s/km covers 16 km in 80 min
    expect(peakLongRunMin(goal('10k', 20), 390, st, 300)).toBe(80)
    expect(peakLongRunMin(goal('5k', 20), 390, st, 300)).toBe(80)
    // a slower carried pace leaves the tier alone: 16 km at 420 s/km take 112 min
    expect(peakLongRunMin(goal('10k', 20), 300, st, 420)).toBe(100)
    // the D3 floors of a half or a marathon time goal are read at the training pace
    const half = goal('half', 20)
    expect(peakLongRunMin(half, 330, st, 270)).toBe(peakLongRunMin(half, 330, st))
  })

  describe('a fast threshold pace with slower logged runs', () => {
    // threshold 240 s/km puts zone 1 near 300 s/km; the logged weeks run at 390 s/km
    const fast: AthleteProfile = { ...PROFILE, thresholdPaceSecPerKm: 240 }
    const history = () => state({ typicalWeekMin: 400, weeks: weekRows(180, 27_700) })
    const withZones = (g: GoalModel): EngineInput => ({ ...input(g), profile: fast })

    it.each(['5k', '10k'] as const)('keeps the long runs of a %s goal within 16 km', (cls) => {
      const g = goal(cls, 24)
      const st = history()
      const weeks = macroPlan(withZones(g), st, g, FEASIBLE)
      const z1 = buildZones(fast, st, TODAY).pace!.z1
      const carried = (z1[0] + z1[1]) / 2
      expect(carried).toBeLessThan(330)
      const withLong = weeks.filter((w) => w.longRunM !== null)
      expect(withLong.length).toBeGreaterThan(10)
      for (const w of withLong) {
        expect(w.longRunM!).toBeLessThanOrEqual(P.macroDesign.peakLongRunKmMax.value * 1000)
        // at the carried pace the minutes of the week are at most 16 km
        expect((w.longRunMin * 60) / carried).toBeLessThanOrEqual(
          P.macroDesign.peakLongRunKmMax.value + 1e-9,
        )
      }
      // the cap binds: the longest run is the minutes of 16 km at the carried pace
      expect(longest(weeks)).toBe(Math.floor((16 * carried) / 60 + 1e-9))
      // the training pace would have given a longer run, and a distance over 16 km
      expect(Math.floor((16 * 390) / 60)).toBeGreaterThan(longest(weeks))
    })

    it.each(['5k', '10k'] as const)(
      'places no long or fast-finish session of a %s plan beyond 16 km, the first part week included',
      (cls) => {
        const g = goal(cls, 24)
        const draft = buildPlan({ ...withZones(g), activities: [] })
        const long = draft.sessions.filter(
          (x) => x.kind === 'long' || x.kind === 'long-fast-finish',
        )
        expect(long.length).toBeGreaterThan(10)
        for (const x of long) {
          expect(x.distanceM).not.toBeNull()
          expect(x.distanceM!).toBeLessThanOrEqual(P.macroDesign.peakLongRunKmMax.value * 1000)
        }
      },
    )

    it('does not change a runner whose zone 1 is the training pace', () => {
      const g = goal('10k', 24)
      const st = history()
      const slowZones = macroPlan({ ...input(g), profile: PROFILE }, st, g, FEASIBLE)
      // no pace zones: 16 km at 390 s/km take 104 min, so the 100 min tier binds
      expect(longest(slowZones)).toBe(100)
    })
  })
})

describe('macroPlan: time distribution by intensity', () => {
  it.each(['5k', 'half', 'marathon', 'ultra50', 'ultra100mi'] as const)(
    'keeps Z1 at 70 or more, Z2 under Z1 and the total at 100 for %s',
    (cls) => {
      for (const w of plan(goal(cls, 26))) {
        expect(w.tid.z1 + w.tid.z2 + w.tid.z3).toBe(100)
        expect(w.tid.z1).toBeGreaterThanOrEqual(P.e4.z1Floor.value)
        expect(w.tid.z2).toBeLessThanOrEqual(w.tid.z1)
        expect(w.tid.z2 + w.tid.z3).toBeLessThanOrEqual(P.f2.z2z3ShareMax.value)
      }
    },
  )

  it('uses the base table: Z1 80+, Z2 up to 12, Z3 about 5', () => {
    const base = plan(goal('half', 26)).find((w) => w.phase === 'base')
    expect(base?.tid.z1).toBeGreaterThanOrEqual(P.e4.z1Prior.value)
    expect(base?.tid.z2).toBeLessThanOrEqual(P.e4.z2CapBase.value)
    expect(base?.tid.z3).toBe(P.e4.baseZ3Share.value)
  })

  it('uses 80/12/8 in the build phase for a 10 km goal', () => {
    const build = plan(goal('10k', 26)).find((w) => w.phase === 'build')
    expect(build?.tid).toEqual({
      z1: P.e4.z1Prior.value,
      z2: P.e4.z2Prior.value,
      z3: P.e4.z3Prior.value,
    })
  })

  it('moves race pace into Z2 for the half-marathon specific phase, within the Z2 cap', () => {
    const specific = plan(goal('half', 26)).find((w) => w.phase === 'specific')
    expect(specific?.tid.z2).toBeGreaterThan(P.e4.z2Prior.value)
    expect(specific?.tid.z2).toBeLessThanOrEqual(P.e4.specificHalfMarathonZ2Max.value)
  })

  it('keeps Z1 at 85+ and Z3 at 5 or less for every ultra phase', () => {
    for (const w of plan(goal('ultra100k', 30))) {
      expect(w.tid.z1).toBeGreaterThanOrEqual(P.e4.ultraZ1Min.value)
      expect(w.tid.z3).toBeLessThanOrEqual(P.e4.ultraZ3Max.value)
    }
  })

  it('offers a polarized specific phase for 10 km only when asked', () => {
    const asked = plan(goal('10k', 26), state(), { tidModel: 'polarized' })
    const spec = asked.find((w) => w.phase === 'specific')
    expect(spec?.tid.z2).toBe(P.macroDesign.polarizedZ2Share.value)
    expect(spec?.tid.z3).toBeGreaterThan(spec?.tid.z2 ?? 0)
    expect(spec?.tid.z1).toBeGreaterThanOrEqual(P.e4.z1Floor.value)
    const pyramidal = plan(goal('10k', 26)).find((w) => w.phase === 'specific')
    expect(pyramidal?.tid.z2).toBe(P.e4.z2Prior.value)
    const marathon = plan(goal('marathon', 26), state(), { tidModel: 'polarized' }).find(
      (w) => w.phase === 'specific',
    )
    expect(marathon?.tid.z2).not.toBe(P.macroDesign.polarizedZ2Share.value)
  })
})

describe('macroPlan: run days and quality', () => {
  it('gives a novice three run days and at most one quality session', () => {
    const weeks = plan(goal('10k', 20), state({ experience: 'novice', typicalWeekMin: 90 }))
    for (const w of preTaper(weeks)) {
      expect(w.runDays).toBe(P.f5.noviceRunDays.value)
      expect(w.qualitySessions).toBeLessThanOrEqual(1)
    }
  })

  it('never plans more than six run days nor more than two quality sessions', () => {
    for (const w of plan(goal('marathon', 30), state({ typicalWeekMin: 600 }))) {
      expect(w.runDays).toBeLessThanOrEqual(P.f5.mastersMaxRunDays.value)
      expect(w.qualitySessions).toBeLessThanOrEqual(P.f2.qualitySessionsPerWeek.value)
    }
  })

  it('puts volume before pace work for goals of 100 km or more, not for 50 km', () => {
    for (const w of plan(goal('ultra100k', 30))) expect(w.qualitySessions).toBeLessThanOrEqual(1)
    const ultra50 = plan(goal('ultra50', 30), state({ typicalWeekMin: 400 }))
    expect(ultra50.some((w) => w.qualitySessions === 2)).toBe(true)
  })

  it('caps the long run at the lesser of 6 h and 60% of the race duration for ultras', () => {
    const hundred = plan(goal('ultra100mi', 40), state({ typicalWeekMin: 500 }))
    expect(Math.max(...hundred.map((w) => w.longRunMin))).toBeLessThanOrEqual(
      P.h2.longestRunCapHours.value * 60,
    )
    const fifty = goal('ultra50', 30, { expectedDurationSec: 5 * 3600 })
    const cap = Math.min(
      P.h2.longestRunCapHours.value * 60,
      P.h2.longestRunCapRaceFraction.value * 300,
    )
    const long = Math.max(...plan(fifty, state({ typicalWeekMin: 600 })).map((w) => w.longRunMin))
    expect(long).toBeLessThanOrEqual(cap)
    expect(long).toBe(cap)
  })

  it('keeps the long run inside the week', () => {
    for (const w of plan(goal('marathon', 30), state({ typicalWeekMin: 300 }))) {
      expect(w.longRunMin).toBeLessThanOrEqual(w.targetRunMin)
    }
  })
})

describe('macroPlan: fixed blocks', () => {
  it('runs a 12-week heavy strength block in base and early build, then one maintenance session', () => {
    const weeks = plan(goal('marathon', 36))
    const block = weeks.filter((w) => w.flags.includes('strength-block'))
    expect(block).toHaveLength(P.e5.strengthBlockWeeks.value)
    expect(block.map((w) => w.index)).toEqual(block.map((_, i) => i))
    expect(block.every((w) => w.strengthSessions === P.flib.strengthPerWeek.value)).toBe(true)
    const after = weeks.filter(
      (w) => !w.flags.includes('strength-block') && w.phase !== 'race' && !w.isTaper,
    )
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((w) => w.strengthSessions === P.e5.strengthMaintenancePerWeek.value)).toBe(
      true,
    )
  })

  it('skips the heavy block when base and build are shorter than the minimum', () => {
    const weeks = plan(goal('marathon', 14))
    expect(weeks.some((w) => w.flags.includes('strength-block'))).toBe(false)
    expect(Math.max(...weeks.map((w) => w.strengthSessions))).toBeLessThanOrEqual(
      P.e5.strengthMaintenancePerWeek.value,
    )
  })

  it('honours the strength option', () => {
    expect(
      plan(goal('marathon', 36), state(), { strengthSessions: 0 }).every(
        (w) => w.strengthSessions === 0,
      ),
    ).toBe(true)
    const one = plan(goal('marathon', 36), state(), { strengthSessions: 1 })
    expect(Math.max(...one.map((w) => w.strengthSessions))).toBe(1)
  })

  it('places a heat block before race week when the race WBGT is 18 C or higher', () => {
    const hot = plan(goal('marathon', 24, { raceWbgtC: P.i8.triggerWbgtC.value }))
    const flagged = hot.filter((w) => w.flags.includes('heat-acclimation'))
    expect(flagged).toHaveLength(Math.ceil(P.i8.blockDays.value / 7))
    const race = hot.find((w) => w.phase === 'race')
    expect(Math.max(...flagged.map((w) => w.index))).toBe((race?.index ?? 0) - 1)
    const cool = plan(goal('marathon', 24, { raceWbgtC: P.i8.triggerWbgtC.value - 0.5 }))
    expect(cool.some((w) => w.flags.includes('heat-acclimation'))).toBe(false)
    expect(plan(goal('marathon', 24)).some((w) => w.flags.includes('heat-acclimation'))).toBe(false)
  })

  it('places gut training in the specific phase and ends it before the taper', () => {
    const gut = plan(goal('ultra100k', 30)).filter((w) => w.flags.includes('gut-training'))
    expect(gut).toHaveLength(P.h7.gutTrainingWeeks.value)
    expect(gut.every((w) => w.phase === 'specific')).toBe(true)
    expect(plan(goal('10k', 30)).some((w) => w.flags.includes('gut-training'))).toBe(false)
  })

  it('flags headlamp rehearsal weeks only for races that cross darkness', () => {
    const night = plan(goal('ultra100k', 30, { crossesDarkness: true }))
    const flagged = night.filter((w) => w.flags.includes('night'))
    expect(flagged.length).toBeGreaterThanOrEqual(1)
    expect(flagged.length).toBeLessThanOrEqual(P.h6.headlampRehearsalRuns.value[1])
    expect(flagged.every((w) => w.phase === 'specific')).toBe(true)
    expect(plan(goal('ultra100k', 30)).some((w) => w.flags.includes('night'))).toBe(false)
  })

  it('starts downhill conditioning 8 weeks before a race with descent, outside the taper', () => {
    const hilly = plan(goal('ultra50', 30, { gainM: 2000, lossM: 2000 }))
    const down = hilly.filter((w) => w.flags.includes('downhill'))
    const race = hilly.find((w) => w.phase === 'race')
    expect(Math.min(...down.map((w) => w.index))).toBe(
      (race?.index ?? 0) - P.h5.downhillStartWeeksBeforeRace.value,
    )
    expect(down.every((w) => !w.isTaper)).toBe(true)
    expect(plan(goal('ultra50', 30)).some((w) => w.flags.includes('downhill'))).toBe(false)
  })

  it('schedules back-to-backs only for ultras, outside recovery and taper, two weeks apart', () => {
    const weeks = plan(goal('ultra100mi', 40), state({ typicalWeekMin: 400 }))
    const b2b = weeks.filter((w) => w.flags.includes('b2b'))
    expect(b2b.length).toBeGreaterThan(0)
    for (const w of b2b) {
      expect(w.isTaper || w.isRecovery).toBe(false)
      expect(['build', 'specific']).toContain(w.phase)
    }
    for (let i = 1; i < b2b.length; i++) {
      expect((b2b[i]?.index ?? 0) - (b2b[i - 1]?.index ?? 0)).toBeGreaterThanOrEqual(
        P.h3.b2bMinGapWeeks.value,
      )
    }
    expect(plan(goal('marathon', 40)).some((w) => w.flags.includes('b2b'))).toBe(false)
  })
})

describe('macroPlan: vertical gain and post-race', () => {
  it('leaves the gain target empty for a flat goal', () => {
    expect(plan(goal('marathon', 20)).every((w) => w.gainTargetM === null)).toBe(true)
  })

  it('ramps weekly gain by at most the soft ramp or the minimum step', () => {
    const work = workWeeks(plan(goal('ultra50', 30, { gainM: 2500, lossM: 2500 })))
    for (let i = 1; i < work.length; i++) {
      const prev = work[i - 1]?.gainTargetM ?? 0
      expect(work[i]?.gainTargetM ?? 0).toBeLessThanOrEqual(
        Math.max(
          Math.floor(prev * (1 + P.h4.weeklyGainRamp.value) + 1e-9),
          prev + P.h4.minStepGainM.value,
        ),
      )
    }
    expect(Math.max(...work.map((w) => w.gainTargetM ?? 0))).toBeGreaterThan(0)
  })

  /** A runner under 40 with an earlier race in the class: no modifier lengthens the hold. */
  const SEASONED = (distanceClass: GoalModel['distanceClass'], g: GoalModel): EngineInput => ({
    ...input(g),
    profile: { ...PROFILE, birthYear: 1995 },
    activities: [
      {
        id: 'earlier',
        date: addDays(TODAY, -300),
        type: 'race',
        durationSec: DISTANCES[distanceClass].sec,
        distanceM: DISTANCES[distanceClass].m,
        duplicateOfId: null,
        duplicateStatus: 'none',
      } as unknown as Activity,
    ],
  })

  /** What a post-race week holds by the rule: the step fractions of its days after the hold. */
  function byTheRule(g: GoalModel, weekStart: string, ref: number): number {
    const window = ownWindow(SEASONED(g.distanceClass, g))
    let minutes = 0
    for (let d = 0; d < 7; d++) {
      const day = windowDay(window, addDays(weekStart, d))
      if (day?.kind === 'step') minutes += (day.stage.fraction * ref) / 7
    }
    return Math.floor(minutes + 1e-9)
  }

  it('counts the weeks after a 100 km race in days: rest through the hold, then three steps', () => {
    const g = goal('ultra100k', 26)
    const weeks = macroPlan(SEASONED('ultra100k', g), state(), g, FEASIBLE)
    const post = weeks.filter((w) => w.flags.includes('post-race'))
    const ref = Math.max(...preTaper(weeks).map((w) => w.targetRunMin))
    // a Saturday race: the hold (7 days) ends on the Saturday after, so the first Monday week is
    // all rest bar its last two days, and the steps of 7 days follow (fractions .25, .5, .75)
    expect(P.macroDesign.postRaceLongFractions.value).toEqual([0.25, 0.5, 0.75])
    expect(post).toHaveLength(4)
    expect(post[0]?.targetRunMin).toBe(byTheRule(g, post[0]!.weekStart, ref))
    for (const w of post) {
      expect(w.targetRunMin).toBeLessThanOrEqual(byTheRule(g, w.weekStart, ref))
      expect(w.targetRunMin).toBeLessThan(ref * 0.75)
      expect(w.isRecovery).toBe(true)
      expect(w.qualitySessions).toBe(0)
      expect(w.strengthSessions).toBe(0)
      expect(w.longRunMin).toBeLessThanOrEqual(P.h12.laterStepLongRunMaxMin.value)
      expect(w.tid.z1).toBe(100)
    }
    // the last week holds only the days the window still covers, so it can sit below the one before
    expect(post[2]?.targetRunMin).toBeGreaterThan(post[1]!.targetRunMin)
    // no long run before the third step, and no run of a week above the normal band of G-1 over
    // the longest run of the weeks before it (all within 30 days here): the runs regrow at 1.10x,
    // so the 90 min long run of the third step is reached later than its first week
    expect(post.slice(0, 2).every((w) => w.longRunMin === 0)).toBe(true)
    const longest = (w: WeekDraft) =>
      w.runDays === 0 ? 0 : Math.max(w.longRunMin, Math.ceil(w.targetRunMin / w.runDays))
    for (let i = 2; i < post.length; i++) {
      const before = Math.max(...post.slice(0, i).map(longest))
      expect(longest(post[i]!)).toBeLessThanOrEqual(spikeWarnLimit(before, P.g1.minStepMin.value))
    }
    expect(post[0]?.focus).toMatch(/After the race/)
    expect(post[1]?.runDays).toBeLessThanOrEqual(P.h12.step1MaxRuns.value)
    expect(post[1]?.targetRunMin).toBeGreaterThan(0)
  })

  it('keeps a week inside the hold at zero minutes and zero run days', () => {
    // a marathon on a Sunday: Monday is day 1, inside the 2-day hold
    const g = goal('marathon', 20, { date: addDays(mondayOf(TODAY), 20 * 7 + 6) })
    const weeks = macroPlan(SEASONED('marathon', g), state(), g, FEASIBLE)
    const first = weeks.find((w) => w.flags.includes('post-race'))!
    // day 1 (Monday) is hold, day 2 (Tuesday) is the first run day: the week still holds minutes
    expect(first.weekStart).toBe(addDays(g.date, 1))
    expect(first.targetRunMin).toBeGreaterThan(0)
    const hold = macroPlan(
      SEASONED('ultra100mi', goal('ultra100mi', 26)),
      state(),
      goal('ultra100mi', 26),
      FEASIBLE,
    ).filter((w) => w.flags.includes('post-race'))
    // a 10-day hold from a Saturday race covers the whole first Monday week (days 2 to 8)
    expect(hold[0]?.targetRunMin).toBe(0)
    expect(hold[0]?.runDays).toBe(0)
    expect(hold[0]?.focus).toBe('After the race: rest')
  })

  it('adds one reduced step after a shorter race, 0.5 of the reference over the days it covers', () => {
    const g = goal('half', 20)
    const weeks = macroPlan(SEASONED('half', g), state(), g, FEASIBLE)
    const post = weeks.filter((w) => w.flags.includes('post-race'))
    expect(post).toHaveLength(1)
    const ref = Math.max(...preTaper(weeks).map((w) => w.targetRunMin))
    // a Saturday race with no hold: the 7-day step covers Monday to Friday of the next week
    expect(post[0]?.targetRunMin).toBe(
      Math.min(
        byTheRule(g, post[0]!.weekStart, ref),
        P.h12.step1MaxRuns.value * P.h12.step1RunMaxMin.value,
      ),
    )
    expect(post[0]?.targetRunMin).toBeLessThanOrEqual(
      Math.floor(ref * P.macroDesign.postRaceReducedFraction.value + 1e-9),
    )
  })

  it('uses no word of blame in its focus lines', () => {
    for (const w of plan(goal('marathon', 24))) {
      expect(w.focus).not.toMatch(/behind|missed|streak|\bred\b/i)
    }
  })
})

describe('macroPlan: restart floor and run days', () => {
  const FLOOR = P.restartFloor.sessions.value * P.restartFloor.sessionMin.value
  const recentRun = (minutes: number, daysAgo = 20): Activity =>
    ({
      id: `r-${minutes}-${daysAgo}`,
      date: addDays(TODAY, -daysAgo),
      type: 'run',
      durationSec: minutes * 60,
      duplicateOfId: null,
      duplicateStatus: 'none',
    }) as unknown as Activity
  const floorPlan = (st: AthleteState, activities: Activity[]) => {
    const g = goal('ultra100mi', 30)
    return macroPlan({ ...input(g), activities }, st, g, FEASIBLE)
  }

  it('starts at 3 sessions of the longest recent run, held to 30 min, and grows from it', () => {
    const weeks = floorPlan(state({ typicalWeekMin: 27 }), [recentRun(30)])
    expect(FLOOR).toBe(60)
    // 8 years of running, no flag, a 30-min run 20 days ago: 3 x 30
    expect(weeks[0]!.targetRunMin).toBe(90)
    expect(weeks[0]!.runDays).toBe(P.restartFloor.sessions.value)
    expect(weeks[0]!.longRunMin).toBe(30)
    expect(weeks[0]!.flags).toContain('restart-floor')
    expect(weeks[0]!.flags).not.toContain('run-walk')
    expect(weeks[0]!.qualitySessions).toBe(0)
    expect(weeks[1]!.targetRunMin).toBeLessThanOrEqual(Math.floor(90 * 1.1 + 1e-9))
    expect(weeks.slice(1).some((w) => w.flags.includes('restart-floor'))).toBe(false)
  })

  it('starts at 3 x 20 when the longest recent run is 20 to 24 min, or a flag holds the lift back', () => {
    const twenty = floorPlan(state({ typicalWeekMin: 27 }), [recentRun(24)])
    expect(twenty[0]!.targetRunMin).toBe(FLOOR)
    const flagged = state({
      typicalWeekMin: 27,
      risk: {
        recentInjury: false,
        priorBsi: false,
        bsiFactors: 0,
        redsFlags: 0,
        noviceFlags: ['age-45-plus'],
      },
    })
    expect(floorPlan(flagged, [recentRun(30)])[0]!.targetRunMin).toBe(FLOOR)
    expect(
      floorPlan(state({ typicalWeekMin: 27, yearsRunning: 1 }), [recentRun(30)])[0]!.targetRunMin,
    ).toBe(FLOOR)
  })

  it('enters the ladder below 20 min of running in 90 days, with the run-walk flag', () => {
    const none = floorPlan(state({ typicalWeekMin: 27 }), [recentRun(15), recentRun(30, 120)])
    expect(none[0]!.flags).toEqual(
      expect.arrayContaining(['restart-floor', 'run-walk', 'ladder-4']),
    )
  })

  it('leaves a typical week at or above the floor alone', () => {
    expect(floorPlan(state({ typicalWeekMin: FLOOR }), [recentRun(30)])[0]!.flags).not.toContain(
      'restart-floor',
    )
  })

  it('takes a tightened profile through the start path, but never lifts it above 3 x 20', () => {
    const tight = state({
      typicalWeekMin: 27,
      risk: { recentInjury: false, priorBsi: true, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    })
    // an unflagged runner with the same 30-min run is lifted to 3 x 30 (the test above)
    const weeks = floorPlan(tight, [recentRun(30)])
    expect(weeks[0]!.flags).toContain('restart-floor')
    expect(weeks[0]!.targetRunMin).toBe(FLOOR)
  })

  it('plans at least 4 run days from 3 h, 5 from 5 h and 6 from 7 h of weekly running', () => {
    const weeks = plan(goal('ultra100mi', 40), state({ typicalWeekMin: 100 })).filter(
      (w) => !w.isTaper && !w.flags.includes('post-race') && !w.isRecovery,
    )
    for (const w of weeks) {
      if (w.targetRunMin >= 420) expect(w.runDays).toBeGreaterThanOrEqual(6)
      else if (w.targetRunMin >= 300) expect(w.runDays).toBeGreaterThanOrEqual(5)
      else if (w.targetRunMin >= 180) expect(w.runDays).toBeGreaterThanOrEqual(4)
    }
    expect(Math.max(...weeks.map((w) => w.targetRunMin))).toBeGreaterThanOrEqual(420)
  })

  it('lists each week flag once', () => {
    for (const w of plan(goal('ultra100mi', 40))) {
      expect(new Set(w.flags).size).toBe(w.flags.length)
    }
  })
})

describe('macroPlan: REDs hold', () => {
  const held = (flags: number, over: Partial<AthleteState> = {}) =>
    state({
      risk: {
        recentInjury: false,
        priorBsi: false,
        bsiFactors: 0,
        redsFlags: flags,
        noviceFlags: [],
      },
      ...over,
    })
  const loading = (weeks: WeekDraft[]) =>
    weeks.filter((w) => !w.isRecovery && !w.isTaper && !w.flags.includes('post-race'))

  it('exports the hold as two or more flags (j5.redsHoldFlags)', () => {
    expect(redsHold(held(0))).toBe(false)
    expect(redsHold(held(P.j5.redsHoldFlags.value - 1))).toBe(false)
    expect(redsHold(held(P.j5.redsHoldFlags.value))).toBe(true)
    expect(redsHold(held(5))).toBe(true)
  })

  it('keeps every loading week at the current level: no ramp, no minimum step', () => {
    const open = plan(goal('marathon', 20), held(0))
    expect(Math.max(...loading(open).map((w) => w.targetRunMin))).toBeGreaterThan(240)
    const weeks = plan(goal('marathon', 20), held(2))
    for (const w of loading(weeks)) expect(w.targetRunMin).toBe(240)
    const novice = plan(goal('5k', 14), held(2, { experience: 'novice', typicalWeekMin: 90 }))
    for (const w of loading(novice)) expect(w.targetRunMin).toBe(90)
  })

  it('holds the long run and the weekly gain target too', () => {
    const weeks = loading(plan(goal('ultra50', 24, { gainM: 2000, lossM: 2000 }), held(3)))
    const longs = weeks.map((w) => w.longRunMin)
    expect(Math.max(...longs)).toBeLessThanOrEqual(longs[0]!)
    const gains = weeks.map((w) => w.gainTargetM ?? 0)
    expect(Math.max(...gains)).toBeLessThanOrEqual(gains[0]!)
  })

  it('adds no back-to-back weekend and no restart-floor lift', () => {
    const g = goal('ultra100mi', 40)
    expect(plan(g, held(0)).some((w) => w.flags.includes('b2b'))).toBe(true)
    expect(plan(g, held(2)).some((w) => w.flags.includes('b2b'))).toBe(false)
    const floor = plan(goal('half', 20), held(2, { typicalWeekMin: 27 }))
    expect(floor[0]!.targetRunMin).toBe(27)
    expect(floor[0]!.flags).not.toContain('restart-floor')
  })

  it('still cuts recovery weeks and tapers, and one flag changes nothing', () => {
    const weeks = plan(goal('marathon', 20), held(2))
    expect(weeks.some((w) => w.isRecovery)).toBe(true)
    const taper = taperWeeks(weeks)
    expect(taper.length).toBeGreaterThan(0)
    expect(taper[0]!.targetRunMin).toBeLessThan(240)
    expect(plan(goal('marathon', 20), held(1))).toEqual(plan(goal('marathon', 20), held(0)))
  })
})

describe('buildPlan: the long runs of a 5 km or 10 km goal stay within 16 km [rules D7]', () => {
  const MONDAY = '2026-10-19'
  const record = (distanceM: number, targetDate: string): Goal => ({
    id: 'goal-1',
    userId: 'u1',
    name: 'Synthetic race',
    priority: 'A',
    status: 'target',
    targetDate,
    dateProvisional: false,
    distanceM,
    location: null,
    successCriteria: null,
    notes: null,
    url: null,
    isActive: true,
    gainM: null,
    lossM: null,
    surface: 'road',
    goalType: 'finish',
    targetTimeSec: null,
    startTime: null,
    raceLat: null,
    raceLng: null,
    supportLevel: 'aided',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
  })
  const WEEK_RUNS: Array<[number, number]> = [
    [1, 60],
    [3, 80],
    [4, 80],
    [5, 60],
    [6, 140],
  ]
  /** Four weeks of 60, 80, 80, 60 and 140 minutes at `pace` s/km, ending before this week. */
  const runner = (distanceM: number, threshold: number, pace: number): EngineInput => {
    const activities: Activity[] = []
    for (let week = 1; week <= 4; week++) {
      for (const [dayOffset, min] of WEEK_RUNS) {
        const date = addDays(MONDAY, -7 * week + dayOffset)
        activities.push(
          activity(date, {
            id: `run-${date}`,
            durationSec: min * 60,
            movingSec: min * 60,
            distanceM: Math.round(((min * 60) / pace) * 1000),
            rpe: 3,
          }),
        )
      }
    }
    activities.sort((a, b) => (a.date < b.date ? -1 : 1))
    const base: EngineInput = {
      ...e8Input(),
      profile: e8Profile({ thresholdPaceSecPerKm: threshold, longRunDay: 'sat' }),
      activities,
    }
    const model = goalModel(record(distanceM, '2027-03-13'), estimateState(base), null)
    return { ...base, goal: model }
  }

  it.each([
    [5000, 240, 330],
    [5000, 240, 390],
    [10_000, 240, 390],
    [10_000, 270, 360],
    [10_000, 270, 480],
    [10_000, 300, 480],
  ])('keeps a plain long run of %i m under 16 km at threshold %i and logged pace %i', (m, t, p) => {
    const input = runner(m, t, p)
    const built = buildPlan(input)
    // the part week the plan opens with is left out: its few run days make the placement raise the
    // long run to its share of the week (micro.ts), above the weekly long run the macrocycle sets
    const longs = built.sessions.filter(
      (s) => s.kind === 'long' && mondayOf(s.date) > mondayOf(input.today),
    )
    expect(longs.length).toBeGreaterThan(5)
    for (const s of longs) {
      expect(s.distanceM).not.toBeNull()
      expect(s.distanceM!).toBeLessThanOrEqual(P.macroDesign.peakLongRunKmMax.value * 1000)
    }
    // the weekly long-run distance is within the cap too
    for (const w of built.weeks) {
      expect(w.longRunM ?? 0).toBeLessThanOrEqual(P.macroDesign.peakLongRunKmMax.value * 1000)
    }
  })
})
