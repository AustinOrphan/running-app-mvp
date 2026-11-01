// The plans of a weekly re-plan chain, one per Monday, each week run exactly as planned (or, with
// `scale`, run that many times as planned): the first plan, then a re-plan on every Monday up to
// the race week. Shared by the tests that read a plan at every step of a season.
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import type {
  DisruptionWindow,
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
  /**
   * Windows the runner reports [rule J9]: each joins the input of the first re-plan on or after its
   * first day and stays in it, closed or not, as the simulator reports its own. The runner honours
   * a window whether or not the plan in force knew of it: no run on a day of a rest window, and a
   * run on a day of a limited window cut to its cap.
   */
  windows?: readonly DisruptionWindow[]
}

export interface ReplanStepsOptions extends ReplanChainOptions {
  /** The position of the load setting, left out of the input when absent. */
  loadAppetite?: LoadAppetite
  /** The method preset [rules P1 to P4], left out of the input when absent. */
  method?: PresetId
}

/** The first plan of `first` and a re-plan on every Monday after it, until the race week. */
export function replanChain(first: EngineInput, options: ReplanChainOptions = {}): ReplanStep[] {
  const { scale = 1, maxSteps = Infinity, windows = [] } = options
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
      .flatMap((s) => {
        const window = windows.find((w) => w.startDate <= s.date && s.date <= w.endDate)
        if (window?.mode === 'rest') return []
        const minutes =
          window?.mode === 'limited' && window.maxRunMin !== null
            ? Math.min(s.durationMin, window.maxRunMin)
            : s.durationMin
        const cut = s.durationMin > 0 ? minutes / s.durationMin : 1
        const distanceM = (s.distanceM ?? s.durationMin * 170) * cut
        return [
          activity(s.date, {
            id: `done-${s.date}-${s.order}`,
            durationSec: factor === 1 ? minutes * 60 : Math.round(minutes * factor) * 60,
            distanceM: factor === 1 ? distanceM : Math.round(distanceM * factor),
          }),
        ]
      })
    activities = [...activities, ...ran]
    const reported = windows.filter((w) => w.startDate <= monday)
    const input: EngineInput = {
      ...first,
      today: monday,
      activities,
      ...(reported.length > 0 ? { disruptions: [...(first.disruptions ?? []), ...reported] } : {}),
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
