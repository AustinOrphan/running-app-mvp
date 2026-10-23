// The running time a plan still holds over the next four weeks, now and once a write is applied.
// One pure function, so a preview states a figure that follows from the same rows as its diff:
// the stored sessions, and the sessions the write creates, deletes and updates.
import { addDays } from '../dates.ts'
import { RUN_KINDS } from '../engine/adjust.ts'
import type { SessionKind } from '../engine/types.ts'
import type { PlanSessionStatus, RunMinutes } from '../types.ts'
import { isToRun } from './sessionStatus.ts'

/** The days ahead the figure adds up: four weeks, today included. */
export const RUN_MINUTES_DAYS = 28

/** The columns of a session that its running time depends on. */
export interface RunMinutesRow {
  date: string
  kind: string
  durationMin: number
  status: string
}

/** The rows a write creates, deletes and updates; a stored row appears in `deleted` or `before`. */
export interface RunMinutesWrites {
  created: readonly RunMinutesRow[]
  deleted: readonly RunMinutesRow[]
  updated: ReadonlyArray<{ before: RunMinutesRow; after: RunMinutesRow }>
}

/**
 * The minutes of runs still to come from `today` for 28 days, from the stored `rows` and as they
 * stand once `writes` are applied. A session counts when it is a run kind, falls in those days and
 * is still to be run (`isToRun`): a skipped or finished session is neither in the first figure nor
 * taken from it when a write replaces it. Strength and rest add nothing. A week's target is not
 * used: a window cuts the days of the current week and leaves that week's stored target alone, so
 * only the sessions say what the runner will run. Null when no run counts before or after.
 */
export function runMinutesAhead(
  rows: readonly RunMinutesRow[],
  writes: RunMinutesWrites,
  today: string,
): RunMinutes | null {
  const last = addDays(today, RUN_MINUTES_DAYS - 1)
  const counted = (row: RunMinutesRow): number =>
    row.date >= today &&
    row.date <= last &&
    RUN_KINDS.has(row.kind as SessionKind) &&
    isToRun(row.status as PlanSessionStatus)
      ? row.durationMin
      : 0
  const total = (list: readonly RunMinutesRow[]): number =>
    list.reduce((sum, row) => sum + counted(row), 0)
  const before = total(rows)
  const after =
    before +
    total(writes.created) +
    total(writes.updated.map((pair) => pair.after)) -
    total(writes.deleted) -
    total(writes.updated.map((pair) => pair.before))
  return before === 0 && after === 0 ? null : { before, after }
}
