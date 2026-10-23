// A week already run past its plan [rules G-2, G-3, G-6]: the minutes run are a fact, so the week
// is taken as run (its target is at least what was logged, and it is flagged), the checklist does
// not fail on logged minutes, and the weeks after it neither rise on the strength of it nor make
// anything up. Synthetic runners; no personal data.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { runChecklist } from '../../../shared/engine/checklist.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { plannedMinOf, runningMinutes } from '../../../shared/engine/limits.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import type { Activity } from '../../../shared/types.ts'
import { activity, goal, input, profile } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

const MONDAY = '2026-10-19'
const WEDNESDAY = '2026-10-21'
const THURSDAY = '2026-10-22'
const FRIDAY = '2026-10-23'
const OFF = { available: false, maxMin: null }

type Existing = NonNullable<EngineInput['existing']>

const failed = (plan: PlanDraft) =>
  plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)
const weekOf = (plan: PlanDraft, weekStart: string) =>
  plan.weeks.find((w) => w.weekStart === weekStart)!
const nextWeek = (weekStart: string, k: number) => addDays(weekStart, 7 * k)

/** A run of `minutes` on `date`, as a logged activity. */
function logged(date: string, minutes: number, id: string): Activity {
  return activity(date, {
    id,
    durationSec: minutes * 60,
    movingSec: minutes * 60,
    distanceM: minutes * 170,
  })
}

/** The runs of the four weeks before `monday`: a 20-minute and a 10-minute run each week. */
function history(monday: string): Activity[] {
  const out: Activity[] = []
  for (let w = 1; w <= 4; w++) {
    for (const [dow, minutes] of [
      [1, 20],
      [5, 10],
    ] as const) {
      const date = addDays(monday, dow - 7 * w)
      out.push(logged(date, minutes, `h-${date}`))
    }
  }
  return out
}

/**
 * A recreational runner with a 30-minute typical week and a 100-mile goal 33 weeks out, who runs
 * on Monday, Wednesday and the weekend: the plan opens on the 3 x 20 restart floor week (60 min).
 */
function floorRunner(today: string): EngineInput {
  const p = profile({ runningSinceYear: null, birthYear: null, sex: 'unspecified' })
  return input({
    today,
    activities: history(MONDAY),
    profile: { ...p, availability: { ...p.availability, tue: OFF, thu: OFF, fri: OFF } },
    goal: {
      ...goal(),
      name: 'Synthetic 100 miles',
      date: '2027-06-13',
      distanceM: 160_934,
      gainM: 4500,
      lossM: 4500,
      surface: 'trail',
      goalType: 'finish',
      isUltra: true,
      distanceClass: 'ultra100mi',
      expectedDurationSec: 30 * 3600,
    },
  })
}

/** The plan with its Monday and Wednesday runs done at the given lengths, as stored rows. */
function ranTwo(plan: PlanDraft, long: number, short: number) {
  const runs = [logged(MONDAY, long, 'done-mon'), logged(WEDNESDAY, short, 'done-wed')]
  const existing: Existing = {
    weeks: plan.weeks,
    sessions: plan.sessions.map((s, i) => {
      const run = s.kind === 'strength' ? undefined : runs.find((r) => r.date === s.date)
      return {
        ...s,
        id: `s${String(i)}`,
        status: run === undefined ? 'planned' : 'completed',
        activityId: run?.id ?? null,
      }
    }),
  }
  return { runs, existing }
}

describe('a restart floor week run past its minutes [rules G-2, E6, G-6]', () => {
  const first = floorRunner(MONDAY)
  const plan = buildPlan(first)
  const { runs, existing } = ranTwo(plan, 44, 35)
  const out = replan({
    ...first,
    today: THURSDAY,
    activities: [...first.activities, ...runs],
    existing,
  })
  const weekStart = mondayOf(THURSDAY)

  it('opens on the 60-minute floor week, with a clean checklist', () => {
    expect(weekOf(plan, weekStart).targetRunMin).toBe(60)
    expect(weekOf(plan, weekStart).flags).toContain('restart-floor')
    expect(failed(plan)).toEqual([])
  })

  it('passes the checklist after 44 + 35 minutes were run in the week', () => {
    expect(failed(out.draft)).toEqual([])
  })

  it('takes the week as run: the target is the 79 minutes logged, and the week is flagged', () => {
    const week = weekOf(out.draft, weekStart)
    expect(week.targetRunMin).toBe(79)
    expect(week.flags).toContain('overshoot')
    expect(week.flags).toContain('restart-floor')
  })

  it('adds no run to the rest of the week', () => {
    const rest = out.draft.sessions.filter(
      (s) => s.date >= THURSDAY && mondayOf(s.date) === weekStart,
    )
    expect(runningMinutes(rest)).toBe(0)
  })

  it('plans the weeks after it as a week run as planned does: nothing rises, nothing is made up', () => {
    const asPlanned = ranTwo(plan, 20, 20)
    const control = replan({
      ...first,
      today: THURSDAY,
      activities: [...first.activities, ...asPlanned.runs],
      existing: asPlanned.existing,
    })
    expect(weekOf(control.draft, weekStart).flags).not.toContain('overshoot')
    expect(weekOf(control.draft, weekStart).targetRunMin).toBe(60)
    // The next block: the 44-minute run raises the reference of G-1 and so the long runs, further
    // out; the weekly minutes are the ramp from the planned week either way.
    const block = (draft: PlanDraft) =>
      [1, 2, 3, 4].map((k) => weekOf(draft, nextWeek(weekStart, k)).targetRunMin)
    expect(block(out.draft)).toEqual(block(control.draft))
    expect(block(out.draft)).toEqual(
      [1, 2, 3, 4].map((k) => weekOf(plan, nextWeek(weekStart, k)).targetRunMin),
    )
  })

  it('holds the next week at the ramp from the plan, not from the 79 minutes, and ramps on from there', () => {
    const planned = weekOf(plan, weekStart).targetRunMin
    const one = weekOf(out.draft, nextWeek(weekStart, 1)).targetRunMin
    const two = weekOf(out.draft, nextWeek(weekStart, 2)).targetRunMin
    // the lesser of the ramp from the planned week and the ramp from the minutes run [G-6]
    expect(one).toBeLessThanOrEqual(Math.floor(Math.min(planned, 79) * 1.1 + 1e-9))
    expect(one).toBeLessThan(Math.floor(79 * 1.1))
    expect(two).toBeGreaterThan(one)
    expect(two).toBeLessThanOrEqual(Math.floor(one * 1.1 + 1e-9))
  })

  it('keeps the same weeks when the week is re-planned again the next day', () => {
    const again = replan({
      ...first,
      today: FRIDAY,
      activities: [...first.activities, ...runs],
      existing: {
        weeks: out.draft.weeks,
        sessions: out.draft.sessions.map((s, i) => ({
          ...s,
          id: `t${String(i)}`,
          status: s.date < FRIDAY ? 'completed' : 'planned',
          activityId: runs.find((r) => r.date === s.date)?.id ?? null,
        })),
      },
    })
    expect(failed(again.draft)).toEqual([])
    expect(again.draft.weeks.map((w) => [w.weekStart, w.targetRunMin])).toEqual(
      out.draft.weeks.map((w) => [w.weekStart, w.targetRunMin]),
    )
  })
})

describe('a plan generated after the week was run past its minutes [rules G-2, G-6]', () => {
  const first = floorRunner(FRIDAY)
  const runs = [logged(MONDAY, 44, 'done-mon'), logged(WEDNESDAY, 35, 'done-wed')]
  const plan = buildPlan({ ...first, activities: [...first.activities, ...runs] })

  it('passes the checklist and takes the 79 minutes as the week', () => {
    expect(failed(plan)).toEqual([])
    const week = weekOf(plan, MONDAY)
    expect(week.targetRunMin).toBe(79)
    expect(week.flags).toContain('overshoot')
  })
})

describe('the checklist and logged minutes [rules G-2, G-3]', () => {
  const first = floorRunner(MONDAY)
  const plan = buildPlan(first)
  const { runs, existing } = ranTwo(plan, 44, 35)
  const today = THURSDAY
  const withRuns: EngineInput = {
    ...first,
    today,
    activities: [...first.activities, ...runs],
    existing,
  }
  const out = replan(withRuns)

  it('does not fail a week for the minutes already run in it', () => {
    const item = runChecklist(out.draft, withRuns).find((c) => c.id === 'progression')!
    expect(item.ok).toBe(true)
  })

  it('still fails a week that plans more running on top of an overshot week', () => {
    const copy = structuredClone(out.draft)
    const extra = copy.sessions.find((s) => s.date >= today && s.kind === 'easy')
    const template = copy.sessions.find((s) => s.kind === 'easy')!
    copy.sessions.push({ ...(extra ?? template), date: addDays(today, 3), durationMin: 30 })
    const item = runChecklist(copy, withRuns).find((c) => c.id === 'progression')!
    expect(item.ok).toBe(false)
    expect(item.detail).toContain(`week of ${MONDAY}`)
  })
})

describe('a loading week of an established runner run past its target [rules G-2, G-6]', () => {
  const half = athletes().find((a) => a.id === 'half')!
  const first: EngineInput = { ...half.input, today: MONDAY }
  const plan = buildPlan(first)
  const planned = weekOf(plan, MONDAY).targetRunMin
  // 150 + 46 + 120 minutes by Wednesday, against a planned week of 215
  const runs = [
    logged(MONDAY, 150, 'big-mon'),
    logged(addDays(MONDAY, 1), 46, 'tue'),
    logged(WEDNESDAY, 120, 'big-wed'),
  ]
  const rowsFor = (draft: PlanDraft, today: string, done: Activity[]): Existing => ({
    weeks: draft.weeks,
    sessions: draft.sessions.map((s, i) => ({
      ...s,
      id: `s${String(i)}`,
      status: s.date < today && s.kind !== 'strength' ? 'completed' : 'planned',
      activityId: done.find((r) => r.date === s.date && s.kind !== 'strength')?.id ?? null,
    })),
  })
  const replanOn = (today: string, draft: PlanDraft, done: Activity[] = runs) =>
    replan({
      ...first,
      today,
      activities: [...first.activities, ...done],
      existing: rowsFor(draft, today, done),
    })
  const out = replanOn(THURSDAY, plan)
  const targets = (draft: PlanDraft, weeks = 6) =>
    draft.weeks.slice(0, weeks).map((w) => [w.weekStart, w.targetRunMin])

  it('takes the week as run, flags it, and remembers the minutes it was planned at', () => {
    const week = weekOf(out.draft, MONDAY)
    expect(planned).toBeLessThan(316)
    expect(week.targetRunMin).toBe(316)
    expect(week.flags).toContain('overshoot')
    expect(plannedMinOf(week)).toBe(planned)
    expect(failed(out.draft)).toEqual([])
    expect(out.draft.warnings.find((w) => w.code === 'overshoot-week')?.severity).toBe('info')
  })

  it('leaves the weeks after it as they were planned', () => {
    expect(targets(out.draft).slice(1)).toEqual(targets(plan).slice(1))
  })

  it('draws the same weeks when the week is re-planned again, and on the next Monday', () => {
    const again = replanOn(FRIDAY, out.draft)
    expect(failed(again.draft)).toEqual([])
    expect(targets(again.draft)).toEqual(targets(out.draft))
    expect(weekOf(again.draft, MONDAY).flags).toEqual(weekOf(out.draft, MONDAY).flags)

    const monday = replanOn(nextWeek(MONDAY, 1), out.draft)
    expect(failed(monday.draft)).toEqual([])
    expect(targets(monday.draft)).toEqual(targets(out.draft))
  })

  it('keeps a recovery week at its target when it is run past, and the checklist still passes', () => {
    const recovery = nextWeek(MONDAY, 1)
    expect(weekOf(plan, recovery).isRecovery).toBe(true)
    const heavy = [
      ...runs,
      logged(recovery, 100, 'rec-mon'),
      logged(addDays(recovery, 2), 120, 'rec-wed'),
    ]
    const today = addDays(recovery, 3)
    const week = replanOn(today, out.draft, heavy)
    expect(weekOf(week.draft, recovery).targetRunMin).toBe(weekOf(plan, recovery).targetRunMin)
    expect(weekOf(week.draft, recovery).flags).not.toContain('overshoot')
    expect(failed(week.draft)).toEqual([])
  })
})

describe('the weeks after an overshot restart floor week, once the weeks before it were outrun [rules G-2, G-6, E6, J7]', () => {
  // A 100-mile runner back after a layoff. When the plan is made, the last four weeks with a run
  // hold 100, 30, 30 and 30 minutes, a typical week of 30: the plan opens on the 60-minute floor.
  // Two more runs of the week before the plan (30 + 34) are logged afterwards and make it a
  // 94-minute week, which lifts the typical week to 62, past the floor. On Wednesday the first
  // week of the plan stands at 44 + 35 = 79 minutes.
  const planning = [
    logged('2026-08-25', 40, 'old-1'),
    logged('2026-08-28', 60, 'old-2'),
    logged('2026-09-15', 30, 'old-3'),
    logged('2026-10-06', 30, 'old-4'),
    logged('2026-10-13', 30, 'old-5'),
  ]
  const late = [logged('2026-10-15', 30, 'late-1'), logged('2026-10-17', 34, 'late-2')]
  const first: EngineInput = { ...floorRunner(MONDAY), activities: planning }
  const plan = buildPlan(first)
  const { runs, existing } = ranTwo(plan, 44, 35)
  const history = [...planning, ...late, ...runs]
  const replanOn = (today: string, rows: Existing) =>
    replan({ ...first, today, activities: history.filter((a) => a.date <= today), existing: rows })
  const out = replanOn(THURSDAY, existing)
  const targets = (draft: PlanDraft, weeks = 6) =>
    draft.weeks.slice(0, weeks).map((w) => w.targetRunMin)
  const storedRows = (draft: PlanDraft, today: string): Existing => ({
    weeks: draft.weeks,
    sessions: draft.sessions.map((s, i) => ({
      ...s,
      id: `r${String(i)}`,
      status: s.date < today && s.kind !== 'strength' ? 'completed' : 'planned',
      activityId: runs.find((r) => r.date === s.date)?.id ?? null,
    })),
  })

  it('opens on the 60-minute floor from a typical week of 30, and ends the layoff with the runs', () => {
    expect(estimateState({ ...first, activities: planning }).typicalWeekMin).toBe(30)
    expect(weekOf(plan, MONDAY).targetRunMin).toBe(60)
    expect(weekOf(plan, MONDAY).flags).toContain('restart-floor')
    const now = estimateState({ ...first, today: THURSDAY, activities: history })
    expect(now.typicalWeekMin).toBeGreaterThanOrEqual(60)
    expect(now.weeks.find((w) => w.weekStart === '2026-10-12')?.runMin).toBe(94)
  })

  it('takes the week as run, still the floor week it opened as, and passes the checklist', () => {
    const week = weekOf(out.draft, MONDAY)
    expect(week.targetRunMin).toBe(79)
    expect(week.flags).toContain('overshoot')
    expect(week.flags).toContain('restart-floor')
    expect(plannedMinOf(week)).toBe(60)
    expect(failed(out.draft)).toEqual([])
  })

  // The loading weeks after the first week of the plan (a recovery week sits where the cadence of
  // the runner's typical week puts it, which is a separate matter).
  const loadingAfter = (draft: PlanDraft, count = 4) =>
    draft.weeks
      .filter((w) => w.weekStart > MONDAY && !w.isRecovery && !w.isTaper)
      .slice(0, count)
      .map((w) => w.targetRunMin)

  it('draws the weeks after it from the plan they continue, not below a Monday re-plan of the same history', () => {
    const monday = replanOn(nextWeek(MONDAY, 1), existing)
    expect(failed(monday.draft)).toEqual([])
    const thursday = loadingAfter(out.draft)
    const control = loadingAfter(monday.draft)
    expect(control[0]).toBe(66)
    thursday.forEach((minutes, i) => {
      expect(minutes, `loading week ${String(i + 1)}`).toBeGreaterThanOrEqual(control[i]!)
    })
    // the plan before the week was run: the weeks after it are the same weeks
    expect(thursday).toEqual(loadingAfter(plan))
  })

  it('keeps the weeks after it inside the ramp from the weeks actually run (94, then 79 minutes)', () => {
    const series: Array<{ minutes: number; recovery: boolean }> = [
      { minutes: 94, recovery: false },
      { minutes: 79, recovery: false },
      ...out.draft.weeks
        .slice(1, 8)
        .map((w) => ({ minutes: w.targetRunMin, recovery: w.isRecovery })),
    ]
    const loading: number[] = []
    series.forEach((w, i) => {
      if (i >= 2 && !w.recovery) {
        const base = Math.max(...loading.slice(-2))
        expect(w.minutes, `week ${String(i - 1)}`).toBeLessThanOrEqual(
          Math.floor(base * 1.1 + 1e-9),
        )
      }
      if (!w.recovery) loading.push(w.minutes)
    })
    expect(weekOf(out.draft, nextWeek(MONDAY, 1)).targetRunMin).toBeGreaterThan(60)
  })

  it('draws the same weeks when the week is re-planned again on Friday and on the next Monday', () => {
    const friday = replanOn(FRIDAY, storedRows(out.draft, FRIDAY))
    expect(failed(friday.draft)).toEqual([])
    expect(targets(friday.draft)).toEqual(targets(out.draft))
    expect(weekOf(friday.draft, MONDAY).flags).toEqual(weekOf(out.draft, MONDAY).flags)
    const monday = replanOn(nextWeek(MONDAY, 1), storedRows(friday.draft, nextWeek(MONDAY, 1)))
    expect(failed(monday.draft)).toEqual([])
    expect(loadingAfter(monday.draft, 3)).toEqual(loadingAfter(out.draft, 3))
  })

  it('keeps the floor week and the weeks after it when the week is re-planned on Tuesday, before the overshoot', () => {
    const tuesday = addDays(MONDAY, 1)
    const early = replanOn(tuesday, {
      weeks: plan.weeks,
      sessions: plan.sessions.map((s, i) => ({
        ...s,
        id: `e${String(i)}`,
        status: s.date === MONDAY ? 'completed' : 'planned',
        activityId: s.date === MONDAY && s.kind !== 'strength' ? 'done-mon' : null,
      })),
    })
    expect(failed(early.draft)).toEqual([])
    expect(weekOf(early.draft, MONDAY).targetRunMin).toBe(60)
    expect(weekOf(early.draft, MONDAY).flags).toContain('restart-floor')
    expect(weekOf(early.draft, MONDAY).flags).not.toContain('overshoot')
    expect(loadingAfter(early.draft)).toEqual(loadingAfter(out.draft))
  })

  it('leaves a runner under a progression hold with the typical week, not the floor', () => {
    const held = replan({
      ...first,
      today: THURSDAY,
      activities: history,
      existing,
      screeningFlags: 2,
    })
    expect(weekOf(held.draft, MONDAY).flags).not.toContain('restart-floor')
  })

  describe('a plan generated from scratch on that Thursday [rules G-2, G-3, E6, J7]', () => {
    // The same history, with no plan to continue (the "Regenerate plan" button). The weeks two and
    // three before the week of the plan hold 30 and 0 minutes, so the 2-week ceiling of its first
    // week is 30 x 1.3 = 39 minutes, with 79 already run in it and 94 the week before.
    const fresh = buildPlan({ ...first, today: THURSDAY, activities: history })
    const control = replanOn(nextWeek(MONDAY, 1), existing)

    it('takes the 79 minutes run as the week, planned from the start level and not from the ceiling of the weeks before the layoff', () => {
      const week = weekOf(fresh, MONDAY)
      expect(week.targetRunMin).toBeGreaterThanOrEqual(79)
      expect(week.flags).toContain('overshoot')
      // the floor week the runner has outrun, not the 39 minutes of the stale ceiling
      expect(plannedMinOf(week)).toBeGreaterThanOrEqual(60)
      expect(failed(fresh)).toEqual([])
      expect(
        fresh.sessions.filter((s) => s.date >= THURSDAY && mondayOf(s.date) === MONDAY),
      ).toEqual([])
    })

    it('draws the weeks after it from that level, not below a Monday re-plan of the continued plan', () => {
      const weeks = loadingAfter(fresh)
      const monday = loadingAfter(control.draft)
      expect(monday.slice(0, 3)).toEqual([66, 72, 79])
      weeks.forEach((minutes, i) => {
        expect(minutes, `loading week ${String(i + 1)}`).toBeGreaterThanOrEqual(monday[i]!)
      })
    })

    it('keeps the weeks after it inside the ramp from the weeks actually run (94, then 79 minutes)', () => {
      const loading = [94, 79]
      for (const w of fresh.weeks.slice(1, 8)) {
        if (!w.isRecovery) {
          expect(w.targetRunMin, `week of ${w.weekStart}`).toBeLessThanOrEqual(
            Math.floor(Math.max(...loading.slice(-2)) * 1.1 + 1e-9),
          )
          loading.push(w.targetRunMin)
        }
      }
      expect(Math.min(...loadingAfter(fresh))).toBeGreaterThan(60)
    })

    it('draws the same weeks when the plan is re-planned the next day and on the next Monday', () => {
      const again = replanOn(FRIDAY, storedRows(fresh, FRIDAY))
      expect(failed(again.draft)).toEqual([])
      expect(targets(again.draft)).toEqual(targets(fresh))
      expect(weekOf(again.draft, MONDAY).flags).toEqual(weekOf(fresh, MONDAY).flags)
      const monday = replanOn(nextWeek(MONDAY, 1), storedRows(again.draft, nextWeek(MONDAY, 1)))
      expect(failed(monday.draft)).toEqual([])
      expect(loadingAfter(monday.draft, 3)).toEqual(loadingAfter(fresh, 3))
    })

    it('plans no week below the minutes run in it when only part of the ceiling is passed', () => {
      // On the Wednesday only the 44 minutes of Monday are run: above the 39-minute ceiling, below
      // the start level. The week is not planned under them, and the weeks after it rise from it.
      const wednesday = buildPlan({
        ...first,
        today: WEDNESDAY,
        activities: history.filter((a) => a.date <= WEDNESDAY && a.id !== 'done-wed'),
      })
      const week = weekOf(wednesday, MONDAY)
      expect(week.targetRunMin).toBeGreaterThanOrEqual(44)
      expect(failed(wednesday)).toEqual([])
      expect(loadingAfter(wednesday)[0]).toBeGreaterThan(week.targetRunMin)
    })
  })

  describe('a plan generated from scratch for a runner who has not outrun the floor [rules E6, A9, J7]', () => {
    // 30-minute weeks only, and 20 minutes run on the Monday of the week of the plan.
    const quiet = floorRunner(THURSDAY)
    const plan = buildPlan({
      ...quiet,
      activities: [...quiet.activities, logged(MONDAY, 20, 'quiet-mon')],
    })

    it('still opens on the 60-minute restart floor', () => {
      const week = weekOf(plan, MONDAY)
      expect(week.targetRunMin).toBe(60)
      expect(week.flags).toContain('restart-floor')
      expect(week.flags).not.toContain('overshoot')
      expect(failed(plan)).toEqual([])
    })
  })
})
