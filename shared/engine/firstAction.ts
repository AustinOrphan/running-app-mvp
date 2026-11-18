// What a runner with no plan is asked to do first (FH1a). The check is the engine's own start path
// (`startPath`, macro.ts, rules E6 and G-3) and the state's last run: with no run on file the first
// step is to bring runs in; with runs on file it is a goal, and a start level under the 3 x 20
// minute floor (the plan then starts with a short programme) is a fact beside it. Nothing here is a
// Param: the level and the floor are read from the state and from `P.restartFloor`.
import { afterBreak } from './adapt.ts'
import { startLevelMin } from './limits.ts'
import { startPath } from './macro.ts'
import { P } from './params/index.ts'
import type { AthleteState, EngineInput } from './types.ts'

/**
 * `runs`: no run is on file (in the history window the snapshot reads) and no injury-return
 * programme applies, so runs are what the plan needs. `goal`: runs are on file (or an
 * injury-return programme sets the start), so a goal race is what is missing.
 */
export type FirstActionReason = 'runs' | 'goal'

export interface FirstAction {
  reason: FirstActionReason
  /**
   * Runs are on file but the start level sits under the floor, so the plan starts with a short
   * programme (never set with `runs`, and never for an injury-return start).
   */
  belowFloor: boolean
  /** The start level of the runs on file, in minutes a week (after a break, as the plan reads it). */
  levelMin: number
  /** The weekly minutes a plan starts from on the runner's own level: sessions x session length. */
  floorMin: number
}

/** Which first step applies, from the same state and input that `generate` reads. */
export function firstActionFor(input: EngineInput, state: AthleteState): FirstAction {
  const planState = afterBreak(state)
  const path = startPath(input, planState)
  const injuryReturn = path?.kind === 'injury-return'
  const noRuns = state.lastRunDate === null
  return {
    reason: noRuns && !injuryReturn ? 'runs' : 'goal',
    belowFloor: !noRuns && path !== null && !injuryReturn,
    levelMin: startLevelMin(planState),
    floorMin: P.restartFloor.sessions.value * P.restartFloor.sessionMin.value,
  }
}
