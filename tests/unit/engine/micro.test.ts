import { describe, expect, it, vi } from 'vitest'
import { addDays, daysBetween } from '../../../shared/dates.ts'
import type { SessionKind, SessionSpec, WeekDraft } from '../../../shared/engine/types.ts'
import { holdSessions, placeWeek } from '../../../shared/engine/micro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { postRaceWindow, windowWeeks } from '../../../shared/engine/postRace.ts'
import { ZONES, availability, profile, session, state, week } from './e6-fixtures.ts'

// Task E5 owns `prescribe`; the placement is tested against a fake with the frozen signature.
vi.mock('../../../shared/engine/sessions.ts', () => ({
  prescribe: (kind: SessionKind, minutes: number, _zones: unknown, w: WeekDraft) => ({
    date: w.weekStart,
    order: 0,
    kind,
    title: kind,
    durationMin: minutes,
    distanceM: null,
    gainM: null,
    structure: [],
    target: { zone: 'z1', rpe: [2, 3], hr: null, paceSecPerKm: null, heatNote: null },
    purpose: kind,
    rules: [],
    // As in E5's prescribe: every 'b2b' session comes back marked as day 1.
    flags: kind === 'b2b' ? ['b2b-day1'] : [],
  }),
}))

const HARD: SessionKind[] = ['threshold', 'intervals', 'race-pace', 'hills', 'long-fast-finish']
const isRun = (s: SessionSpec) => s.kind !== 'strength' && s.kind !== 'mobility'

function place(
  w: WeekDraft,
  over: { profile?: ReturnType<typeof profile>; prev?: SessionSpec[]; age?: number } = {},
) {
  return placeWeek(w, {
    profile: over.profile ?? profile(),
    zones: ZONES,
    state: state({ age: over.age ?? 36 }),
    prevSessions: over.prev ?? [],
  })
}

const dayOf = (s: SessionSpec) => daysBetween('2026-11-02', s.date)
const runMinutes = (sessions: SessionSpec[]) =>
  sessions.filter(isRun).reduce((sum, s) => sum + s.durationMin, 0)

describe('placeWeek', () => {
  it('places the long run on the long-run day and fills the weekly minutes', () => {
    const sessions = place(week())
    const long = sessions.find((s) => s.kind === 'long')
    expect(long?.date).toBe('2026-11-07')
    expect(long?.durationMin).toBe(100)
    expect(sessions.filter(isRun)).toHaveLength(5)
    expect(runMinutes(sessions)).toBe(300)
  })

  it('is deterministic', () => {
    expect(place(week())).toEqual(place(week()))
  })

  it('never leaves two hard days in a row, inside the week or across it', () => {
    for (const hardOnSunday of [false, true]) {
      const prev = hardOnSunday
        ? [session({ date: '2026-11-01', kind: 'threshold', durationMin: 50 })]
        : []
      for (const longRunDay of ['mon', 'wed', 'fri', 'sat', 'sun'] as const) {
        const sessions = place(week({ runDays: 6 }), { profile: profile({ longRunDay }), prev })
        const hard = [...prev, ...sessions]
          .filter((s) => HARD.includes(s.kind))
          .map((s) => daysBetween('2026-11-01', s.date))
        for (let i = 1; i < hard.length; i += 1) {
          expect(hard[i]! - hard[i - 1]!, `${longRunDay} ${hardOnSunday}`).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it('keeps the long run out from between two quality days', () => {
    for (const longRunDay of ['tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const) {
      const sessions = place(week({ runDays: 7 }), { profile: profile({ longRunDay }) })
      const long = sessions.find((s) => s.kind === 'long')!
      const before = sessions.find(
        (s) => s.date === addDays(long.date, -1) && HARD.includes(s.kind),
      )
      const after = sessions.find((s) => s.date === addDays(long.date, 1) && HARD.includes(s.kind))
      expect(before && after, longRunDay).toBeFalsy()
    }
  })

  it('uses only available days and respects the day limits', () => {
    const avail = availability({
      mon: { available: false, maxMin: null },
      wed: { available: false, maxMin: null },
      thu: { available: true, maxMin: 30 },
      sat: { available: true, maxMin: 150 },
    })
    const sessions = place(week({ strengthSessions: 2 }), {
      profile: profile({ availability: avail }),
    })
    for (const s of sessions) {
      expect([0, 2]).not.toContain(dayOf(s))
    }
    const perDay = new Map<number, number>()
    for (const s of sessions) perDay.set(dayOf(s), (perDay.get(dayOf(s)) ?? 0) + s.durationMin)
    expect(perDay.get(3) ?? 0).toBeLessThanOrEqual(30)
    expect(perDay.get(5) ?? 0).toBeLessThanOrEqual(150)
  })

  it('moves the long run to another day when the long-run day is unavailable', () => {
    const avail = availability({ sat: { available: false, maxMin: null } })
    const sessions = place(week(), { profile: profile({ availability: avail }) })
    const long = sessions.find((s) => s.kind === 'long')
    expect(long?.date).toBe('2026-11-08')
    expect(runMinutes(sessions)).toBeLessThanOrEqual(300)
  })

  it('caps the long run at the day limit and does not stretch it', () => {
    const avail = availability({ sat: { available: true, maxMin: 80 } })
    const sessions = place(week(), { profile: profile({ availability: avail }) })
    const long = sessions.find((s) => s.kind === 'long')
    expect(long?.durationMin).toBeLessThanOrEqual(80)
  })

  it('never makes any other run longer than the long run', () => {
    const sessions = place(week({ targetRunMin: 600, longRunMin: 90, runDays: 4 }))
    for (const s of sessions) expect(s.durationMin).toBeLessThanOrEqual(90)
  })

  it('places no run when the week has no run minutes or no run days', () => {
    expect(place(week({ targetRunMin: 0, longRunMin: 0 }))).toEqual([])
    expect(place(week({ runDays: 0 }))).toEqual([])
  })

  it('drops run days instead of writing runs shorter than the minimum', () => {
    const minimum = P.fplace.minRunDayMin.value
    const sessions = place(week({ targetRunMin: 100, longRunMin: 60, runDays: 6 }))
    for (const s of sessions) expect(s.durationMin).toBeGreaterThanOrEqual(minimum)
    expect(sessions.length).toBeLessThan(6)
  })

  it('chooses the quality kinds from the phase', () => {
    // A fast finish a week ago keeps the specific phase on its own quality kinds.
    const recentFastFinish = [session({ date: '2026-10-31', kind: 'long-fast-finish' })]
    const kinds = (phase: WeekDraft['phase'], q = 2) =>
      place(week({ phase, qualitySessions: q }), { prev: recentFastFinish })
        .map((s) => s.kind)
        .filter((k) => HARD.includes(k) || k === 'strides')
        .sort()
    expect(kinds('build')).toEqual(['intervals', 'threshold'])
    expect(kinds('specific')).toEqual(['race-pace', 'threshold'])
    expect(kinds('base', 1)).toEqual(['strides'])
    expect(kinds('race', 2)).toEqual(['strides'])
    expect(kinds('build', 0)).toEqual([])
  })

  it('never schedules more quality sessions than the weekly limit', () => {
    const sessions = place(week({ qualitySessions: 5, runDays: 7 }))
    const quality = sessions.filter((s) => HARD.includes(s.kind))
    expect(quality.length).toBeLessThanOrEqual(P.f2.qualitySessionsPerWeek.value)
  })

  it('gives novices three non-consecutive run days with the run-walk flag, and no quality', () => {
    const sessions = place(week({ index: 2, runDays: 5, qualitySessions: 2 }), {
      profile: profile({ longRunDay: 'sun' }),
    })
    const novice = placeWeek(week({ index: 2, runDays: 5, qualitySessions: 2 }), {
      profile: profile({ longRunDay: 'sun' }),
      zones: ZONES,
      state: state({ experience: 'novice' }),
      prevSessions: [],
    })
    expect(sessions.length).toBeGreaterThan(3)
    const days = novice.map(dayOf).sort((a, b) => a - b)
    expect(days).toHaveLength(P.f5.noviceRunDays.value)
    for (let i = 1; i < days.length; i += 1)
      expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(2)
    for (const s of novice) {
      expect(s.flags).toContain('run-walk')
      expect(HARD).not.toContain(s.kind)
    }
  })

  it('keeps a novice off the Monday after a Sunday run', () => {
    const novice = placeWeek(week({ index: 2, runDays: 3 }), {
      profile: profile({ longRunDay: 'sat' }),
      zones: ZONES,
      state: state({ experience: 'novice' }),
      prevSessions: [session({ date: '2026-11-01' })],
    })
    expect(novice.map(dayOf)).not.toContain(0)
  })

  it('stops run-walk after the novice programme length', () => {
    const late = placeWeek(week({ index: P.flib.runWalkWeeks.value }), {
      profile: profile(),
      zones: ZONES,
      state: state({ experience: 'novice' }),
      prevSessions: [],
    })
    for (const s of late) expect(s.flags).not.toContain('run-walk')
  })

  it('caps run days at 6 from age 40, and not below', () => {
    expect(place(week({ runDays: 7, qualitySessions: 0 }), { age: 40 }).filter(isRun)).toHaveLength(
      6,
    )
    expect(place(week({ runDays: 7, qualitySessions: 0 }), { age: 39 }).filter(isRun)).toHaveLength(
      7,
    )
  })

  it('places a fast-finish long run in the specific phase at most every 2 weeks', () => {
    const w = week({ phase: 'specific', qualitySessions: 1 })
    const first = place(w)
    expect(first.some((s) => s.kind === 'long-fast-finish')).toBe(true)
    expect(first.some((s) => s.kind === 'race-pace')).toBe(false)
    const lastWeek = [session({ date: '2026-10-31', kind: 'long-fast-finish' })]
    expect(place(w, { prev: lastWeek }).some((s) => s.kind === 'long-fast-finish')).toBe(false)
    const twoWeeksAgo = [session({ date: '2026-10-24', kind: 'long-fast-finish' })]
    expect(place(w, { prev: twoWeeksAgo }).some((s) => s.kind === 'long-fast-finish')).toBe(true)
    expect(
      place(week({ phase: 'build', qualitySessions: 1 })).some(
        (s) => s.kind === 'long-fast-finish',
      ),
    ).toBe(false)
    expect(
      place({ ...w, flags: ['heat-acclimation'] }).some((s) => s.kind === 'long-fast-finish'),
    ).toBe(false)
  })

  it('marks the long run with the fuel and night flags from the week flags', () => {
    const sessions = place(week({ flags: ['gut-training', 'night'] }))
    const long = sessions.find((s) => s.kind === 'long')!
    expect(long.flags).toEqual(expect.arrayContaining(['fuel-practice', 'night']))
  })

  it('fills the distance of the long run and spreads the weekly gain over the runs', () => {
    const sessions = place(week({ longRunM: 18000, gainTargetM: 900 }))
    const long = sessions.find((s) => s.kind === 'long')!
    expect(long.distanceM).toBe(18000)
    const gain = sessions.filter(isRun).reduce((sum, s) => sum + (s.gainM ?? 0), 0)
    expect(gain).toBeGreaterThan(850)
    expect(gain).toBeLessThanOrEqual(900)
    const capped = place(week({ longRunM: 18000 }), {
      profile: profile({ availability: availability({ sat: { available: true, maxMin: 50 } }) }),
    })
    expect(capped.find((s) => s.kind === 'long')!.distanceM).toBe(9000)
  })

  describe('back-to-back pairs', () => {
    const b2bWeek = (over: Partial<WeekDraft> = {}) =>
      week({ phase: 'specific', flags: ['b2b'], targetRunMin: 480, longRunMin: 180, ...over })

    it('puts day 2 straight after day 1, never longer, with the pair flags', () => {
      const sessions = place(b2bWeek())
      const day1 = sessions.find((s) => s.flags.includes('b2b-day1'))!
      const day2 = sessions.find((s) => s.flags.includes('b2b-day2'))!
      expect(day1.kind).toBe('b2b')
      expect(day2.kind).toBe('b2b')
      expect(day2.date).toBe(addDays(day1.date, 1))
      expect(day1.flags).not.toContain('b2b-day2')
      expect(day2.flags).not.toContain('b2b-day1')
      expect(day2.durationMin).toBeLessThanOrEqual(day1.durationMin)
      expect(day2.durationMin).toBe(Math.round(day1.durationMin * P.fplace.b2bDay2Fraction.value))
      expect(runMinutes(sessions)).toBeLessThanOrEqual(480)
    })

    it('counts the pair as one hard block: at most one more quality day, two days clear of it', () => {
      const sessions = place(b2bWeek({ runDays: 6 }))
      const pair = sessions.filter((s) => s.kind === 'b2b').map(dayOf)
      const quality = sessions.filter((s) => HARD.includes(s.kind)).map(dayOf)
      expect(quality.length).toBeLessThanOrEqual(1)
      for (const q of quality)
        for (const p of pair) expect(Math.abs(q - p)).toBeGreaterThanOrEqual(2)
    })

    it('falls back to a plain long run in a taper, a recovery week and an early phase', () => {
      for (const over of [{ isTaper: true }, { isRecovery: true }, { phase: 'base' as const }]) {
        const sessions = place(b2bWeek(over))
        expect(sessions.some((s) => s.kind === 'b2b')).toBe(false)
        expect(sessions.some((s) => s.kind === 'long')).toBe(true)
      }
    })

    it('allows one pair every 2 weeks', () => {
      // a pair of 150 and 100 min sets the 2-day total the next pair is measured against [H3]
      const lastWeek = [
        session({ date: '2026-10-31', kind: 'b2b', flags: ['b2b-day1'], durationMin: 150 }),
        session({ date: '2026-11-01', kind: 'b2b', flags: ['b2b-day2'], durationMin: 100 }),
      ]
      expect(place(b2bWeek(), { prev: lastWeek }).some((s) => s.kind === 'b2b')).toBe(false)
      const older = lastWeek.map((s) => ({ ...s, date: addDays(s.date, -7) }))
      expect(place(b2bWeek(), { prev: older }).some((s) => s.kind === 'b2b')).toBe(true)
    })

    it('finds another pair of days when the long-run day has no day after it', () => {
      const sessions = place(b2bWeek(), { profile: profile({ longRunDay: 'sun' }) })
      const day1 = sessions.find((s) => s.flags.includes('b2b-day1'))
      const day2 = sessions.find((s) => s.flags.includes('b2b-day2'))
      expect(day1 && day2).toBeTruthy()
      expect(day2!.date).toBe(addDays(day1!.date, 1))
    })

    it('uses a plain long run when no two consecutive days are available', () => {
      const avail = availability({
        mon: { available: false, maxMin: null },
        wed: { available: false, maxMin: null },
        fri: { available: false, maxMin: null },
        sun: { available: false, maxMin: null },
      })
      const sessions = place(b2bWeek({ runDays: 3 }), { profile: profile({ availability: avail }) })
      expect(sessions.some((s) => s.kind === 'b2b')).toBe(false)
    })
  })

  describe('strength', () => {
    it('places sessions on available days, away from hard runs and the day before the long run', () => {
      const sessions = place(week({ strengthSessions: 2 }))
      const strength = sessions.filter((s) => s.kind === 'strength')
      expect(strength).toHaveLength(2)
      const long = sessions.find((s) => s.kind === 'long')!
      for (const s of strength) {
        expect(s.date).not.toBe(long.date)
        expect(s.date).not.toBe(addDays(long.date, -1))
        const sameDay = sessions.filter((o) => o.date === s.date && o !== s)
        expect(sameDay.some((o) => HARD.includes(o.kind))).toBe(false)
        expect(s.durationMin).toBe(P.fplace.strengthSessionMin.value)
      }
      expect(Math.abs(dayOf(strength[0]!) - dayOf(strength[1]!))).toBeGreaterThanOrEqual(2)
    })

    it('orders strength after the run of the same day', () => {
      const sessions = place(week({ strengthSessions: 2, runDays: 7, qualitySessions: 0 }))
      for (const s of sessions.filter((x) => x.kind === 'strength')) {
        const run = sessions.find((o) => o.date === s.date && isRun(o))
        if (run) expect(s.order).toBeGreaterThan(run.order)
      }
    })

    it('respects the strength preference and the day limits', () => {
      expect(
        place(week({ strengthSessions: 2 }), {
          profile: profile({ strengthPreference: 1 }),
        }).filter((s) => s.kind === 'strength'),
      ).toHaveLength(1)
      expect(
        place(week({ strengthSessions: 2 }), {
          profile: profile({ strengthPreference: 0 }),
        }).filter((s) => s.kind === 'strength'),
      ).toHaveLength(0)
      const tight = availability({
        mon: { available: true, maxMin: 20 },
        tue: { available: true, maxMin: 20 },
        wed: { available: true, maxMin: 20 },
        thu: { available: true, maxMin: 20 },
        fri: { available: true, maxMin: 20 },
        sat: { available: true, maxMin: 120 },
        sun: { available: false, maxMin: null },
      })
      const sessions = place(week({ strengthSessions: 2, runDays: 3, qualitySessions: 0 }), {
        profile: profile({ availability: tight }),
      })
      const perDay = new Map<number, number>()
      for (const s of sessions) perDay.set(dayOf(s), (perDay.get(dayOf(s)) ?? 0) + s.durationMin)
      for (const [d, total] of perDay)
        expect(total, `day ${d}`).toBeLessThanOrEqual(d === 5 ? 120 : 20)
    })

    it('can place strength in a week without runs', () => {
      const sessions = place(
        week({ targetRunMin: 0, longRunMin: 0, runDays: 0, strengthSessions: 1 }),
      )
      expect(sessions.map((s) => s.kind)).toEqual(['strength'])
    })
  })

  describe('session minimums', () => {
    const MIN = P.fplace.easyRunMinMin.value
    const runs = (sessions: SessionSpec[]) => sessions.filter(isRun)

    it('places fewer runs rather than runs under the minimum', () => {
      const sessions = place(week({ targetRunMin: 70, longRunMin: 30, runDays: 5 }))
      expect(runs(sessions)).toHaveLength(3)
      for (const s of runs(sessions)) expect(s.durationMin).toBeGreaterThanOrEqual(MIN)
      expect(runMinutes(sessions)).toBe(70)
    })

    it('places at least two runs outside recovery, taper and race weeks, and one inside them', () => {
      const small = { targetRunMin: 30, longRunMin: 15, runDays: 4, qualitySessions: 0 }
      const plain = place(week(small))
      expect(runs(plain)).toHaveLength(2)
      for (const s of runs(plain)) expect(s.durationMin).toBeGreaterThanOrEqual(MIN)
      for (const over of [{ isRecovery: true }, { isTaper: true }]) {
        expect(runs(place(week({ ...small, ...over })))).toHaveLength(1)
      }
    })

    it('keeps the long run at the minimum and the longest run of the week', () => {
      const short = place(week({ targetRunMin: 100, longRunMin: 8, runDays: 3 }))
      const long = short.find((s) => s.kind === 'long')!
      expect(long.durationMin).toBeGreaterThanOrEqual(MIN)
      for (const s of runs(short)) expect(s.durationMin).toBeLessThanOrEqual(long.durationMin)
    })

    it('lets the long run take the share of the runs left out, so it stays the longest', () => {
      const sessions = place(
        week({
          targetRunMin: 54,
          longRunMin: 23,
          runDays: 3,
          isRecovery: true,
          qualitySessions: 0,
        }),
      )
      expect(runs(sessions)).toHaveLength(2)
      const long = sessions.find((s) => s.kind === 'long')!
      expect(runMinutes(sessions)).toBe(54)
      for (const s of runs(sessions)) expect(s.durationMin).toBeLessThanOrEqual(long.durationMin)
    })

    it('keeps the run day minimum for run-walk weeks', () => {
      const walk = place(
        week({ targetRunMin: 45, longRunMin: 15, runDays: 3, flags: ['run-walk'] }),
      )
      expect(runs(walk)).toHaveLength(3)
      for (const s of runs(walk)) {
        expect(s.durationMin).toBeGreaterThanOrEqual(P.fplace.minRunDayMin.value)
        expect(s.flags).toContain('run-walk')
      }
    })
  })

  describe('restart floor week', () => {
    it('places three runs of 20 min on non-consecutive days in the days left of a part week', () => {
      // Wednesday to Sunday are open; the long-run day is Saturday, which would leave room for two
      const avail = availability({
        mon: { available: false, maxMin: null },
        tue: { available: false, maxMin: null },
      })
      const sessions = place(
        week({
          index: 0,
          targetRunMin: 60,
          longRunMin: 27,
          runDays: 3,
          qualitySessions: 0,
          flags: ['restart-floor'],
        }),
        { profile: profile({ availability: avail }) },
      )
      const days = sessions
        .filter(isRun)
        .map(dayOf)
        .sort((a, b) => a - b)
      expect(days).toHaveLength(3)
      for (let i = 1; i < days.length; i++)
        expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(2)
      for (const s of sessions.filter(isRun)) expect(s.durationMin).toBeGreaterThanOrEqual(20)
      expect(runMinutes(sessions)).toBe(60)
    })
  })

  describe('pairs and the 2-day total', () => {
    const b2bWeek = () =>
      week({ phase: 'specific', flags: ['b2b'], targetRunMin: 480, longRunMin: 180, runDays: 5 })
    const history = (day2: number) => [
      session({ date: '2026-10-24', kind: 'long', durationMin: 150 }),
      session({ date: '2026-10-25', kind: 'easy', durationMin: day2 }),
    ]

    it('shortens day 2 to stay within 1.10x of the largest 2-day total (H3)', () => {
      const sessions = place(b2bWeek(), { prev: history(60) })
      const day1 = sessions.find((s) => s.flags.includes('b2b-day1'))!
      const day2 = sessions.find((s) => s.flags.includes('b2b-day2'))!
      expect(day1.durationMin).toBe(180)
      expect(day1.durationMin + day2.durationMin).toBe(Math.floor(210 * P.h3.b2bTwoDayRatio.value))
      expect(day2.durationMin).toBeLessThan(Math.round(180 * P.fplace.b2bDay2Fraction.value))
    })

    it('drops the pair for a single long run when day 2 would fall under the minimum', () => {
      const sessions = place(b2bWeek(), { prev: history(30) })
      expect(sessions.some((s) => s.kind === 'b2b')).toBe(false)
      expect(sessions.some((s) => s.kind === 'long' || s.kind === 'long-fast-finish')).toBe(true)
      expect(sessions.filter(isRun).length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('post-race window (H12)', () => {
    // A marathon on the Sunday before the week of 2026-11-02, by a runner under 40 with an earlier
    // finish: days 0 and 1 are the hold, step 1 runs Tuesday to the Monday after (3 to 9 November),
    // step 2 the 7 days after that, and quality work waits for 17 November.
    const RACE = '2026-11-01'
    const window = postRaceWindow(
      { date: RACE, distanceM: 42_195, lossM: null, distanceClass: 'marathon' },
      { age: 30 },
      [{ date: '2025-04-01', distanceM: 42_195 }],
      [],
      '2026-11-01',
    )
    const afterRace = (weekStart: string) =>
      windowWeeks(window, {
        weekStarts: [weekStart],
        firstIndex: 0,
        reference: 300,
        referenceRunDays: 5,
      })[0]!
    const placeAfter = (weekStart: string, prev: SessionSpec[] = []) =>
      placeWeek(afterRace(weekStart), {
        profile: profile(),
        zones: ZONES,
        state: state({ age: 30 }),
        prevSessions: prev,
        postRace: [window],
      })

    it('keeps the hold day free and puts three capped runs on every other day in step 1', () => {
      const sessions = placeAfter('2026-11-02')
      expect(sessions.map((s) => s.date)).toEqual(['2026-11-03', '2026-11-05', '2026-11-07'])
      for (const s of sessions) {
        expect(s.kind).toBe('recovery')
        expect(s.durationMin).toBeLessThanOrEqual(P.h12.step1RunMaxMin.value)
        expect(s.flags).toContain('post-race')
        expect(s.rules).toContain('H12')
        expect(s.title).toBe(`After the race: easy ${s.durationMin} min`)
      }
    })

    it('counts the first step across the weeks it spans: no fourth run, none next to the third', () => {
      const first = placeAfter('2026-11-02')
      // the last day of step 1 is Monday 9 November: three runs are already placed
      const next = placeAfter('2026-11-09', first)
      expect(next.some((s) => s.date === '2026-11-09')).toBe(false)
      const steps2 = next.filter(isRun)
      expect(steps2.length).toBeGreaterThan(0)
      for (const s of steps2) {
        expect(s.kind).toBe('easy')
        expect(s.durationMin).toBeLessThanOrEqual(60)
      }
    })

    it('puts no quality work before the end of the window, whatever the week asks for', () => {
      const ask = week({
        weekStart: '2026-11-09',
        phase: 'build',
        qualitySessions: 2,
        targetRunMin: 300,
      })
      const inside = placeWeek(ask, {
        profile: profile(),
        zones: ZONES,
        state: state({ age: 30 }),
        prevSessions: [],
        postRace: [window],
      })
      expect(inside.filter((s) => HARD.includes(s.kind) || s.kind === 'strides')).toEqual([])
      // the same week without the window holds quality work
      const free = placeWeek(ask, {
        profile: profile(),
        zones: ZONES,
        state: state({ age: 30 }),
        prevSessions: [],
      })
      expect(free.some((s) => HARD.includes(s.kind))).toBe(true)
      // a week that starts on the first day quality is allowed may hold it again
      const after = placeWeek(
        week({ weekStart: '2026-11-17', phase: 'build', qualitySessions: 2 }),
        {
          profile: profile(),
          zones: ZONES,
          state: state({ age: 30 }),
          prevSessions: [],
          postRace: [window],
        },
      )
      expect(after.some((s) => HARD.includes(s.kind))).toBe(true)
    })

    it('lets one run of a later step reach 90 min and holds the others to 60', () => {
      const late = postRaceWindow(
        { date: RACE, distanceM: 160_934, lossM: null, distanceClass: 'ultra100mi' },
        { age: 30 },
        [{ date: '2025-04-01', distanceM: 160_934 }],
        [],
        RACE,
      )
      // a 10-day hold: step 2 runs 18 to 24 November and step 3 from 25 November
      const wk = windowWeeks(late, {
        weekStarts: ['2026-11-23'],
        firstIndex: 0,
        reference: 500,
        referenceRunDays: 5,
      })[0]!
      const sessions = placeWeek(wk, {
        profile: profile(),
        zones: ZONES,
        state: state({ age: 30 }),
        prevSessions: [],
        postRace: [late],
      })
      const lengths = sessions.map((s) => s.durationMin).sort((a, b) => b - a)
      expect(lengths[0]!).toBe(P.h12.laterStepLongRunMaxMin.value)
      for (const m of lengths.slice(1)) expect(m).toBeLessThanOrEqual(P.h12.step2RunMaxMin.value)
    })

    it('writes a rest day with the hold copy for every hold day from the first date given', () => {
      const days = holdSessions(week({ weekStart: '2026-11-02' }), ZONES, [window], '2026-11-01')
      expect(days.map((s) => s.date)).toEqual(['2026-11-02'])
      expect(days[0]).toMatchObject({ kind: 'rest', title: 'After the race: rest' })
      expect(days[0]!.purpose).toBe(
        'Rest. Walking and easy movement are fine; no running until 2026-11-03.',
      )
      // the race day carries the race, and later hold days are not asked for before `from`
      expect(
        holdSessions(week({ weekStart: '2026-10-26' }), ZONES, [window], '2026-10-26'),
      ).toEqual([])
      expect(
        holdSessions(week({ weekStart: '2026-11-02' }), ZONES, [window], '2026-11-03'),
      ).toEqual([])
    })
  })
})
