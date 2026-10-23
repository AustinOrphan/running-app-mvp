// The provider-neutral workout model [design 6.5, rule O1]. One `WorkoutPlan` per session is
// rendered three ways (the intervals.icu text, the FIT file, the calendar outline), so the routes
// cannot disagree. Pure data: nothing here reads a clock, a file or the network.
import type { ResolvedTargets, SessionKind } from '../engine/types.ts'
import type { Units } from '../types.ts'

/**
 * What a step asks of the runner. `open` carries no figure: the step is run by effort (recoveries,
 * strides, hill repeats, a day steered by heat, a step too short for a wrist heart rate).
 *
 * Paces are seconds per kilometre, slow end first, as `ResolvedTargets` has them; a renderer
 * converts to the runner's units.
 */
export type StepTarget =
  | { kind: 'open' }
  /** `floorBpm` (`P.o1.hrFloorBpm`) is the lower edge, so the watch alerts only above the ceiling. */
  | { kind: 'hr-ceiling'; floorBpm: number; ceilingBpm: number }
  | { kind: 'hr-band'; lowBpm: number; highBpm: number }
  | { kind: 'pace'; slowSecPerKm: number; fastSecPerKm: number }

/** The engine's step kinds: the roles a step can play in a session. */
export type StepIntent = 'warmup' | 'work' | 'recover' | 'cooldown' | 'steady'

export interface WorkoutStep {
  type: 'step'
  intent: StepIntent
  /** A short name for the step ("Warm up", "Fast", "Recover"), the same on every surface. */
  label: string
  /** A walking step: a break of the run-walk ladder or the walk framing a ladder session. */
  walk: boolean
  durationSec: number
  target: StepTarget
}

/**
 * Steps repeated `count` times (at least 2): the work and its recovery of an interval session, the
 * `bouts - 1` recoveries of a cruise session (the last work step follows the repeat).
 */
export interface WorkoutRepeat {
  type: 'repeat'
  count: number
  steps: WorkoutStep[]
}

export type WorkoutNode = WorkoutStep | WorkoutRepeat

export interface WorkoutPlan {
  /** `publicTitle` of the session: kind and length only, safe for a watch or a calendar. */
  title: string
  kind: SessionKind
  nodes: WorkoutNode[]
  /**
   * Every step with repeats expanded. Equals the session minutes, except that a run-walk ladder
   * session adds the two walks that frame it (`noviceLadder.walkFrameMin` each), which the engine
   * keeps outside the session minutes.
   */
  totalSec: number
  /** Plain-text outline of the steps; every number in it is a number of a step. */
  description: string
  /** The session's targets as `resolveTargets` returned them: the one source of every figure. */
  targets: ResolvedTargets
  /** The easy version that replaced the planned session for today. */
  eased: boolean
  /** Tonight's fuel line, when the session carries one (quoted from the fuel module). */
  fuelLine: string | null
  /** The units the description is written in. */
  units: Units
}

export interface WorkoutOptions {
  /** True when the session is today's eased version (`easedSession`); the reason is never named. */
  eased?: boolean
  /** The fuel line for the session, appended to the description as it is. */
  fuelLine?: string | null
  units: Units
}
