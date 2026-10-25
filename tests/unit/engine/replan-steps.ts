// The plans of a weekly re-plan chain, one per Monday, each week run exactly as planned: the first
// plan, then a re-plan on every Monday up to the race week. Shared by the tests that read a plan at
// every step of a season.
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

export interface ReplanStep {
  draft: PlanDraft
  /** What the plan was made from: the first step's input, then each re-plan's with its `existing`. */
  input: EngineInput
}

/** The first plan and every Monday re-plan of the matrix athlete `id` until the race week. */
export function replanSteps(id: string): ReplanStep[] {
  const a = athletes().find((x) => x.id === id)!
  let draft = buildPlan(a.input)
  let activities = a.input.activities
  const steps: ReplanStep[] = [{ draft, input: a.input }]
  const raceMonday = mondayOf(a.input.goal.date)
  for (let monday = addDays(mondayOf(a.input.today), 7); monday <= raceMonday;) {
    const ran = draft.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => !['strength', 'race', 'mobility', 'rest'].includes(s.kind))
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    activities = [...activities, ...ran]
    const input: EngineInput = {
      ...a.input,
      today: monday,
      activities,
      existing: {
        weeks: draft.weeks,
        sessions: draft.sessions.map((s, i) => ({
          ...s,
          id: `s${i}`,
          status: s.date < monday ? 'completed' : 'planned',
          activityId: null,
        })),
      },
    }
    draft = replan(input).draft
    steps.push({ draft, input })
    monday = addDays(monday, 7)
  }
  return steps
}
