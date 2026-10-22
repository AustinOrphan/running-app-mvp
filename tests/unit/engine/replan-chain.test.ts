// A Monday re-plan every week up to the race, each week run exactly as planned: the plan of record
// keeps its progression, its peak and its race-specific weeks [rules E2, g-2].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
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
function chain(id: string): { first: PlanDraft; last: PlanDraft; replans: number } {
  const a = athletes().find((x) => x.id === id)!
  const first = buildPlan(a.input)
  let plan = first
  let activities = a.input.activities
  let monday = addDays(mondayOf(a.input.today), 7)
  let replans = 0
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
  return { first, last: plan, replans }
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
