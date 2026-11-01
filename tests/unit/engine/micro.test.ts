import { describe, expect, it, vi } from 'vitest'
import { addDays, daysBetween } from '../../../shared/dates.ts'
import type { DayRule } from '../../../shared/engine/disruption.ts'
import type { SessionKind, SessionSpec, WeekDraft } from '../../../shared/engine/types.ts'
import {
  holdSessions,
  placeWeek,
  strengthMinutes,
  strengthOffDay,
} from '../../../shared/engine/micro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { postRaceWindow, windowWeeks } from '../../../shared/engine/postRace.ts'
import { WEEKDAYS, ZONES, availability, profile, session, state, week } from './e6-fixtures.ts'

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

  // Found by H2 and M5 (2026-10-31), fixed by RF2. A plan made on a Saturday opens with a quality
  // session on the Saturday and the long run on the Sunday; the week after it put its first quality
  // session on the Monday, and the long run sat between two quality days across the Monday (rule F3).
  it('keeps the long run of the week before out from between two quality days, across the Monday', () => {
    const prev = [
      session({ date: '2026-10-31', kind: 'threshold', durationMin: 40 }),
      session({ date: '2026-11-01', kind: 'long', durationMin: 90 }),
    ]
    for (const longRunDay of ['wed', 'thu', 'fri', 'sat'] as const) {
      const sessions = place(week({ runDays: 5, qualitySessions: 2 }), {
        profile: profile({ longRunDay }),
        prev,
      })
      // no quality session on the Monday, and the week keeps its quality elsewhere
      expect(
        sessions.filter((s) => HARD.includes(s.kind) && dayOf(s) === 0),
        longRunDay,
      ).toEqual([])
      expect(
        sessions.some((s) => HARD.includes(s.kind)),
        longRunDay,
      ).toBe(true)
    }
    // a long run with no quality day before it leaves the Monday free to take one
    const free = place(week({ runDays: 5, qualitySessions: 2 }), {
      prev: [session({ date: '2026-11-01', kind: 'long', durationMin: 90 })],
    })
    expect(free.some((s) => HARD.includes(s.kind) && dayOf(s) === 0)).toBe(true)
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

  it('gives novices at most three non-consecutive run days', () => {
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

  it('holds no quality work in the first weeks of a novice plan, ladder or not', () => {
    const early = placeWeek(week({ index: 2, runDays: 5, qualitySessions: 2, phase: 'build' }), {
      profile: profile({ longRunDay: 'sun' }),
      zones: ZONES,
      state: state({ experience: 'novice' }),
      prevSessions: [],
    })
    expect(early.some((s) => HARD.includes(s.kind) || s.kind === 'strides')).toBe(false)
    const later = placeWeek(
      week({ index: P.flib.runWalkWeeks.value, runDays: 5, qualitySessions: 2, phase: 'build' }),
      {
        profile: profile({ longRunDay: 'sun' }),
        zones: ZONES,
        state: state({ experience: 'novice' }),
        prevSessions: [],
      },
    )
    expect(later.some((s) => HARD.includes(s.kind))).toBe(true)
  })

  it('marks run-walk by the week flags, not by a novice plan index', () => {
    for (const index of [0, P.flib.runWalkWeeks.value + 3]) {
      const novice = placeWeek(week({ index }), {
        profile: profile(),
        zones: ZONES,
        state: state({ experience: 'novice' }),
        prevSessions: [],
      })
      for (const s of novice) expect(s.flags).not.toContain('run-walk')
    }
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
    expect(long.rules).toContain('H7')
  })

  describe('fuel practice in a gut-training week [rule H7]', () => {
    const gutWeek = (over: Partial<WeekDraft> = {}) =>
      week({ flags: ['gut-training'], runDays: 6, targetRunMin: 480, longRunMin: 150, ...over })
    const fuelRuns = (sessions: SessionSpec[]) =>
      sessions.filter((s) => s.flags.includes('fuel-practice'))
    /** The plan without the fuel marks, to compare a week with and without the block. */
    const unmarked = (sessions: SessionSpec[]) =>
      sessions.map((s) => ({
        ...s,
        flags: s.flags.filter((f) => f !== 'fuel-practice'),
        rules: s.rules.filter((r) => r !== 'H7'),
      }))

    it('marks the long run and the next longest runs, up to the weekly cap, with rule H7', () => {
      const sessions = place(gutWeek())
      const marked = fuelRuns(sessions)
      expect(marked).toHaveLength(P.h7.gutBlockSessionsPerWeek.value)
      expect(marked.every((s) => s.rules.includes('H7'))).toBe(true)
      expect(marked.some((s) => s.kind === 'long')).toBe(true)
      // the cap is binding: more runs than the cap are long enough
      const longEnough = sessions.filter(
        (s) => isRun(s) && s.durationMin >= P.h7.gutTrainingSessionMinMin.value,
      )
      expect(longEnough.length).toBeGreaterThan(marked.length)
      // after the long run, the longest of the easy runs
      const easy = sessions.filter((s) => s.kind === 'easy')
      const shortestMarked = Math.min(
        ...marked.filter((s) => s.kind === 'easy').map((s) => s.durationMin),
      )
      for (const s of easy.filter((x) => !marked.includes(x))) {
        expect(s.durationMin).toBeLessThanOrEqual(shortestMarked)
      }
      // no run outside the marked ones says so
      expect(sessions.filter((s) => !marked.includes(s) && s.rules.includes('H7'))).toHaveLength(0)
    })

    it('marks both days of a back-to-back pair before other runs, even shorter ones', () => {
      const sessions = place(
        gutWeek({
          phase: 'specific',
          flags: ['gut-training', 'b2b'],
          targetRunMin: 640,
          longRunMin: 120,
        }),
      )
      const day1 = sessions.find((s) => s.flags.includes('b2b-day1'))!
      const day2 = sessions.find((s) => s.flags.includes('b2b-day2'))!
      const others = sessions.filter((s) => s !== day1 && s !== day2)
      // day 2 is under the other runs and over the session minimum
      expect(day2.durationMin).toBeGreaterThanOrEqual(P.h7.gutTrainingSessionMinMin.value)
      expect(others.filter((s) => s.durationMin > day2.durationMin).length).toBeGreaterThan(
        P.h7.gutBlockSessionsPerWeek.value,
      )
      expect(day1.flags).toContain('fuel-practice')
      expect(day2.flags).toContain('fuel-practice')
      expect(fuelRuns(sessions)).toHaveLength(P.h7.gutBlockSessionsPerWeek.value)
    })

    it('marks only runs of at least the session minimum', () => {
      for (const targetRunMin of [150, 200, 260, 330, 480]) {
        const sessions = place(gutWeek({ targetRunMin, longRunMin: Math.round(targetRunMin / 3) }))
        for (const s of fuelRuns(sessions)) {
          expect(s.durationMin, `${targetRunMin} min week`).toBeGreaterThanOrEqual(
            P.h7.gutTrainingSessionMinMin.value,
          )
        }
      }
      // a long run under the minimum is not marked
      const short = place(gutWeek({ targetRunMin: 150, longRunMin: 50, runDays: 3 }))
      expect(Math.max(...short.filter(isRun).map((s) => s.durationMin))).toBeLessThan(
        P.h7.gutTrainingSessionMinMin.value,
      )
      expect(fuelRuns(short)).toHaveLength(0)
    })

    it('never marks threshold, interval or hill work, nor a run outside a gut-training week', () => {
      const build = place(gutWeek({ phase: 'build', qualitySessions: 2, targetRunMin: 540 }))
      const hard = build.filter((s) => ['threshold', 'intervals', 'hills'].includes(s.kind))
      expect(hard.some((s) => s.durationMin >= P.h7.gutTrainingSessionMinMin.value)).toBe(true)
      expect(hard.filter((s) => s.flags.includes('fuel-practice'))).toEqual([])
      const specific = place(gutWeek({ phase: 'specific', qualitySessions: 2, targetRunMin: 540 }))
      for (const s of fuelRuns([...build, ...specific])) {
        expect(['easy', 'long', 'long-fast-finish', 'b2b', 'race-pace']).toContain(s.kind)
      }
      expect(fuelRuns(place(week({ runDays: 6, targetRunMin: 480, longRunMin: 150 })))).toEqual([])
      expect(fuelRuns(place(week({ flags: ['night'], runDays: 6, targetRunMin: 480 })))).toEqual([])
    })

    it('marks the long day of a back-to-back pair and leaves minutes, days and kinds as they are', () => {
      for (const over of [
        {},
        { phase: 'specific' as const, flags: ['gut-training', 'b2b'], longRunMin: 180 },
        { runDays: 4, targetRunMin: 300 },
        { qualitySessions: 0 },
      ]) {
        const gut = place(gutWeek(over))
        const plain = place(
          gutWeek({
            ...over,
            flags: (over.flags ?? ['gut-training']).filter((f) => f !== 'gut-training'),
          }),
        )
        expect(fuelRuns(gut).length).toBeGreaterThan(0)
        expect(fuelRuns(plain)).toHaveLength(0)
        expect(unmarked(gut)).toEqual(plain)
      }
      const pair = place(
        gutWeek({ phase: 'specific', flags: ['gut-training', 'b2b'], longRunMin: 180 }),
      )
      expect(fuelRuns(pair).some((s) => s.flags.includes('b2b-day1'))).toBe(true)
    })
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

  describe('the time a strength session is given (strengthMinutes, rules F7, F4)', () => {
    it('is the block budget in a block week and the maintenance budget in every other week', () => {
      expect(strengthMinutes({ flags: ['strength-block'] })).toBe(P.f7.blockSessionMin.value)
      expect(strengthMinutes({ flags: ['strength-block', 'recovery'] })).toBe(
        P.f7.blockSessionMin.value,
      )
      for (const flags of [[], ['taper'], ['recovery'], ['injury-return']]) {
        expect(strengthMinutes({ flags }), flags.join()).toBe(P.f7.maintenanceSessionMin.value)
      }
    })

    it('is the budget the placement gives a session', () => {
      for (const flags of [[], ['strength-block']]) {
        const given = place(week({ strengthSessions: 2, flags })).filter(
          (s) => s.kind === 'strength',
        )
        expect(given.length).toBeGreaterThan(0)
        for (const s of given) expect(s.durationMin).toBe(strengthMinutes({ flags }))
      }
    })
  })

  describe('the day the plan keeps strength off (strengthOffDay, rule F4)', () => {
    const monday = '2026-11-02'
    const on = (day: number, kind: SessionKind) => ({ date: addDays(monday, day), kind })
    const asked = (day: number, sessions: Array<{ date: string; kind: SessionKind }>) =>
      strengthOffDay(addDays(monday, day), sessions)

    it('names the day before the long run, and a day that holds a hard run or the long run', () => {
      const week = [on(1, 'threshold'), on(3, 'easy'), on(5, 'long')]
      expect(asked(4, week)).toBe('day-before-long-run')
      expect(asked(1, week)).toBe('hard-run-day')
      expect(asked(5, week)).toBe('hard-run-day')
      for (const open of [0, 2, 3, 6]) expect(asked(open, week), `day ${String(open)}`).toBeNull()
    })

    it.each(['long', 'long-fast-finish', 'b2b'] as const)(
      'counts a %s as the long run: the day before it is off',
      (kind) => {
        expect(asked(5, [on(6, kind)])).toBe('day-before-long-run')
      },
    )

    it.each(HARD)('keeps strength off the day of a %s', (kind) => {
      expect(asked(2, [on(2, kind)])).not.toBeNull()
    })

    it.each(['easy', 'recovery', 'strides', 'hike'] as const)(
      'leaves the day of a %s open',
      (kind) => {
        expect(asked(2, [on(2, kind)])).toBeNull()
      },
    )

    it('takes the first long run of the week as the one the day before is off for', () => {
      const week = [on(2, 'long-fast-finish'), on(5, 'long')]
      expect(asked(1, week)).toBe('day-before-long-run')
      expect(asked(4, week)).toBeNull()
    })

    it('names the day before the long run first when the day is also a hard day', () => {
      expect(asked(4, [on(4, 'threshold'), on(5, 'long')])).toBe('day-before-long-run')
    })

    it('reads the runs of the date’s own week only, and no session that is not a run', () => {
      // a long run on Monday has no day before it in this week, and last week’s runs are not this week’s
      expect(asked(6, [on(0, 'long')])).toBeNull()
      expect(asked(0, [on(0, 'long')])).toBe('hard-run-day')
      expect(asked(1, [{ date: addDays(monday, -2), kind: 'long' }])).toBeNull()
      expect(asked(1, [on(1, 'strength'), on(1, 'mobility'), on(1, 'rest')])).toBeNull()
      expect(asked(2, [])).toBeNull()
    })

    it('agrees with the placement of a week’s lifts: no lift is ever placed on a day it names', () => {
      for (const runDays of [3, 4, 5, 6, 7]) {
        for (const qualitySessions of [0, 1, 2]) {
          const sessions = place(week({ strengthSessions: 3, runDays, qualitySessions }))
          const runs = sessions.filter(isRun)
          const lifts = sessions.filter((s) => s.kind === 'strength')
          expect(lifts.length, `${String(runDays)} run days`).toBeGreaterThan(0)
          for (const lift of lifts) {
            expect(
              strengthOffDay(lift.date, runs),
              `${lift.date} with ${String(runDays)} run days`,
            ).toBeNull()
          }
        }
      }
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
        expect(s.durationMin).toBe(P.f7.maintenanceSessionMin.value)
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

    it('gives a block week the block budget and every other week the maintenance budget', () => {
      const block = place(week({ strengthSessions: 2, flags: ['strength-block'] }))
      const strength = (sessions: SessionSpec[]) => sessions.filter((s) => s.kind === 'strength')
      expect(strength(block)).toHaveLength(2)
      for (const s of strength(block)) expect(s.durationMin).toBe(P.f7.blockSessionMin.value)
      for (const flags of [[], ['taper'], ['recovery']]) {
        const other = strength(place(week({ strengthSessions: 2, flags })))
        expect(other, flags.join()).toHaveLength(2)
        for (const s of other) expect(s.durationMin).toBe(P.f7.maintenanceSessionMin.value)
      }
    })

    it('needs the budget of the week free on a day: 35 minutes take a maintenance session and not a block session', () => {
      const days = Object.fromEntries(
        WEEKDAYS.map((d) => [d, { available: true, maxMin: 35 }]),
      ) as Parameters<typeof availability>[0]
      const noRuns = { targetRunMin: 0, longRunMin: 0, runDays: 0, qualitySessions: 0 }
      const strengthOn = (flags: string[], avail: ReturnType<typeof availability>) =>
        place(week({ ...noRuns, strengthSessions: 2, flags }), {
          profile: profile({ availability: avail }),
        }).filter((s) => s.kind === 'strength')
      const narrow = availability(days)
      expect(strengthOn(['strength-block'], narrow)).toHaveLength(0)
      expect(strengthOn([], narrow)).toHaveLength(2)
      // a day with the block budget takes a block session, on that day only
      const roomy = availability({ ...days, wed: { available: true, maxMin: 40 } })
      const one = strengthOn(['strength-block'], roomy)
      expect(one).toHaveLength(1)
      expect(dayOf(one[0]!)).toBe(2)
      expect(one[0]!.durationMin).toBe(P.f7.blockSessionMin.value)
    })

    it('leaves the minutes that the budget needs after a run of the same day', () => {
      // Friday holds a 30-minute easy run and is capped at 55: 25 minutes are left after the run,
      // which a maintenance session fills exactly and a block session does not fit
      const avail = availability({
        mon: { available: false, maxMin: null },
        tue: { available: false, maxMin: null },
        wed: { available: true, maxMin: 100 },
        thu: { available: false, maxMin: null },
        fri: { available: true, maxMin: 55 },
        sat: { available: false, maxMin: null },
        sun: { available: false, maxMin: null },
      })
      const run = (flags: string[]) =>
        place(
          week({
            targetRunMin: 90,
            longRunMin: 60,
            runDays: 2,
            qualitySessions: 0,
            strengthSessions: 1,
            flags,
          }),
          { profile: profile({ availability: avail, longRunDay: 'wed' }) },
        )
      const other = run([]).find((s) => s.kind === 'strength')
      expect(other?.date).toBe(addDays('2026-11-02', 4))
      expect(other?.durationMin).toBe(P.f7.maintenanceSessionMin.value)
      expect(run(['strength-block']).some((s) => s.kind === 'strength')).toBe(false)
    })

    describe('the lifts a week already holds [rule F4]', () => {
      // a re-plan keeps the finished sessions of the current week on its closed days: Tuesday is
      // closed here, and a lift of the week stands on it
      const noRuns = { targetRunMin: 0, longRunMin: 0, runDays: 0, qualitySessions: 0 }
      const closed = (...days: Array<'mon' | 'tue' | 'wed'>) =>
        availability(Object.fromEntries(days.map((d) => [d, { available: false, maxMin: null }])))
      const lift = (date: string) => session({ date, kind: 'strength', durationMin: 40 })
      const placed = (
        planned: number,
        held: SessionSpec[],
        over: { preference?: 0 | 1 | 2; closedDays?: Array<'mon' | 'tue' | 'wed'> } = {},
      ) =>
        place(week({ ...noRuns, strengthSessions: planned, flags: ['strength-block'] }), {
          profile: profile({
            availability: closed(...(over.closedDays ?? ['tue'])),
            strengthPreference: over.preference ?? 2,
          }),
          prev: held,
        }).filter((s) => s.kind === 'strength')

      it('places only the lifts still to come', () => {
        expect(placed(2, [])).toHaveLength(2)
        expect(placed(2, [lift('2026-11-03')])).toHaveLength(1)
        expect(
          placed(2, [lift('2026-11-02'), lift('2026-11-03')], { closedDays: ['mon', 'tue'] }),
        ).toHaveLength(0)
        expect(placed(1, [lift('2026-11-03')])).toHaveLength(0)
      })

      it('counts a lift that was finished and one that was kept alike, and never above the preference', () => {
        const done = { ...lift('2026-11-03'), status: 'completed' }
        expect(placed(2, [done as SessionSpec])).toHaveLength(1)
        // the runner asked for one a week: a lift already held fills it
        expect(placed(2, [lift('2026-11-03')], { preference: 1 })).toHaveLength(0)
      })

      it('prefers a day apart from the lift already held', () => {
        const [added] = placed(2, [lift('2026-11-03')])
        // Tuesday holds the lift: not Monday nor Wednesday while later days are free
        expect([0, 2]).not.toContain(dayOf(added!))
      })

      it('ignores a lift of another week and a lift on an open day', () => {
        expect(placed(2, [lift('2026-10-27')])).toHaveLength(2)
        expect(placed(2, [lift('2026-11-04')], { closedDays: ['tue'] })).toHaveLength(2)
      })
    })

    describe('the room of a session on a day [rules F4, F7, G-1]', () => {
      // one 20-minute run in the last 30 days: the spike guard caps a run at 22 minutes on any day,
      // under both budgets, while the days themselves have no limit
      const reference = {
        runs: [{ date: '2026-10-25', min: 20, distanceM: null, gainM: null, lossM: null }],
        virtualTwoDay: [],
      }
      const noRuns = { targetRunMin: 0, longRunMin: 0, runDays: 0, qualitySessions: 0 }
      const lifts = (
        flags: string[],
        extra: Partial<Parameters<typeof placeWeek>[1]> = {},
      ): SessionSpec[] =>
        placeWeek(week({ ...noRuns, strengthSessions: 2, flags }), {
          profile: profile(),
          zones: ZONES,
          state: state(),
          prevSessions: [],
          limits: reference,
          ...extra,
        }).filter((s) => s.kind === 'strength')
      const everyDay = (over: Partial<DayRule> = {}): DayRule[] =>
        [0, 1, 2, 3, 4, 5, 6].map((i) => ({
          date: addDays('2026-11-02', i),
          held: false,
          gate: false,
          maxRunMin: null,
          quality: false,
          reason: 'niggle',
          windowIds: [],
          ...over,
        }))

      it('is the availability of the day: the reference of a run does not size the gym time', () => {
        for (const flags of [['strength-block'], []]) {
          expect(lifts(flags), flags.join()).toHaveLength(2)
        }
      })

      it('still holds every part on a day a window rules and in a week a window touched', () => {
        expect(lifts(['strength-block'], { dayRules: everyDay() })).toHaveLength(0)
        expect(lifts([], { dayRules: everyDay() })).toHaveLength(0)
        expect(lifts(['strength-block', 'disrupted'])).toHaveLength(0)
        expect(lifts(['disruption-return'])).toHaveLength(0)
      })

      it('sizes the gym time of a start-path week by availability like any other week [spec 8.2, return]', () => {
        for (const flags of [
          ['strength-block', 'ladder-4'],
          ['ladder-4'],
          ['restart-floor'],
          ['injury-return', 'injury-level-1'],
        ]) {
          expect(lifts(flags), flags.join()).toHaveLength(2)
        }
      })

      it('puts no lift on a day a window holds or caps below the budget', () => {
        const held = everyDay({ held: true, maxRunMin: 0 })
        expect(lifts([], { dayRules: held, limits: undefined })).toHaveLength(0)
        const capped = everyDay({ maxRunMin: 20 })
        expect(lifts([], { dayRules: capped, limits: undefined })).toHaveLength(0)
        // a cap that leaves the room of a maintenance session holds one
        const roomy = everyDay({ maxRunMin: 30 })
        expect(lifts([], { dayRules: roomy, limits: undefined })).toHaveLength(2)
        expect(lifts(['strength-block'], { dayRules: roomy, limits: undefined })).toHaveLength(0)
      })
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

    it('places three runs at the day limit when it is under the session minimum, not none [E6, G-1]', () => {
      // the limit of G-1 leaves 17 minutes a day: the floor runs at 17, the week says 3 x 17
      const day = { available: true, maxMin: 17 }
      const sessions = place(
        week({
          index: 0,
          targetRunMin: 51,
          longRunMin: 17,
          runDays: 3,
          qualitySessions: 0,
          flags: ['restart-floor'],
        }),
        {
          profile: profile({
            availability: availability({
              mon: day,
              tue: day,
              wed: day,
              thu: day,
              fri: day,
              sat: day,
              sun: day,
            }),
          }),
        },
      )
      const runs = sessions.filter(isRun)
      expect(runs.map((s) => s.durationMin)).toEqual([17, 17, 17])
      const days = runs.map(dayOf).sort((a, b) => a - b)
      for (let i = 1; i < days.length; i++)
        expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(2)
    })

    it('shares a week held under N a session between its runs, not onto fewer runs', () => {
      const sessions = place(
        week({
          index: 0,
          targetRunMin: 48,
          longRunMin: 16,
          runDays: 3,
          qualitySessions: 0,
          flags: ['restart-floor'],
        }),
      )
      expect(sessions.filter(isRun).map((s) => s.durationMin)).toEqual([16, 16, 16])
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

describe('placeWeek: start-path weeks [rules E6, g-3]', () => {
  const ladderWeek = (rung: number, over: Partial<WeekDraft> = {}) =>
    week({
      index: rung - 1,
      targetRunMin: 63,
      longRunMin: 0,
      runDays: 3,
      qualitySessions: 0,
      flags: ['run-walk', `ladder-${String(rung)}`],
      ...over,
    })
  const runsOf = (sessions: SessionSpec[]) => sessions.filter(isRun)
  const noviceState = state({ experience: 'novice' })
  const placeStart = (
    w: WeekDraft,
    over: { prev?: SessionSpec[]; recent?: number; profile?: ReturnType<typeof profile> } = {},
  ) =>
    placeWeek(w, {
      profile: over.profile ?? profile({ longRunDay: 'sat' }),
      zones: ZONES,
      state: noviceState,
      prevSessions: over.prev ?? [],
      limits:
        over.recent === undefined
          ? undefined
          : {
              runs: [
                {
                  date: '2026-10-25',
                  min: over.recent,
                  distanceM: null,
                  gainM: null,
                  lossM: null,
                },
              ],
              virtualTwoDay: [],
            },
    })

  it('places the three sessions of a rung on non-consecutive days, the longest last, flagged run-walk where they walk', () => {
    const sessions = runsOf(placeStart(ladderWeek(5, { targetRunMin: 62 })))
    expect(sessions).toHaveLength(3)
    // rung 5: 5-3w-5-3w-5 (21 min), 8-5w-8 (21 min), 20 min without a stop
    expect(sessions.map((s) => s.durationMin)).toEqual([21, 21, 20])
    const days = sessions.map(dayOf)
    for (let i = 1; i < days.length; i += 1) {
      expect(days[i]! - days[i - 1]!).toBeGreaterThanOrEqual(2)
    }
    for (const s of sessions) expect(s.kind).toBe('easy')
    // only a session with a walking break is a run-walk session; the continuous 20 minutes is not
    expect(sessions.map((s) => s.flags.includes('run-walk'))).toEqual([true, true, false])
  })

  it('plans no quality, whatever the week asks for', () => {
    const sessions = runsOf(placeStart(ladderWeek(4, { qualitySessions: 2, phase: 'build' })))
    expect(sessions.every((s) => s.kind === 'easy')).toBe(true)
  })

  it('with fewer open days than sessions keeps the later, longer sessions', () => {
    const avail = availability({
      mon: { available: false, maxMin: null },
      tue: { available: false, maxMin: null },
      wed: { available: false, maxMin: null },
      thu: { available: false, maxMin: null },
    })
    const sessions = runsOf(
      placeStart(ladderWeek(5, { targetRunMin: 62 }), {
        profile: profile({ availability: avail }),
      }),
    )
    // Friday to Sunday are open: Friday and Sunday are the largest set of non-consecutive days
    expect(sessions.map(dayOf)).toEqual([4, 6])
    expect(sessions.map((s) => s.durationMin)).toEqual([21, 20])
  })

  it('cuts a session to 1.10x the longest run of the last 30 days: the lesser of the rung and the bound', () => {
    const sessions = runsOf(placeStart(ladderWeek(4, { targetRunMin: 66 }), { recent: 15 }))
    // the bound is the larger of 1.10 x 15 = 16.5 and 15 + 3 (the duration step), so the
    // 21.5-minute session of rung 4 is cut to 18 minutes
    expect(sessions.map((s) => s.durationMin)).toEqual([18, 18, 18])
  })

  it('places a session at the bound when the bound falls under the run day minimum, never under 5 minutes', () => {
    // 10 + 3 = 13 min sits under the 15-min run day minimum, which a ladder session is exempt from
    const sessions = runsOf(placeStart(ladderWeek(1), { recent: 10 }))
    expect(sessions.map((s) => s.durationMin)).toEqual([13, 13, 13])
    // a bound under 5 minutes leaves no session to place
    expect(runsOf(placeStart(ladderWeek(1), { recent: 1 }))).toEqual([])
  })

  it('places the runs of an injury-return level with a rest day between them, from 5 minutes', () => {
    const injury = week({
      index: 0,
      targetRunMin: 10,
      longRunMin: 0,
      runDays: 2,
      qualitySessions: 0,
      flags: ['injury-return', 'injury-level-0'],
    })
    const sessions = runsOf(placeStart(injury))
    expect(sessions.map((s) => s.durationMin)).toEqual([5, 5])
    const days = sessions.map(dayOf)
    expect(days[1]! - days[0]!).toBeGreaterThanOrEqual(P.injuryReturn.restDaysBetween.value + 1)
    for (const s of sessions) expect(s.flags).toContain('injury-return')
  })

  it('holds an injury-return run to 1.10x the longest run: the lesser of the level and the bound', () => {
    const injury = week({
      index: 0,
      targetRunMin: 30,
      longRunMin: 0,
      runDays: 2,
      qualitySessions: 0,
      flags: ['injury-return', 'injury-level-2'],
    })
    // level 3 is 15 min; from a 9-min run the bound is 9 + 3 = 12 (more than 1.10 x 9)
    expect(runsOf(placeStart(injury, { recent: 9 })).map((s) => s.durationMin)).toEqual([12, 12])
    expect(runsOf(placeStart(injury, { recent: 30 })).map((s) => s.durationMin)).toEqual([15, 15])
  })
})
