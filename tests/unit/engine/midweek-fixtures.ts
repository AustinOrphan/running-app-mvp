// Helpers of the mid-week re-plan tests (midweek-replan.test.ts and midweek-replan-sweep.test.ts).
import type { DisruptionWindow, EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain } from './replan-steps.ts'

const NOT_RUNS = new Set(['strength', 'race', 'mobility', 'rest'])

/** The runs a draft holds from `from` up to `to` as finished activities, days under a window left out. */
export function ranFrom(
  draft: PlanDraft,
  from: string,
  to: string,
  window: DisruptionWindow | null,
) {
  return draft.sessions
    .filter((s) => s.date >= from && s.date < to && !NOT_RUNS.has(s.kind))
    .filter((s) => !(window !== null && window.startDate <= s.date && s.date <= window.endDate))
    .map((s) =>
      activity(s.date, {
        id: `done-${s.date}-${String(s.order)}`,
        durationSec: s.durationMin * 60,
        distanceM: s.distanceM ?? s.durationMin * 170,
      }),
    )
}

/** The input of a re-plan on `today` against the stored `draft`, every earlier day completed. */
export function inputAt(
  base: EngineInput,
  draft: PlanDraft,
  today: string,
  activities: EngineInput['activities'],
  windows: DisruptionWindow[],
  options: Partial<EngineInput['options']> = {},
): EngineInput {
  return {
    ...base,
    today,
    activities,
    options: { ...base.options, ...options },
    ...(windows.length > 0 ? { disruptions: windows } : {}),
    existing: {
      weeks: draft.weeks,
      sessions: draft.sessions.map((s, i) => ({
        ...s,
        id: `s${String(i)}`,
        status: s.date < today ? 'completed' : 'planned',
        activityId: null,
      })),
    },
  }
}

export const hundred = () => {
  const athlete = athletes().find((a) => a.id === 'first-100-mile')!
  const steps = replanChain(athlete.input)
  const step = steps.find((s) => s.input.today === '2026-11-02')!
  return { athlete, steps, step, base: { ...step.input, existing: null } as EngineInput }
}

export const weekTargets = (draft: PlanDraft, from: string, count: number) =>
  draft.weeks
    .filter((w) => w.weekStart >= from)
    .slice(0, count)
    .map((w) => w.targetRunMin)
