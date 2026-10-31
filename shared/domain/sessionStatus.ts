// What a plan session's status says about running it. One exhaustive map, so a status added to
// `PlanSessionStatus` is a compile error here until it is classified. Also the one derivation of
// whether a session is trimmed, from its rule ids.
import type { PlanSessionStatus } from '../types.ts'

/** True for a status whose session is still to be run; false for a settled one. */
const TO_RUN: Record<PlanSessionStatus, boolean> = {
  planned: true,
  moved: true,
  downgraded: true,
  completed: false,
  partial: false,
  skipped: false,
  adjusted: true,
}

/**
 * True when a session with this status is still to be run: planned, moved to another day, trimmed,
 * or shortened by the runner (`adjusted`). Completed, partial and skipped sessions are settled.
 * Every reader that asks whether a session is still to be run asks here, so the answer is the same
 * on every surface.
 */
export function isToRun(status: PlanSessionStatus): boolean {
  return TO_RUN[status] === true
}

/** The rule id that marks a session the engine or an execution trim eased [design 4.3]. */
export const TRIM_RULE = 'design-4.3'

/**
 * Whether a session's rule ids mark it as trimmed. The one derivation of a trim: `PlanSession.trimmed`
 * is set through it on every write of `rules` (`server/serialize.ts` re-exports it), and the engine
 * asks it of a session in memory. Nothing else compares the rule id or scans the stored JSON text.
 */
export function isTrimmed(rules: readonly string[]): boolean {
  return rules.includes(TRIM_RULE)
}

/** The rule id the weekly decision adds to the quality session it trims after a hold [rule J5]. */
export const HOLD_TRIM_RULE = 'J5'

/**
 * Whether a trim is the weekly decision's own: a trimmed session that also cites the rule of the
 * weekly decision. A trim from an assessed session (`server/services/execution.ts`) cites only the
 * trim rule, and is the runner's record; the decision's trim is drawn again from the decision at
 * every re-plan, so it is not kept as an edit.
 */
export function isHoldTrim(rules: readonly string[]): boolean {
  return isTrimmed(rules) && rules.includes(HOLD_TRIM_RULE)
}
