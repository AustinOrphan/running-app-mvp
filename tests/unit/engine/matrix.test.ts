// The plan matrix [design section 9]: ten synthetic athletes with their goals. For each plan the
// checklist is asserted item by item and every limit is re-derived here from the finished
// sessions, in every week, without calling the code that enforces it. Determinism is asserted too.
import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, mondayOf } from '../../../shared/dates.ts'
import { afterBreak } from '../../../shared/engine/adapt.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { startLevelMin } from '../../../shared/engine/limits.ts'
import { buildPlan, runChecklist } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { EngineInput, PlanDraft, SessionSpec } from '../../../shared/engine/types.ts'
import { problemsOf, windowOf } from './disruption-fixtures.ts'
import {
  ANY_RUN,
  CHECKLIST_IDS,
  describePlanMatrix,
  fullWeeks,
  HARD,
  MIN_RUN,
  planWeeks,
  RUNNING,
  WEEKDAYS,
  weeklyVolume,
} from './matrix-checks.ts'
import { athletes, TODAY, type MatrixAthlete } from './matrix-fixtures.ts'

const all = athletes()
const plans = new Map<string, PlanDraft>(all.map((a) => [a.id, buildPlan(a.input)]))
const planOf = (a: MatrixAthlete): PlanDraft => plans.get(a.id)!

// the default plans: the checklist, the limits and the adequacy of every week (the presets run the
// same checks in `matrix-methods.test.ts`)
describePlanMatrix(all.map((athlete) => ({ athlete, plan: planOf(athlete) })))

describe('plan matrix: per-athlete expectations', () => {
  const get = (id: string) => {
    const a = all.find((x) => x.id === id)!
    return { a, plan: planOf(a), state: estimateState(a.input) }
  }

  it('novice 5 km: three non-consecutive run days, run-walk, no hard work early, peak below the half', () => {
    const { plan, state } = get('novice-5k')
    expect(state.experience).toBe('novice')
    const days = new Map<string, Set<string>>()
    for (const s of plan.sessions.filter((x) => ANY_RUN.has(x.kind))) {
      const w = mondayOf(s.date)
      days.set(w, (days.get(w) ?? new Set()).add(s.date))
    }
    for (const set of days.values()) expect(set.size).toBeLessThanOrEqual(3)
    expect(plan.sessions.some((s) => s.flags.includes('run-walk'))).toBe(true)
    const first = planWeeks(plan)
      .slice(0, 4)
      .map((w) => w.weekStart)
    expect(
      plan.sessions.filter((s) => first.includes(mondayOf(s.date)) && HARD.has(s.kind)),
    ).toEqual([])
  })

  it('levels differ: the novice, half, marathon and 100-mile plans grow in that order', () => {
    const peak = (id: string) => {
      const { a, plan } = get(id)
      const v = weeklyVolume(a, plan)
      return Math.max(...planWeeks(plan).map((w) => v.get(w.weekStart) ?? 0))
    }
    const longest = (id: string) =>
      Math.max(
        ...get(id)
          .plan.sessions.filter((s) => s.kind !== 'race')
          .map((s) => s.durationMin),
      )
    expect(peak('novice-5k')).toBeLessThan(peak('half'))
    expect(peak('half')).toBeLessThan(peak('marathon'))
    expect(peak('marathon')).toBeLessThan(peak('first-100-mile'))
    expect(longest('novice-5k')).toBeLessThan(longest('half'))
    expect(longest('half')).toBeLessThan(longest('marathon'))
    expect(longest('marathon')).toBeLessThan(longest('first-100-mile'))
  })

  it('first 100-mile: volume first, the ultra long-run cap, night and fuel practice, spaced pairs, rest after the race', () => {
    const { a, plan } = get('first-100-mile')
    expect(a.input.goal.distanceClass).toBe('ultra100mi')
    expect(planWeeks(plan).every((w) => w.qualitySessions <= 1)).toBe(true)
    const longest = Math.max(
      ...plan.sessions.filter((s) => s.kind !== 'race').map((s) => s.durationMin),
    )
    expect(longest).toBeLessThanOrEqual(360)
    expect(plan.sessions.some((s) => s.flags.includes('night'))).toBe(true)
    expect(plan.sessions.some((s) => s.flags.includes('fuel-practice'))).toBe(true)
    const day1 = plan.sessions.filter((s) => s.flags.includes('b2b-day1'))
    expect(day1.length).toBeGreaterThan(0)
    for (const d of day1) {
      const d2 = plan.sessions.find(
        (s) => s.date === addDays(d.date, 1) && s.flags.includes('b2b-day2'),
      )
      expect(d2).toBeDefined()
      expect(d2!.durationMin).toBeLessThanOrEqual(d.durationMin)
    }
    for (let i = 1; i < day1.length; i++) {
      expect(daysBetween(day1[i - 1]!.date, day1[i]!.date)).toBeGreaterThanOrEqual(14)
    }
    // a 100-mile race: the first week after it is inside the hold, so it holds rest days only
    const rest = plan.weeks.find((w) => w.flags.includes('post-race'))!
    expect(rest.targetRunMin).toBe(0)
    const inRest = plan.sessions.filter((s) => mondayOf(s.date) === rest.weekStart)
    expect(inRest.length).toBeGreaterThan(0)
    expect(inRest.every((s) => s.kind === 'rest')).toBe(true)
  })

  it('50 km trail: climbing grows toward the course gain and sessions carry gain', () => {
    const { a, plan } = get('trail-50k')
    const gains = planWeeks(plan).map((w) => w.gainTargetM ?? 0)
    expect(Math.max(...gains)).toBeGreaterThan(0)
    expect(plan.sessions.some((s) => (s.gainM ?? 0) > 0)).toBe(true)
    expect(a.input.goal.surface).toBe('trail')
  })

  it('masters: at most six run days in a week and the closed days stay empty', () => {
    const { plan } = get('masters')
    const days = new Map<string, Set<string>>()
    for (const s of plan.sessions.filter((x) => ANY_RUN.has(x.kind) && x.kind !== 'race')) {
      const w = mondayOf(s.date)
      days.set(w, (days.get(w) ?? new Set()).add(s.date))
    }
    for (const set of days.values()) expect(set.size).toBeLessThanOrEqual(6)
    for (const s of plan.sessions) {
      const weekday = WEEKDAYS[daysBetween(mondayOf(s.date), s.date)]
      if (s.kind !== 'race' && s.kind !== 'rest') expect(['mon', 'wed']).not.toContain(weekday)
    }
  })

  it('returning after six weeks off: the first week restarts at half the pre-break week', () => {
    const { a, plan, state } = get('returning')
    expect(state.layoffDays).toBeGreaterThanOrEqual(35)
    const v = weeklyVolume(a, plan)
    const first = v.get(mondayOf(TODAY)) ?? 0
    expect(first).toBeLessThanOrEqual(state.typicalWeekMin * 0.5 * 1.1 + 1)
    expect(first).toBeGreaterThan(0)
  })

  it('prior bone stress injury: the ramp stays at or below 5% a week after the first week', () => {
    const { a, plan, state } = get('prior-bsi')
    expect(state.risk.priorBsi).toBe(true)
    const v = weeklyVolume(a, plan)
    const weeks = planWeeks(plan).filter((w) => w.isRecovery === false && !w.isTaper)
    for (let i = 1; i < weeks.length; i++) {
      const now = v.get(weeks[i]!.weekStart) ?? 0
      const before = Math.max(
        v.get(addDays(weeks[i]!.weekStart, -7)) ?? 0,
        v.get(addDays(weeks[i]!.weekStart, -14)) ?? 0,
      )
      if (before > 0) expect(now).toBeLessThanOrEqual(before * 1.05 + 1)
    }
  })

  it('hot race: heat acclimation weeks, a heat warning and a heat flag on the race', () => {
    const { a, plan } = get('hot-race')
    expect(a.input.goal.raceWbgtC).toBe(27)
    expect(plan.weeks.some((w) => w.flags.includes('heat-acclimation'))).toBe(true)
    expect(plan.warnings.some((w) => w.code === 'heat-above-model-range')).toBe(true)
    const race = plan.sessions.find((s) => s.kind === 'race')!
    expect(race.flags).toContain('heat')
  })

  it('time goals carry a race pace and a prediction with an interval when history allows', () => {
    const { plan } = get('marathon')
    expect(plan.prediction).not.toBeNull()
    expect(plan.prediction!.lowSec).toBeLessThan(plan.prediction!.predictedSec)
    expect(plan.prediction!.highSec).toBeGreaterThan(plan.prediction!.predictedSec)
    const race: SessionSpec = plan.sessions.find((s) => s.kind === 'race')!
    expect(race.target.paceSecPerKm).not.toBeNull()
  })
})

describe('plan adequacy: sparse history, first 100-mile', () => {
  const a = all.find((x) => x.id === 'sparse-100-mile')!
  const plan = planOf(a)

  it('starts with three runs of at least 20 minutes on non-consecutive days', () => {
    const first = plan.sessions.filter(
      (s) => mondayOf(s.date) === mondayOf(TODAY) && ANY_RUN.has(s.kind),
    )
    expect(first).toHaveLength(3)
    for (const s of first) expect(s.durationMin).toBeGreaterThanOrEqual(MIN_RUN)
    const dates = first.map((s) => s.date).sort()
    for (let i = 1; i < dates.length; i++) {
      expect(daysBetween(dates[i - 1]!, dates[i]!)).toBeGreaterThanOrEqual(2)
    }
  })

  it('grows to 6 h in the last specific week with a 3 h long run, and labels feasibility', () => {
    const specific = planWeeks(plan).filter((w) => w.phase === 'specific' && !w.isRecovery)
    const last = specific.at(-1)!
    const volume = weeklyVolume(a, plan)
    const long = Math.max(
      ...plan.sessions
        .filter((s) => mondayOf(s.date) === last.weekStart && RUNNING.has(s.kind))
        .map((s) => s.durationMin),
    )
    // Whatever the label, a not-reachable verdict must come with its warning, and the plan
    // still has to grow to the volume and the long run.
    if (plan.feasibility.label === 'not-reachable') {
      expect(plan.warnings.some((w) => w.code === 'not-reachable')).toBe(true)
    }
    expect(volume.get(last.weekStart) ?? 0).toBeGreaterThanOrEqual(360)
    expect(long).toBeGreaterThanOrEqual(180)
  })

  it('does not collapse to one session a week after the opening weeks', () => {
    const counts = fullWeeks(plan)
      .filter((w) => !w.isTaper)
      .map(
        (w) =>
          plan.sessions.filter((s) => mondayOf(s.date) === w.weekStart && ANY_RUN.has(s.kind))
            .length,
      )
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(2)
  })
})

describe('plan matrix: REDs hold', () => {
  const a = all.find((x) => x.id === 'reds-hold')!
  const plan = planOf(a)
  const open = buildPlan({ ...a.input, screeningFlags: 0 })
  const peak = (p: PlanDraft) => Math.max(...planWeeks(p).map((w) => w.targetRunMin))

  it('reads the screening into the state and warns with a clinician prompt', () => {
    expect(estimateState(a.input).risk.redsFlags).toBe(2)
    const warning = plan.warnings.find((w) => w.code === 'reds-hold')
    expect(warning?.severity).toBe('hold')
    expect(warning?.message).toMatch(/clinician/i)
    expect(warning?.rules).toContain('n-4')
    expect(open.warnings.some((w) => w.code === 'reds-hold')).toBe(false)
  })

  it('holds the weekly level and plans no back-to-back, where the same athlete otherwise grows', () => {
    expect(peak(open)).toBeGreaterThan(peak(plan))
    const loading = planWeeks(plan).filter(
      (w) => !w.isRecovery && !w.isTaper && !w.flags.includes('post-race'),
    )
    const first = loading[0]!.targetRunMin
    for (const w of loading) expect(w.targetRunMin, w.weekStart).toBeLessThanOrEqual(first)
    expect(open.sessions.some((s) => s.flags.includes('b2b-day1'))).toBe(true)
    expect(plan.sessions.some((s) => s.flags.includes('b2b-day1'))).toBe(false)
    expect(plan.sessions.some((s) => s.kind === 'b2b')).toBe(false)
  })

  it('passes every checklist item, the hold item included', () => {
    const item = plan.checklist.find((c) => c.id === 'reds-hold')!
    expect(item.ok).toBe(true)
    expect(item.detail).toMatch(/hold/i)
  })

  describe('with the first week capped under the level by the weekly decision [rules n-4, J5, E6]', () => {
    // The weekly decision of a held plan caps the week it covers (a recovery week before it, a
    // sleep warning, the minutes run), and the weeks after the cap climb back by the ramp to the
    // level the hold keeps. That is the plan returning to its level, not progressing beyond it: the
    // level is the runner's (`startLevelMin`, the macrocycle's own), not the dip of the first week.
    const loading = planWeeks(plan).filter(
      (w) => !w.isRecovery && !w.isTaper && !w.flags.includes('post-race'),
    )
    const level = loading[0]!.targetRunMin
    const lowered = (cut: number, grow?: { index: number; by: number }): PlanDraft => ({
      ...plan,
      weeks: plan.weeks.map((w) => {
        if (w.weekStart === loading[0]!.weekStart) {
          return {
            ...w,
            targetRunMin: Math.round(level * cut),
            longRunMin: Math.round(w.longRunMin * cut),
          }
        }
        if (grow !== undefined && w.weekStart === loading[grow.index]!.weekStart) {
          return { ...w, targetRunMin: level + grow.by }
        }
        return w
      }),
    })
    const hold = (draft: PlanDraft) =>
      runChecklist(draft, a.input).find((c) => c.id === 'reds-hold')!

    it('does not fail the weeks that return to the level', () => {
      const item = hold(lowered(0.75))
      expect(item.ok, item.detail).toBe(true)
      expect(item.detail).toMatch(/hold/i)
    })

    it('still fails a week above the level the hold keeps', () => {
      const item = hold(lowered(0.75, { index: 3, by: 20 }))
      expect(item.ok).toBe(false)
      expect(item.detail).toMatch(/above the held/)
    })
  })

  describe.each([10, 40])(
    'after a layoff of %i days before the screening [rules n-4, J7]',
    (gap) => {
      // The macrocycle holds a progression-held plan at the level after the J7 restart (`afterBreak`):
      // 90% of the typical week after a break of 7 to 14 days, 50% over 28. The item reads that
      // level, not the one before the break, or it would let a plan grow back toward it.
      const input: EngineInput = {
        ...a.input,
        activities: a.input.activities.filter((x) => x.date <= addDays(TODAY, -gap - 1)),
      }
      const state = estimateState(input)
      const restart = startLevelMin(afterBreak(state))
      const held = buildPlan(input)
      const loading = planWeeks(held).filter(
        (w) => !w.isRecovery && !w.isTaper && !w.flags.includes('post-race'),
      )
      const hold = (draft: PlanDraft) =>
        runChecklist(draft, input).find((c) => c.id === 'reds-hold')!

      it('holds the plan at the restart level, under the level before the break', () => {
        expect(state.layoffDays).toBeGreaterThanOrEqual(P.j7.tier1Days.value)
        expect(restart).toBeLessThan(startLevelMin(state))
        expect(loading[0]!.targetRunMin).toBe(restart)
        expect(hold(held).ok, hold(held).detail).toBe(true)
      })

      it('fails a week above the restart level, though it is under the level before the break', () => {
        const above = restart + Math.round((startLevelMin(state) - restart) / 2)
        expect(above).toBeLessThan(startLevelMin(state))
        const grown: PlanDraft = {
          ...held,
          weeks: held.weeks.map((w) =>
            w.weekStart === loading[2]!.weekStart ? { ...w, targetRunMin: above } : w,
          ),
        }
        const item = hold(grown)
        expect(item.ok).toBe(false)
        expect(item.detail).toMatch(
          new RegExp(`${String(above)} min is above the held ${String(restart)} min`),
        )
      })
    },
  )
})

describe.each(all)('plan matrix with a rest window: $label', (a) => {
  // A three-day illness starting in two days: rest through the symptom-free day, easy running after.
  const window = windowOf({
    reason: 'illness-above-neck',
    startDate: addDays(TODAY, 2),
    endDate: addDays(TODAY, 4),
  })
  const plan = buildPlan({ ...a.input, disruptions: [window] })

  it('is the plan of the athlete without the field when the list of windows is empty', () => {
    expect(buildPlan({ ...a.input, disruptions: [] })).toEqual(planOf(a))
    expect(planOf(a).checklist.map((c) => c.id)).toEqual(CHECKLIST_IDS)
  })

  it('passes every item, the window item last, and keeps the label and the race', () => {
    expect(plan.checklist.map((c) => c.id)).toEqual([...CHECKLIST_IDS, 'disruption-window'])
    expect(plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)).toEqual([])
    expect(plan.feasibility.label).toBe(planOf(a).feasibility.label)
    expect(plan.sessions.filter((s) => s.kind === 'race').map((s) => s.date)).toEqual([
      a.input.goal.date,
    ])
  })

  it('rests on the held days, adds no minutes and keeps the invariants of the window', () => {
    expect(problemsOf(a, [window], plan, planOf(a))).toEqual([])
    const held = [2, 3, 4, 5].map((k) => addDays(TODAY, k))
    for (const date of held) {
      expect(plan.sessions.filter((s) => s.date === date).map((s) => s.kind)).toEqual(['rest'])
    }
  })
})

// The matrix profiles ask for no strength, so the plans above hold no lift. This variant asks for two
// a week, the most a plan holds: a lift is budgeted at 40 minutes in a block week and 25 otherwise
// and is placed after the runs, so it changes no run, no week's running minutes and nothing else in
// the plan [rules F7, F4, E5]. A lift never displaces a run: a week with no day for it holds fewer
// lifts and never fewer runs. The room of a lift on a day is the runner's availability; the 30-day
// reference of G-1 limits a run and not the gym time, except on a day or in a week that a window or a
// post-race step already limits. A start-path week (ladder, injury-return, restart floor) takes its
// lifts like any other [design 8.2, return]. The weeks that hold fewer than planned are listed, by
// athlete: `masters` (five open days) holds one lift in the weeks whose hard days, long run and the
// day before it leave a single legal day.
const SHORT_LIFT_WEEKS: Record<string, string[]> = {
  masters: [
    '2026-10-19: 1 of 2',
    '2026-11-02: 1 of 2',
    '2026-11-09: 1 of 2',
    '2026-11-16: 1 of 2',
    '2026-11-23: 1 of 2',
    '2026-11-30: 1 of 2',
    '2026-12-07: 1 of 2',
  ],
}

describe.each(all)('strength sessions: $label', (a) => {
  const asked = buildPlan({ ...a.input, profile: { ...a.input.profile, strengthPreference: 2 } })
  const liftsOf = (plan: PlanDraft, weekStart: string) =>
    plan.sessions.filter((s) => s.kind === 'strength' && mondayOf(s.date) === weekStart)

  it('budgets a block week at 40 minutes and every other week at 25, and cites F7', () => {
    for (const w of asked.weeks) {
      for (const s of liftsOf(asked, w.weekStart)) {
        const budget = w.flags.includes('strength-block')
          ? P.f7.blockSessionMin.value
          : P.f7.maintenanceSessionMin.value
        expect(s.durationMin, s.date).toBe(budget)
        expect(s.rules, s.date).toEqual(
          a.isUltra ? ['F-lib', 'F4', 'E5', 'F7', 'H10'] : ['F-lib', 'F4', 'E5', 'F7'],
        )
      }
    }
    expect(asked.sessions.some((s) => s.kind === 'strength')).toBe(true)
  })

  it('holds no more lifts than a week plans, and the weeks with fewer are the listed ones', () => {
    const short: string[] = []
    for (const w of asked.weeks) {
      const n = liftsOf(asked, w.weekStart).length
      expect(n, w.weekStart).toBeLessThanOrEqual(w.strengthSessions)
      if (n < w.strengthSessions) short.push(`${w.weekStart}: ${n} of ${w.strengthSessions}`)
    }
    expect(short).toEqual(SHORT_LIFT_WEEKS[a.id] ?? [])
  })

  it('changes no run and no week target against the plan with no strength asked', () => {
    const none = planOf(a)
    expect(asked.sessions.filter((s) => s.kind !== 'strength')).toEqual(
      none.sessions.filter((s) => s.kind !== 'strength'),
    )
    const runWeek = ({ strengthSessions: _s, ...week }: PlanDraft['weeks'][number]) => week
    expect(asked.weeks.map(runWeek)).toEqual(none.weeks.map(runWeek))
  })
})
