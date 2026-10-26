// What a stored plan week was planned at. The engine takes a loading week that was run past its
// target as run: the stored target becomes the minutes run and the flags `overshoot` and
// `planned-<n>` keep the planned minutes (`takenAsRun`, `overshootFlags` and `plannedMinOf` in
// `shared/engine/limits.ts`, rules g-2 and g-6). The record "planned 79, ran 144" is therefore in
// the flags; this module reads it back so a payload can state it. Pure: no I/O.
import { plannedMinOf } from '../engine/limits.ts'

/** The two figures a week payload carries beside the stored `targetRunMin`. */
export interface PlannedWeek {
  /** The minutes the week was planned at: its target, unless the week was run past it. */
  plannedRunMin: number
  /** The week was run past its plan and taken as run (the engine's `overshoot` flag). */
  overshoot: boolean
}

/**
 * `plannedRunMin` and `overshoot` for a stored week. The stored target is left as the engine wrote
 * it. A week that is not flagged answers `plannedRunMin === targetRunMin`.
 */
export function plannedWeek(week: { targetRunMin: number; flags: string[] }): PlannedWeek {
  return { plannedRunMin: plannedMinOf(week), overshoot: week.flags.includes('overshoot') }
}

/**
 * The target a screen shows for a week: the planned minutes of a week run past its plan, the stored
 * target of any other. The payload's two fields are read, nothing is worked out.
 */
export function shownTargetMin(week: {
  targetRunMin: number
  plannedRunMin: number
  overshoot: boolean
}): number {
  return week.overshoot ? week.plannedRunMin : week.targetRunMin
}
