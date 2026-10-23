// What a plan session's status says about running it. One exhaustive map, so a status added to
// `PlanSessionStatus` is a compile error here until it is classified.
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
