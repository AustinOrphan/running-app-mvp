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
import { changesSummary, decisionSummary } from '../../shared/copy/revision.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { diffPlans, type PlanWrites, type RowWrites } from '../../shared/engine/diff.ts'
import { replan, weeklyDecision, weeklyRamp } from '../../shared/engine/index.ts'
import { P } from '../../shared/engine/params/index.ts'
import type {
  EngineInput,
  PlanChange,
  PlanDraft,
  WeekDraft,
  WeeklyDecision,
} from '../../shared/engine/types.ts'
import type { PlanDiff, PlanRevisionReason, PlanRevisionView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import {
  PLAN_SESSION_COLUMNS,
  PLAN_WEEK_COLUMNS,
  type PlanSession as PlanSessionRow,
  type PlanWeek as PlanWeekRow,
  type PrismaClient,
} from '../db.ts'
import { notFound, validationError } from '../errors.ts'
import { toPlanRevision } from '../serialize.ts'
import { gatherEngineInput } from './engineInput.ts'
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
}

type WeekData = ReturnType<typeof weekRow>

/** What a re-plan will do to a plan's weeks, decided from the rows alone: nothing is written. */
export interface WeekWritePlan {
  created: WeekData[]
  updated: Array<{ before: PlanWeekRow; data: WeekData }>
  deleted: PlanWeekRow[]
}

/**
 * The week rows a re-plan writes. The draft's weeks from the current Monday on are created when
 * missing and updated when a column differs; stored weeks from the current Monday on that the draft
 * no longer has are deleted. Earlier weeks are never touched. The owner's working target stays
 * while it is within the engine's limit [rules g-2].
 */
export function planWeekWrites(
  rows: readonly PlanWeekRow[],
  args: { today: string; weeks: readonly WeekDraft[] },
): WeekWritePlan {
  const currentMonday = mondayOf(args.today)
  const byStart = new Map(rows.map((row) => [row.weekStart, row]))
  const future = args.weeks.filter((week) => week.weekStart >= currentMonday)
  const planned: WeekWritePlan = { created: [], updated: [], deleted: [] }
  for (const week of future) {
    const data = weekRow(week)
    const old = byStart.get(week.weekStart)
    if (!old) {
      planned.created.push(data)
      continue
    }
    const keep =
      (old.targetSource === 'override' || old.targetSource === 'review') &&
      old.targetRunMin <= week.targetRunMin
    const set: WeekData = keep
      ? {
          ...data,
          targetRunMin: old.targetRunMin,
          targetSource: old.targetSource,
          overrideNote: old.overrideNote,
        }
      : data
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
  args: { planId: string; today: string; weeks: readonly WeekDraft[] },
): Promise<WeekWriteSet> {
  const rows = await tx.planWeek.findMany({ where: { planId: args.planId } })
  const planned = planWeekWrites(rows, args)
  const written: WeekWriteSet = { created: [], deleted: planned.deleted, updated: [] }
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
  /** Rest windows (phase 3a, E5); empty until the model exists. */
  disruptions: {
    created: Array<{ id: string; hash: string }>
    updated: Array<{ id: string; before: Record<string, unknown>; hash: string }>
  }
}

/** The columns an undo restores: every scalar column of the table except `updatedAt`. */
const SESSION_COLUMNS: readonly string[] = PLAN_SESSION_COLUMNS.filter((c) => c !== 'updatedAt')
const WEEK_COLUMNS: readonly string[] = PLAN_WEEK_COLUMNS.filter((c) => c !== 'updatedAt')
/**
 * The activity link and its assessment are not part of what a session says, so a run being linked
 * to a session reads as that, never as an edit of the session.
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

function changedColumns(
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
export function revisionParts(writes: { sessions?: SessionWriteSet; weeks?: WeekWriteSet }): {
  diff: PlanDiff
  undo: UndoPayload | null
} {
  const sessions: RowWrites<PlanSessionRow> = writes.sessions ?? noWrites()
  const weeks: RowWrites<PlanWeekRow> = writes.weeks ?? noWrites()
  const diff = diffPlans({ sessions, weeks })
  if (diff.empty) return { diff, undo: null }
  return {
    diff,
    undo: {
      v: 1,
      sessions: undoRows(sessions, SESSION_COLUMNS, SESSION_HASH_COLUMNS),
      weeks: undoRows(weeks, WEEK_COLUMNS, WEEK_COLUMNS),
      disruptions: { created: [], updated: [] },
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
      decision: record.decision ? JSON.stringify(record.decision) : null,
      diff: record.diff ? JSON.stringify(record.diff) : null,
      undo: record.undo ? JSON.stringify(record.undo) : null,
      disruptionId: record.disruptionId ?? null,
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

/**
 * A page of the active plan's revisions, newest first. Revisions whose diff is empty (a weekly
 * update that changed nothing) are left out unless `includeEmpty`; revisions without a diff, those
 * written before the revision model, stay. `before` is the id of the last revision of the previous
 * page.
 */
export async function listRevisions(
  deps: Deps,
  args: { userId: string; limit: number; before?: string; includeEmpty?: boolean },
): Promise<PlanRevisionView[]> {
  const { prisma } = deps
  const plan = await prisma.plan.findFirst({
    where: { userId: args.userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  })
  if (!plan) return []
  const cursor =
    args.before === undefined
      ? null
      : await prisma.planRevision.findFirst({ where: { id: args.before, planId: plan.id } })
  if (args.before !== undefined && cursor === null) throw notFound('Revision not found.')
  const rows = await prisma.planRevision.findMany({
    where: {
      planId: plan.id,
      AND: [
        cursor === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            },
        // A null diff is not a match for NOT LIKE in SQL, so it is named.
        args.includeEmpty
          ? {}
          : { OR: [{ diff: null }, { NOT: { diff: { contains: EMPTY_DIFF_MARK } } }] },
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: args.limit,
  })
  const now = new Date()
  return rows.map((row) => toPlanRevision(row, now))
}

// ---------------------------------------------------------------------------------------------
// Compute and apply
// ---------------------------------------------------------------------------------------------

/** Changes the engine input before a re-plan reads it: how a what-if applies a hypothetical. */
export type PlanInputTransform = (input: EngineInput) => EngineInput

export interface ReplanArgs {
  userId: string
  reason: PlanRevisionReason
  today: string
  transform?: PlanInputTransform
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
  /** The reason the revision is written with: a weekly update after a long break reads 'break'. */
  reason: PlanRevisionReason
  auto: boolean
  summary: string
  changes: PlanChange[]
  decision: WeeklyDecision | null
  draft: PlanDraft
  raceWeekStart: string
  /** What writing it would change, from the rows as they are now. */
  diff: PlanDiff
}

/**
 * The writes of a draft as a diff reads them, before anything is written: the same pairing as the
 * write itself (`planSessionWrites`, `planWeekWrites`), with the rows to be created described by
 * their engine columns. A session not yet written has no id and no `externalId`.
 */
function previewWrites(
  planId: string,
  rows: { sessions: readonly PlanSessionRow[]; weeks: readonly PlanWeekRow[] },
  args: { today: string; draft: PlanDraft },
): PlanWrites {
  const sessions = planSessionWrites(rows.sessions, {
    today: args.today,
    sessions: args.draft.sessions,
  })
  const weeks = planWeekWrites(rows.weeks, { today: args.today, weeks: args.draft.weeks })
  return {
    sessions: {
      created: sessions.created.map((spec) => ({ id: null, ...sessionRow(planId, spec, '') })),
      deleted: sessions.deleted,
      updated: sessions.updated.map(({ before, data }) => ({
        before,
        after: { ...before, ...data },
      })),
    },
    weeks: {
      created: weeks.created,
      deleted: weeks.deleted,
      updated: weeks.updated.map(({ before, data }) => ({ before, after: { ...before, ...data } })),
    },
  }
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
  const options = JSON.parse(plan.options) as EngineInput['options']
  const gathered = await gatherEngineInput(
    deps,
    { userId, goalId: plan.goalId, today, options },
    { existing: true },
  )
  const input = args.transform ? args.transform(gathered) : gathered
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
  const weekCaps: Record<string, number> = {}
  if (decision !== null && decision.decision !== 'progress') {
    weekCaps[addDays(lastWeek, 7)] = decision.nextWeekTargetMin
  }
  const [weekRows, sessionRows] = await Promise.all([
    prisma.planWeek.findMany({ where: { planId: plan.id } }),
    prisma.planSession.findMany({ where: { planId: plan.id } }),
  ])
  for (const week of weekRows) {
    if (
      week.weekStart >= currentMonday &&
      (week.targetSource === 'override' || week.targetSource === 'review')
    ) {
      weekCaps[week.weekStart] = week.targetRunMin
    }
  }
  // A hold trims the next quality session of the week it caps; a reduce makes it a recovery week.
  const decisions: Record<string, WeeklyDecision['decision']> =
    decision !== null && decision.decision !== 'progress'
      ? { [addDays(lastWeek, 7)]: decision.decision }
      : {}
  const { draft, changes } = replan({ ...input, weekCaps }, { decisions })

  const reason: PlanRevisionReason =
    args.reason === 'weekly' && state.layoffDays >= P.j7.tier1Days.value ? 'break' : args.reason
  const summary = [
    describeChanges(changes),
    decision ? decisionSummary(decision.decision, decision.nextWeekTargetMin) : null,
  ]
    .filter((line): line is string => line !== null)
    .join(' ')

  return {
    userId,
    planId: plan.id,
    goal: plan.goal,
    input: { goal: input.goal },
    today,
    reason,
    // The scheduler asks for 'weekly' and nothing else does; a request never writes an automatic revision.
    auto: args.reason === 'weekly',
    summary,
    changes,
    decision,
    draft,
    raceWeekStart: mondayOf(plan.goal.targetDate),
    diff: diffPlans(
      previewWrites(plan.id, { sessions: sessionRows, weeks: weekRows }, { today, draft }),
    ),
  }
}

/**
 * Writes a computed re-plan in one transaction and returns its revision. The rows are paired again
 * against the stored rows inside the transaction, so the diff and the undo payload describe what
 * was written. A draft that fails the quality checklist is refused (422) and nothing is written.
 */
export async function applyReplan(deps: Deps, result: ReplanResult): Promise<PlanRevisionView> {
  const { planId, today, draft } = result
  const blocked = failedChecklist(draft.checklist)
  if (blocked) throw blocked

  return deps.prisma.$transaction(
    async (tx) => {
      const sessions = await writeReplannedSessions(tx, {
        planId,
        today,
        sessions: draft.sessions,
      })
      const weeks = await writeReplannedWeeks(tx, { planId, today, weeks: draft.weeks })
      await tx.plan.update({
        where: { id: planId },
        data: {
          raceWeekStart: result.raceWeekStart,
          paramsVersion: draft.paramsVersion,
          feasibility: JSON.stringify(draft.feasibility),
          warnings: JSON.stringify(draft.warnings),
          checklist: JSON.stringify(draft.checklist),
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
      const { diff, undo } = revisionParts({ sessions, weeks })
      return recordPlanWrite(tx, {
        planId,
        userId: result.userId,
        reason: result.reason,
        summary: result.summary,
        changes: result.changes,
        diff,
        undo,
        decision: result.decision,
        auto: result.auto,
      })
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
}

/** Re-plans the active plan from the updated state and writes a `PlanRevision`. */
export async function replanActivePlan(
  deps: Deps,
  args: { userId: string; reason: PlanRevisionReason; today: string },
): Promise<PlanRevisionView> {
  return applyReplan(deps, await computeReplan(deps, args))
}
