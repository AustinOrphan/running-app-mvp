// What the run page's stream charts may draw from the session the run filled: the planned pace
// band and the easy heart-rate ceiling. Pure, so the rules are tested without a browser.
//
// A planned pace is drawn across the whole run only when the session is one steady stretch whose
// target is a pace: for threshold, intervals and race pace the stored pace is the work pace alone
// (`sessions.ts`), and a long run with a fast finish or a run-walk has no one pace. The ceiling is
// the runner's Z1 ceiling, drawn when the session is steered by it or when the run filled no
// session; on a session steered by pace or a heart-rate band, heart rate above Z1 is the plan, and
// a hatch would read as a breach.
import { resolveTargets } from '../engine/targets.ts'
import type { SessionKind, Step, ZoneSet } from '../engine/types.ts'
import type { PlanSession } from '../types.ts'

export type ChartSession = Pick<PlanSession, 'kind' | 'target' | 'structure' | 'flags'>

export interface RunChartContext {
  /** `[slow, fast]` seconds per km, or null when no one pace stands for the whole run. */
  plannedPaceSecPerKm: [number, number] | null
  /** Top of the runner's Z1 in bpm, or null when the hatch must not be drawn. */
  easyCeilingBpm: number | null
}

const NOT_ONE_PACE: ReadonlySet<SessionKind> = new Set<SessionKind>(['long-fast-finish'])

/** One stretch of steady running: no work or recovery step, no warm-up around a work pace, no run-walk. */
function isOneSteadyStretch(session: ChartSession): boolean {
  if (NOT_ONE_PACE.has(session.kind)) return false
  if (session.flags.includes('run-walk')) return false
  // no steps at all is one stretch only for a session paced as a whole: a short threshold or
  // intervals session stores no steps and its pace is the work pace
  if (session.structure.length === 0) return session.kind === 'race-pace' || session.kind === 'race'
  return session.structure.every((step: Step) => step.kind === 'steady')
}

/** Whether every step that is run (not a warm-up, cool-down or recovery) is in Z1: no fast finish or work. */
function isEasyThroughout(session: ChartSession): boolean {
  if (NOT_ONE_PACE.has(session.kind)) return false
  return session.structure.every(
    (step: Step) =>
      step.kind === 'warmup' ||
      step.kind === 'cooldown' ||
      step.kind === 'recover' ||
      step.zone === 'z1',
  )
}

/**
 * The context of the charts. `session` is the planned session the run filled, or undefined when it
 * filled none (the caller has read the plan: while it loads it must not ask).
 */
export function runChartContext(
  session: ChartSession | undefined,
  zones: ZoneSet | null,
): RunChartContext {
  if (session === undefined) {
    return { plannedPaceSecPerKm: null, easyCeilingBpm: zones?.hr?.z1[1] ?? null }
  }
  const targets = resolveTargets(session, zones, { hot: false })
  return {
    plannedPaceSecPerKm:
      targets.mode === 'pace' && isOneSteadyStretch(session) ? targets.paceSecPerKm : null,
    easyCeilingBpm:
      targets.mode === 'hr-ceiling' && isEasyThroughout(session) ? targets.hrCeiling : null,
  }
}
