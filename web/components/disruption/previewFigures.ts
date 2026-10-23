import { addDays } from '../../../shared/dates.ts'
import { isToRun } from '../../../shared/domain/sessionStatus.ts'
import { RUN_KINDS } from '../../../shared/engine/adjust.ts'
import type { EngineWarning, SessionBrief } from '../../../shared/engine/types.ts'
import type { PlanDiff, PlanSession } from '../../../shared/types.ts'

/** The days ahead the running-time line of a preview adds up: four weeks, today included. */
export const PREVIEW_DAYS = 28

/**
 * The running time of the next four weeks, now and as the preview leaves it: the minutes of the
 * runs still to come from today on, and the same after the rows of the diff are written. Strength
 * and rest add nothing. A week's target is not used: a window cuts the days of the current week
 * and leaves that week's stored target alone, so only the sessions say what the runner will run.
 * Null when no run is planned in those weeks.
 */
export function runMinOverNextWeeks(
  sessions: ReadonlyArray<Pick<PlanSession, 'date' | 'kind' | 'durationMin' | 'status'>>,
  diff: PlanDiff,
  today: string,
): { before: number; after: number } | null {
  const last = addDays(today, PREVIEW_DAYS - 1)
  const ahead = (date: string) => date >= today && date <= last
  const before = sessions
    .filter((s) => ahead(s.date) && isToRun(s.status) && RUN_KINDS.has(s.kind))
    .reduce((sum, s) => sum + s.durationMin, 0)
  const minutesOf = (brief: SessionBrief | null) =>
    brief !== null && ahead(brief.date) && RUN_KINDS.has(brief.kind) ? brief.durationMin : 0
  const change = diff.sessions.reduce(
    (sum, line) => sum + minutesOf(line.after) - minutesOf(line.before),
    0,
  )
  return before === 0 && change === 0 ? null : { before, after: before + change }
}

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
