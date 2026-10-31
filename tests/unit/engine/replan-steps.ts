// The plans of a weekly re-plan chain, one per Monday, each week run exactly as planned (or, with
// `scale`, run that many times as planned): the first plan, then a re-plan on every Monday up to
// the race week. Shared by the tests that read a plan at every step of a season.
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type {
  EngineInput,
  LoadAppetite,
  PlanDraft,
  PresetId,
} from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

export interface ReplanStep {
  draft: PlanDraft
  /** What the plan was made from: the first step's input, then each re-plan's with its `existing`. */
  input: EngineInput
}

export interface ReplanChainOptions {
  /**
   * Every session is run this many times its planned minutes (default 1: run as planned); a
   * function gives the factor of the week that ends before re-plan `step` (1 for the first).
   */
  scale?: number | ((step: number) => number)
  /** Stop after this many re-plans (default: until the race week). */
  maxSteps?: number
}

export interface ReplanStepsOptions extends ReplanChainOptions {
  /** The position of the load setting, left out of the input when absent. */
  loadAppetite?: LoadAppetite
  /** The method preset [rules P1 to P4], left out of the input when absent. */
  method?: PresetId
}

/** The first plan of `first` and a re-plan on every Monday after it, until the race week. */
export function replanChain(first: EngineInput, options: ReplanChainOptions = {}): ReplanStep[] {
  const { scale = 1, maxSteps = Infinity } = options
  let draft = buildPlan(first)
  let activities = first.activities
  const steps: ReplanStep[] = [{ draft, input: first }]
  const raceMonday = mondayOf(first.goal.date)
  for (
    let monday = addDays(mondayOf(first.today), 7);
    monday <= raceMonday && steps.length <= maxSteps;
  ) {
    const factor = typeof scale === 'number' ? scale : scale(steps.length)
    const ran = draft.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => !['strength', 'race', 'mobility', 'rest'].includes(s.kind))
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: factor === 1 ? s.durationMin * 60 : Math.round(s.durationMin * factor) * 60,
          distanceM:
            factor === 1
              ? (s.distanceM ?? s.durationMin * 170)
              : Math.round((s.distanceM ?? s.durationMin * 170) * factor),
        }),
      )
    activities = [...activities, ...ran]
    const input: EngineInput = {
      ...first,
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

/** The first plan and every Monday re-plan of the matrix athlete `id` until the race week. */
export function replanSteps(id: string, options: ReplanStepsOptions = {}): ReplanStep[] {
  const { loadAppetite, method, ...chain } = options
  const a = athletes().find((x) => x.id === id)!
  const first: EngineInput = {
    ...a.input,
    options: {
      ...a.input.options,
      ...(loadAppetite === undefined ? {} : { loadAppetite }),
      ...(method === undefined ? {} : { method }),
    },
  }
  return replanChain(first, chain)
}
