// Re-plans and the revision log (phase 3a design 4.2, ADR 0007). This module is the only way to
// write a re-plan or a `PlanRevision`:
//
// - `computeReplan` reads and decides. It writes nothing, so a preview and a commit can both start
//   from it, and it takes an optional transformer of the engine input for a what-if.
// - `applyReplan` runs the transaction: the row-level writes of design 4.1 (`writeReplannedSessions`
//   and `writeReplannedWeeks`), the plan's derived columns, the prediction log, then
//   `recordPlanWrite` with the diff and the undo payload built from the rows actually written.
// - `recordPlanWrite` is the one function that creates a `PlanRevision`. It bumps no data version:
//   the client does that after every state write (ADR 0009).
// - `replanActivePlan` keeps its old signature as `applyReplan(computeReplan(...))`.
//
// `planEngine.ts` re-exports `replanActivePlan` and imports `recordPlanWrite` from here, and this
// module uses the row builders of `planEngine.ts`: the two import each other. Every use is inside a
// function body, so the cycle never sees an uninitialised binding.
import { createHash } from 'node:crypto'
import { addDays, mondayOf } from '../../shared/dates.ts'
import {
  changesSummary,
  decisionSummary,
  stalePreviewMessage,
  targetsSummary,
} from '../../shared/copy/revision.ts'
import { runMinutesAhead } from '../../shared/domain/runMinutes.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { draftRamp } from '../../shared/engine/checklist.ts'
import { disruptionPlan, heldDates } from '../../shared/engine/disruption.ts'
import { diffPlans, type PlanWrites, type RowWrites } from '../../shared/engine/diff.ts'
import { backdatedSkips, replan, weeklyDecision, weeklyRamp } from '../../shared/engine/index.ts'
import { targetLimit, type TargetLimit } from '../../shared/engine/limits.ts'
import { progressionHold } from '../../shared/engine/macro.ts'
import { P } from '../../shared/engine/params/index.ts'
import type {
  AthleteState,
  EngineInput,
  PlanChange,
  PlanDraft,
  WeekDraft,
  WeeklyDecision,
} from '../../shared/engine/types.ts'
import type {
  PlanDiff,
  PlanRevisionReason,
  PlanRevisionView,
  RunMinutes,
  TargetDiffLine,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import {
  PLAN_SESSION_COLUMNS,
  PLAN_WEEK_COLUMNS,
  type PlanSession as PlanSessionRow,
  type PlanWeek as PlanWeekRow,
  type PrismaClient,
} from '../db.ts'
import { conflict, notFound, validationError } from '../errors.ts'
import { toPlanRevision, toPlanSession } from '../serialize.ts'
import { gatherEngineInput, sessionSpec } from './engineInput.ts'
import { withGutTrainingOption } from './fuel.ts'
import { recordPrediction, type PredictionGoal } from './predictionLog.ts'
import {
  executionRecordsByWeek,
  failedChecklist,
  planSessionWrites,
  sessionRow,
  weekRow,
  WRITE_TIMEOUT_MS,
  writeReplannedSessions,
  type SessionWriteSet,
} from './planEngine.ts'

// ---------------------------------------------------------------------------------------------
// Rows written
// ---------------------------------------------------------------------------------------------

/** The rows a re-plan wrote to a plan's weeks, as `SessionWriteSet` does for its sessions. */
export interface WeekWriteSet {
  created: PlanWeekRow[]
  /** Full rows, so an undo can recreate them with their id. */
  deleted: PlanWeekRow[]
  /** Only the rows with a changed column; `before` and `after` are full rows. */
  updated: Array<{ id: string; before: PlanWeekRow; after: PlanWeekRow }>
  /**
   * The raised week targets of the runner that the write kept or lowered, whether or not the row
   * changed (a kept target leaves its row as it was). Not rows: nothing here is restored by an undo,
   * which restores the rows above.
   */
  targets: TargetDiffLine[]
}

type WeekData = ReturnType<typeof weekRow>

/** What a re-plan will do to a plan's weeks, decided from the rows alone: nothing is written. */
export interface WeekWritePlan {
  created: WeekData[]
  updated: Array<{ before: PlanWeekRow; data: WeekData }>
  deleted: PlanWeekRow[]
  /** What became of each week target the runner raised above the plan's own figure. */
  targets: TargetDiffLine[]
}

/**
 * The week rows a re-plan writes. The draft's weeks from the current Monday on are created when
 * missing and updated when a column differs; stored weeks from the current Monday on that the draft
 * no longer has are deleted. Earlier weeks are never touched.
 *
 * The owner's working target stays [rules g-2, ADR 0007]. A target at or under the plan's own
 * figure stays as set, and a review's target stays only so. A target the runner raised by hand
 * (`targetSource` override) above the plan's figure stays up to `limits` for its week, the largest
 * the engine allows any week (`targetLimit`): a higher one is lowered to that limit. A raised
 * target without a limit is replaced by the plan's figure. Each raised target the write kept or
 * lowered is named in `targets`, from the row as it is written.
 */
export function planWeekWrites(
  rows: readonly PlanWeekRow[],
  args: {
    today: string
    weeks: readonly WeekDraft[]
    /** The limit of each week whose target the runner raised (`raisedTargetLimits`), by Monday. */
    limits?: ReadonlyMap<string, TargetLimit>
  },
): WeekWritePlan {
  const currentMonday = mondayOf(args.today)
  const byStart = new Map(rows.map((row) => [row.weekStart, row]))
  const future = args.weeks.filter((week) => week.weekStart >= currentMonday)
  const planned: WeekWritePlan = { created: [], updated: [], deleted: [], targets: [] }
  for (const week of future) {
    const data = weekRow(week)
    const old = byStart.get(week.weekStart)
    if (!old) {
      planned.created.push(data)
      continue
    }
    let keptMin: number | null = null
    if (
      (old.targetSource === 'override' || old.targetSource === 'review') &&
      old.targetRunMin <= week.targetRunMin
    ) {
      keptMin = old.targetRunMin
    } else if (old.targetSource === 'override') {
      const limit = args.limits?.get(week.weekStart)
      if (limit !== undefined) {
        keptMin = Math.min(old.targetRunMin, limit.max)
        planned.targets.push({
          weekStart: week.weekStart,
          outcome: keptMin === old.targetRunMin ? 'kept' : 'clipped',
          askedMin: old.targetRunMin,
          keptMin,
          engineMin: week.targetRunMin,
          limit: limit.kind,
          ramp: limit.ramp,
        })
      }
    }
    const set: WeekData =
      keptMin === null
        ? data
        : {
            ...data,
            targetRunMin: keptMin,
            targetSource: old.targetSource,
            overrideNote: old.overrideNote,
          }
    if ((Object.keys(set) as Array<keyof WeekData>).some((column) => old[column] !== set[column])) {
      planned.updated.push({ before: old, data: set })
    }
  }
  const futureStarts = new Set(future.map((week) => week.weekStart))
  planned.deleted = rows.filter(
    (row) => row.weekStart >= currentMonday && !futureStarts.has(row.weekStart),
  )
  return planned
}

/** Writes a re-plan's weeks row by row and returns what was written. */
export async function writeReplannedWeeks(
  tx: Pick<PrismaClient, 'planWeek'>,
  args: {
    planId: string
    today: string
    weeks: readonly WeekDraft[]
    limits?: ReadonlyMap<string, TargetLimit>
  },
): Promise<WeekWriteSet> {
  const rows = await tx.planWeek.findMany({ where: { planId: args.planId } })
  const planned = planWeekWrites(rows, args)
  const written: WeekWriteSet = {
    created: [],
    deleted: planned.deleted,
    updated: [],
    targets: planned.targets,
  }
  for (const data of planned.created) {
    written.created.push(await tx.planWeek.create({ data: { ...data, planId: args.planId } }))
  }
  for (const { before, data } of planned.updated) {
    const after = await tx.planWeek.update({ where: { id: before.id }, data })
    written.updated.push({ id: before.id, before, after })
  }
  if (planned.deleted.length > 0) {
    await tx.planWeek.deleteMany({ where: { id: { in: planned.deleted.map((row) => row.id) } } })
  }
  return written
}

// ---------------------------------------------------------------------------------------------
// The undo payload
// ---------------------------------------------------------------------------------------------

/** A session row without `updatedAt`: the content that an undo restores and a hash covers. */
export type SessionContent = Omit<PlanSessionRow, 'updatedAt'>
export type WeekContent = Omit<PlanWeekRow, 'updatedAt'>

export interface UndoRows<Row> {
  /** Rows the revision created: their id and the hash of the row as written. */
  created: Array<{ id: string; hash: string }>
  /** Rows the revision deleted, whole: every scalar column except `updatedAt`. */
  deleted: Row[]
  /** Rows the revision updated: the columns it changed, as they were, and the hash as written. */
  updated: Array<{ id: string; before: Partial<Row>; hash: string }>
}

/**
 * What it takes to reverse a revision (design 4.2), stored as JSON in `PlanRevision.undo`. It holds
 * rows, never plan-level derived columns (those are recomputed). Server only: no route sends it.
 */
export interface UndoPayload {
  v: 1
  sessions: UndoRows<SessionContent>
  weeks: UndoRows<WeekContent>
  /**
   * Rest windows (phase 3a, E5): the rows the revision created (an undo withdraws them) and the
   * columns it changed (an undo puts them back), each with the hash of the row as written. A
   * window the revision withdrew is an update of `status`.
   */
  disruptions: {
    created: Array<{ id: string; hash: string }>
    updated: Array<{ id: string; before: Record<string, unknown>; hash: string }>
  }
}

/** The columns an undo restores: every scalar column of the table except `updatedAt`. */
export const SESSION_COLUMNS: readonly string[] = PLAN_SESSION_COLUMNS.filter(
  (c) => c !== 'updatedAt',
)
export const WEEK_COLUMNS: readonly string[] = PLAN_WEEK_COLUMNS.filter((c) => c !== 'updatedAt')
/**
 * The activity link and its assessment are not part of what a session says. Linking a run also sets
 * the session's `status` (completed or partial), which stays in the hash because an owner's skip or
 * move is a status too; a reader that compares hashes therefore checks `activityId` first
 * (`scopeUndo` in `revisions.ts`), so a linked run reads as a run and never as an edit.
 */
const LINK_COLUMNS: ReadonlySet<string> = new Set(['execution', 'activityId', 'linkSource'])
const SESSION_HASH_COLUMNS = SESSION_COLUMNS.filter((c) => !LINK_COLUMNS.has(c))

type Scalar = string | number | boolean | null

function scalarOf(row: object, column: string): Scalar {
  return (row as Record<string, Scalar | undefined>)[column] ?? null
}

function contentOf(row: object, columns: readonly string[]): Record<string, Scalar> {
  return Object.fromEntries(columns.map((column) => [column, scalarOf(row, column)]))
}

/** SHA-256 of the stable JSON of a row's `columns`: sorted by name, absent values as null. */
function hashRow(row: object, columns: readonly string[]): string {
  const content = contentOf(row, [...columns].sort())
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

/** The hash of a session's content columns: all but `updatedAt` and the activity link. */
export function sessionHash(row: SessionContent): string {
  return hashRow(row, SESSION_HASH_COLUMNS)
}

/** The hash of a week's content columns: all but `updatedAt`. */
export function weekHash(row: WeekContent): string {
  return hashRow(row, WEEK_COLUMNS)
}

/**
 * The columns of a window that say what it is and what it does. Its identity and owner never
 * change, and a hash that covered `updatedAt` would change with every write.
 */
export const DISRUPTION_COLUMNS: readonly string[] = [
  'reason',
  'mode',
  'startDate',
  'endDate',
  'maxRunMin',
  'area',
  'pain',
  'gaitChange',
  'note',
  'status',
]

/** The hash of a window's content columns. */
export function disruptionHash(row: object): string {
  return hashRow(row, DISRUPTION_COLUMNS)
}

/** The columns in which two rows differ, with the first row's value. `id` is never listed. */
export function changedColumns(
  before: object,
  after: object,
  columns: readonly string[],
): Record<string, Scalar> {
  return Object.fromEntries(
    columns
      .filter((column) => column !== 'id' && scalarOf(before, column) !== scalarOf(after, column))
      .map((column) => [column, scalarOf(before, column)]),
  )
}

function undoRows<Row extends { id: string }>(
  writes: RowWrites<Row>,
  columns: readonly string[],
  hashColumns: readonly string[],
): UndoRows<Omit<Row, 'updatedAt'>> {
  type Content = Omit<Row, 'updatedAt'>
  return {
    created: writes.created.map((row) => ({ id: row.id, hash: hashRow(row, hashColumns) })),
    deleted: writes.deleted.map((row) => contentOf(row, columns) as unknown as Content),
    updated: writes.updated.map(({ before, after }) => ({
      id: after.id,
      before: changedColumns(before, after, columns) as unknown as Partial<Content>,
      hash: hashRow(after, hashColumns),
    })),
  }
}

const noWrites = <Row>(): RowWrites<Row> => ({ created: [], deleted: [], updated: [] })

/**
 * The diff and the undo payload of one write, built from the rows it wrote. Nothing written gives
 * an empty diff and no payload: there is nothing to restore.
 */
export function revisionParts(writes: {
  sessions?: SessionWriteSet
  weeks?: WeekWriteSet
  /** The window rows the write created or changed (E5): they are part of what an undo restores. */
  disruptions?: UndoPayload['disruptions']
  holds?: PlanDiff['holds']
}): {
  diff: PlanDiff
  undo: UndoPayload | null
} {
  const sessions: RowWrites<PlanSessionRow> = writes.sessions ?? noWrites()
  const weeks: RowWrites<PlanWeekRow> = writes.weeks ?? noWrites()
  const diff = diffPlans({
    sessions,
    weeks,
    ...(writes.holds ? { holds: writes.holds } : {}),
    ...(writes.weeks ? { targets: writes.weeks.targets } : {}),
  })
  const disruptions = writes.disruptions ?? { created: [], updated: [] }
  // A window written without any session or week changing still has something to restore.
  const touched = disruptions.created.length + disruptions.updated.length > 0
  if (diff.empty && !touched) return { diff, undo: null }
  return {
    diff,
    undo: {
      v: 1,
      sessions: undoRows(sessions, SESSION_COLUMNS, SESSION_HASH_COLUMNS),
      weeks: undoRows(weeks, WEEK_COLUMNS, WEEK_COLUMNS),
      disruptions,
    },
  }
}

/** A plan's session and week rows, in memory. */
export interface PlanRows {
  sessions: SessionContent[]
  weeks: WeekContent[]
}

function applyRows<Row extends { id: string }>(rows: readonly Row[], undo: UndoRows<Row>): Row[] {
  const created = new Set(undo.created.map((entry) => entry.id))
  const restored = new Map(undo.updated.map((entry) => [entry.id, entry.before]))
  return [
    ...rows
      .filter((row) => !created.has(row.id))
      .map((row) => {
        const before = restored.get(row.id)
        return before === undefined ? row : { ...row, ...before }
      }),
    ...undo.deleted.map((row) => ({ ...row })),
  ]
}

/**
 * The rows as they were before the revision: the rows it created are removed, the rows it deleted
 * come back whole (id and `externalId` included) and the columns it changed take their old values.
 * Pure; the caller chooses which rows take part (an undo leaves the past alone) and compares hashes
 * first (`sessionHash`, `weekHash`) to refuse an undo of a row edited since. The input is not
 * changed, and the result is in no particular order.
 */
export function applyUndoPayload(rows: PlanRows, payload: UndoPayload): PlanRows {
  return {
    sessions: applyRows(rows.sessions, payload.sessions),
    weeks: applyRows(rows.weeks, payload.weeks),
  }
}

// ---------------------------------------------------------------------------------------------
// The revision log
// ---------------------------------------------------------------------------------------------

export interface PlanWriteRecord {
  planId: string
  /** The plan must be this user's: a revision is never written to another user's plan. */
  userId: string
  reason: PlanRevisionReason
  summary: string
  changes: PlanChange[]
  /** Null when the write has no row-level diff (a new plan, a zone decision). */
  diff: PlanDiff | null
  /** Null when nothing can be restored. */
  undo: UndoPayload | null
  /** The weekly decision this write acted on. */
  decision?: WeeklyDecision | null
  /** Written by the scheduler, not by a request. */
  auto?: boolean
  /** The rest window this write created, changed or removed. */
  disruptionId?: string | null
  /** On an 'undo' revision: the revision it reverted. */
  undoOf?: string | null
}

/**
 * Writes one `PlanRevision`; the only function that does. Call it inside the transaction that
 * wrote the rows it describes. It raises no data version: the client does that after each state
 * write.
 */
export async function recordPlanWrite(
  tx: Pick<PrismaClient, 'plan' | 'planRevision'>,
  record: PlanWriteRecord,
): Promise<PlanRevisionView> {
  const owned = await tx.plan.count({ where: { id: record.planId, userId: record.userId } })
  if (owned === 0) throw notFound('Plan not found.')
  const row = await tx.planRevision.create({
    data: {
      planId: record.planId,
      reason: record.reason,
      summary: record.summary,
      changes: JSON.stringify(record.changes),
      auto: record.auto ?? false,
      // The one seen marker (ADR 0007): a revision the runner asked for is seen when it is written;
      // one the scheduler wrote waits until a surface that shows it stamps it (`markRevisionSeen`).
      seenAt: record.auto ? null : new Date(),
      decision: record.decision ? JSON.stringify(record.decision) : null,
      diff: record.diff ? JSON.stringify(record.diff) : null,
      undo: record.undo ? JSON.stringify(record.undo) : null,
      disruptionId: record.disruptionId ?? null,
      undoOf: record.undoOf ?? null,
    },
  })
  return toPlanRevision(row)
}

/**
 * How `PlanDiff.empty` reads in the stored JSON. A revision list filters on it in the query, so the
 * page of a list holds as many revisions as were asked for; no other text of a diff contains it
 * (a quote inside a title is escaped).
 */
export const EMPTY_DIFF_MARK = '"empty":true'

/**
 * The summary of week-level changes: "3 changes across 2 weeks." The words are templates in
 * `shared/copy/revision.ts`.
 */
export function describeChanges(changes: readonly PlanChange[]): string {
  return changesSummary(changes.length, new Set(changes.map((c) => c.weekStart)).size)
}

// ---------------------------------------------------------------------------------------------
// Compute and apply
// ---------------------------------------------------------------------------------------------

/** Changes the engine input before a re-plan reads it: how a what-if applies a hypothetical. */
export type PlanInputTransform = (input: EngineInput) => EngineInput

/** What a rest-window action tells the re-plan it is part of. */
export interface WindowReplan {
  /** The window's span in the diff: after the action, or as it was for a removal. */
  hold: PlanDiff['holds'][number]
  /** The summary of the revision: what the action did to the window. */
  summary: string
}

export interface ReplanArgs {
  userId: string
  reason: PlanRevisionReason
  today: string
  transform?: PlanInputTransform
  /**
   * Set by a rest-window action. The re-plan then marks the past sessions the windows cover as
   * skipped before it writes (design 9.4), puts the window in the diff and takes the summary.
   */
  window?: WindowReplan
}

/** A past session that a rest window skips, written before the re-plan's own rows. */
export interface SettleWrite {
  before: PlanSessionRow
  data: { status: 'skipped'; flags: string; original: string }
}

/** A re-plan that has been decided and not written. */
export interface ReplanResult {
  userId: string
  planId: string
  /** The plan's goal, for the prediction log. */
  goal: PredictionGoal
  /** The goal model of the engine input the draft was made from (race-day WBGT). */
  input: Pick<EngineInput, 'goal'>
  today: string
  /** The newest revision of the plan before anything was read, for the head check of the write. */
  headRevisionId: string | null
  /**
   * The engine options the draft was made with, the gut-training switch included. `applyReplan`
   * stores them in `Plan.options`; absent, the stored options are left as they are.
   */
  options?: EngineInput['options']
  /** The reason the revision is written with: a weekly update after a long break reads 'break'. */
  reason: PlanRevisionReason
  auto: boolean
  /** What a preview shows: `baseSummary`, then the sentences for the raised week targets. */
  summary: string
  /**
   * The summary without the raised week targets. `applyReplan` adds the sentences for the targets
   * as it writes them, so the stored summary names what was written.
   */
  baseSummary: string
  changes: PlanChange[]
  decision: WeeklyDecision | null
  draft: PlanDraft
  /** The limit of each week whose target the runner raised above the plan's own figure. */
  targetLimits: ReadonlyMap<string, TargetLimit>
  raceWeekStart: string
  /** The days the windows hold: an owner edit on one is released, so the write must know them. */
  holdDates: string[]
  /** The past sessions a rest window skips first; empty for any other re-plan. */
  settle: SettleWrite[]
  /** The rest windows the diff names; empty for any other re-plan. */
  holds: PlanDiff['holds']
  /** What writing it would change, from the rows as they are now. */
  diff: PlanDiff
  /** The running time of the next 28 days, now and once the same writes are applied. */
  runMin: RunMinutes | null
}

/** A write that found the plan changed since it was decided; the caller recomputes or answers 409. */
export class StaleWrite extends Error {
  constructor() {
    super('The plan changed after this was decided.')
    this.name = 'StaleWrite'
  }
}

/** The id of a plan's newest revision, or null. */
export async function headRevisionOf(
  prisma: Pick<PrismaClient, 'planRevision'>,
  planId: string,
): Promise<string | null> {
  const head = await prisma.planRevision.findFirst({
    where: { planId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  return head?.id ?? null
}

/**
 * The writes of a draft as a diff reads them, before anything is written: the same pairing as the
 * write itself (`planSessionWrites`, `planWeekWrites`), with the rows to be created described by
 * their engine columns. A session not yet written has no id and no `externalId`.
 */
function previewWrites(
  planId: string,
  rows: { sessions: readonly PlanSessionRow[]; weeks: readonly PlanWeekRow[] },
  args: {
    today: string
    draft: PlanDraft
    settle: readonly SettleWrite[]
    holdDates: ReadonlySet<string>
    holds: PlanDiff['holds']
    limits: ReadonlyMap<string, TargetLimit>
  },
): PlanWrites {
  // The write pairs the rows after the skips, and so does this. The skipped rows lie in the past,
  // which a re-plan keeps, so they never take part in the pairing either way.
  const settled = new Map(args.settle.map((write) => [write.before.id, write]))
  const current = rows.sessions.map((row) => {
    const write = settled.get(row.id)
    return write === undefined ? row : { ...row, ...write.data }
  })
  const sessions = planSessionWrites(current, {
    today: args.today,
    sessions: args.draft.sessions,
    heldDates: args.holdDates,
  })
  const weeks = planWeekWrites(rows.weeks, {
    today: args.today,
    weeks: args.draft.weeks,
    limits: args.limits,
  })
  return {
    sessions: {
      created: sessions.created.map((spec) => ({ id: null, ...sessionRow(planId, spec, '') })),
      deleted: sessions.deleted,
      updated: [
        ...args.settle.map(({ before, data }) => ({ before, after: { ...before, ...data } })),
        ...sessions.updated.map(({ before, data }) => ({ before, after: { ...before, ...data } })),
      ],
    },
    weeks: {
      created: weeks.created,
      deleted: weeks.deleted,
      updated: weeks.updated.map(({ before, data }) => ({ before, after: { ...before, ...data } })),
    },
    holds: args.holds,
    targets: weeks.targets,
  }
}

/**
 * The past sessions the windows of `input` skip, as writes: still to be run, unlinked, on a day a
 * window holds or caps (`backdatedSkips`). The row keeps its prescription in `original`, as the
 * runner's own skip does, and gains the flag `rest-window`, which the engine reads as "not run".
 */
function settleWrites(
  rows: readonly PlanSessionRow[],
  input: Pick<EngineInput, 'disruptions'>,
  today: string,
): SettleWrite[] {
  const targets = new Set(backdatedSkips(rows, disruptionPlan(input.disruptions ?? []), today))
  return rows
    .filter((row) => targets.has(row))
    .map((before) => {
      const flags = toPlanSession(before).flags
      return {
        before,
        data: {
          status: 'skipped' as const,
          flags: JSON.stringify(flags.includes('rest-window') ? flags : [...flags, 'rest-window']),
          original: before.original ?? JSON.stringify(sessionSpec(toPlanSession(before))),
        },
      }
    })
}

/** The engine input with the sessions of `settle` skipped and flagged, as the write will leave them. */
function settledInput(input: EngineInput, settle: readonly SettleWrite[]): EngineInput {
  if (settle.length === 0 || input.existing === null) return input
  const ids = new Set(settle.map((write) => write.before.id))
  return {
    ...input,
    existing: {
      ...input.existing,
      sessions: input.existing.sessions.map((session) =>
        ids.has(session.id)
          ? {
              ...session,
              status: 'skipped',
              flags: session.flags.includes('rest-window')
                ? session.flags
                : [...session.flags, 'rest-window'],
            }
          : session,
      ),
    },
  }
}

/** A summary followed by the sentences for the raised week targets the write kept or lowered. */
function withTargets(summary: string, targets: readonly TargetDiffLine[]): string {
  return targets.length === 0 ? summary : `${summary} ${targetsSummary(targets)}`
}

/**
 * The limit of each week whose target the runner raised above the plan's own figure, by Monday
 * [rules g-2, g-3, ADR 0007]. A week counts when its row is an override above the draft's target
 * and the draft still has the week. The limit is `targetLimit` over the ramp of the draft, as the
 * checklist reads it (`draftRamp`). The weeks are taken in order, and the target each override at
 * or above the plan's figure keeps enters the minutes of the weeks after it, so the ramp of a later
 * raised week is measured from the weeks as the runner holds them, as it is from weeks that were
 * run. An override that an earlier re-plan lowered to the plan's own figure stays in that count, so
 * two re-plans in a row read the same minutes.
 */
export function raisedTargetLimits(args: {
  rows: readonly PlanWeekRow[]
  draft: PlanDraft
  input: EngineInput
  state: AthleteState
  /** The Monday the weekly decision (hold or reduce) caps, when it did. */
  decidedWeek: string | null
}): Map<string, TargetLimit> {
  const { rows, draft, input, state, decidedWeek } = args
  const currentMonday = mondayOf(input.today)
  const drawn = new Map(draft.weeks.map((week) => [week.weekStart, week]))
  const owned = rows
    .filter((row) => {
      const week = drawn.get(row.weekStart)
      return (
        row.targetSource === 'override' &&
        row.weekStart >= currentMonday &&
        week !== undefined &&
        row.targetRunMin >= week.targetRunMin
      )
    })
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
  const limits = new Map<string, TargetLimit>()
  if (!owned.some((row) => row.targetRunMin > drawn.get(row.weekStart)!.targetRunMin)) return limits
  const { ctx } = draftRamp(draft, input, state)
  const held = progressionHold(input, state)
  const logged = state.weeks.find((week) => week.weekStart === currentMonday)?.runMin ?? 0
  for (const row of owned) {
    const week = drawn.get(row.weekStart)!
    const limit = targetLimit(ctx, row.weekStart, {
      engineMin: week.targetRunMin,
      week,
      held,
      decided: row.weekStart === decidedWeek,
      loggedMin: row.weekStart === currentMonday ? logged : 0,
    })
    if (row.targetRunMin > week.targetRunMin) limits.set(row.weekStart, limit)
    const kept = Math.min(row.targetRunMin, limit.max)
    ctx.volumes.set(row.weekStart, Math.max(ctx.volumes.get(row.weekStart) ?? 0, kept))
  }
  return limits
}

/**
 * Decides a re-plan of the active plan from the updated state and writes nothing. A failed quality
 * checklist is not thrown here: it is in `draft.checklist`, and `applyReplan` refuses to write it.
 */
export async function computeReplan(deps: Deps, args: ReplanArgs): Promise<ReplanResult> {
  const { prisma } = deps
  const { userId, today } = args
  const plan = await prisma.plan.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { goal: true },
  })
  if (!plan) throw notFound('There is no active plan to re-plan.')
  if (plan.generatorVersion < 2) {
    throw validationError(
      'This plan was made by the version-1 generator and cannot be re-planned. Generate a new plan.',
    )
  }
  if (plan.goal.targetDate < today) {
    throw validationError('The goal date has passed. Move the date or choose another goal.')
  }
  // The newest revision is read before anything else, so a revision that lands during the compute
  // makes the head check of the write (and the hash of a preview) differ, never silently match.
  const headRevisionId = await headRevisionOf(prisma, plan.id)
  // The gut-training switch is read from the stored fuel settings at every compute, so a change to
  // the switches shows up in the next re-plan's diff, and a preview and its commit agree (design
  // 10.5). `applyReplan` stores the options it was computed with.
  const options = await withGutTrainingOption(
    prisma,
    userId,
    JSON.parse(plan.options) as EngineInput['options'],
  )
  const gathered = await gatherEngineInput(
    deps,
    { userId, goalId: plan.goalId, today, options },
    { existing: true },
  )
  const hypothetical = args.transform ? args.transform(gathered) : gathered
  const [weekRows, sessionRows] = await Promise.all([
    prisma.planWeek.findMany({ where: { planId: plan.id } }),
    prisma.planSession.findMany({ where: { planId: plan.id } }),
  ])
  // A window reported late skips the past sessions it covers, and the engine sees them skipped:
  // a skipped run in the window is not a run [rules J9, G-6]. Without a window action none are.
  const settle = args.window ? settleWrites(sessionRows, hypothetical, today) : []
  const input = settledInput(hypothetical, settle)
  const holdDates = heldDates(disruptionPlan(input.disruptions ?? []))
  const holds = args.window ? [args.window.hold] : []
  // The decision for the week that just finished goes into the summary and, after a reduce or a
  // hold, caps the week that follows it; the owner's or review's lower target caps its week too
  // and takes the place of the decision's number [rules g-2, J5].
  const state = estimateState(input)
  const currentMonday = mondayOf(today)
  const lastWeek = addDays(currentMonday, -7)
  const decision = input.existing?.weeks.some((w) => w.weekStart === lastWeek)
    ? weeklyDecision(input, lastWeek, {
        executions: (await executionRecordsByWeek(prisma, plan.id, [lastWeek])).get(lastWeek) ?? [],
        redsFlags: input.screeningFlags,
        ramp: weeklyRamp(state),
      })
    : null
  // The week a hold or a reduce caps: the week that follows the one the decision reviewed.
  const decidedWeek =
    decision !== null && decision.decision !== 'progress' ? addDays(lastWeek, 7) : null
  const weekCaps: Record<string, number> = {}
  if (decision !== null && decidedWeek !== null) {
    weekCaps[decidedWeek] = decision.nextWeekTargetMin
  }
  for (const week of weekRows) {
    if (
      week.weekStart >= currentMonday &&
      (week.targetSource === 'override' || week.targetSource === 'review')
    ) {
      // A target the runner raised above the weekly decision's cap leaves that cap in place: a hold
      // or a reduce is a limit of the week, and the raised target stays within it [rules J5, g-2].
      const decided = week.targetSource === 'override' ? weekCaps[week.weekStart] : undefined
      weekCaps[week.weekStart] =
        decided === undefined ? week.targetRunMin : Math.min(decided, week.targetRunMin)
    }
  }
  // A hold trims the next quality session of the week it caps; a reduce makes it a recovery week.
  const decisions: Record<string, WeeklyDecision['decision']> =
    decision !== null && decidedWeek !== null ? { [decidedWeek]: decision.decision } : {}
  const { draft, changes } = replan({ ...input, weekCaps }, { decisions })
  const targetLimits = raisedTargetLimits({ rows: weekRows, draft, input, state, decidedWeek })

  const reason: PlanRevisionReason =
    args.reason === 'weekly' && state.layoffDays >= P.j7.tier1Days.value ? 'break' : args.reason
  const baseSummary =
    args.window?.summary ??
    [
      describeChanges(changes),
      decision ? decisionSummary(decision.decision, decision.nextWeekTargetMin) : null,
    ]
      .filter((line): line is string => line !== null)
      .join(' ')

  // One write set describes the preview: the diff and the running time are read from it.
  const writes = previewWrites(
    plan.id,
    { sessions: sessionRows, weeks: weekRows },
    { today, draft, settle, holdDates: new Set(holdDates), holds, limits: targetLimits },
  )

  return {
    userId,
    planId: plan.id,
    goal: plan.goal,
    input: { goal: input.goal },
    today,
    headRevisionId,
    options,
    reason,
    // The scheduler asks for 'weekly' and nothing else does; a request never writes an automatic revision.
    auto: args.reason === 'weekly',
    summary: withTargets(baseSummary, writes.targets ?? []),
    baseSummary,
    changes,
    decision,
    draft,
    targetLimits,
    raceWeekStart: mondayOf(plan.goal.targetDate),
    holdDates,
    settle,
    holds,
    diff: diffPlans(writes),
    runMin: runMinutesAhead(sessionRows, writes.sessions, today),
  }
}

/** What a rest-window action wrote to the window table, for the revision that records it. */
export interface WindowWrite {
  /** The window the action created, changed or withdrew. */
  disruptionId: string
  /** What an undo of the revision does to the window table. */
  undo: UndoPayload['disruptions']
}

export interface ApplyOptions {
  /** Writes the window of a rest-window action, first, inside the transaction. */
  window?: (tx: Pick<PrismaClient, 'disruption'>) => Promise<WindowWrite>
  /** Refuses the write (`StaleWrite`) when the plan has a revision newer than the one decided on. */
  checkHead?: boolean
}

/**
 * Writes a computed re-plan in one transaction and returns its revision. The rows are paired again
 * against the stored rows inside the transaction, so the diff and the undo payload describe what
 * was written. A draft that fails the quality checklist is refused (422) and nothing is written.
 * A rest-window action passes its window write: the window, the skips of the past days it covers
 * and the re-plan are one transaction and one revision.
 */
export async function applyReplan(
  deps: Deps,
  result: ReplanResult,
  options: ApplyOptions = {},
): Promise<PlanRevisionView> {
  const { planId, today, draft } = result
  const blocked = failedChecklist(draft.checklist)
  if (blocked) throw blocked

  return deps.prisma.$transaction(
    async (tx) => {
      if (options.checkHead && (await headRevisionOf(tx, planId)) !== result.headRevisionId) {
        throw new StaleWrite()
      }
      const windowWrite = options.window ? await options.window(tx) : null
      const sessions = await writeSettled(tx, result)
      const replanned = await writeReplannedSessions(tx, {
        planId,
        today,
        sessions: draft.sessions,
        heldDates: new Set(result.holdDates),
      })
      sessions.created.push(...replanned.created)
      sessions.deleted.push(...replanned.deleted)
      sessions.updated.push(...replanned.updated)
      const weeks = await writeReplannedWeeks(tx, {
        planId,
        today,
        weeks: draft.weeks,
        limits: result.targetLimits,
      })
      await tx.plan.update({
        where: { id: planId },
        data: {
          raceWeekStart: result.raceWeekStart,
          paramsVersion: draft.paramsVersion,
          feasibility: JSON.stringify(draft.feasibility),
          warnings: JSON.stringify(draft.warnings),
          checklist: JSON.stringify(draft.checklist),
          ...(result.options === undefined ? {} : { options: JSON.stringify(result.options) }),
        },
      })
      await recordPrediction(tx, {
        userId: result.userId,
        goal: result.goal,
        draft,
        input: result.input,
        today,
        mode: 'refresh',
      })
      const { diff, undo } = revisionParts({
        sessions,
        weeks,
        ...(windowWrite ? { disruptions: windowWrite.undo } : {}),
        holds: result.holds,
      })
      return recordPlanWrite(tx, {
        planId,
        userId: result.userId,
        reason: result.reason,
        summary: withTargets(result.baseSummary, weeks.targets),
        changes: result.changes,
        diff,
        undo,
        decision: result.decision,
        auto: result.auto,
        disruptionId: windowWrite?.disruptionId ?? null,
      })
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
}

/**
 * Marks the past sessions of a rest window skipped, from the rows as they are inside the
 * transaction. A row that was linked, finished or edited since the decision was made would make the
 * diff that was shown untrue, so it stops the write (`StaleWrite`) rather than being skipped.
 */
async function writeSettled(
  tx: Pick<PrismaClient, 'planSession'>,
  result: ReplanResult,
): Promise<SessionWriteSet> {
  const written: SessionWriteSet = { created: [], deleted: [], updated: [] }
  if (result.settle.length === 0) return written
  const rows = await tx.planSession.findMany({
    where: { id: { in: result.settle.map((write) => write.before.id) } },
  })
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const { before, data } of result.settle) {
    const now = byId.get(before.id)
    if (
      now === undefined ||
      now.status !== before.status ||
      now.activityId !== before.activityId ||
      now.flags !== before.flags ||
      now.original !== before.original
    ) {
      throw new StaleWrite()
    }
    const after = await tx.planSession.update({ where: { id: before.id }, data })
    written.updated.push({ id: before.id, before: now, after })
  }
  return written
}

/**
 * Re-plans the active plan from the updated state and writes a `PlanRevision`. A request that
 * lands between the read and the write moves the plan's newest revision; the re-plan is then
 * decided again, once. A second collision is a 409 for the caller to report (the weekly job logs
 * it and the next tick tries again).
 */
export async function replanActivePlan(
  deps: Deps,
  args: { userId: string; reason: PlanRevisionReason; today: string },
): Promise<PlanRevisionView> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await applyReplan(deps, await computeReplan(deps, args), { checkHead: true })
    } catch (error) {
      if (!(error instanceof StaleWrite)) throw error
      if (attempt >= 2) throw conflict(stalePreviewMessage())
    }
  }
}
