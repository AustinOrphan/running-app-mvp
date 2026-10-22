import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { macroPlan } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  AthleteState,
  EngineInput,
  Feasibility,
  GoalModel,
  WeekDraft,
} from '../../../shared/engine/types.ts'
import type { Activity, AthleteProfile } from '../../../shared/types.ts'

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
    const last = weeks[weeks.length - 1]
    expect(last?.flags).toContain('post-race')
    expect(daysBetween(raceWeek?.weekStart ?? '', last?.weekStart ?? '')).toBe(7)
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
    const work = workWeeks(
      plan(goal('10k', 20), state({ experience: 'novice', typicalWeekMin: 10 })),
    )
    expect(at(work, 1)).toBeGreaterThanOrEqual(at(work, 0) + P.g2.noviceMinStepMin.value)
  })

  it('holds a runner already above the peak table at the current volume', () => {
    const work = workWeeks(plan(goal('5k', 20), state({ typicalWeekMin: 400 })))
    expect(work.every((w) => w.targetRunMin === 400)).toBe(true)
  })

  it('starts from the floor when there is no recent running', () => {
    const work = workWeeks(plan(goal('half', 20), state({ typicalWeekMin: 0 })))
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

  it('adds a rest week then a reduced week after a race of 100 km or more', () => {
    const post = plan(goal('ultra100k', 26)).filter((w) => w.flags.includes('post-race'))
    expect(post).toHaveLength(2)
    expect(post[0]?.targetRunMin).toBe(0)
    expect(post[0]?.runDays).toBe(0)
    expect(post[1]?.targetRunMin).toBeGreaterThan(0)
    expect(post[1]?.isRecovery).toBe(true)
  })

  it('adds one reduced week after a shorter race', () => {
    const weeks = plan(goal('half', 20))
    const post = weeks.filter((w) => w.flags.includes('post-race'))
    expect(post).toHaveLength(1)
    const ref = Math.max(...preTaper(weeks).map((w) => w.targetRunMin))
    expect(post[0]?.targetRunMin).toBe(
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

  it('starts at 3 sessions of 20 min when the typical week is below that, and grows from it', () => {
    const weeks = floorPlan(state({ typicalWeekMin: 27 }), [recentRun(30)])
    expect(FLOOR).toBe(60)
    expect(weeks[0]!.targetRunMin).toBe(FLOOR)
    expect(weeks[0]!.runDays).toBe(P.restartFloor.sessions.value)
    expect(weeks[0]!.flags).toContain('restart-floor')
    expect(weeks[0]!.flags).not.toContain('run-walk')
    expect(weeks[1]!.targetRunMin).toBeLessThanOrEqual(Math.floor(FLOOR * 1.1 + 1e-9))
    expect(weeks.slice(1).some((w) => w.flags.includes('restart-floor'))).toBe(false)
  })

  it('makes the floor sessions run-walk when no run of 20 min was completed in 90 days', () => {
    const none = floorPlan(state({ typicalWeekMin: 27 }), [recentRun(15), recentRun(30, 120)])
    expect(none[0]!.flags).toEqual(expect.arrayContaining(['restart-floor', 'run-walk']))
  })

  it('leaves a typical week at or above the floor, no recent running, and tightened profiles alone', () => {
    expect(floorPlan(state({ typicalWeekMin: FLOOR }), [recentRun(30)])[0]!.flags).not.toContain(
      'restart-floor',
    )
    expect(floorPlan(state({ typicalWeekMin: 0 }), [])[0]!.targetRunMin).toBe(
      P.macroDesign.startFloorWeekMin.value,
    )
    const tight = state({
      typicalWeekMin: 27,
      risk: { recentInjury: false, priorBsi: true, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    })
    const weeks = floorPlan(tight, [recentRun(30)])
    expect(weeks[0]!.flags).not.toContain('restart-floor')
    expect(weeks[0]!.targetRunMin).toBe(27)
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
