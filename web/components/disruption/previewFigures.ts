import type { EngineWarning } from '../../../shared/engine/types.ts'

/**
 * The warnings a preview adds: those the plan after the action carries that the plan now does not.
 * A warning the plan already shows on its own page is not repeated in a preview of something else.
 */
export function newWarnings(
  proposed: readonly EngineWarning[],
  current: readonly EngineWarning[],
): EngineWarning[] {
  const known = new Set(current.map((warning) => `${warning.code}\u0000${warning.message}`))
  return proposed.filter((warning) => !known.has(`${warning.code}\u0000${warning.message}`))
}

/** True when `day` falls in the window, ends included. */
export function windowCovers(window: { startDate: string; endDate: string }, day: string): boolean {
  return window.startDate <= day && day <= window.endDate
}
