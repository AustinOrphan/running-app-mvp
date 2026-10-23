import type { SessionKind } from '../../shared/engine/types.ts'
import type { PlanPhase } from '../../shared/types.ts'

// The date and climb formatters live in `shared/` so the copy system can use them; pages keep
// importing them from here.
export { formatLongDate, formatShortDate, formatWeekday } from '../../shared/dates.ts'
export { formatClimb } from '../../shared/units.ts'

const phaseLabels: Record<PlanPhase, string> = {
  restart: 'Restart',
  base1: 'Base 1',
  base2: 'Base 2',
  endurance: 'Endurance',
  specific: 'Specific',
  peak: 'Peak',
  taper: 'Taper',
  race: 'Race week',
  base: 'Base',
  build: 'Build',
}

export function phaseLabel(phase: PlanPhase): string {
  return phaseLabels[phase]
}

/**
 * The label of a plan week. A week after the race keeps the phase 'race' (no schema change) and
 * carries the 'post-race' flag; every view calls it "After the race", not "Race week".
 */
export function weekPhaseLabel(week: { phase: PlanPhase; flags?: readonly string[] }): string {
  return week.flags?.includes('post-race') === true ? 'After the race' : phaseLabel(week.phase)
}

const kindLabels: Record<SessionKind, string> = {
  easy: 'Easy run',
  recovery: 'Recovery run',
  long: 'Long run',
  'long-fast-finish': 'Long run, fast finish',
  threshold: 'Threshold',
  intervals: 'Intervals',
  'race-pace': 'Race pace',
  strides: 'Strides',
  hills: 'Hills',
  hike: 'Hike',
  b2b: 'Back-to-back',
  strength: 'Strength',
  mobility: 'Mobility',
  rest: 'Rest',
  race: 'Race',
  cross: 'Cross-training',
}

/** A session kind as the Plan page names it: "Long run, fast finish". */
export function sessionKindLabel(kind: SessionKind): string {
  return kindLabels[kind]
}

/** Whether a string names a session kind. */
export function isSessionKind(value: unknown): value is SessionKind {
  return typeof value === 'string' && value in kindLabels
}
/** `one` for a count of 1, `many` otherwise; the count itself is not included. */
export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}
