import { describe, expect, it } from 'vitest'
import { P } from '../../../shared/engine/params/index.ts'
import { prescribe, sessionLibrary } from '../../../shared/engine/sessions.ts'
import type {
  Boundary,
  SessionKind,
  SessionSpec,
  WeekDraft,
  ZoneSet,
} from '../../../shared/engine/types.ts'

const KINDS: SessionKind[] = [
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'hike',
  'b2b',
  'strength',
  'mobility',
  'rest',
  'race',
  'cross',
]

const boundary = (value: number): Boundary => ({
  value,
  band: [value, value],
  source: 'cs',
  asOf: '2026-01-05',
})

const CS = 3.5 // m/s, about 4:46 per km

function zones(over: Partial<ZoneSet> = {}): ZoneSet {
  return {
    hrMax: null,
    hrRest: null,
    lt1Hr: null,
    lt2Hr: null,
    csMps: boundary(CS),
    lt1PaceSecPerKm: null,
    thresholdPaceSecPerKm: null,
    hr: { z1: [120, 140], z2: [140, 155], z3: [155, 170] },
    pace: { z1: [390, 340], z2: [340, 310], z3: [310, 285] },
    rpe: { z1: [2, 3], z2: [4, 5], z3: [6, 8] },
    ...over,
  }
}

function week(over: Partial<WeekDraft> = {}): WeekDraft {
  return {
    weekStart: '2026-01-05',
    index: 0,
    phase: 'build',
    focus: 'Build',
    targetRunMin: 300,
    longRunMin: 100,
    longRunM: null,
    gainTargetM: null,
    runDays: 5,
    qualitySessions: 2,
    strengthSessions: 2,
    tid: { z1: 80, z2: 12, z3: 8 },
    flags: [],
    isRecovery: false,
    isTaper: false,
    ...over,
  }
}

const kmh = (mps: number) => mps * 3.6
const paceOf = (mps: number) => 1000 / mps
const totalSec = (s: SessionSpec) =>
  s.structure.reduce((sum, step) => sum + (step.durationSec ?? 0) * step.reps, 0)
const text = (s: SessionSpec) => `${s.title} ${s.purpose}`

describe('sessionLibrary', () => {
  it.each(KINDS)('describes %s with its expected RPE and a purpose', (kind) => {
    const t = sessionLibrary(kind)
    expect(t.kind).toBe(kind)
    expect(t.rpe).toEqual(P.expectedRpe[kind].value)
    expect(t.purpose.length).toBeGreaterThan(10)
    expect(t.purpose).not.toMatch(/behind|missed|streak/i)
  })

  it('maps kinds to zones', () => {
    expect(sessionLibrary('easy').zone).toBe('z1')
    expect(sessionLibrary('recovery').zone).toBe('z1')
    expect(sessionLibrary('long').zone).toBe('z1')
    expect(sessionLibrary('threshold').zone).toBe('z2')
    expect(sessionLibrary('intervals').zone).toBe('z3')
    expect(sessionLibrary('race-pace').zone).toBe('race-pace')
    expect(sessionLibrary('strides').zone).toBe('strides')
    expect(sessionLibrary('strength').zone).toBe('strength')
    expect(sessionLibrary('rest').zone).toBe('rest')
  })

  it('cites the rules that justify each session', () => {
    expect(sessionLibrary('threshold').rules).toContain('C5')
    expect(sessionLibrary('intervals').rules).toContain('C6')
    expect(sessionLibrary('b2b').rules).toContain('H3')
    expect(sessionLibrary('strength').rules).toContain('F4')
    for (const kind of KINDS.filter((k) => k !== 'rest')) {
      expect(sessionLibrary(kind).rules.length, kind).toBeGreaterThan(0)
    }
  })
})

describe('prescribe: steady runs', () => {
  it('leaves an easy run undated with an empty structure and Z1 targets', () => {
    const s = prescribe('easy', 60, zones(), week())
    expect(s.date).toBe('')
    expect(s.order).toBe(0)
    expect(s.kind).toBe('easy')
    expect(s.durationMin).toBe(60)
    expect(s.structure).toEqual([])
    expect(s.target.zone).toBe('z1')
    expect(s.target.hr).toEqual([120, 140])
    expect(s.target.paceSecPerKm).toEqual([390, 340])
    expect(s.target.rpe).toEqual(P.expectedRpe.easy.value)
    expect(s.target.heatNote).toBeNull()
    expect(s.distanceM).toBe(9900) // 60 min at the 365 s/km midpoint, to 100 m
    expect(s.gainM).toBeNull()
    expect(s.purpose.length).toBeGreaterThan(0)
    expect(s.rules).toContain('F-lib')
  })

  it('has no distance and no pace without a pace zone', () => {
    const s = prescribe('easy', 60, zones({ pace: null, hr: null }), week())
    expect(s.distanceM).toBeNull()
    expect(s.target.paceSecPerKm).toBeNull()
    expect(s.target.hr).toBeNull()
  })

  it('shares the weekly gain target by minutes for run sessions', () => {
    const w = week({ gainTargetM: 900, targetRunMin: 300 })
    expect(prescribe('long', 100, zones(), w).gainM).toBe(300)
    expect(prescribe('easy', 60, zones(), w).gainM).toBe(180)
    expect(prescribe('strength', 45, zones(), w).gainM).toBeNull()
    expect(prescribe('race', 100, zones(), w).gainM).toBeNull()
  })

  it('marks a long run for fuel practice, night and downhill from the week flags', () => {
    const plain = prescribe('long', 120, zones(), week())
    expect(plain.flags).toEqual([])
    const flagged = prescribe(
      'long',
      120,
      zones(),
      week({ flags: ['gut-training', 'night', 'downhill'] }),
    )
    expect(flagged.flags).toEqual(expect.arrayContaining(['fuel-practice', 'night', 'downhill']))
    expect(flagged.rules).toEqual(expect.arrayContaining(['H7', 'H6', 'H5']))
  })

  it('flags an easy run in a heat acclimation week and explains it', () => {
    const s = prescribe('easy', 45, zones(), week({ flags: ['heat-acclimation'] }))
    expect(s.flags).toContain('heat')
    expect(s.target.heatNote).toMatch(/heat/i)
    expect(s.rules).toContain('I8')
  })

  it('leaves the back-to-back day flags to the placement step', () => {
    const s = prescribe('b2b', 150, zones(), week({ flags: ['b2b'] }))
    expect(s.flags).not.toContain('b2b-day1')
    expect(s.flags).not.toContain('b2b-day2')
    expect(s.title).not.toMatch(/day one/i)
    expect(s.rules).toContain('H3')
  })

  it('prescribes a hike by effort without a pace', () => {
    const s = prescribe('hike', 90, zones(), week())
    expect(s.target.paceSecPerKm).toBeNull()
    expect(s.target.rpe).toEqual(P.expectedRpe.hike.value)
    expect(s.rules).toContain('H4')
  })

  it('builds a run-walk structure for novices', () => {
    const s = prescribe('easy', 30, zones(), week(), { runWalk: true })
    expect(s.flags).toContain('run-walk')
    const run = P.flib.runWalkRunUnits.value
    const walk = P.flib.runWalkWalkUnits.value
    const work = s.structure.find((x) => x.kind === 'work')
    const rest = s.structure.find((x) => x.kind === 'recover')
    expect(work?.durationSec).toBe(run * 60)
    expect(rest?.durationSec).toBe(walk * 60)
    expect(work?.reps).toBe(Math.floor(30 / (run + walk)))
    expect(totalSec(s)).toBeLessThanOrEqual(30 * 60)
  })
})

describe('prescribe: threshold', () => {
  it('keeps the work at least 1.0 km/h under critical speed for athletes who are not well trained', () => {
    const s = prescribe('threshold', 60, zones(), week())
    const [slow, fast] = s.target.paceSecPerKm ?? [0, 0]
    expect(fast).toBeCloseTo(paceOf(CS - P.c5.thresholdMarginOtherKmh.value / 3.6), 6)
    expect(kmh(1000 / fast)).toBeLessThanOrEqual(
      kmh(CS) - P.c5.thresholdMarginOtherKmh.value + 1e-9,
    )
    expect(slow).toBeGreaterThan(fast)
    expect(s.target.zone).toBe('z2')
    expect(s.target.hr).toEqual([140, 155])
    expect(s.structure.filter((x) => x.kind === 'work').every((x) => x.zone === 'z2')).toBe(true)
    expect(s.rules).toContain('C5')
  })

  it('allows 0.5 km/h under critical speed for well-trained athletes in bouts of 30 min or less', () => {
    const s = prescribe('threshold', 60, zones(), week(), { wellTrained: true })
    const fast = s.target.paceSecPerKm?.[1] ?? 0
    expect(fast).toBeCloseTo(paceOf(CS - P.c5.thresholdMarginWellTrainedKmh.value / 3.6), 6)
    for (const step of s.structure.filter((x) => x.kind === 'work')) {
      expect((step.durationSec ?? 0) / 60).toBeLessThanOrEqual(P.c5.wellTrainedBoutMaxMin.value)
    }
  })

  it('wraps the work in a warm-up and cool-down and fills the session', () => {
    const s = prescribe('threshold', 60, zones(), week())
    expect(s.structure[0]).toMatchObject({ kind: 'warmup', zone: 'z1' })
    expect(s.structure.at(-1)).toMatchObject({ kind: 'cooldown', zone: 'z1' })
    expect(totalSec(s)).toBeLessThanOrEqual(60 * 60 + 60)
    expect(totalSec(s)).toBeGreaterThanOrEqual(60 * 60 - 3 * 60 * 2)
  })

  it('splits long work into cruise intervals with recovery between the bouts', () => {
    const s = prescribe('threshold', 90, zones(), week())
    const work = s.structure.filter((x) => x.kind === 'work')
    expect(work.length).toBeGreaterThan(0)
    const bouts = work.reduce((n, x) => n + x.reps, 0)
    expect(bouts).toBeGreaterThanOrEqual(2)
    const recover = s.structure.find((x) => x.kind === 'recover')
    expect(recover?.reps).toBe(bouts - 1)
    expect(recover?.durationSec).toBe(P.sessionDesign.thresholdRecoverMin.value * 60)
  })

  it('caps the pace at the threshold pace without a critical speed', () => {
    const threshold = {
      value: 310,
      band: [295, 326] as [number, number],
      source: 'profile' as const,
      asOf: '2026-01-01',
    }
    const s = prescribe(
      'threshold',
      60,
      zones({ csMps: null, thresholdPaceSecPerKm: threshold }),
      week(),
    )
    const [slow, fast] = s.target.paceSecPerKm ?? [0, 0]
    expect(fast).toBe(310)
    expect(slow).toBeCloseTo(310 * (1 + P.c7.bandDefaultPacePct.value / 100), 6)
  })

  it('falls back to the Z2 band without a critical speed or threshold pace', () => {
    const s = prescribe('threshold', 60, zones({ csMps: null }), week())
    expect(s.target.paceSecPerKm).toEqual([340, 310])
  })

  it('falls back to a plain Z2 run when the session is too short for a structure', () => {
    const s = prescribe('threshold', 15, zones(), week())
    expect(s.durationMin).toBe(15)
    expect(totalSec(s)).toBeLessThanOrEqual(15 * 60)
  })
})

describe('prescribe: intervals', () => {
  const rep = (s: SessionSpec) => s.structure.find((x) => x.kind === 'work')

  it('limits each rep to half the time to exhaustion at that speed', () => {
    const s = prescribe('intervals', 60, zones(), week())
    const v = CS * (1 + P.sessionDesign.intervalSpeedAboveCs.value)
    const tte = P.sessionDesign.intervalDefaultDPrimeM.value / (v - CS)
    expect(rep(s)?.durationSec ?? Infinity).toBeLessThanOrEqual(P.c6.repFractionOfTte.value * tte)
    expect(rep(s)?.durationSec).toBe(P.sessionDesign.intervalRepSec.value)
    expect(s.rules).toContain('C6')
  })

  it('uses the athlete D-prime when given and shortens the rep to fit', () => {
    const s = prescribe('intervals', 60, zones(), week(), { dPrimeM: 60 })
    const v = CS * (1 + P.sessionDesign.intervalSpeedAboveCs.value)
    const tte = 60 / (v - CS)
    expect(rep(s)?.durationSec ?? Infinity).toBeLessThanOrEqual(P.c6.repFractionOfTte.value * tte)
    expect(rep(s)?.durationSec ?? 0).toBeLessThan(P.sessionDesign.intervalRepSec.value)
  })

  it('runs the reps faster than critical speed and pairs each with recovery', () => {
    const s = prescribe('intervals', 60, zones(), week())
    const slow = s.target.paceSecPerKm?.[0] ?? Infinity
    expect(1000 / slow).toBeGreaterThan(CS)
    const work = rep(s)
    const rest = s.structure.find((x) => x.kind === 'recover')
    expect(rest?.reps).toBe(work?.reps)
    expect(rest?.durationSec).toBe(
      Math.round((work?.durationSec ?? 0) * P.sessionDesign.intervalRecoverFraction.value),
    )
    expect(s.target.zone).toBe('z3')
    expect(totalSec(s)).toBeLessThanOrEqual(60 * 60)
  })

  it('stays faster than the CS-equivalent pace without a critical speed', () => {
    const s = prescribe('intervals', 60, zones({ csMps: null }), week())
    const [slow, fast] = s.target.paceSecPerKm ?? [Infinity, Infinity]
    expect(slow).toBeLessThan(285)
    expect(fast).toBeLessThan(slow)
  })
})

describe('prescribe: other quality and special sessions', () => {
  it('prescribes strides as an easy run with the standard number of short sprints', () => {
    const s = prescribe('strides', 40, zones(), week())
    const strides = s.structure.find((x) => x.zone === 'strides')
    expect(strides?.reps).toBe(P.flib.stridesCount.value)
    expect(strides?.durationSec).toBe(P.sessionDesign.stridesWorkSec.value)
    expect(totalSec(s)).toBe(40 * 60)
    expect(s.target.zone).toBe('strides')
  })

  it('finishes a long fast-finish run with the last fifth at race pace', () => {
    const s = prescribe('long-fast-finish', 150, zones(), week({ flags: ['gut-training'] }))
    const last = s.structure.at(-1)
    expect(last?.zone).toBe('race-pace')
    expect(last?.durationSec).toBe(Math.round(150 * 60 * P.flib.fastFinishFraction.value))
    expect(totalSec(s)).toBe(150 * 60)
    expect(s.flags).toContain('fuel-practice')
  })

  it('anchors race-pace work on the goal pace when given, else on Z2', () => {
    const withGoal = prescribe('race-pace', 70, zones(), week(), { goalPaceSecPerKm: 330 })
    const [slow, fast] = withGoal.target.paceSecPerKm ?? [0, 0]
    expect(slow).toBeGreaterThan(330)
    expect(fast).toBeLessThan(330)
    expect(withGoal.target.zone).toBe('race-pace')
    const without = prescribe('race-pace', 70, zones(), week())
    expect(without.target.paceSecPerKm).toEqual([340, 310])
    const bouts = withGoal.structure.filter((x) => x.kind === 'work')
    for (const b of bouts) {
      expect((b.durationSec ?? 0) / 60).toBeLessThanOrEqual(P.sessionDesign.racePaceBoutMin.value)
    }
  })

  it('prescribes hill repeats by effort with a warm-up and cool-down', () => {
    const s = prescribe('hills', 60, zones(), week({ flags: ['downhill'] }))
    const work = s.structure.find((x) => x.kind === 'work')
    expect(work?.durationSec).toBe(P.sessionDesign.hillsRepSec.value)
    expect(work?.reps).toBeGreaterThan(1)
    expect(s.target.paceSecPerKm).toBeNull()
    expect(s.target.rpe).toEqual(P.expectedRpe.hills.value)
    expect(s.flags).toContain('downhill')
  })

  it('describes the heavy strength dose from the parameters', () => {
    const s = prescribe('strength', 45, zones(), week())
    expect(s.target.zone).toBe('strength')
    expect(s.structure).toEqual([])
    expect(s.target.hr).toBeNull()
    expect(s.target.paceSecPerKm).toBeNull()
    expect(s.distanceM).toBeNull()
    expect(s.purpose).toContain(String(P.flib.heavyMinPct1rm.value))
    expect(s.purpose).toContain(String(P.flib.heavySets.value))
    expect(s.rules).toEqual(expect.arrayContaining(['F4', 'E5']))
  })

  it('has zero duration for a rest day and no targets', () => {
    const s = prescribe('rest', 30, zones(), week())
    expect(s.durationMin).toBe(0)
    expect(s.target.zone).toBe('rest')
    expect(s.target.rpe).toEqual([0, 0])
    expect(s.distanceM).toBeNull()
  })

  it('keeps mobility off the run targets', () => {
    const s = prescribe('mobility', 20, zones(), week())
    expect(s.target.zone).toBe('rest')
    expect(s.target.hr).toBeNull()
    expect(s.durationMin).toBe(20)
  })

  it('uses race effort for a race and the goal pace when known', () => {
    const s = prescribe('race', 240, zones(), week(), { goalPaceSecPerKm: 340 })
    expect(s.target.zone).toBe('race-pace')
    expect(s.target.rpe).toEqual(P.expectedRpe.race.value)
    expect(s.durationMin).toBe(240)
  })

  it('writes copy without blame words', () => {
    for (const kind of KINDS) {
      const s = prescribe(kind, 60, zones(), week())
      expect(text(s), kind).not.toMatch(/behind|missed|streak|\bred\b/i)
    }
  })

  it('is deterministic', () => {
    expect(prescribe('intervals', 60, zones(), week())).toEqual(
      prescribe('intervals', 60, zones(), week()),
    )
  })
})
