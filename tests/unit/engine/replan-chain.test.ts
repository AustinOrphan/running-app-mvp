// A Monday re-plan every week up to the race, each week run exactly as planned: the plan of record
// keeps its progression, its peak and its race-specific weeks [rules E2, g-2].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type { DisruptionWindow, EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

type Existing = NonNullable<EngineInput['existing']>

const asExisting = (plan: PlanDraft, today: string): Existing => ({
  weeks: plan.weeks,
  sessions: plan.sessions.map((s, i) => ({
    ...s,
    id: `s${i}`,
    status: s.date < today ? 'completed' : 'planned',
    activityId: null,
  })),
})

/** Re-plans on every Monday after the first plan until the race week, running each week as planned. */
function chain(id: string): {
  first: PlanDraft
  last: PlanDraft
  replans: number
  ranMinutes: number
} {
  const a = athletes().find((x) => x.id === id)!
  const first = buildPlan(a.input)
  let plan = first
  let activities = a.input.activities
  let monday = addDays(mondayOf(a.input.today), 7)
  let replans = 0
  let ranMinutes = 0
  const raceMonday = mondayOf(a.input.goal.date)
  while (monday <= raceMonday) {
    const ran = plan.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => s.kind !== 'strength' && s.kind !== 'race' && s.kind !== 'mobility')
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    ranMinutes += ran.reduce((n, r) => n + r.durationSec / 60, 0)
    activities = [...activities, ...ran]
    const out = replan({
      ...a.input,
      today: monday,
      activities,
      existing: asExisting(plan, monday),
    })
    plan = out.draft
    replans += 1
    monday = addDays(monday, 7)
  }
  return { first, last: plan, replans, ranMinutes }
}

const preTaper = (plan: PlanDraft) => plan.weeks.filter((w) => !w.isTaper && w.phase !== 'race')
const peak = (plan: PlanDraft, field: 'targetRunMin' | 'longRunMin') =>
  Math.max(...preTaper(plan).map((w) => w[field]))

describe.each(['half', 'first-100-mile', 'marathon'])('weekly re-plans of %s', (id) => {
  const { first, last, replans } = chain(id)

  it('re-plans more than a few times', () => {
    expect(replans).toBeGreaterThan(8)
  })

  it('keeps the peak week and the peak long run of the first plan', () => {
    expect(peak(last, 'targetRunMin')).toBeGreaterThanOrEqual(peak(first, 'targetRunMin') * 0.9)
    expect(peak(last, 'longRunMin')).toBeGreaterThanOrEqual(peak(first, 'longRunMin') * 0.9)
  })

  it('keeps the race-specific phase until the taper', () => {
    const firstSpecific = first.weeks.find((w) => w.phase === 'specific')!.weekStart
    const late = last.weeks.filter((w) => w.weekStart >= firstSpecific && !w.isTaper)
    expect(late.filter((w) => w.phase !== 'race' && w.phase !== 'specific')).toEqual([])
  })
})

/**
 * The same chain with a rest window that every re-plan is given, as the server gives all active
 * windows: the days it holds carry no run, and the chain's activities are the planned runs.
 */
function chainWithWindow(id: string, window: DisruptionWindow) {
  const a = athletes().find((x) => x.id === id)!
  const input = { ...a.input, disruptions: [window] }
  let plan = buildPlan(input)
  let activities = a.input.activities
  let monday = addDays(mondayOf(a.input.today), 7)
  const raceMonday = mondayOf(a.input.goal.date)
  const steps: PlanDraft[] = []
  let ranMinutes = 0
  while (monday <= raceMonday) {
    const ran = plan.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => !['strength', 'race', 'mobility', 'rest'].includes(s.kind))
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    ranMinutes += ran.reduce((n, r) => n + r.durationSec / 60, 0)
    activities = [...activities, ...ran]
    const out = replan({
      ...input,
      today: monday,
      activities,
      existing: asExisting(plan, monday),
    })
    plan = out.draft
    steps.push(plan)
    monday = addDays(monday, 7)
  }
  return { steps, ranMinutes, window }
}

describe.each(['half', 'first-100-mile', 'marathon'])(
  'weekly re-plans of %s with a rest window ahead',
  (id) => {
    // ill for ten days from the Monday two weeks on: the week before it is the last one run
    const a = athletes().find((x) => x.id === id)!
    const start = addDays(mondayOf(a.input.today), 14)
    const window: DisruptionWindow = {
      id: 'w1',
      reason: 'illness-below-neck',
      mode: 'rest',
      startDate: start,
      endDate: addDays(start, 9),
      maxRunMin: null,
      pain: null,
      gaitChange: false,
    }
    const plain = chain(id)
    const windowed = chainWithWindow(id, window)

    it('passes the checklist at every re-plan, the window item included', () => {
      expect(windowed.steps.length).toBeGreaterThan(8)
      for (const [n, step] of windowed.steps.entries()) {
        expect(
          step.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`),
          `step ${n}`,
        ).toEqual([])
      }
      // the item is there while the window still matters to the plan
      expect(windowed.steps[0]!.checklist.map((c) => c.id)).toContain('disruption-window')
    })

    it('runs nothing on a held day and adds no running to the chain', () => {
      const held = new Set<string>()
      for (let d = start; d <= addDays(start, 10); d = addDays(d, 1)) held.add(d)
      for (const step of windowed.steps) {
        const runs = step.sessions.filter(
          (s) => held.has(s.date) && s.kind !== 'rest' && s.kind !== 'race',
        )
        expect(runs.map((s) => `${s.date} ${s.kind}`)).toEqual([])
      }
      expect(windowed.ranMinutes).toBeLessThan(plain.ranMinutes)
    })

    it('goes back to the plan without the window once the way back is over', () => {
      // the plan of record keeps its race-specific weeks and its race week
      const last = windowed.steps.at(-1)!
      const raceWeek = mondayOf(a.input.goal.date)
      expect(last.sessions.some((s) => s.kind === 'race' && mondayOf(s.date) === raceWeek)).toBe(
        true,
      )
      const firstSpecific = plain.first.weeks.find((w) => w.phase === 'specific')!.weekStart
      const late = last.weeks.filter((w) => w.weekStart >= firstSpecific && !w.isTaper)
      expect(late.filter((w) => w.phase !== 'race' && w.phase !== 'specific')).toEqual([])
    })
  },
)
