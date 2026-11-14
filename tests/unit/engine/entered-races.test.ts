// Races the runner entered before the goal race [rules K6, H12, task SR1]: the race session, the
// easing before it by priority, the recovery window after it, the taper and two races close together.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { enteredRacePurpose } from '../../../shared/copy/enteredRaces.ts'
import { assertCleanCopy } from '../../../shared/copy/lint.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { plannedRaces } from '../../../shared/engine/enteredRaces.ts'
import { runningMinutes } from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  EngineInput,
  EnteredRace,
  GoalModel,
  SessionSpec,
} from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'

const base = athletes().find((a) => a.id === 'first-100-mile')!.input
const TUNE_UP_DATE = '2026-12-05' // a Saturday, six weeks after the fixture's today

function race(priority: 'B' | 'C', date: string, over: Partial<GoalModel> = {}): EnteredRace {
  const distanceM = over.distanceM ?? 40_000
  return {
    priority,
    goal: {
      ...base.goal,
      goalId: `tune-${priority}-${date}`,
      name: `Synthetic tune-up ${date}`,
      date,
      distanceM,
      gainM: 0,
      lossM: 0,
      surface: 'road',
      goalType: 'finish',
      targetTimeSec: null,
      startTime: null,
      isUltra: false,
      distanceClass: 'marathon',
      expectedDurationSec: 9000,
      crossesDarkness: false,
      raceWbgtC: null,
      ...over,
    },
  }
}

function planWith(races: EnteredRace[]) {
  return buildPlan({ ...base, races })
}
const without = buildPlan(base)

const on = (sessions: readonly SessionSpec[], from: string, to = from) =>
  sessions.filter((s) => s.date >= from && s.date <= to)
const isRun = (s: SessionSpec) => runningMinutes([s]) > 0
const QUALITY = new Set([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
  'strides',
])

describe('a B race six weeks before the goal race', () => {
  const plan = planWith([race('B', TUNE_UP_DATE)])

  it('gives the day a race session and nothing else', () => {
    const day = on(plan.sessions, TUNE_UP_DATE)
    expect(day.map((s) => s.kind)).toEqual(['race'])
    expect(day[0]!.title).toBe('Race: Synthetic tune-up 2026-12-05')
    expect(day[0]!.rules).toEqual(expect.arrayContaining(['K6', 'H12']))
    // the goal race keeps its own session
    expect(plan.sessions.filter((s) => s.kind === 'race').map((s) => s.date)).toEqual([
      TUNE_UP_DATE,
      base.goal.date,
    ])
  })

  it('eases the two days before it: easy running only, a shake-out the day before', () => {
    const days = on(
      plan.sessions,
      addDays(TUNE_UP_DATE, -P.k6.tuneUpBEasyDays.value),
      addDays(TUNE_UP_DATE, -1),
    )
    for (const s of days.filter(isRun)) {
      expect(QUALITY.has(s.kind), s.kind).toBe(false)
      expect(s.kind).not.toBe('long')
    }
    for (const s of on(plan.sessions, addDays(TUNE_UP_DATE, -1)).filter(isRun)) {
      expect(s.durationMin).toBeLessThanOrEqual(P.k6.tuneUpBDayBeforeMaxMin.value)
    }
  })

  it('plans the H12 window after it: a rest hold, capped runs, no quality', () => {
    const rest = on(plan.sessions, addDays(TUNE_UP_DATE, 1))
    expect(rest.map((s) => s.kind)).toEqual(['rest'])
    const step1 = on(plan.sessions, addDays(TUNE_UP_DATE, 2), addDays(TUNE_UP_DATE, 8)).filter(
      isRun,
    )
    expect(step1.length).toBeLessThanOrEqual(3)
    for (const s of step1) expect(s.durationMin).toBeLessThanOrEqual(40)
    const quiet = on(plan.sessions, addDays(TUNE_UP_DATE, 1), addDays(TUNE_UP_DATE, 15))
    for (const s of quiet.filter(isRun)) expect(QUALITY.has(s.kind), s.kind).toBe(false)
    for (const s of on(plan.sessions, addDays(TUNE_UP_DATE, 9), addDays(TUNE_UP_DATE, 15)).filter(
      isRun,
    )) {
      expect(s.durationMin).toBeLessThanOrEqual(P.h12.step2RunMaxMin.value)
    }
  })

  it('never plans more running in a week than the plan without the race', () => {
    const weeks = new Set(plan.sessions.map((s) => mondayOf(s.date)))
    for (const weekStart of weeks) {
      const inWeek = (s: SessionSpec) => mondayOf(s.date) === weekStart
      expect(runningMinutes(plan.sessions.filter(inWeek))).toBeLessThanOrEqual(
        runningMinutes(without.sessions.filter(inWeek)),
      )
    }
  })

  it('leaves the weeks before the easing as the plan without the race has them', () => {
    const cut = addDays(TUNE_UP_DATE, -P.k6.tuneUpBEasyDays.value)
    expect(plan.sessions.filter((s) => s.date < cut)).toEqual(
      without.sessions.filter((s) => s.date < cut),
    )
  })

  it('passes the plan checks and draws the weeks the window covers as recovery weeks', () => {
    expect(plan.checklist.filter((item) => !item.ok)).toEqual([])
    const recovery = plan.weeks.filter((w) => w.flags.includes('race-recovery'))
    expect(recovery.map((w) => w.weekStart)).toContain(mondayOf(addDays(TUNE_UP_DATE, 8)))
    for (const week of recovery) expect(week.isRecovery).toBe(true)
  })

  it('is deterministic and stamps the Params version', () => {
    expect(planWith([race('B', TUNE_UP_DATE)]).sessions).toEqual(plan.sessions)
    expect(plan.paramsVersion).toBe('2026-11-14.3')
  })
})

describe('a C race', () => {
  it('is eased lighter than a B race: one day, a longer shake-out', () => {
    expect(P.k6.tuneUpCEasyDays.value).toBeLessThan(P.k6.tuneUpBEasyDays.value)
    expect(P.k6.tuneUpCDayBeforeMaxMin.value).toBeGreaterThan(P.k6.tuneUpBDayBeforeMaxMin.value)
    const plan = planWith([race('C', TUNE_UP_DATE)])
    for (const s of on(plan.sessions, addDays(TUNE_UP_DATE, -1)).filter(isRun)) {
      expect(s.durationMin).toBeLessThanOrEqual(P.k6.tuneUpCDayBeforeMaxMin.value)
    }
    // the second day before is not eased: the plan keeps what it had there
    const second = addDays(TUNE_UP_DATE, -2)
    expect(on(plan.sessions, second)).toEqual(on(without.sessions, second))
  })

  it('gets the same race session and the same recovery as a B race', () => {
    const b = planWith([race('B', TUNE_UP_DATE)])
    const c = planWith([race('C', TUNE_UP_DATE)])
    const after = (p: typeof b) =>
      on(p.sessions, addDays(TUNE_UP_DATE, 1), addDays(TUNE_UP_DATE, 20))
    expect(after(c)).toEqual(after(b))
  })
})

describe('a shorter race', () => {
  it('is eased and raced but has no recovery window', () => {
    const tenK = race('B', TUNE_UP_DATE, {
      distanceM: 10_000,
      distanceClass: '10k',
      expectedDurationSec: 3000,
    })
    const plan = planWith([tenK])
    expect(on(plan.sessions, TUNE_UP_DATE).map((s) => s.kind)).toEqual(['race'])
    const next = addDays(TUNE_UP_DATE, 1)
    expect(on(plan.sessions, next)).toEqual(on(without.sessions, next))
  })
})

describe('a race in the taper of the goal race', () => {
  const date = addDays(base.goal.date, -10)
  const plan = planWith([race('B', date)])

  it('stays as entered, with a note and no easing or window of its own', () => {
    expect(on(plan.sessions, date).map((s) => s.kind)).toEqual(['race'])
    expect(plan.warnings.map((w) => w.code)).toContain('entered-race-in-taper')
    const before = addDays(date, -1)
    expect(on(plan.sessions, before)).toEqual(on(without.sessions, before))
    const after = addDays(date, 1)
    expect(on(plan.sessions, after, addDays(date, 6))).toEqual(
      on(without.sessions, after, addDays(date, 6)),
    )
  })
})

describe('two races close together', () => {
  const first = race('B', TUNE_UP_DATE)
  const second = race('C', addDays(TUNE_UP_DATE, 10), {
    distanceM: 10_000,
    distanceClass: '10k',
    expectedDurationSec: 3000,
  })
  const plan = planWith([first, second])

  it('passes the plan checks', () => {
    expect(plan.checklist.filter((item) => !item.ok)).toEqual([])
  })

  it('keeps both races, ends the first window at the second and says so', () => {
    expect(on(plan.sessions, second.goal.date).map((s) => s.kind)).toEqual(['race'])
    expect(on(plan.sessions, first.goal.date).map((s) => s.kind)).toEqual(['race'])
    expect(plan.warnings.map((w) => w.code)).toContain('entered-races-close')
  })

  it('never plans more running in a week than the plan without them', () => {
    for (const weekStart of new Set(plan.sessions.map((s) => mondayOf(s.date)))) {
      const inWeek = (s: SessionSpec) => mondayOf(s.date) === weekStart
      expect(runningMinutes(plan.sessions.filter(inWeek))).toBeLessThanOrEqual(
        runningMinutes(without.sessions.filter(inWeek)),
      )
    }
  })

  it('keeps one race for two entered on the same day', () => {
    const input: EngineInput = {
      ...base,
      races: [race('C', TUNE_UP_DATE), race('B', TUNE_UP_DATE)],
    }
    expect(plannedRaces(input).map((r) => r.priority)).toEqual(['B'])
  })
})

describe('races that are not planned around', () => {
  it('ignores a race after the goal race, one today or earlier, and the goal itself', () => {
    const input: EngineInput = {
      ...base,
      races: [
        race('B', addDays(base.goal.date, 14)),
        race('B', base.today),
        race('B', addDays(base.today, -3)),
        { priority: 'B', goal: base.goal },
      ],
    }
    expect(plannedRaces(input)).toEqual([])
    expect(buildPlan(input).sessions).toEqual(without.sessions)
  })

  it('is the plan it always was with no entered races', () => {
    expect(buildPlan({ ...base, races: [] }).sessions).toEqual(without.sessions)
  })
})

describe('the words', () => {
  it('pass the copy lint and never suggest entering a race', () => {
    for (const priority of ['B', 'C'] as const) {
      for (const inTaper of [false, true]) {
        for (const recovery of [false, true]) {
          const text = enteredRacePurpose({ priority, inTaper, recovery })
          assertCleanCopy(text)
          expect(text).not.toMatch(/\b(add|enter|sign up|consider|another race|tune-up)\b/i)
        }
      }
    }
    for (const w of planWith([race('B', TUNE_UP_DATE), race('C', addDays(TUNE_UP_DATE, 5))])
      .warnings) {
      assertCleanCopy(w.message)
    }
  })
})
