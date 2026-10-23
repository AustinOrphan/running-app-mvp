// A week already run past its plan [rules G-2, G-3, G-6]: the minutes run are a fact, so the week
// is taken as run (its target is at least what was logged, and it is flagged), the checklist does
// not fail on logged minutes, and the weeks after it neither rise on the strength of it nor make
// anything up. Synthetic runners; no personal data.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
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
