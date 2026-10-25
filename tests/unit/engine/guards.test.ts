import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { applyGuards, nextWeekCap } from '../../../shared/engine/guards.ts'
import {
  completedReference,
  countsTowardReference,
  referenceAt,
  runCaps,
  twoDayReference,
  weeklyGain,
} from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { SessionSpec } from '../../../shared/engine/types.ts'
import type { Activity, WeekRow } from '../../../shared/types.ts'
import { run, session, state } from './e6-fixtures.ts'

// asOf is Sunday 2026-11-01; the plan starts Monday 2026-11-02.
const LONG_REF = state({
  typicalWeekMin: 0,
  longest30d: { distanceM: 20000, durationSec: 6000, gainM: 400, lossM: 400, twoDaySec: 9000 },
})
const withWeeks = (minutes: number[], over: Parameters<typeof state>[0] = {}) =>
  state({
    ...over,
    weeks: minutes.map((runMin, i): WeekRow => ({
      weekStart: addDays('2026-11-02', -7 * (minutes.length - i)),
      runMin,
      runM: 0,
      runSessions: 4,
      runDays: 4,
      strengthSessions: 0,
      crossMin: 0,
      raceMin: 0,
      longestRunMin: 0,
      longRunShare: null,
      avg4wRunMin: runMin,
      streak3Plus: 0,
    })),
  })

/** One week of easy runs with the given total minutes, spread over four days. */
function planWeek(weekStart: string, total: number): SessionSpec[] {
  const each = Math.round(total / 4)
  return [0, 1, 3, 5].map((d) => session({ date: addDays(weekStart, d), durationMin: each }))
}
const weekMinutes = (sessions: SessionSpec[], weekStart: string) =>
  sessions.filter((s) => mondayOf(s.date) === weekStart).reduce((sum, s) => sum + s.durationMin, 0)

describe('nextWeekCap (rules G-6)', () => {
  it('caps the target at what was actually run, plus the ramp', () => {
    expect(nextWeekCap(300, 200, 0.1)).toBeCloseTo(220)
    expect(nextWeekCap(210, 200, 0.1)).toBe(210)
  })
  it('never makes up volume and never goes below zero', () => {
    expect(nextWeekCap(300, 100, 0.1)).toBeCloseTo(110)
    expect(nextWeekCap(300, 0, 0.1)).toBe(0)
    expect(nextWeekCap(-5, 200, 0.1)).toBe(0)
  })
  it('grows by the step of the rebuild zone below its ceiling, as the plan does [rules g-8]', () => {
    const zone = { ceilingMin: 300, step: 0.12 }
    expect(nextWeekCap(400, 100, 0.1, zone)).toBeCloseTo(112)
    // the zone never plans past R except by the usual step: 290 x 1.12 = 324.8, R = 300, 290 x 1.1 = 319
    expect(nextWeekCap(400, 290, 0.1, zone)).toBeCloseTo(319)
    // from R up the usual ramp applies
    expect(nextWeekCap(400, 300, 0.1, zone)).toBeCloseTo(330)
    // the plan's own figure is still the lesser number, and a zone of null is the plain cap
    expect(nextWeekCap(105, 100, 0.1, zone)).toBe(105)
    expect(nextWeekCap(400, 100, 0.1, null)).toBe(nextWeekCap(400, 100, 0.1))
  })
})

describe('applyGuards: session spike guard (G-1)', () => {
  const only = (s: SessionSpec[]) => applyGuards(s, LONG_REF, [])

  it('leaves a run at or under 1.10x of the 30-day longest alone', () => {
    const result = only([session({ date: '2026-11-03', kind: 'long', durationMin: 110 })])
    expect(result.sessions[0]!.flags).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('warns between 1.10x and 2.00x and names the rule', () => {
    const result = only([session({ date: '2026-11-03', kind: 'long', durationMin: 111 })])
    expect(result.sessions[0]!.flags).toEqual(['spike-warn'])
    expect(result.sessions[0]!.durationMin).toBe(111)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]!.rules).toContain('g-1')
    expect(result.warnings[0]!.severity).toBe('warn')
    const twice = only([session({ date: '2026-11-03', kind: 'long', durationMin: 200 })])
    expect(twice.sessions[0]!.flags).toEqual(['spike-warn'])
  })

  it('never schedules above 2.00x without override-required', () => {
    const result = only([session({ date: '2026-11-03', kind: 'long', durationMin: 210 })])
    expect(result.sessions[0]!.flags).toEqual(['override-required'])
    expect(result.warnings[0]!.severity).toBe('hold')
    expect(result.warnings[0]!.rules).toContain('g-1')
  })

  describe('for a generated plan (neverOverride)', () => {
    const generated = (s: SessionSpec[]) => applyGuards(s, LONG_REF, [], { neverOverride: true })

    it('shortens a run above 1.10x to the normal band instead of flagging it', () => {
      const result = generated([session({ date: '2026-11-03', kind: 'long', durationMin: 210 })])
      expect(result.sessions[0]!.durationMin).toBe(110)
      expect(result.sessions[0]!.flags).toEqual([])
      const warning = result.warnings.find((w) => w.code === 'spike-shortened')!
      expect(warning.rules).toContain('g-1')
    })

    it('shortens distance and gain with the run', () => {
      const result = generated([
        session({
          date: '2026-11-03',
          kind: 'long',
          durationMin: 90,
          distanceM: 50_000,
          gainM: 300,
        }),
      ])
      const s = result.sessions[0]!
      expect(s.distanceM).toBeLessThanOrEqual(22_000)
      expect(s.gainM).toBeLessThanOrEqual(440)
      expect(s.durationMin).toBeLessThan(90)
      expect(s.flags).toEqual([])
    })

    it('shortens a run in the warn band to 1.10x, with no warning flag [rules G6]', () => {
      const result = generated([session({ date: '2026-11-03', kind: 'long', durationMin: 150 })])
      expect(result.sessions[0]!.durationMin).toBe(110)
      expect(result.sessions[0]!.flags).toEqual([])
    })

    it('keeps a step within the 0.5 km and 100 m minimums without a warning or a cut', () => {
      const shortRef = state({
        longest30d: { distanceM: 3000, durationSec: 1800, gainM: 200, lossM: 200, twoDaySec: 0 },
      })
      const one = (over: Partial<SessionSpec>) =>
        applyGuards([session({ date: '2026-11-03', durationMin: 30, ...over })], shortRef, [], {
          neverOverride: true,
        })
      const within = one({ distanceM: 3500, gainM: 300 })
      expect(within.sessions[0]).toMatchObject({ distanceM: 3500, gainM: 300, flags: [] })
      expect(within.warnings).toEqual([])
      const above = one({ distanceM: 3600 })
      expect(above.sessions[0]!.distanceM).toBeLessThanOrEqual(3500)
      expect(above.sessions[0]!.flags).toEqual([])
    })

    it('holds every week of a multi-week plan to the normal band, not only the first', () => {
      let duration = 100
      const sessions = [0, 7, 14, 21, 28, 35].map((offset) => {
        const s = session({
          date: addDays('2026-11-03', offset),
          kind: 'long',
          durationMin: duration,
        })
        duration = Math.round(duration * 1.3)
        return s
      })
      const result = generated(sessions)
      let reference = 100
      for (const s of result.sessions) {
        expect(s.flags).toEqual([])
        expect(s.durationMin).toBeLessThanOrEqual(Math.floor(reference * 1.1 + 1e-9))
        reference = Math.max(reference, s.durationMin)
      }
      expect(result.sessions.length).toBeGreaterThan(1)
    })

    it('leaves a run out when the cut would fall under the session minimum', () => {
      const tiny = state({
        longest30d: { distanceM: 1000, durationSec: 300, gainM: 0, lossM: 0, twoDaySec: 0 },
      })
      const result = applyGuards([session({ date: '2026-11-03', durationMin: 60 })], tiny, [], {
        neverOverride: true,
      })
      expect(result.sessions).toEqual([])
      expect(result.warnings.map((w) => w.code)).toContain('spike-run-dropped')
    })

    it('still flags override-required by default, as an owner edit keeps its own rules', () => {
      const result = only([session({ date: '2026-11-03', kind: 'long', durationMin: 210 })])
      expect(result.sessions[0]!.flags).toEqual(['override-required'])
    })
  })

  it('checks distance, gain and descent as well as duration', () => {
    const base = { date: '2026-11-03', kind: 'long' as const, durationMin: 90 }
    expect(only([session({ ...base, distanceM: 24000 })]).sessions[0]!.flags).toEqual([
      'spike-warn',
    ])
    expect(only([session({ ...base, distanceM: 41000 })]).sessions[0]!.flags).toEqual([
      'override-required',
    ])
    expect(only([session({ ...base, gainM: 600 })]).sessions[0]!.flags).toEqual(['spike-warn'])
    expect(only([session({ ...base, gainM: 900 })]).sessions[0]!.flags).toEqual([
      'override-required',
    ])
  })

  it('applies the minimum steps of 0.5 km and 100 m when the longest run is short', () => {
    const shortRef = state({
      longest30d: { distanceM: 3000, durationSec: 1800, gainM: 200, lossM: 200, twoDaySec: 0 },
    })
    const flags = (over: Partial<SessionSpec>) =>
      applyGuards([session({ date: '2026-11-03', durationMin: 30, ...over })], shortRef, [])
        .sessions[0]!.flags
    expect(flags({ distanceM: 3500 })).toEqual([])
    expect(flags({ distanceM: 3501 })).toEqual(['spike-warn'])
    expect(flags({ gainM: 300 })).toEqual([])
    expect(flags({ gainM: 301 })).toEqual(['spike-warn'])
    expect(P.g1.minStepDistanceM.value).toBe(500)
    expect(P.h4.minStepGainM.value).toBe(100)
    // duration has its own minimum step, so a return built on 5-min runs can rise
    expect(P.g1.minStepMin.value).toBe(3)
    const tinyRef = state({
      longest30d: { distanceM: 800, durationSec: 300, gainM: 0, lossM: 0, twoDaySec: 0 },
    })
    const minutes = (durationMin: number) =>
      applyGuards([session({ date: '2026-11-03', durationMin, distanceM: null })], tinyRef, [])
        .sessions[0]!.flags
    expect(minutes(8)).toEqual([])
    expect(minutes(9)).toEqual(['spike-warn'])
  })

  it('uses the history, within the 30 days before the run, completed runs only', () => {
    const history = [
      run('2026-10-20', 60, { distanceKm: 10, elevationGainM: 100, elevationLossM: 100 }),
      run('2026-09-01', 180, { distanceKm: 30 }),
    ]
    const planned = (durationMin: number, date = '2026-11-03') => [
      session({ date, kind: 'long', durationMin }),
    ]
    const flags = (s: SessionSpec[]) => applyGuards(s, state(), history).sessions[0]!.flags
    expect(flags(planned(66))).toEqual([])
    expect(flags(planned(67))).toEqual(['spike-warn'])
    // by 2026-11-25 the 2026-10-20 run is 36 days back: no reference left, so nothing to compare
    expect(flags(planned(300, '2026-11-25'))).toEqual([])
    const unfinished = [
      run('2026-10-20', 300, { duplicateOfId: 'x', duplicateStatus: 'confirmed' }),
    ]
    expect(applyGuards(planned(300), state(), unfinished).sessions[0]!.flags).toEqual([])
  })

  describe('races in the 30-day reference [rules g-1]', () => {
    const planned = (durationMin: number) => [
      session({ date: '2026-11-03', kind: 'long', durationMin }),
    ]
    const flags = (history: Activity[], durationMin: number) =>
      applyGuards(planned(durationMin), state(), history).sessions[0]!.flags

    it('does not let a 100-mile race 10 days ago raise the reference', () => {
      const history = [
        run('2026-10-10', 60, { distanceKm: 10 }),
        run('2026-10-22', 1800, { type: 'race', distanceKm: 161 }),
      ]
      // 1.10 x 60 min = 66 min; the 30 h race would allow a run of 33 h
      expect(flags(history, 66)).toEqual([])
      expect(flags(history, 67)).toEqual(['spike-warn'])
      expect(flags(history, 3000)).toEqual(['override-required'])
    })

    it('lets a 10 km race raise the reference like any other run', () => {
      const history = [
        run('2026-10-10', 40, { distanceKm: 8 }),
        run('2026-10-22', 50, { type: 'race', distanceKm: 10 }),
      ]
      expect(flags(history, 55)).toEqual([])
      expect(flags(history, 56)).toEqual(['spike-warn'])
    })

    it('draws the line at the marathon distance and counts a race without distance', () => {
      const race = (distanceKm: number | undefined) => [
        run('2026-10-10', 60, { distanceKm: 10 }),
        run('2026-10-22', 240, { type: 'race', distanceKm }),
      ]
      const longest = (history: Activity[]) =>
        referenceAt(completedReference(history, state()).runs, '2026-11-03').min
      expect(P.g1.referenceRaceMaxM.value).toBe(42_195)
      expect(longest(race(42.194))).toBe(240)
      expect(longest(race(42.195))).toBe(60)
      expect(longest(race(50))).toBe(60)
      expect(longest(race(undefined))).toBe(240)
    })

    it('counts a race without a distance only up to 4 h, so a long ultra is no reference run', () => {
      const hours = P.g1.referenceRaceMaxHours.value
      expect(hours).toBe(4)
      expect(P.g1.referenceRaceMaxHours.grade).toBe('D')
      expect(P.g1.referenceRaceMaxHours.note).toMatch(/default/i)
      const race = (durationMin: number) =>
        run('2026-10-22', durationMin, { type: 'race', distanceKm: undefined })
      expect(countsTowardReference(race(60))).toBe(true)
      expect(countsTowardReference(race(240))).toBe(true)
      expect(countsTowardReference(race(241))).toBe(false)
      // a race with a distance is judged by the distance, whatever its duration
      expect(countsTowardReference(run('2026-10-22', 1200, { type: 'race', distanceKm: 10 }))).toBe(
        true,
      )
      // the cap that a 20-hour race logged without a distance would have set: 22 hours
      const history = [run('2026-10-24', 30, { distanceKm: 5 }), race(1200)]
      const caps = runCaps(referenceAt(completedReference(history, state()).runs, '2026-11-03'))
      expect(caps.min).toBe(Math.floor(30 * 1.1 + 1e-9))
      const short = [run('2026-10-24', 30, { distanceKm: 5 }), race(180)]
      expect(runCaps(referenceAt(completedReference(short, state()).runs, '2026-11-03')).min).toBe(
        Math.floor(180 * 1.1 + 1e-9),
      )
    })

    it('keeps a long race out of the largest 2-day total', () => {
      const history = [
        run('2026-10-10', 60, { distanceKm: 10 }),
        run('2026-10-22', 600, { type: 'race', distanceKm: 100 }),
      ]
      const { runs, virtualTwoDay } = completedReference(history, state())
      expect(runs.map((r) => r.min)).toEqual([60])
      expect(twoDayReference(runs, virtualTwoDay, '2026-11-03')).toBe(60)
    })
  })

  describe('duplicates in the reference [rules g-1]', () => {
    const base = run('2026-10-10', 60, { distanceKm: 10, elevationGainM: 100, elevationLossM: 100 })
    // the owner dismissed the duplicate flag: the run stays, with the id of its look-alike
    const dismissed = run('2026-10-24', 150, {
      distanceKm: 25,
      elevationGainM: 400,
      elevationLossM: 400,
      duplicateOfId: 'other',
      duplicateStatus: 'dismissed',
    })
    const flagged = (status: 'possible' | 'confirmed') => ({
      ...dismissed,
      id: `${dismissed.id}-${status}`,
      duplicateStatus: status,
    })
    const longest = (history: Activity[]) =>
      referenceAt(completedReference(history, state()).runs, '2026-11-03')

    it('counts a dismissed duplicate as a run, like the athlete state does', () => {
      expect(longest([base, dismissed])).toMatchObject({ min: 150, distanceM: 25000, gainM: 400 })
      expect(runCaps(longest([base, dismissed])).min).toBe(165)
    })

    it('leaves a possible or a confirmed duplicate out', () => {
      expect(longest([base, flagged('possible')]).min).toBe(60)
      expect(longest([base, flagged('confirmed')]).min).toBe(60)
    })

    it('counts a dismissed duplicate alone, from the history and not from the state maxima', () => {
      const alone = completedReference([dismissed], state())
      expect(alone.runs.map((r) => r.min)).toEqual([150])
      expect(alone.virtualTwoDay).toEqual([])
    })

    it('counts the climbing of a dismissed duplicate in the weekly gain', () => {
      const week = mondayOf('2026-10-24')
      expect(weeklyGain([base, dismissed]).get(week)).toBe(400)
      expect(weeklyGain([base, flagged('confirmed')]).get(week)).toBeUndefined()
      expect(weeklyGain([base, flagged('possible')]).get(week)).toBeUndefined()
    })
  })

  it('compares gain with a flat history, and says so when no run records gain', () => {
    const flat = [run('2026-10-25', 60, { elevationGainM: 0, elevationLossM: 0 })]
    const planned = (gainM: number) => [session({ date: '2026-11-03', durationMin: 50, gainM })]
    expect(applyGuards(planned(80), state(), flat).sessions[0]!.flags).toEqual([])
    const climb = applyGuards(planned(250), state(), flat)
    expect(climb.sessions[0]!.flags).toEqual(['override-required'])
    expect(climb.warnings[0]!.message).toContain('gain 250 m against none')
    const unknown = applyGuards(planned(250), state(), [run('2026-10-25', 60)])
    expect(unknown.sessions[0]!.flags).toEqual([])
    expect(
      unknown.warnings.filter((w) => w.code === 'spike-no-reference').map((w) => w.severity),
    ).toEqual(['info', 'info'])
  })

  it('falls back to the athlete state when the history holds no runs', () => {
    const result = applyGuards([session({ date: '2026-11-03', durationMin: 111 })], LONG_REF, [])
    expect(result.sessions[0]!.flags).toEqual(['spike-warn'])
  })

  it('treats planned runs that come earlier as done, so a 10% progression stays clean', () => {
    let duration = 100
    const sessions = [0, 7, 14, 21, 28, 35].map((offset) => {
      const s = session({
        date: addDays('2026-11-03', offset),
        kind: 'long',
        durationMin: duration,
      })
      duration = Math.floor(duration * 1.1)
      return s
    })
    const result = applyGuards(sessions, LONG_REF, [])
    expect(result.sessions.map((s) => s.flags)).toEqual(sessions.map(() => []))
  })

  it('does not count an override-required run as done for the runs after it', () => {
    const result = applyGuards(
      [
        session({ date: '2026-11-03', kind: 'long', durationMin: 300 }),
        session({ date: '2026-11-10', kind: 'long', durationMin: 300 }),
      ],
      LONG_REF,
      [],
    )
    expect(result.sessions.map((s) => s.flags)).toEqual([
      ['override-required'],
      ['override-required'],
    ])
  })

  it('leaves the past, strength and race sessions alone', () => {
    const result = applyGuards(
      [
        session({ date: '2026-10-30', kind: 'long', durationMin: 400 }),
        session({ date: '2026-11-03', kind: 'strength', durationMin: 400 }),
        session({ date: '2026-11-08', kind: 'race', durationMin: 400 }),
      ],
      LONG_REF,
      [],
    )
    for (const s of result.sessions) expect(s.flags).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('makes 1.10x a hard limit after a recent injury', () => {
    const injured = state({ ...LONG_REF, risk: { ...LONG_REF.risk, recentInjury: true } })
    const result = applyGuards(
      [session({ date: '2026-11-03', kind: 'long', durationMin: 200, distanceM: 30000 })],
      injured,
      [],
    )
    const s = result.sessions[0]!
    expect(s.flags).toEqual([])
    expect(s.durationMin).toBeLessThanOrEqual(110)
    expect(s.distanceM!).toBeLessThanOrEqual(22000)
    expect(result.warnings[0]!.rules).toEqual(expect.arrayContaining(['g-1', 'g-3']))
  })

  it('scales the steps of a clamped session with it', () => {
    const injured = state({ ...LONG_REF, risk: { ...LONG_REF.risk, recentInjury: true } })
    const result = applyGuards(
      [
        session({
          date: '2026-11-03',
          kind: 'long',
          durationMin: 200,
          structure: [{ kind: 'steady', reps: 1, durationSec: 12000, distanceM: null, zone: 'z1' }],
        }),
      ],
      injured,
      [],
    )
    expect(result.sessions[0]!.structure[0]!.durationSec).toBeLessThanOrEqual(6600)
  })

  it('does not mutate its input and gives the same result when run twice', () => {
    const input = [session({ date: '2026-11-03', kind: 'long', durationMin: 150 })]
    const copy = structuredClone(input)
    const once = applyGuards(input, LONG_REF, [])
    expect(input).toEqual(copy)
    const twice = applyGuards(once.sessions, LONG_REF, [])
    expect(twice.sessions).toEqual(once.sessions)
    expect(twice.warnings).toEqual(once.warnings)
  })

  it('returns sessions ordered by date and order', () => {
    const result = applyGuards(
      [
        session({ date: '2026-11-05', durationMin: 30 }),
        session({ date: '2026-11-03', durationMin: 30, order: 1 }),
        session({ date: '2026-11-03', durationMin: 30, order: 0 }),
      ],
      LONG_REF,
      [],
    )
    expect(result.sessions.map((s) => [s.date, s.order])).toEqual([
      ['2026-11-03', 0],
      ['2026-11-03', 1],
      ['2026-11-05', 0],
    ])
  })
})

describe('applyGuards: weekly ramp (G-2, G-3)', () => {
  const weekStarts = [0, 7, 14, 21, 28, 35, 42, 49].map((d) => addDays('2026-11-02', d))

  it('warns above the soft 10% and leaves the plan as written', () => {
    const st = withWeeks([200, 200, 200])
    const sessions = planWeek('2026-11-02', 230)
    const result = applyGuards(sessions, st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBe(weekMinutes(sessions, '2026-11-02'))
    expect(result.warnings.some((w) => w.code === 'ramp-soft' && w.rules.includes('g-2'))).toBe(
      true,
    )
  })

  it('does not warn at 10% or less', () => {
    const result = applyGuards(planWeek('2026-11-02', 220), withWeeks([200, 200, 200]), [])
    expect(result.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
  })

  it('reads the rebuild zone: its step does not warn, a week above it names the zone, the ceiling cuts', () => {
    const st = withWeeks([200, 200, 200])
    const zone = { ceilingMin: 300, step: 0.12 }
    // 224 is +12%: inside the zone, above the usual 10%
    const within = applyGuards(planWeek('2026-11-02', 224), st, [], { rebuild: zone })
    expect(within.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
    const without = applyGuards(planWeek('2026-11-02', 224), st, [])
    expect(without.warnings.some((w) => w.code === 'ramp-soft')).toBe(true)
    // above the zone's step the warning says which step it measured against
    const above = applyGuards(planWeek('2026-11-02', 240), st, [], { rebuild: zone })
    const warning = above.warnings.find((w) => w.code === 'ramp-soft')
    expect(warning?.rules).toEqual(['g-2', 'g-8'])
    expect(warning?.message).toContain('the 12% rebuild step toward 300 min')
    expect(lintText(warning?.message ?? '')).toEqual([])
    // the 2-week ceiling is the same with or without the zone
    const cut = applyGuards(planWeek('2026-11-02', 400), st, [], { rebuild: zone })
    expect(weekMinutes(cut.sessions, '2026-11-02')).toBeLessThanOrEqual(260)
    expect(cut.warnings.some((w) => w.code === 'ramp-ceiling')).toBe(true)
    // from R up the usual 10% applies again
    const atR = withWeeks([300, 300, 300])
    const over = applyGuards(planWeek('2026-11-02', 336), atR, [], { rebuild: zone })
    expect(over.warnings.find((w) => w.code === 'ramp-soft')?.rules).toEqual(['g-2'])
  })

  it('cuts a week above the 2-week ceiling back to it', () => {
    const st = withWeeks([200, 200, 200])
    const result = applyGuards(planWeek('2026-11-02', 400), st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(260)
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeGreaterThan(240)
    const warning = result.warnings.find((w) => w.code === 'ramp-ceiling')
    expect(warning?.severity).toBe('warn')
    expect(warning?.rules).toContain('g-2')
  })

  it('holds the ceiling over every 2-week window of a long, aggressive plan', () => {
    const st = withWeeks([180, 180, 180, 180])
    const sessions = weekStarts.flatMap((w, i) => planWeek(w, 180 * (1 + 0.4 * (i + 1))))
    const result = applyGuards(sessions, st, [])
    const volumes = [180, 180, 180, 180, ...weekStarts.map((w) => weekMinutes(result.sessions, w))]
    for (let i = 6; i < volumes.length; i += 1) {
      const baseline = Math.max(volumes[i - 2]!, volumes[i - 3]!)
      expect(volumes[i]!, `week ${i}`).toBeLessThanOrEqual(baseline * 1.3 + 1)
    }
  })

  it('does not read the week after a recovery week as a jump', () => {
    const st = withWeeks([200, 200, 200])
    const plan = [
      ...planWeek('2026-11-02', 220),
      ...planWeek('2026-11-09', 240),
      ...planWeek('2026-11-16', 180),
      ...planWeek('2026-11-23', 250),
    ]
    const result = applyGuards(plan, st, [])
    expect(weekMinutes(result.sessions, '2026-11-23')).toBe(weekMinutes(plan, '2026-11-23'))
    expect(result.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
  })

  it('caps the ramp at 5% after a prior bone stress injury', () => {
    const st = withWeeks([200, 200, 200], { risk: { ...state().risk, priorBsi: true } })
    const result = applyGuards(planWeek('2026-11-02', 300), st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(200 * 1.05 + 1)
    expect(result.warnings.find((w) => w.code === 'ramp-tightened')?.rules).toContain('g-3')
    expect(P.g3.priorBsiRampMax.value).toBe(0.05)
  })

  it('halves the default ramp with two or more bone stress factors', () => {
    const st = withWeeks([200, 200, 200], { risk: { ...state().risk, bsiFactors: 2 } })
    const result = applyGuards(planWeek('2026-11-02', 300), st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(200 * 1.05 + 1)
  })

  it('caps the ramp at 7% with the recent-injury flag', () => {
    const st = withWeeks([200, 200, 200], { risk: { ...state().risk, recentInjury: true } })
    const result = applyGuards(planWeek('2026-11-02', 300), st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(200 * 1.07 + 1)
  })

  it('uses the lowest cap when profiles combine', () => {
    const st = withWeeks([200, 200, 200], {
      risk: { ...state().risk, recentInjury: true, priorBsi: true },
    })
    const result = applyGuards(planWeek('2026-11-02', 300), st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(200 * 1.05 + 1)
  })

  it('leaves the race out of the weekly running minutes, so race week keeps its runs', () => {
    const st = withWeeks([200, 150, 120])
    const plan = [
      session({ date: '2026-11-03', durationMin: 40 }),
      session({ date: '2026-11-05', durationMin: 30 }),
      session({ date: '2026-11-08', kind: 'race', durationMin: 240 }),
    ]
    const result = applyGuards(plan, st, [])
    expect(result.sessions.map((s) => s.durationMin)).toEqual([40, 30, 240])
    expect(result.warnings.filter((w) => w.code.startsWith('ramp'))).toEqual([])
  })

  it('lets novices grow by at least one minute a week', () => {
    const st = withWeeks([6, 6, 6], { experience: 'novice' })
    const plan = [
      session({ date: '2026-11-02', durationMin: 4 }),
      session({ date: '2026-11-04', durationMin: 3 }),
    ]
    const result = applyGuards(plan, st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBe(7)
    expect(P.g2.noviceMinStepMin.value).toBe(1)
  })

  it('falls back to the typical week when the weeks before are empty, and skips with no reference', () => {
    const typical = applyGuards(planWeek('2026-11-02', 400), state({ typicalWeekMin: 200 }), [])
    expect(weekMinutes(typical.sessions, '2026-11-02')).toBeLessThanOrEqual(260)
    const none = applyGuards(planWeek('2026-11-02', 400), state({ typicalWeekMin: 0 }), [])
    expect(weekMinutes(none.sessions, '2026-11-02')).toBe(400)
  })

  it('only trims sessions from today on, and counts the earlier ones as fixed', () => {
    const st = withWeeks([200, 200, 200], { asOf: '2026-11-04' })
    const plan = [
      session({ date: '2026-11-02', durationMin: 100 }),
      session({ date: '2026-11-03', durationMin: 100 }),
      session({ date: '2026-11-05', durationMin: 100 }),
      session({ date: '2026-11-07', durationMin: 100 }),
    ]
    const result = applyGuards(plan, st, [])
    expect(result.sessions.slice(0, 2).map((s) => s.durationMin)).toEqual([100, 100])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(260)
  })

  it('drops runs that a cut would leave shorter than the minimum', () => {
    const st = withWeeks([20, 20, 20])
    const plan = [
      session({ date: '2026-11-02', durationMin: 20 }),
      session({ date: '2026-11-04', durationMin: 20 }),
      session({ date: '2026-11-06', durationMin: 20 }),
    ]
    const result = applyGuards(plan, st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(26)
    for (const s of result.sessions) {
      expect(s.durationMin).toBeGreaterThanOrEqual(P.fplace.minRunDayMin.value)
    }
  })

  it('warns when the weekly gain grows by more than the soft ramp', () => {
    const history = [run('2026-10-21', 60, { elevationGainM: 500 })]
    const plan = [
      session({ date: '2026-11-03', durationMin: 60, gainM: 700 }),
      session({ date: '2026-11-05', durationMin: 60 }),
    ]
    const result = applyGuards(plan, withWeeks([100, 100, 100]), history)
    expect(result.warnings.some((w) => w.code === 'gain-ramp-soft' && w.rules.includes('H4'))).toBe(
      true,
    )
    expect(result.sessions[0]!.gainM).toBe(700)
  })

  it('does not warn about a weekly gain step within the 100 m minimum', () => {
    const history = [run('2026-10-21', 60, { elevationGainM: 300 })]
    const week = (gainM: number) => [
      session({ date: '2026-11-03', durationMin: 60, gainM }),
      session({ date: '2026-11-05', durationMin: 60 }),
    ]
    const warns = (gainM: number) =>
      applyGuards(week(gainM), withWeeks([100, 100, 100]), history).warnings.some(
        (w) => w.code === 'gain-ramp-soft',
      )
    // 300 m is 10% of 30 m short of the 100 m step: 400 m is the edge
    expect(warns(400)).toBe(false)
    expect(warns(401)).toBe(true)
  })
})

describe('applyGuards: ultra caps (H2, H3)', () => {
  const NO_RAMP = state({ typicalWeekMin: 0 })
  it('caps a single run at the lesser of 6 h and 60% of the race, for ultra goals only', () => {
    const long = session({ date: '2026-11-03', kind: 'long', durationMin: 480 })
    const free = applyGuards([long], NO_RAMP, [])
    expect(free.sessions[0]!.durationMin).toBe(480)
    const six = applyGuards([long], NO_RAMP, [], { ultraRaceDurationSec: 30 * 3600 })
    expect(six.sessions[0]!.durationMin).toBe(360)
    expect(six.warnings.find((w) => w.rules.includes('H2'))).toBeTruthy()
    const share = applyGuards([long], NO_RAMP, [], { ultraRaceDurationSec: 8 * 3600 })
    expect(share.sessions[0]!.durationMin).toBe(288)
  })

  const pair = (d1: number, d2: number, date = '2026-11-07') => [
    session({ date, kind: 'b2b', durationMin: d1, flags: ['b2b-day1'] }),
    session({ date: addDays(date, 1), kind: 'b2b', durationMin: d2, flags: ['b2b-day2'] }),
  ]
  const BIG = state({
    typicalWeekMin: 0,
    longest30d: { distanceM: 40000, durationSec: 20000, gainM: 0, lossM: 0, twoDaySec: 40000 },
  })

  it('keeps day 2 no longer than day 1', () => {
    const result = applyGuards(pair(120, 150), BIG, [])
    expect(result.sessions[1]!.durationMin).toBe(120)
    expect(result.warnings.find((w) => w.rules.includes('H3'))).toBeTruthy()
  })

  it('keeps the pair within 1.10x of the largest 2-day total of the last 30 days', () => {
    const result = applyGuards(pair(500, 500), BIG, [])
    const total = result.sessions.reduce((sum, s) => sum + s.durationMin, 0)
    expect(total).toBeLessThanOrEqual((40000 / 60) * 1.1 + 1)
    expect(result.sessions).toHaveLength(2)
  })

  it('turns a pair that cannot fit into a plain long run', () => {
    const result = applyGuards(pair(730, 300), BIG, [])
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]!.kind).toBe('long')
    expect(result.sessions[0]!.flags).not.toContain('b2b-day1')
  })

  it('allows one pair every 2 weeks only', () => {
    const plan = [
      ...pair(100, 60, '2026-11-07'),
      ...pair(100, 60, '2026-11-14'),
      ...pair(100, 60, '2026-11-21'),
    ]
    const result = applyGuards(plan, BIG, [])
    const days = result.sessions.filter((s) => s.flags.includes('b2b-day1')).map((s) => s.date)
    expect(days).toEqual(['2026-11-07', '2026-11-21'])
    expect(result.sessions.some((s) => s.date === '2026-11-15')).toBe(false)
    expect(result.sessions.find((s) => s.date === '2026-11-14')!.kind).toBe('long')
  })

  it('leaves a compliant pair untouched', () => {
    const input = pair(100, 60)
    const result = applyGuards(input, BIG, [])
    expect(result.sessions).toEqual(input)
    expect(result.warnings).toEqual([])
  })
})

describe('applyGuards: cuts keep the session minimum (G-2)', () => {
  const easy = (date: string, durationMin: number, over: Partial<SessionSpec> = {}) =>
    session({ date, durationMin, ...over })

  it('scales the runs of a cut week down in proportion, never below the session minimum', () => {
    const st = withWeeks([120, 120, 120])
    const plan = [
      easy('2026-11-03', 60),
      easy('2026-11-05', 60),
      easy('2026-11-07', 60),
      easy('2026-11-08', 60),
    ]
    const result = applyGuards(plan, st, [])
    expect(result.sessions).toHaveLength(4)
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(156)
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeGreaterThan(145)
    for (const s of result.sessions) {
      expect(s.durationMin).toBeGreaterThanOrEqual(P.fplace.easyRunMinMin.value)
    }
  })

  it('removes the shortest easy run when the minimums do not fit, and never the long run', () => {
    const st = withWeeks([30, 30, 30])
    const plan = [
      easy('2026-11-03', 25),
      easy('2026-11-05', 30),
      easy('2026-11-07', 24, { kind: 'long' }),
    ]
    const result = applyGuards(plan, st, [])
    expect(result.sessions.some((s) => s.kind === 'long')).toBe(true)
    expect(result.sessions.length).toBeLessThan(3)
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(39 + 1e-6)
    for (const s of result.sessions) {
      expect(s.durationMin).toBeGreaterThanOrEqual(P.fplace.easyRunMinMin.value)
    }
    expect(result.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining(['ramp-ceiling', 'ramp-run-dropped']),
    )
  })

  it('keeps run-walk runs down to the run day minimum', () => {
    const st = withWeeks([30, 30, 30], { experience: 'novice' })
    const plan = [
      easy('2026-11-03', 20, { flags: ['run-walk'] }),
      easy('2026-11-05', 20, { flags: ['run-walk'] }),
      easy('2026-11-07', 20, { flags: ['run-walk'] }),
    ]
    const result = applyGuards(plan, st, [])
    expect(weekMinutes(result.sessions, '2026-11-02')).toBeLessThanOrEqual(40)
    for (const s of result.sessions) {
      expect(s.durationMin).toBeGreaterThanOrEqual(P.fplace.minRunDayMin.value)
    }
  })
})

describe('applyGuards: baselines of the 2-week ceiling', () => {
  it('lets a recovery week hold nothing down: the week after returns to the pre-recovery level', () => {
    const st = withWeeks([200, 200, 200])
    const plan = [
      ...planWeek('2026-11-02', 220),
      ...planWeek('2026-11-09', 240),
      ...planWeek('2026-11-16', 160),
      ...planWeek('2026-11-23', 120),
      ...planWeek('2026-11-30', 260),
    ]
    const low = ['2026-11-16', '2026-11-23']
    const result = applyGuards(plan, st, [], { lowWeeks: low })
    // lag 2 and 3 of 11-30 are 11-16 (recovery) and 11-09 (240): 1.3 x 240 = 312
    expect(weekMinutes(result.sessions, '2026-11-30')).toBe(weekMinutes(plan, '2026-11-30'))
    expect(result.warnings.some((w) => w.code === 'ramp-ceiling')).toBe(false)
  })

  it('moves the window back to the last loading week when every week of it is a recovery or taper week', () => {
    const st = withWeeks([200, 200, 200])
    const plan = [
      ...planWeek('2026-11-02', 220),
      ...planWeek('2026-11-09', 120),
      ...planWeek('2026-11-16', 100),
      ...planWeek('2026-11-23', 80),
      ...planWeek('2026-11-30', 200),
    ]
    const low = ['2026-11-09', '2026-11-16', '2026-11-23']
    const result = applyGuards(plan, st, [], { lowWeeks: low })
    // lag 2 and 3 of 11-30 are 11-16 and 11-09, both low: the window finds 11-02 (220) instead
    expect(weekMinutes(result.sessions, '2026-11-30')).toBe(weekMinutes(plan, '2026-11-30'))
    expect(result.warnings.some((w) => w.code === 'ramp-ceiling')).toBe(false)
    // without the low weeks the same plan is held to the weeks it follows
    const held = applyGuards(plan, st, [])
    expect(weekMinutes(held.sessions, '2026-11-30')).toBeLessThanOrEqual(1.3 * 120 + 1)
  })
})

describe('applyGuards: restart floor', () => {
  const FLOOR = { weekStart: '2026-11-02', minutes: 60 }
  const sparse = () => withWeeks([0, 30, 28], { typicalWeekMin: 27 })
  const floorPlan = () => [
    ...planWeek('2026-11-02', 60),
    ...planWeek('2026-11-09', 66),
    ...planWeek('2026-11-16', 72),
  ]

  it('exempts the floor week from G-2, says so, and holds the weeks after it to the ramp', () => {
    const plan = floorPlan()
    const result = applyGuards(plan, sparse(), [], { startPath: FLOOR })
    expect(weekMinutes(result.sessions, '2026-11-02')).toBe(weekMinutes(plan, '2026-11-02'))
    expect(result.warnings.find((w) => w.code === 'restart-floor')?.severity).toBe('info')
    // the floor week is the ceiling baseline of the week after it
    expect(weekMinutes(result.sessions, '2026-11-09')).toBe(weekMinutes(plan, '2026-11-09'))
    expect(weekMinutes(result.sessions, '2026-11-16')).toBe(weekMinutes(plan, '2026-11-16'))
    expect(result.warnings.some((w) => w.code === 'ramp-ceiling')).toBe(false)
  })

  it('does not exempt the floor week without the option, nor anything above the floor', () => {
    const plain = applyGuards(floorPlan(), sparse(), [])
    expect(weekMinutes(plain.sessions, '2026-11-02')).toBeLessThanOrEqual(39)
    const above = applyGuards(planWeek('2026-11-02', 100), sparse(), [], { startPath: FLOOR })
    expect(weekMinutes(above.sessions, '2026-11-02')).toBeLessThanOrEqual(60)
  })

  it('still applies the session spike guard (G-1) in the floor week', () => {
    const history = [run('2026-10-28', 35)]
    const plan = [session({ date: '2026-11-03', kind: 'long', durationMin: 80 })]
    const result = applyGuards(plan, sparse(), history, {
      startPath: { weekStart: '2026-11-02', minutes: 80 },
    })
    expect(result.sessions[0]!.flags).toContain('override-required')
  })
})

describe('applyGuards: post-race return weeks (H12)', () => {
  const st = () => withWeeks([200, 200, 200])

  it('leaves an exempt week above the ramp as planned, and cuts the same week otherwise', () => {
    const plan = planWeek('2026-11-02', 400)
    const exempt = applyGuards(plan, st(), [], { exemptWeeks: ['2026-11-02'] })
    expect(weekMinutes(exempt.sessions, '2026-11-02')).toBe(weekMinutes(plan, '2026-11-02'))
    expect(exempt.warnings.some((w) => w.code.startsWith('ramp'))).toBe(false)
    const cut = applyGuards(plan, st(), [])
    expect(weekMinutes(cut.sessions, '2026-11-02')).toBeLessThan(weekMinutes(plan, '2026-11-02'))
  })

  it('still applies the session spike guard (G-1) in an exempt week', () => {
    const history = [run('2026-10-28', 35)]
    const plan = [session({ date: '2026-11-03', kind: 'long', durationMin: 80 })]
    const result = applyGuards(plan, st(), history, { exemptWeeks: ['2026-11-02'] })
    expect(result.sessions[0]!.flags).toContain('override-required')
  })
})

describe('applyGuards: ladder weeks [rules E6, g-2]', () => {
  const FIRST = { weekStart: '2026-11-02', minutes: 63, kind: 'ladder' as const }
  const EXEMPT = new Map<string, 'soft'>([
    ['2026-11-09', 'soft'],
    ['2026-11-16', 'soft'],
  ])
  const sparse = () => withWeeks([0, 30, 28], { typicalWeekMin: 27 })
  /** Three run-walk sessions of `each` minutes on Tuesday, Thursday and Saturday. */
  const ladderWeek = (weekStart: string, each: number) =>
    [1, 3, 5].map((d) =>
      session({ date: addDays(weekStart, d), durationMin: each, flags: ['run-walk'] }),
    )
  const plan = (second: number, third: number) => [
    ...ladderWeek('2026-11-02', 21),
    ...ladderWeek('2026-11-09', second),
    ...ladderWeek('2026-11-16', third),
  ]

  it('warns of a step above the soft 10% only outside the ladder weeks', () => {
    // 63 -> 75 min is +19%: over the soft step, under the 30% ceiling
    const rise = plan(21, 25)
    const exempt = applyGuards(rise, sparse(), [], { startPath: FIRST, exempt: EXEMPT })
    expect(exempt.warnings.some((w) => w.code === 'ramp-soft')).toBe(false)
    expect(exempt.warnings.some((w) => w.code === 'ramp-ceiling')).toBe(false)
    const plain = applyGuards(rise, sparse(), [], { startPath: FIRST })
    expect(plain.warnings.some((w) => w.code === 'ramp-soft')).toBe(true)
  })

  it('still holds a ladder week to the 30% ceiling over two weeks', () => {
    // 90 min against 63 two weeks earlier is +43%
    const jump = plan(21, 30)
    const result = applyGuards(jump, sparse(), [], { startPath: FIRST, exempt: EXEMPT })
    expect(result.warnings.some((w) => w.code === 'ramp-ceiling')).toBe(true)
    expect(weekMinutes(result.sessions, '2026-11-16')).toBeLessThanOrEqual(
      Math.floor(1.3 * 63 + 1e-9),
    )
  })

  it('words the first week of the ladder without a word of blame', () => {
    const result = applyGuards(plan(21, 21), sparse(), [], { startPath: FIRST, exempt: EXEMPT })
    const note = result.warnings.find((w) => w.code === 'restart-floor')
    expect(note?.severity).toBe('info')
    expect(note?.rules).toContain('E6')
    expect(note?.message).toMatch(/run-walk/)
    expect(note?.message).not.toMatch(/behind|missed|streak|failed/i)
  })

  it('keeps the injury-return weeks out of the weekly ramp: each run is held to G-1 instead', () => {
    const injured = withWeeks([0, 0, 0], {
      typicalWeekMin: 0,
      risk: { recentInjury: true, priorBsi: false, bsiFactors: 0, redsFlags: 0, noviceFlags: [] },
    })
    const level = (weekStart: string, each: number) =>
      [1, 4].map((d) =>
        session({
          date: addDays(weekStart, d),
          durationMin: each,
          flags: ['injury-return'],
        }),
      )
    const steps = [
      ...level('2026-11-02', 10),
      ...level('2026-11-09', 10),
      ...level('2026-11-16', 11),
    ]
    const exempt = new Map<string, 'ramp'>([
      ['2026-11-09', 'ramp'],
      ['2026-11-16', 'ramp'],
    ])
    const free = applyGuards(steps, injured, [], {
      startPath: { weekStart: '2026-11-02', minutes: 20, kind: 'injury-return' },
      exempt,
    })
    // 20 -> 22 min is +10%, above the 5-7% of the profile, and passes the 2-week ceiling; each run
    // is 1.10x the one before, the hard limit of G-3
    expect(weekMinutes(free.sessions, '2026-11-16')).toBe(22)
    expect(free.warnings.some((w) => w.code === 'ramp-tightened')).toBe(false)
    const tight = applyGuards(steps, injured, [], {
      startPath: { weekStart: '2026-11-02', minutes: 20, kind: 'injury-return' },
    })
    expect(tight.warnings.some((w) => w.code === 'ramp-tightened')).toBe(true)
  })
})
