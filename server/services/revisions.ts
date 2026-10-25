// The revision log and the undo of a revision (phase 3a design 4.2, ADR 0007).
//
// - `undoStates` says, for a page of revisions, whether each can be undone. It runs checks 1 to 6
//   of the policy (`shared/engine/undoGuard.ts`) and never builds a plan: one query for the
//   sessions and one for the weeks the page touched, and at most one read of the cached athlete
//   input, for a revision that cites a safety rule.
// - `planUndo` decides one undo and writes nothing. It runs the same checks on the plan's rows,
//   restores the payload in memory, runs the quality checklist on the result and returns the writes
//   and their diff. `planActions.ts` previews it and commits it.
// - `markRevisionSeen` is the one seen marker of the product.
//
// An undo restores sessions dated today or later and weeks from the current Monday on. The past is
// left as it is, except when the undone revision created a rest window: its back-dated skips come
// back, because the window was the runner's own statement.
import { describeUndoFinding, undoneSummary } from '../../shared/copy/revision.ts'
import { mondayOf, todayIso } from '../../shared/dates.ts'
import { diffPlans } from '../../shared/engine/diff.ts'
import { replan, runChecklist } from '../../shared/engine/index.ts'
import { P } from '../../shared/engine/params/index.ts'
import type {
  ChecklistResult,
  EngineInput,
  EngineWarning,
  PlanChange,
  WeeklyDecision,
} from '../../shared/engine/types.ts'
import {
  activeSafetyRules,
  citedSafetyRules,
  revisionUndoReason,
  undoEligibility,
  type SafetyRule,
  type UndoFinding,
  type UndoRowFact,
  type UndoStanding,
} from '../../shared/engine/undoGuard.ts'
import type { PlanDiff, PlanRevisionView, UndoReason, UndoState } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type {
  Disruption as DisruptionRow,
  PlanRevision as PlanRevisionRow,
  PlanSession as PlanSessionRow,
  PlanWeek as PlanWeekRow,
} from '../db.ts'
import { notFound } from '../errors.ts'
import { existingFrom, loadAthleteContext } from './athleteState.ts'
import { gatherEngineInput } from './engineInput.ts'
import {
  parsePlanOptions,
  revisionView,
  toDisruption,
  toPlanSession,
  toPlanWeek,
  type PlanRevisionListRow,
} from '../serialize.ts'
import { toEngineWindow } from './athleteState.ts'
import {
  DISRUPTION_COLUMNS,
  SESSION_COLUMNS,
  WEEK_COLUMNS,
  applyUndoPayload,
  changedColumns,
  disruptionHash,
  sessionHash,
  weekHash,
  EMPTY_DIFF_MARK,
  type SessionContent,
  type UndoPayload,
  type WeekContent,
} from './replan.ts'

// ---------------------------------------------------------------------------------------------
// Reading a stored revision
// ---------------------------------------------------------------------------------------------

function readJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function isRowSets(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false
  const sets = value as Record<string, unknown>
  return Array.isArray(sets.created) && Array.isArray(sets.deleted) && Array.isArray(sets.updated)
}

/** The stored undo payload, or null when there is none or it cannot be read (nothing to restore). */
export function readPayload(text: string | null): UndoPayload | null {
  const value = readJson<Record<string, unknown> | null>(text, null)
  if (value === null || value.v !== 1 || !isRowSets(value.sessions) || !isRowSets(value.weeks)) {
    return null
  }
  const windows = value.disruptions as UndoPayload['disruptions'] | undefined
  return {
    ...(value as unknown as UndoPayload),
    disruptions: {
      created: Array.isArray(windows?.created) ? windows.created : [],
      updated: Array.isArray(windows?.updated) ? windows.updated : [],
    },
  }
}

/** A revision read once: its payload, its diff and the safety rules it cites. */
interface ParsedRevision {
  row: PlanRevisionListRow
  /** Whether a payload is stored, which says nothing about whether it was read or can be read. */
  stored: boolean
  /** Null when none is stored, or when it cannot be read: there is then nothing to restore. */
  payload: UndoPayload | null
  diff: PlanDiff | null
  cited: SafetyRule[]
  /** The revision created a rest window the runner reported: its undo is not refused on safety. */
  createdWindow: boolean
}

function parseRevision(
  row: PlanRevisionListRow,
  undo: { stored: boolean; text: string | null },
): ParsedRevision {
  const payload = readPayload(undo.text)
  const diff = readJson<PlanDiff | null>(row.diff, null)
  return {
    row,
    stored: undo.stored,
    payload,
    diff,
    cited: citedSafetyRules({
      changes: readJson<PlanChange[]>(row.changes, []),
      decision: readJson<WeeklyDecision | null>(row.decision, null),
      diff,
    }),
    createdWindow: payload !== null && reportsWindow(payload),
  }
}

/**
 * The revision opened a window the runner reported, or withdrew one: restoring either only returns
 * caution (G6), so its undo is never refused on safety grounds. A window the revision merely moved
 * the end of is not either.
 */
function reportsWindow(payload: UndoPayload): boolean {
  return (
    payload.disruptions.created.length > 0 ||
    payload.disruptions.updated.some((entry) => entry.before.status === 'active')
  )
}

/** What checks 1 to 3 of the policy read: the revision row, and whether it holds a payload. */
function revisionFacts(row: PlanRevisionListRow, stored: boolean, planActive: boolean) {
  return {
    reason: row.reason,
    hasPayload: stored,
    undone: row.undoneAt !== null,
    createdAtMs: row.createdAt.getTime(),
    planActive,
  }
}

/** Whether the active safety rules have to be read to decide this revision. */
function needsActiveRules(parsed: ParsedRevision): boolean {
  return parsed.cited.length > 0 && !parsed.createdWindow
}

// ---------------------------------------------------------------------------------------------
// The rows an undo looks at
// ---------------------------------------------------------------------------------------------

/** The current rows of a plan, by the keys an undo checks them by. */
export interface PlanRowIndex {
  disruptionById: ReadonlyMap<string, DisruptionRow>
  sessionById: ReadonlyMap<string, SessionContent>
  sessionByExternalId: ReadonlyMap<string, SessionContent>
  sessionByActivity: ReadonlyMap<string, SessionContent>
  weekById: ReadonlyMap<string, WeekContent>
  weekByStart: ReadonlyMap<string, WeekContent>
}

export function indexRows(
  sessions: readonly SessionContent[],
  weeks: readonly WeekContent[],
  disruptions: readonly DisruptionRow[] = [],
): PlanRowIndex {
  return {
    disruptionById: new Map(disruptions.map((row) => [row.id, row])),
    sessionById: new Map(sessions.map((row) => [row.id, row])),
    sessionByExternalId: new Map(sessions.map((row) => [row.externalId, row])),
    sessionByActivity: new Map(
      sessions.flatMap((row) => (row.activityId === null ? [] : [[row.activityId, row] as const])),
    ),
    weekById: new Map(weeks.map((row) => [row.id, row])),
    weekByStart: new Map(weeks.map((row) => [row.weekStart, row])),
  }
}

/** The payload an undo restores and the facts about its rows that the policy reads. */
export interface ScopedUndo {
  payload: UndoPayload
  rows: UndoRowFact[]
}

/**
 * Keeps the parts of a payload that an undo restores (sessions dated today or later, weeks from the
 * current Monday on; everything when the revision created a rest window) and says how each stands:
 * a row linked to an activity is `run`, checked before its content; a row whose content hash is not
 * the one the revision left, or that is gone, is `edited`; a row the revision deleted whose place
 * is taken (its `externalId` or week, or its activity linked elsewhere) is `edited` or `run`.
 */
export function scopeUndo(
  payload: UndoPayload,
  index: PlanRowIndex,
  args: { today: string; diff: PlanDiff | null },
): ScopedUndo {
  // A revision that wrote a window also skipped the past days the window covers, on the runner's
  // word; undoing the window brings those sessions back.
  const restorePast = payload.disruptions.created.length + payload.disruptions.updated.length > 0
  const currentMonday = mondayOf(args.today)
  const sessionIn = (date: string) => restorePast || date >= args.today
  const weekIn = (weekStart: string) => restorePast || weekStart >= currentMonday

  /** The words for a session that is gone, from the diff the revision stored. */
  const wordsFor = (id: string): { title: string; date: string } | null => {
    const line = args.diff?.sessions.find((candidate) => candidate.sessionId === id)
    const brief = line ? (line.after ?? line.before) : null
    return brief ? { title: brief.title, date: brief.date } : null
  }
  const sessionFact = (id: string, row: SessionContent | undefined, hash: string): UndoRowFact => {
    const words = row ? { title: row.title, date: row.date } : wordsFor(id)
    const standing: UndoStanding =
      row === undefined
        ? 'edited'
        : row.activityId !== null
          ? 'run'
          : sessionHash(row) === hash
            ? 'as-left'
            : 'edited'
    return {
      kind: 'session',
      id,
      weekStart: row?.weekStart ?? null,
      title: words?.title ?? null,
      date: words?.date ?? null,
      standing,
    }
  }
  const weekFact = (id: string, row: WeekContent | undefined, hash: string): UndoRowFact => ({
    kind: 'week',
    id,
    weekStart: row?.weekStart ?? null,
    title: null,
    date: null,
    standing: row !== undefined && weekHash(row) === hash ? 'as-left' : 'edited',
  })

  const rows: UndoRowFact[] = []
  const scoped: UndoPayload = {
    v: 1,
    sessions: { created: [], deleted: [], updated: [] },
    weeks: { created: [], deleted: [], updated: [] },
    disruptions: payload.disruptions,
  }

  const windowFact = (id: string, row: DisruptionRow | undefined, hash: string): UndoRowFact => ({
    kind: 'disruption',
    id,
    weekStart: null,
    title: null,
    date: null,
    // A window that is gone cannot have changed since; there is nothing to restore on it.
    standing: row === undefined || disruptionHash(row) === hash ? 'as-left' : 'edited',
  })
  for (const entry of [...payload.disruptions.created, ...payload.disruptions.updated]) {
    rows.push(windowFact(entry.id, index.disruptionById.get(entry.id), entry.hash))
  }

  for (const entry of payload.sessions.created) {
    const row = index.sessionById.get(entry.id)
    if (row !== undefined && !sessionIn(row.date)) continue
    scoped.sessions.created.push(entry)
    rows.push(sessionFact(entry.id, row, entry.hash))
  }
  for (const entry of payload.sessions.updated) {
    const row = index.sessionById.get(entry.id)
    if (row !== undefined && !sessionIn(row.date)) continue
    scoped.sessions.updated.push(entry)
    rows.push(sessionFact(entry.id, row, entry.hash))
  }
  for (const row of payload.sessions.deleted) {
    if (!sessionIn(row.date)) continue
    scoped.sessions.deleted.push(row)
    const taken = index.sessionById.has(row.id) || index.sessionByExternalId.has(row.externalId)
    const linkedElsewhere = row.activityId !== null && index.sessionByActivity.has(row.activityId)
    rows.push({
      kind: 'session',
      id: row.id,
      weekStart: row.weekStart,
      title: row.title,
      date: row.date,
      standing: taken ? 'edited' : linkedElsewhere ? 'run' : 'as-left',
    })
  }

  for (const entry of payload.weeks.created) {
    const row = index.weekById.get(entry.id)
    if (row !== undefined && !weekIn(row.weekStart)) continue
    scoped.weeks.created.push(entry)
    rows.push(weekFact(entry.id, row, entry.hash))
  }
  for (const entry of payload.weeks.updated) {
    const row = index.weekById.get(entry.id)
    if (row !== undefined && !weekIn(row.weekStart)) continue
    scoped.weeks.updated.push(entry)
    rows.push(weekFact(entry.id, row, entry.hash))
  }
  for (const row of payload.weeks.deleted) {
    if (!weekIn(row.weekStart)) continue
    scoped.weeks.deleted.push(row)
    const taken = index.weekById.has(row.id) || index.weekByStart.has(row.weekStart)
    rows.push({
      kind: 'week',
      id: row.id,
      weekStart: row.weekStart,
      title: null,
      date: null,
      standing: taken ? 'edited' : 'as-left',
    })
  }
  return { payload: scoped, rows }
}

// ---------------------------------------------------------------------------------------------
// Whether a revision can be undone (checks 1 to 6)
// ---------------------------------------------------------------------------------------------

interface Evaluation {
  findings: UndoFinding[]
  /** Null when the revision's own state refuses before any row is read. */
  scoped: ScopedUndo | null
}

function evaluate(
  parsed: ParsedRevision,
  args: {
    planActive: boolean
    index: PlanRowIndex
    today: string
    nowMs: number
    windowDays: number
    active: readonly SafetyRule[]
  },
): Evaluation {
  const facts = revisionFacts(parsed.row, parsed.stored, args.planActive)
  const own = revisionUndoReason(facts, args.nowMs, args.windowDays)
  if (own !== null || parsed.payload === null) {
    return { findings: [{ code: own ?? 'not-undoable' }], scoped: null }
  }
  const scoped = scopeUndo(parsed.payload, args.index, { today: args.today, diff: parsed.diff })
  const findings = undoEligibility({
    revision: {
      ...facts,
      disruptionId: parsed.row.disruptionId,
      createdWindow: parsed.createdWindow,
      cited: parsed.cited,
    },
    nowMs: args.nowMs,
    windowDays: args.windowDays,
    rows: scoped.rows,
    active: args.active,
  })
  return { findings, scoped }
}

function stateOf(row: PlanRevisionListRow, findings: readonly UndoFinding[], windowDays: number) {
  const reasons: UndoReason[] = findings.map((finding) => describeUndoFinding(finding, windowDays))
  const state: UndoState = {
    available: reasons.length === 0,
    reasons,
    undoneAt: row.undoneAt?.toISOString() ?? null,
  }
  return state
}

/** The sessions and weeks that a set of revisions touched, in two queries. */
async function loadTouchedRows(deps: Deps, revisions: readonly ParsedRevision[]) {
  const planIds = new Set<string>()
  const sessionIds = new Set<string>()
  const externalIds = new Set<string>()
  const activityIds = new Set<string>()
  const weekIds = new Set<string>()
  const weekStarts = new Set<string>()
  const windowIds = new Set<string>()
  for (const { row, payload } of revisions) {
    if (payload === null) continue
    planIds.add(row.planId)
    for (const entry of [...payload.disruptions.created, ...payload.disruptions.updated]) {
      windowIds.add(entry.id)
    }
    for (const entry of [...payload.sessions.created, ...payload.sessions.updated]) {
      sessionIds.add(entry.id)
    }
    for (const session of payload.sessions.deleted) {
      sessionIds.add(session.id)
      externalIds.add(session.externalId)
      if (session.activityId !== null) activityIds.add(session.activityId)
    }
    for (const entry of [...payload.weeks.created, ...payload.weeks.updated]) {
      weekIds.add(entry.id)
    }
    for (const week of payload.weeks.deleted) {
      weekIds.add(week.id)
      weekStarts.add(week.weekStart)
    }
  }
  if (planIds.size === 0) return indexRows([], [])
  const planId = { in: [...planIds] }
  const [sessions, weeks, windows] = await Promise.all([
    deps.prisma.planSession.findMany({
      where: {
        OR: [
          { planId, id: { in: [...sessionIds] } },
          { planId, externalId: { in: [...externalIds] } },
          // An activity is linked to one session in the whole database.
          { activityId: { in: [...activityIds] } },
        ],
      },
    }),
    deps.prisma.planWeek.findMany({
      where: {
        planId,
        OR: [{ id: { in: [...weekIds] } }, { weekStart: { in: [...weekStarts] } }],
      },
    }),
    // Only the windows of the users these plans belong to, by id: a window has no plan.
    windowIds.size === 0
      ? Promise.resolve([])
      : deps.prisma.disruption.findMany({
          where: {
            id: { in: [...windowIds] },
            user: { plans: { some: { id: planId } } },
          },
        }),
  ])
  return indexRows(sessions, weeks, windows)
}

/**
 * Whether each of `rows` can be undone, by the structural checks of the policy (design 4.2, 1 to
 * 6). The rows come without their payload. A revision the policy refuses for its own state
 * (undone, an undo, no payload, an archived plan, an expired window) reads no payload and no row.
 * The others have their payloads read in one query, share one query for the sessions and one for
 * the weeks they touched, and cost one read of the cached athlete input when any cites a safety
 * rule that could still apply. The checklist is never run here: it needs the restored plan.
 */
export async function undoStates(
  deps: Deps,
  args: {
    userId: string
    rows: readonly PlanRevisionListRow[]
    planActive: boolean
    today?: string
    now?: Date
  },
): Promise<Map<string, UndoState>> {
  const { prisma } = deps
  const today = args.today ?? todayIso()
  const nowMs = (args.now ?? new Date()).getTime()
  const windowDays = P.revision.undoWindowDays.value
  const states = new Map<string, UndoState>()
  if (args.rows.length === 0) return states

  // Which revisions hold a payload is asked of the database without reading any.
  const stored = new Set(
    (
      await prisma.planRevision.findMany({
        where: { id: { in: args.rows.map((row) => row.id) }, undo: { not: null } },
        select: { id: true },
      })
    ).map((row) => row.id),
  )
  const candidates: PlanRevisionListRow[] = []
  for (const row of args.rows) {
    const own = revisionUndoReason(
      revisionFacts(row, stored.has(row.id), args.planActive),
      nowMs,
      windowDays,
    )
    if (own === null) candidates.push(row)
    else states.set(row.id, stateOf(row, [{ code: own }], windowDays))
  }
  if (candidates.length === 0) return states

  const texts = new Map(
    (
      await prisma.planRevision.findMany({
        where: { id: { in: candidates.map((row) => row.id) } },
        select: { id: true, undo: true },
      })
    ).map((row) => [row.id, row.undo]),
  )
  const open = candidates.map((row) =>
    parseRevision(row, { stored: true, text: texts.get(row.id) ?? null }),
  )
  const index = await loadTouchedRows(deps, open)
  const active = open.some(needsActiveRules)
    ? activeSafetyRules(await loadAthleteContext(deps, { userId: args.userId, today }))
    : []
  for (const parsed of open) {
    const { findings } = evaluate(parsed, {
      planActive: args.planActive,
      index,
      today,
      nowMs,
      windowDays,
      active,
    })
    states.set(parsed.row.id, stateOf(parsed.row, findings, windowDays))
  }
  return states
}

/**
 * The Mondays of each plan's weeks whose target the runner set, by plan id, each with the time the
 * week row was last written: the weeks a re-plan keeps at the runner's number (`weekCaps` in
 * `computeReplan`). A target above the plan's own figure (`baselineRunMin`, which a cap lowers to
 * the target) is no cap, so its week's sessions are the plan's own and the week is left out. One query for the page, and none when no revision on it has
 * a diff to attribute. Read when the revisions are served, so a week the runner has since reset to
 * the baseline no longer counts.
 */
async function ownerWeeksByPlan(
  deps: Deps,
  rows: readonly PlanRevisionListRow[],
): Promise<Map<string, Map<string, Date>>> {
  const planIds = [...new Set(rows.filter((row) => row.diff !== null).map((row) => row.planId))]
  const byPlan = new Map<string, Map<string, Date>>()
  if (planIds.length === 0) return byPlan
  const weeks = await deps.prisma.planWeek.findMany({
    where: { planId: { in: planIds }, targetSource: { in: ['override', 'review'] } },
    select: {
      planId: true,
      weekStart: true,
      updatedAt: true,
      targetRunMin: true,
      baselineRunMin: true,
    },
  })
  for (const week of weeks) {
    if (week.targetRunMin > week.baselineRunMin) continue
    const map = byPlan.get(week.planId) ?? new Map<string, Date>()
    map.set(week.weekStart, week.updatedAt)
    byPlan.set(week.planId, map)
  }
  return byPlan
}

/**
 * The runner's weeks that a revision written at `at` can name as a cause: those whose row was last
 * written no later than the revision. The row holds no time of its own for the override, so a week
 * written after the revision (an override set later, or any later edit or re-plan of the week) is
 * left out: the older revision then names its generic cause, and never one that was not true when
 * it was written.
 */
function ownerWeeksAt(
  weeks: ReadonlyMap<string, Date> | undefined,
  at: Date,
): ReadonlySet<string> | undefined {
  if (weeks === undefined) return undefined
  return new Set([...weeks].filter(([, writtenAt]) => writtenAt <= at).map(([week]) => week))
}

/** Revisions as the API serves them, with the structural undo state and the causes of each. */
export async function viewRevisions(
  deps: Deps,
  args: { userId: string; rows: readonly PlanRevisionListRow[]; planActive: boolean },
): Promise<PlanRevisionView[]> {
  const [states, ownerWeeks] = await Promise.all([
    undoStates(deps, args),
    ownerWeeksByPlan(deps, args.rows),
  ])
  return args.rows.map((row) =>
    revisionView(row, states.get(row.id)!, ownerWeeksAt(ownerWeeks.get(row.planId), row.createdAt)),
  )
}

/** One of the user's revisions as the API serves it. */
export async function viewRevision(
  deps: Deps,
  args: { userId: string; revisionId: string },
): Promise<PlanRevisionView> {
  const row = await deps.prisma.planRevision.findFirst({
    where: { id: args.revisionId, plan: { userId: args.userId } },
    omit: { undo: true },
    include: { plan: { select: { status: true } } },
  })
  if (!row) throw notFound('Revision not found.')
  const { plan, ...revision } = row
  const [view] = await viewRevisions(deps, {
    userId: args.userId,
    rows: [revision],
    planActive: plan.status === 'active',
  })
  return view!
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
      : await prisma.planRevision.findFirst({
          where: { id: args.before, planId: plan.id },
          select: { id: true, createdAt: true },
        })
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
    // The payload is server-only and can be large: undo availability reads it for the few
    // revisions that can still be undone (`undoStates`), not for the whole page.
    omit: { undo: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: args.limit,
  })
  return viewRevisions(deps, { userId: args.userId, rows, planActive: true })
}

/**
 * Stamps a revision as seen. Idempotent: the first call sets `seenAt` and a later call writes
 * nothing, so it raises no data version. A revision of another user is not found.
 */
export async function markRevisionSeen(
  deps: Deps,
  args: { userId: string; revisionId: string },
): Promise<void> {
  const { prisma } = deps
  const row = await prisma.planRevision.findFirst({
    where: { id: args.revisionId, plan: { userId: args.userId } },
    select: { id: true, seenAt: true },
  })
  if (!row) throw notFound('Revision not found.')
  if (row.seenAt !== null) return
  // The filter keeps the first stamp when two calls race.
  await prisma.planRevision.updateMany({
    where: { id: row.id, seenAt: null },
    data: { seenAt: new Date() },
  })
}

// ---------------------------------------------------------------------------------------------
// Deciding an undo
// ---------------------------------------------------------------------------------------------

/** What restoring a payload does to a plan's rows. */
export interface RestoreWrites {
  sessions: {
    created: SessionContent[]
    deleted: PlanSessionRow[]
    updated: Array<{ before: PlanSessionRow; data: Partial<SessionContent> }>
  }
  weeks: {
    created: WeekContent[]
    deleted: PlanWeekRow[]
    updated: Array<{ before: PlanWeekRow; data: Partial<WeekContent> }>
  }
  /**
   * The windows the payload changes: those the revision created are withdrawn (`status`
   * 'undone'), the columns it changed take their old values.
   */
  windows: Array<{ id: string; data: Partial<WindowColumns> }>
  /** The plan's rows once the payload is applied. */
  restored: { sessions: SessionContent[]; weeks: WeekContent[] }
}

/** The columns of a window an undo can restore. */
export type WindowColumns = Pick<
  DisruptionRow,
  | 'reason'
  | 'mode'
  | 'startDate'
  | 'endDate'
  | 'maxRunMin'
  | 'area'
  | 'pain'
  | 'gaitChange'
  | 'note'
  | 'status'
>

/** Only the columns a window hash covers, whatever a stored payload holds. */
function windowColumnsOf(before: Record<string, unknown>): Partial<WindowColumns> {
  return Object.fromEntries(
    Object.entries(before).filter(([column]) => DISRUPTION_COLUMNS.includes(column)),
  )
}

/**
 * The windows as they stand once a payload is undone: a window the revision created is withdrawn
 * and the columns it changed take their old values. Pure.
 */
export function windowsAfterUndo(
  rows: readonly DisruptionRow[],
  payload: UndoPayload['disruptions'],
): DisruptionRow[] {
  const created = new Set(payload.created.map((entry) => entry.id))
  const restored = new Map(payload.updated.map((entry) => [entry.id, entry.before]))
  return rows.map((row) => {
    const before = restored.get(row.id)
    return {
      ...row,
      ...(created.has(row.id) ? { status: 'undone' } : {}),
      ...(before === undefined ? {} : windowColumnsOf(before)),
    }
  })
}

function difference<Row extends { id: string }>(
  current: readonly Row[],
  restored: readonly Omit<Row, 'updatedAt'>[],
  columns: readonly string[],
) {
  const now = new Map(current.map((row) => [row.id, row]))
  const then = new Set(restored.map((row) => row.id))
  const updated: Array<{ before: Row; data: Partial<Omit<Row, 'updatedAt'>> }> = []
  for (const row of restored) {
    const before = now.get(row.id)
    if (before === undefined) continue
    const data = changedColumns(row, before, columns)
    if (Object.keys(data).length > 0) {
      updated.push({ before, data: data as Partial<Omit<Row, 'updatedAt'>> })
    }
  }
  return {
    created: restored.filter((row) => !now.has(row.id)),
    deleted: current.filter((row) => !then.has(row.id)),
    updated,
  }
}

/**
 * The writes that restore `payload` (already scoped) on the plan's rows: the rows it created are
 * deleted, the rows it deleted come back whole and the columns it changed take their old values.
 * Derived from `applyUndoPayload`, so the restored plan and the writes cannot differ. Pure.
 */
export function restoreWrites(
  rows: { sessions: readonly PlanSessionRow[]; weeks: readonly PlanWeekRow[] },
  payload: UndoPayload,
): RestoreWrites {
  const restored = applyUndoPayload(
    { sessions: [...rows.sessions], weeks: [...rows.weeks] },
    payload,
  )
  return {
    sessions: difference(rows.sessions, restored.sessions, SESSION_COLUMNS),
    weeks: difference(rows.weeks, restored.weeks, WEEK_COLUMNS),
    windows: [
      ...payload.disruptions.created.map((entry) => ({
        id: entry.id,
        data: { status: 'undone' },
      })),
      ...payload.disruptions.updated.map((entry) => ({
        id: entry.id,
        data: windowColumnsOf(entry.before),
      })),
    ],
    restored,
  }
}

/** The diff of a restore, from rows before they are written; the commit builds it from the rows it wrote. */
export function restoreDiff(writes: RestoreWrites): PlanDiff {
  return diffPlans({
    sessions: {
      created: writes.sessions.created,
      deleted: writes.sessions.deleted,
      updated: writes.sessions.updated.map(({ before, data }) => ({
        before,
        after: { ...before, ...data },
      })),
    },
    weeks: {
      created: writes.weeks.created,
      deleted: writes.weeks.deleted,
      updated: writes.weeks.updated.map(({ before, data }) => ({
        before,
        after: { ...before, ...data },
      })),
    },
  })
}

const EMPTY_DIFF = (): PlanDiff =>
  diffPlans({
    sessions: { created: [], deleted: [], updated: [] },
    weeks: { created: [], deleted: [], updated: [] },
  })

const EPOCH = new Date(0)

/** An undo that has been decided and not written. */
export interface UndoPlan {
  target: PlanRevisionRow
  planId: string
  userId: string
  /** What refuses the undo, structural reasons or the checklist; empty when it is allowed. */
  reasons: UndoReason[]
  /** The quality checklist of the restored plan; empty when a structural reason refused first. */
  checklist: ChecklistResult[]
  /** What the restore changes; empty when a structural reason refuses before anything is restored. */
  diff: PlanDiff
  summary: string
  warnings: EngineWarning[]
  /** Present when the undo is allowed: the parsed payload, to scope again inside the transaction. */
  restore: null | {
    payload: UndoPayload
    writes: RestoreWrites
    /** The plan columns that follow the rows, recomputed as a re-plan does. */
    plan: {
      paramsVersion: string
      feasibility: string
      warnings: string
      checklist: string
    }
  }
}

/**
 * Decides an undo from the rows as they are now and writes nothing. The structural checks run on
 * the plan's own rows; when they pass, the payload is restored in memory, the engine input is read
 * from the cached athlete state with the restored plan as the stored plan, and the quality
 * checklist is run on it. A failing checklist refuses the undo with its items.
 */
export async function planUndo(
  deps: Deps,
  args: { userId: string; revisionId: string; today: string; now?: Date },
): Promise<UndoPlan> {
  const { prisma } = deps
  const { userId, today } = args
  const target = await prisma.planRevision.findFirst({
    where: { id: args.revisionId, plan: { userId } },
    include: { plan: { include: { goal: true } } },
  })
  if (!target) throw notFound('Revision not found.')
  const { plan, ...revision } = target
  const windowDays = P.revision.undoWindowDays.value
  const nowMs = (args.now ?? new Date()).getTime()
  const summary = undoneSummary(revision.summary)
  const base = { target: revision, planId: plan.id, userId, summary }
  const refused = (
    findings: readonly UndoFinding[],
    extra: Partial<Pick<UndoPlan, 'diff' | 'checklist' | 'warnings'>> = {},
  ): UndoPlan => ({
    ...base,
    reasons: findings.map((finding) => describeUndoFinding(finding, windowDays)),
    checklist: [],
    diff: EMPTY_DIFF(),
    warnings: [],
    restore: null,
    ...extra,
  })

  const parsed = parseRevision(revision, { stored: revision.undo !== null, text: revision.undo })
  const planActive = plan.status === 'active'
  const own = revisionUndoReason(
    revisionFacts(parsed.row, parsed.stored, planActive),
    nowMs,
    windowDays,
  )
  if (own !== null || parsed.payload === null) {
    return refused([{ code: own ?? 'not-undoable' }])
  }

  const windowIds = [...parsed.payload.disruptions.created, ...parsed.payload.disruptions.updated]
    .map((entry) => entry.id)
    .sort()
  const [sessionRows, weekRows, windowRows] = await Promise.all([
    prisma.planSession.findMany({
      where: { planId: plan.id },
      orderBy: [{ date: 'asc' }, { order: 'asc' }, { id: 'asc' }],
    }),
    prisma.planWeek.findMany({ where: { planId: plan.id }, orderBy: { index: 'asc' } }),
    windowIds.length === 0
      ? Promise.resolve([])
      : prisma.disruption.findMany({ where: { id: { in: windowIds }, userId } }),
  ])
  const active = needsActiveRules(parsed)
    ? activeSafetyRules(await loadAthleteContext(deps, { userId, today }))
    : []
  const { findings, scoped } = evaluate(parsed, {
    planActive,
    index: indexRows(sessionRows, weekRows, windowRows),
    today,
    nowMs,
    windowDays,
    active,
  })
  if (findings.length > 0 || scoped === null) return refused(findings)

  // Restore in memory and build the plan the engine and the checklist read.
  const writes = restoreWrites({ sessions: sessionRows, weeks: weekRows }, scoped.payload)
  const diff = restoreDiff(writes)
  const stored = existingFrom(
    [...writes.restored.weeks]
      .sort((a, b) => a.index - b.index)
      .map((week) => toPlanWeek({ updatedAt: EPOCH, ...week })),
    [...writes.restored.sessions]
      .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.id.localeCompare(b.id))
      .map((session) => toPlanSession({ updatedAt: EPOCH, ...session })),
  )
  // The checklist reads the windows as they will stand: the one an undo withdraws no longer holds
  // the days it held, and the one it brings back does.
  const { disruptions: current, ...gathered } = await gatherEngineInput(
    deps,
    {
      userId,
      goalId: plan.goalId,
      today,
      options: parsePlanOptions(plan.options),
    },
    { existing: false },
  )
  const touched = new Set(windowIds)
  const windows = [
    ...(current ?? []).filter((window) => !touched.has(window.id)),
    ...windowsAfterUndo(windowRows, scoped.payload.disruptions)
      .filter((row) => row.status === 'active')
      .map((row) => toEngineWindow(toDisruption(row))),
  ].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id))
  const input: EngineInput = {
    ...gathered,
    existing: stored,
    ...(windows.length === 0 ? {} : { disruptions: windows }),
  }
  // The plan columns follow the rows by the code a re-plan uses; the checklist reads the restored
  // plan itself.
  const fresh = replan(input).draft
  const checklist = runChecklist(
    { ...fresh, weeks: stored.weeks, sessions: stored.sessions },
    input,
  )
  const failed = checklist.filter((item) => !item.ok)
  if (failed.length > 0) {
    return refused([{ code: 'checklist', items: failed.map((item) => item.id) }], {
      diff,
      checklist,
      warnings: fresh.warnings,
    })
  }
  return {
    ...base,
    reasons: [],
    checklist,
    diff,
    warnings: fresh.warnings,
    restore: {
      payload: scoped.payload,
      writes,
      plan: {
        paramsVersion: fresh.paramsVersion,
        feasibility: JSON.stringify(fresh.feasibility),
        warnings: JSON.stringify(fresh.warnings),
        checklist: JSON.stringify(checklist),
      },
    },
  }
}
