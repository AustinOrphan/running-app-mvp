// What a runner with no plan is asked to do first (FH1a). The check is the engine's own start path
// (`startPath`, macro.ts, rules E6 and G-3): a start level under the 3 x 20 minute floor means the
// runs on file are too few for a plan to start from the runner's own level, so the first step is to
// bring in more of them. Nothing here is a Param: the level and the floor are read from the state
// and from `P.restartFloor`.
import { afterBreak } from './adapt.ts'
import { startLevelMin } from './limits.ts'
import { startPath } from './macro.ts'
import { P } from './params/index.ts'
import type { AthleteState, EngineInput } from './types.ts'

/**
 * `runs`: the runs on file give a start level under the floor and no injury-return programme
 * applies, so more runs are what the plan needs. `goal`: the runs are enough (or an injury-return
 * programme sets the start), so a goal race is what is missing.
 */
export type FirstActionReason = 'runs' | 'goal'

export interface FirstAction {
  reason: FirstActionReason
  /** The start level of the runs on file, in minutes a week (after a break, as the plan reads it). */
  levelMin: number
  /** The weekly minutes a plan starts from on the runner's own level: sessions x session length. */
  floorMin: number
}

/** Which first step applies, from the same state and input that `generate` reads. */
export function firstActionFor(input: EngineInput, state: AthleteState): FirstAction {
  const planState = afterBreak(state)
  const path = startPath(input, planState)
  return {
    reason: path !== null && path.kind !== 'injury-return' ? 'runs' : 'goal',
    levelMin: startLevelMin(planState),
    floorMin: P.restartFloor.sessions.value * P.restartFloor.sessionMin.value,
  }
}
