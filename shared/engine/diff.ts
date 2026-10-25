// The revision diff (phase 3a design 4.2). `diffPlans` turns the rows a write created, deleted and
// updated into a `PlanDiff`: the sessions by `externalId`, the weeks by their Monday, and the
// totals that equal the number of rows written. The pairs come from the write itself
// (`pairSessions` in `shared/domain/sessionIdentity.ts` through `writeReplannedSessions`), so the
// diff cannot describe a change that was not written. Pure: no I/O, no clock, no randomness.
//
// The inputs are the columns of the stored rows (JSON columns still as text), which a Prisma row
// satisfies as it is; `shared/` does not import the database layer.
import type { PlanDiff, SessionDiffLine, TargetDiffLine, WeekDiffLine } from '../types.ts'
import type { SessionBrief, SessionKind } from './types.ts'

/** The columns of a stored session that a diff reads. `id` is null for a session only previewed. */
export interface DiffSessionRow {
  id: string | null
  /** Empty for a session only previewed: its identity is allocated when the row is written. */
  externalId: string
  weekStart: string
  date: string
  kind: string
  title: string
  durationMin: number
  distanceM: number | null
  gainM: number | null
  /** JSON text: Step[]. */
  structure: string
  /** JSON text: SessionTarget. */
  target: string
  status: string
  /** JSON text: string[] of rule ids. */
  rules: string
}

/** The columns of a stored week that a diff reads. */
export interface DiffWeekRow {
  weekStart: string
  targetRunMin: number
  /** JSON text: string[]. */
  flags: string
}

export interface RowWrites<Row> {
  created: Row[]
  deleted: Row[]
  updated: Array<{ before: Row; after: Row }>
}

/**
 * What one write did to the plan: the rows it created, deleted and updated, the rest windows and
 * the week targets the runner raised that it kept or lowered. A target line describes a week row
 * as written; it is no row of its own, so it counts neither as a write nor in the totals.
 */
export interface PlanWrites {
  sessions: RowWrites<DiffSessionRow>
  weeks: RowWrites<DiffWeekRow>
  holds?: PlanDiff['holds']
  targets?: readonly TargetDiffLine[]
}

function textList(text: string): string[] {
  try {
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function sessionBrief(row: DiffSessionRow): SessionBrief {
  return {
    date: row.date,
    kind: row.kind as SessionKind,
    title: row.title,
    durationMin: row.durationMin,
    distanceM: row.distanceM,
    gainM: row.gainM,
  }
}

type Field = SessionDiffLine['fields'][number]

/**
 * The fields of a session that differ. `structure` covers the steps and the targets: both are
 * what the runner is asked to do inside the session, and a change of either is a change of the
 * prescription. A row can be updated without any of these changing (a new title or purpose); its
 * line then has no fields, because every written row has to appear once.
 */
function changedFields(before: DiffSessionRow, after: DiffSessionRow): Field[] {
  const fields: Field[] = []
  if (before.date !== after.date) fields.push('date')
  if (before.kind !== after.kind) fields.push('kind')
  if (before.durationMin !== after.durationMin) fields.push('durationMin')
  if (before.distanceM !== after.distanceM) fields.push('distanceM')
  if (before.gainM !== after.gainM) fields.push('gainM')
  if (before.structure !== after.structure || before.target !== after.target) {
    fields.push('structure')
  }
  if (before.status !== after.status) fields.push('status')
  return fields
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const CHANGE_ORDER = { removed: 0, changed: 1, added: 2 } as const

function sessionLines(writes: RowWrites<DiffSessionRow>): SessionDiffLine[] {
  const lines: SessionDiffLine[] = []
  for (const row of writes.created) {
    lines.push({
      change: 'added',
      externalId: row.externalId,
      sessionId: row.id,
      date: row.date,
      weekStart: row.weekStart,
      before: null,
      after: sessionBrief(row),
      fields: [],
      rules: textList(row.rules),
    })
  }
  for (const row of writes.deleted) {
    lines.push({
      change: 'removed',
      externalId: row.externalId,
      sessionId: row.id,
      date: row.date,
      weekStart: row.weekStart,
      before: sessionBrief(row),
      after: null,
      fields: [],
      rules: textList(row.rules),
    })
  }
  for (const { before, after } of writes.updated) {
    lines.push({
      change: 'changed',
      externalId: after.externalId,
      sessionId: after.id,
      date: after.date,
      weekStart: after.weekStart,
      before: sessionBrief(before),
      after: sessionBrief(after),
      fields: changedFields(before, after),
      rules: textList(after.rules),
    })
  }
  // A fixed order, whatever order the write produced its sets in: the diff is hashed and compared.
  const kindOf = (line: SessionDiffLine) => (line.after ?? line.before)?.kind ?? ''
  return lines.sort(
    (a, b) =>
      compareText(a.date, b.date) ||
      compareText(kindOf(a), kindOf(b)) ||
      CHANGE_ORDER[a.change] - CHANGE_ORDER[b.change] ||
      compareText(a.externalId, b.externalId),
  )
}

function weekLine(before: DiffWeekRow | null, after: DiffWeekRow | null): WeekDiffLine {
  const was = before ? textList(before.flags) : []
  const now = after ? textList(after.flags) : []
  return {
    weekStart: (after ?? before)!.weekStart,
    runMinBefore: before?.targetRunMin ?? 0,
    runMinAfter: after?.targetRunMin ?? 0,
    flagsAdded: now.filter((flag) => !was.includes(flag)),
    flagsRemoved: was.filter((flag) => !now.includes(flag)),
  }
}

function weekLines(writes: RowWrites<DiffWeekRow>): WeekDiffLine[] {
  return [
    ...writes.created.map((row) => weekLine(null, row)),
    ...writes.deleted.map((row) => weekLine(row, null)),
    ...writes.updated.map(({ before, after }) => weekLine(before, after)),
  ].sort((a, b) => compareText(a.weekStart, b.weekStart))
}

/**
 * The diff of one write. Every row written is one line: `totals.added`, `removed` and `changed`
 * equal the sessions created, deleted and updated, and `totals.weeksChanged` the weeks written.
 * `runMinBefore` and `runMinAfter` sum the working targets of those weeks (a created week has none
 * before, a deleted week none after). `targets` is left out when the write met no raised target, so
 * a diff without one reads as before.
 */
export function diffPlans(writes: PlanWrites): PlanDiff {
  const sessions = sessionLines(writes.sessions)
  const weeks = weekLines(writes.weeks)
  const holds = [...(writes.holds ?? [])]
  const targets = [...(writes.targets ?? [])].sort((a, b) => compareText(a.weekStart, b.weekStart))
  return {
    v: 1,
    sessions,
    weeks,
    holds,
    ...(targets.length === 0 ? {} : { targets }),
    totals: {
      added: writes.sessions.created.length,
      removed: writes.sessions.deleted.length,
      changed: writes.sessions.updated.length,
      weeksChanged: weeks.length,
      runMinBefore: weeks.reduce((sum, week) => sum + week.runMinBefore, 0),
      runMinAfter: weeks.reduce((sum, week) => sum + week.runMinAfter, 0),
    },
    empty: sessions.length === 0 && weeks.length === 0 && holds.length === 0,
  }
}
