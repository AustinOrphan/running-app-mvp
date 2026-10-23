// Version-2 plans: generate with the engine, re-plan, persist weeks, sessions and revisions, and the
// owner's edits to single sessions. The engine decides; this module gathers, persists and guards.
import { randomUUID } from 'node:crypto'
import { addDays, daysBetween, isIsoDate, mondayOf, todayIso } from '../../shared/dates.ts'
import {
  generatedSummary,
  goalSwitchSummary,
  movedSummary,
  restoredSummary,
  skippedSummary,
  swappedSummary,
} from '../../shared/copy/revision.ts'
import { carryExternalIds, pairSessions } from '../../shared/domain/sessionIdentity.ts'
import { type ExecutionRecord } from '../../shared/engine/adapt.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { weatherIndex, trainingHeatAdvice } from '../../shared/engine/heat.ts'
import {
  buildPlan,
  keptByReplan,
  todayAdvice,
  weeklyDecision,
  weeklyRamp,
  zoneProposals,
} from '../../shared/engine/index.ts'
import { P } from '../../shared/engine/params/index.ts'
import type {
  ChecklistResult,
  EngineInput,
  PlanChange,
  SessionKind,
  SessionSpec,
  WeekDraft,
  WeeklyDecision,
  ZoneProposal,
  ZoneSet,
} from '../../shared/engine/types.ts'
import type {
  PlanRevisionReason,
  PlanSession,
  PlanWithSessions,
  TodayView,
  ZoneProposalView,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type {
  Plan as PlanRow,
  PlanSession as PlanSessionRow,
  PlanWeek as PlanWeekRow,
  PrismaClient,
} from '../db.ts'
import { conflict, HttpError, notFound, validationError } from '../errors.ts'
import {
  isTrimmed,
  loadProfile,
  toPlan,
  toPlanEngineFields,
  toPlanSession,
  toPlanWeek,
} from '../serialize.ts'
import { loadAthleteContext } from './athleteState.ts'
import { assessSessionById } from './execution.ts'
import { currentZones, gatherContextInput, gatherEngineInput, sessionSpec } from './engineInput.ts'
import { ensureClimate } from './weatherCache.ts'
import { MAX_PLAN_WEEKS } from './plan.ts'
import { recordPrediction } from './predictionLog.ts'
import { recordPlanWrite, revisionParts } from './replan.ts'

/** A plan's rows are written in one transaction; long plans have a thousand sessions. */
export const WRITE_TIMEOUT_MS = 60_000

// Re-plans and revisions are written by `replan.ts` (ADR 0007); the old name stays importable here.
export { replanActivePlan } from './replan.ts'

function json(value: unknown): string {
  return JSON.stringify(value)
}

/** The plan with its weeks and sessions in the API shape. Zones are not stored: they follow the data. */
function present(
  plan: PlanRow & { weeks: PlanWeekRow[]; sessions: PlanSessionRow[] },
  zones: ZoneSet | null,
): PlanWithSessions {
  const engine = plan.generatorVersion >= 2 ? toPlanEngineFields(plan) : null
  return {
    ...toPlan(plan),
    weeks: plan.weeks.map(toPlanWeek),
    sessions: plan.sessions.map(toPlanSession),
    feasibility: engine?.feasibility ?? null,
    warnings: engine?.warnings ?? [],
    checklist: engine?.checklist ?? [],
    zones,
  }
}

/** The active plan with weeks, sessions, feasibility, warnings, checklist and zones. */
export async function loadPlanWithSessions(
  deps: Deps,
  userId: string,
  today: string = todayIso(),
): Promise<PlanWithSessions | null> {
  const plan = await deps.prisma.plan.findFirst({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: {
      weeks: { orderBy: { index: 'asc' } },
      sessions: { orderBy: [{ date: 'asc' }, { order: 'asc' }] },
    },
  })
  if (!plan) return null
  // A version-1 plan has no sessions and no engine fields; its zones are not derived.
  const zones = plan.generatorVersion >= 2 ? await currentZones(deps, { userId, today }) : null
  return present(plan, zones)
}

/** The columns of a stored week that the engine derives from a draft week. */
export function weekRow(week: WeekDraft) {
  return {
    weekStart: week.weekStart,
    index: week.index,
    phase: week.phase,
    focus: week.focus,
    baselineRunMin: week.targetRunMin,
    targetRunMin: week.targetRunMin,
    targetSource: 'baseline',
    longRunMin: week.longRunMin,
    day2Min: null as number | null,
    runDays: week.runDays,
    strengthSessions: week.strengthSessions,
    overrideNote: null as string | null,
    tid: json(week.tid),
    flags: json(week.flags),
    gainTargetM: week.gainTargetM,
  }
}

/**
 * A new session row. `externalId` is the identity of the session outside the database (spec 4.1):
 * a fresh uuid, or the one `externalId` carries over from the session this row replaces. `trimmed`
 * follows `rules` through `isTrimmed`, and a session the engine trimmed after a hold decision
 * [rules J5, design 4.3] is stored as downgraded, as an execution trim is.
 */
export function sessionRow(planId: string, spec: SessionSpec, externalId: string = randomUUID()) {
  const trimmed = isTrimmed(spec.rules)
  return {
    planId,
    externalId,
    weekStart: mondayOf(spec.date),
    date: spec.date,
    order: spec.order,
    kind: spec.kind,
    title: spec.title,
    durationMin: spec.durationMin,
    distanceM: spec.distanceM,
    gainM: spec.gainM,
    structure: json(spec.structure),
    target: json(spec.target),
    purpose: spec.purpose,
    rules: json(spec.rules),
    trimmed,
    flags: json(spec.flags),
    status: trimmed ? 'downgraded' : 'planned',
  }
}

export function failedChecklist(checklist: ChecklistResult[]): HttpError | null {
  const failed = checklist.filter((item) => !item.ok)
  if (failed.length === 0) return null
  return new HttpError(
    422,
    'validation',
    `The plan did not pass the quality checklist (${failed.map((item) => item.id).join(', ')}), so it was not published.`,
    { checklist },
  )
}

/**
 * Runs `buildPlan`, the checklist, persists plan, weeks, sessions and one revision: 'generate', or
 * 'goal-switch' when Make active builds the plan for another goal. Nothing is written unless the
 * plan passes the checklist, so a refusal leaves the goals and the current plan as they were.
 */
export async function generateEnginePlan(
  deps: Deps,
  args: {
    userId: string
    goalId: string
    today: string
    options?: EngineInput['options']
    reason?: Extract<PlanRevisionReason, 'generate' | 'goal-switch'>
  },
): Promise<PlanWithSessions> {
  const { prisma } = deps
  const { userId, today } = args
  const goal = await prisma.goal.findFirst({ where: { id: args.goalId, userId } })
  if (!goal) throw notFound('Goal not found.')
  if (goal.distanceM === null) {
    throw validationError('Add a distance to this goal before generating a plan.')
  }
  if (goal.status !== 'target' && goal.status !== 'considering') {
    throw validationError(
      'Plans can only be generated for goals that are a target or being considered.',
    )
  }
  if (goal.targetDate < today) {
    throw validationError('This goal date has passed. Move the date before generating a plan.')
  }
  const weekCount = daysBetween(mondayOf(today), mondayOf(goal.targetDate)) / 7 + 1
  if (weekCount > MAX_PLAN_WEEKS) {
    throw validationError(`A plan covers at most ${MAX_PLAN_WEEKS} weeks. Choose a nearer goal.`)
  }

  // The one wait on Open-Meteo in plan generation (8 s): a cold cache would otherwise build the
  // first plan without race heat. Later plans, re-plans and every read use the cached climate.
  await ensureClimate(deps, { userId, goalId: goal.id })
  const input = await gatherEngineInput(deps, { ...args, options: args.options ?? {} })
  const draft = buildPlan(input)
  const blocked = failedChecklist(draft.checklist)
  if (blocked) throw blocked

  const created = await prisma.$transaction(
    async (tx) => {
      // The sessions of the plan being archived that are dated today or later hand their
      // externalIds to the paired sessions of the new plan (spec 4.1).
      const previous = await tx.planSession.findMany({
        where: { plan: { userId, status: 'active' }, date: { gte: today } },
        select: { externalId: true, date: true, kind: true, order: true },
      })
      const carried = carryExternalIds(previous, draft.sessions)
      await tx.plan.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'archived' },
      })
      // The plan's goal drives the Dashboard countdown, so exactly that goal is active.
      await tx.goal.updateMany({ where: { userId }, data: { isActive: false } })
      await tx.goal.update({ where: { id: goal.id }, data: { isActive: true } })
      const plan = await tx.plan.create({
        data: {
          userId,
          goalId: goal.id,
          name: goal.name,
          startDate: draft.weeks[0]?.weekStart ?? mondayOf(today),
          raceWeekStart: mondayOf(goal.targetDate),
          status: 'active',
          generatorVersion: 2,
          paramsVersion: draft.paramsVersion,
          feasibility: json(draft.feasibility),
          warnings: json(draft.warnings),
          checklist: json(draft.checklist),
          options: json(args.options ?? {}),
          weeks: { create: draft.weeks.map(weekRow) },
        },
      })
      await tx.planSession.createMany({
        data: draft.sessions.map((spec, i) => sessionRow(plan.id, spec, carried[i] ?? undefined)),
      })
      // A new plan has no earlier rows to diff against, so its revision carries no diff.
      const switched = args.reason === 'goal-switch'
      await recordPlanWrite(tx, {
        planId: plan.id,
        userId,
        reason: switched ? 'goal-switch' : 'generate',
        summary: (switched ? goalSwitchSummary : generatedSummary)(
          goal.name,
          draft.weeks.length,
          draft.sessions.length,
        ),
        changes: [],
        diff: null,
        undo: null,
      })
      await recordPrediction(tx, { userId, goal, draft, input, today, mode: 'refresh' })
      return tx.plan.findUniqueOrThrow({
        where: { id: plan.id },
        include: {
          weeks: { orderBy: { index: 'asc' } },
          sessions: { orderBy: [{ date: 'asc' }, { order: 'asc' }] },
        },
      })
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
  return present(created, draft.zones)
}

/** The rows a re-plan wrote to a plan's sessions: what the revision diff and the undo payload read. */
export interface SessionWriteSet {
  created: PlanSessionRow[]
  /** Full rows, so an undo can recreate them with their id and externalId. */
  deleted: PlanSessionRow[]
  /** Only the rows whose engine-derived columns changed; `before` and `after` are full rows. */
  updated: Array<{ id: string; before: PlanSessionRow; after: PlanSessionRow }>
}

/**
 * The columns a re-plan rewrites in a paired row: the ones `sessionRow` derives from the spec,
 * never `id`, `planId` or `externalId`. The activity link (`activityId`, `linkSource`, `execution`)
 * stays; so do `status` and `original` of a linked row, because the link gave it that status.
 */
function replannedColumns(row: PlanSessionRow, spec: SessionSpec) {
  const {
    planId: _planId,
    externalId: _externalId,
    status,
    ...columns
  } = sessionRow(row.planId, spec, row.externalId)
  // A fresh prescription has no earlier version: the owner's edit of this slot is gone.
  return row.activityId === null ? { ...columns, status, original: null } : columns
}

/**
 * The draft's sessions that the re-plan does not already hold as kept rows. The engine copies each
 * kept session unchanged into its draft, so the copy of a kept row is the draft entry with the
 * row's own date, order and kind. This only removes those copies; which session is which across
 * a re-plan is decided by `pairSessions`.
 */
function withoutKeptCopies(specs: SessionSpec[], kept: PlanSessionRow[]): SessionSpec[] {
  const copies = [...kept]
  return specs.filter((spec) => {
    const at = copies.findIndex(
      (r) => r.date === spec.date && r.order === spec.order && r.kind === spec.kind,
    )
    if (at < 0) return true
    copies.splice(at, 1)
    return false
  })
}

/** What a re-plan will do to a plan's sessions, decided from the rows alone: nothing is written. */
export interface SessionWritePlan {
  /** Replaced rows with no counterpart in the draft. */
  deleted: PlanSessionRow[]
  /** Paired rows with a changed column; `data` is what the re-plan sets. */
  updated: Array<{ before: PlanSessionRow; data: ReturnType<typeof replannedColumns> }>
  /** Draft sessions with no counterpart; they get a fresh `externalId` when written. */
  created: SessionSpec[]
}

/**
 * Pairs a plan's stored sessions with a re-plan's draft (spec 4.1) and says what to write. Kept
 * rows (`keptByReplan`) are left alone and stay out of pairing. Each replaced row is paired with a
 * draft session by `pairSessions`: a paired row is updated in place, so its id, `externalId` and
 * activity link survive; a replaced row with no counterpart is deleted; a draft session with no
 * counterpart is created. A paired row whose columns already match is not written. Pure: the
 * preview of a re-plan and its write both come from here.
 */
export function planSessionWrites(
  rows: readonly PlanSessionRow[],
  args: { today: string; sessions: SessionSpec[] },
): SessionWritePlan {
  // What the engine kept: the past, the finished sessions of the current week and the owner's
  // edits of the next 14 days.
  const isKept = (row: PlanSessionRow) =>
    keptByReplan(
      { date: row.date, status: row.status, rules: toPlanSession(row).rules },
      args.today,
    )
  const kept = rows.filter(isKept)
  const keptIds = new Set(kept.map((row) => row.id))
  const replaced = rows.filter((row) => !keptIds.has(row.id))
  const { paired, removed, added } = pairSessions(replaced, withoutKeptCopies(args.sessions, kept))

  const updated: SessionWritePlan['updated'] = []
  for (const { before, after: spec } of paired) {
    const data = replannedColumns(before, spec)
    const changed = (Object.keys(data) as Array<keyof typeof data>).some(
      (column) => before[column] !== data[column],
    )
    if (changed) updated.push({ before, data })
  }
  return { deleted: removed, updated, created: added }
}

/**
 * Writes a re-plan's sessions row by row (spec 4.1), from the rows as they are inside the
 * transaction, as `planSessionWrites` decides, and returns what was written. A created session
 * gets a fresh `externalId`. The caller passes the transaction client.
 */
export async function writeReplannedSessions(
  tx: Pick<PrismaClient, 'planSession'>,
  args: { planId: string; today: string; sessions: SessionSpec[] },
): Promise<SessionWriteSet> {
  const rows = await tx.planSession.findMany({ where: { planId: args.planId } })
  const planned = planSessionWrites(rows, args)

  const written: SessionWriteSet = { created: [], deleted: planned.deleted, updated: [] }
  if (planned.deleted.length > 0) {
    await tx.planSession.deleteMany({
      where: { id: { in: planned.deleted.map((row) => row.id) } },
    })
  }
  for (const { before, data } of planned.updated) {
    const after = await tx.planSession.update({ where: { id: before.id }, data })
    written.updated.push({ id: before.id, before, after })
  }
  if (planned.created.length > 0) {
    written.created = await tx.planSession.createManyAndReturn({
      data: planned.created.map((spec) => sessionRow(args.planId, spec)),
    })
  }
  return written
}

/**
 * The stored assessments of the sessions of each of `weekStarts`, as the weekly decision reads
 * them: one session query for any number of weeks. Every requested week has an entry, empty when
 * none of its sessions is assessed; each list is in session order.
 */
export async function executionRecordsByWeek(
  prisma: Pick<PrismaClient, 'planSession'>,
  planId: string,
  weekStarts: string[],
): Promise<Map<string, ExecutionRecord[]>> {
  const byWeek = new Map<string, ExecutionRecord[]>(weekStarts.map((week) => [week, []]))
  if (weekStarts.length === 0) return byWeek
  const rows = await prisma.planSession.findMany({
    where: { planId, weekStart: { in: weekStarts }, execution: { not: null } },
    orderBy: [{ date: 'asc' }, { order: 'asc' }],
  })
  for (const row of rows) {
    const session = toPlanSession(row)
    byWeek
      .get(row.weekStart)
      ?.push({ date: session.date, kind: session.kind, assessment: session.execution! })
  }
  return byWeek
}

/**
 * The engine's weekly decision for each of `weekStarts` that the active version-2 plan covers,
 * from one gather of the input, the stored execution assessments and the latest REDs screening.
 * Empty without a version-2 plan.
 */
export async function weeklyDecisions(
  deps: Deps,
  args: { userId: string; today: string; weekStarts: string[] },
): Promise<Map<string, WeeklyDecision>> {
  const decisions = new Map<string, WeeklyDecision>()
  const plan = await deps.prisma.plan.findFirst({
    where: { userId: args.userId, status: 'active', generatorVersion: { gte: 2 } },
    orderBy: { createdAt: 'desc' },
  })
  if (!plan || args.weekStarts.length === 0) return decisions
  const input = await gatherContextInput(
    deps,
    { userId: args.userId, today: args.today, goalId: plan.goalId },
    { existing: true },
  )
  // The tightened ramp of an injury or bone-stress profile caps the suggested week too. The first
  // hot days (heatFirstDays) and the sleep-efficiency drop are not derived from the data yet, so
  // those two holds of rule J5 do not fire.
  const ramp = weeklyRamp(estimateState(input))
  const planned = args.weekStarts.filter((weekStart) =>
    input.existing?.weeks.some((w) => w.weekStart === weekStart),
  )
  const executions = await executionRecordsByWeek(deps.prisma, plan.id, planned)
  for (const weekStart of planned) {
    decisions.set(
      weekStart,
      weeklyDecision(input, weekStart, {
        executions: executions.get(weekStart) ?? [],
        redsFlags: input.screeningFlags,
        ramp,
      }),
    )
  }
  return decisions
}

// ---------------------------------------------------------------------------------------------
// Owner edits of one session
// ---------------------------------------------------------------------------------------------

export interface PlanSessionPatch {
  date?: string
  kind?: SessionKind
  skip?: boolean
}

/** Kinds that need the day after them easy [rules F1]; the same set the week placement uses. */
const HARD_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'threshold',
  'intervals',
  'race-pace',
  'hills',
  'long-fast-finish',
  'b2b',
  'race',
])
/** Kinds that occupy a run day. */
const RUN_KINDS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'hike',
  'b2b',
  'race',
])
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
/** Statuses of a session that is still to be run and so can move or swap. */
const MOVABLE_STATUSES: ReadonlySet<string> = new Set(['planned', 'downgraded', 'moved'])

type Slot = Pick<SessionSpec, 'date' | 'kind' | 'durationMin'> & { title: string }

/** The reason a set of sessions breaks availability or spacing, or null when it holds. */
function layoutProblem(
  sessions: Slot[],
  availability: Awaited<ReturnType<typeof loadProfile>>['availability'],
  touched: Slot[],
): string | null {
  for (const s of touched) {
    if (!RUN_KINDS.has(s.kind)) continue
    const day = availability[WEEKDAYS[daysBetween(mondayOf(s.date), s.date)]!]
    if (!day.available) return `${s.date} is not a day you run: ${s.title} cannot go there.`
    if (day.maxMin !== null && s.kind !== 'race' && s.durationMin > day.maxMin) {
      return `${s.title} is ${s.durationMin} min and ${s.date} allows ${day.maxMin} min.`
    }
  }
  const runs = sessions.filter((s) => RUN_KINDS.has(s.kind))
  for (const s of touched) {
    if (!RUN_KINDS.has(s.kind)) continue
    if (runs.some((o) => o !== s && o.date === s.date)) {
      return `${s.date} already has a run; one run a day keeps the week's spacing (rule F1).`
    }
    if (HARD_KINDS.has(s.kind)) {
      const neighbour = runs.find(
        (o) => o !== s && HARD_KINDS.has(o.kind) && Math.abs(daysBetween(o.date, s.date)) === 1,
      )
      if (neighbour) {
        return `${s.title} next to ${neighbour.title} would leave no easy day between two hard sessions (rule F1).`
      }
    }
  }
  return null
}

async function ownedSession(deps: Deps, userId: string, id: string) {
  const row = await deps.prisma.planSession.findFirst({
    where: { id, plan: { userId, status: 'active' } },
    include: { plan: true },
  })
  if (!row) throw notFound('Session not found.')
  return row
}

function slotOf(row: PlanSessionRow | PlanSession, over: Partial<Slot> = {}): Slot {
  return {
    date: row.date,
    kind: row.kind as SessionKind,
    durationMin: row.durationMin,
    title: row.title,
    ...over,
  }
}

const SWAP_FIELDS = [
  'kind',
  'title',
  'durationMin',
  'distanceM',
  'gainM',
  'structure',
  'target',
  'purpose',
  'rules',
  'trimmed',
  'flags',
] as const

/**
 * Writes the revision of an owner's edit: the rows it updated, in place, give the diff and the
 * undo payload (spec 4.2). Call it inside the transaction that updated them.
 */
function recordOwnerEdit(
  tx: Pick<PrismaClient, 'plan' | 'planRevision'>,
  edit: {
    planId: string
    userId: string
    summary: string
    changes: PlanChange[]
    updated: Array<{ before: PlanSessionRow; after: PlanSessionRow }>
  },
) {
  const sessions: SessionWriteSet = {
    created: [],
    deleted: [],
    updated: edit.updated.map(({ before, after }) => ({ id: after.id, before, after })),
  }
  const { diff, undo } = revisionParts({ sessions })
  return recordPlanWrite(tx, {
    planId: edit.planId,
    userId: edit.userId,
    reason: 'owner',
    summary: edit.summary,
    changes: edit.changes,
    diff,
    undo,
  })
}

/** Owner edits: move within the week, swap kinds within the week, skip or restore. */
export async function updatePlanSession(
  deps: Deps,
  args: { userId: string; sessionId: string; patch: PlanSessionPatch; today: string },
): Promise<PlanSession> {
  const { prisma } = deps
  const { userId, today, patch } = args
  const { plan: _plan, ...row } = await ownedSession(deps, userId, args.sessionId)
  const session = toPlanSession(row)
  const original = JSON.stringify(sessionSpec(session))

  if (patch.skip !== undefined) {
    if (patch.skip) {
      if (session.kind === 'race') throw conflict('The race day cannot be skipped.')
      if (session.activityId !== null) {
        throw conflict('This session is already linked to an activity. Unlink it first.')
      }
      if (session.status === 'skipped') return session
      const saved = await prisma.$transaction(async (tx) => {
        const updated = await tx.planSession.update({
          where: { id: row.id },
          data: { status: 'skipped', original: row.original ?? original },
        })
        await recordOwnerEdit(tx, {
          planId: row.planId,
          userId,
          summary: skippedSummary(session.title, session.date),
          changes: [
            {
              weekStart: session.weekStart,
              field: 'session.status',
              from: session.status,
              to: 'skipped',
              rules: ['g-6'],
            },
          ],
          updated: [{ before: row, after: updated }],
        })
        return updated
      })
      return toPlanSession(saved)
    }
    if (session.status !== 'skipped') return session
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.planSession.update({
        where: { id: row.id },
        data: { status: 'planned' },
      })
      await recordOwnerEdit(tx, {
        planId: row.planId,
        userId,
        summary: restoredSummary(session.title, session.date),
        changes: [
          {
            weekStart: session.weekStart,
            field: 'session.status',
            from: 'skipped',
            to: 'planned',
            rules: ['g-6'],
          },
        ],
        updated: [{ before: row, after: updated }],
      })
      return updated
    })
    return toPlanSession(saved)
  }

  if (session.kind === 'race') throw conflict('The race day stays where it is.')
  if (session.date < today) throw conflict('A session in the past cannot be moved.')
  // A done session keeps the day it was run on; a skipped one is restored before it moves.
  if (session.activityId !== null || !MOVABLE_STATUSES.has(session.status)) {
    throw conflict(
      session.status === 'skipped'
        ? 'This session is skipped. Restore it before moving it.'
        : 'This session is already done or linked to an activity, so it stays on its day.',
    )
  }
  const profile = await loadProfile(prisma, userId)
  const neighbours = await prisma.planSession.findMany({
    where: {
      planId: row.planId,
      date: { gte: addDays(session.weekStart, -1), lte: addDays(session.weekStart, 7) },
      id: { not: row.id },
    },
  })

  if (patch.date !== undefined) {
    if (!isIsoDate(patch.date)) throw validationError('Use a real date as YYYY-MM-DD.')
    if (patch.date === session.date) return session
    if (mondayOf(patch.date) !== session.weekStart) {
      throw conflict('A session moves within its own week. Re-plan to change weeks.')
    }
    if (patch.date < today) throw conflict('A session cannot move to a day that has passed.')
    const moved = slotOf(session, { date: patch.date })
    const others = neighbours.filter((n) => n.status !== 'skipped').map((n) => slotOf(n))
    const problem = layoutProblem([...others, moved], profile.availability, [moved])
    if (problem) throw conflict(problem)
    const saved = await prisma.$transaction(async (tx) => {
      const updated = await tx.planSession.update({
        where: { id: row.id },
        data: { date: patch.date!, status: 'moved', original: row.original ?? original },
      })
      await recordOwnerEdit(tx, {
        planId: row.planId,
        userId,
        summary: movedSummary(session.title, session.date, patch.date!),
        changes: [
          {
            weekStart: session.weekStart,
            field: 'session.date',
            from: session.date,
            to: patch.date,
            rules: ['F1'],
          },
        ],
        updated: [{ before: row, after: updated }],
      })
      return updated
    })
    return toPlanSession(saved)
  }

  // Swap kinds: the other session of that kind in the week takes this one's prescription.
  const kind = patch.kind!
  if (kind === session.kind) return session
  const partner = neighbours.find(
    (n) =>
      n.weekStart === session.weekStart &&
      n.kind === kind &&
      n.date >= today &&
      n.activityId === null &&
      MOVABLE_STATUSES.has(n.status),
  )
  if (!partner) {
    throw conflict(
      `There is no ${kind} session left this week to swap with. A swap never adds a session or raises load.`,
    )
  }
  const thisAfter = slotOf(partner, { date: session.date })
  const partnerAfter = slotOf(session, { date: partner.date })
  const others = neighbours
    .filter((n) => n.id !== partner.id && n.status !== 'skipped')
    .map((n) => slotOf(n))
  const problem = layoutProblem([...others, thisAfter, partnerAfter], profile.availability, [
    thisAfter,
    partnerAfter,
  ])
  if (problem) throw conflict(problem)
  const saved = await prisma.$transaction(async (tx) => {
    const mine: Record<string, unknown> = {}
    const theirs: Record<string, unknown> = {}
    for (const field of SWAP_FIELDS) {
      mine[field] = partner[field]
      theirs[field] = row[field]
    }
    const partnerUpdated = await tx.planSession.update({
      where: { id: partner.id },
      data: {
        ...theirs,
        status: 'moved',
        original: partner.original ?? JSON.stringify(sessionSpec(toPlanSession(partner))),
      },
    })
    const updated = await tx.planSession.update({
      where: { id: row.id },
      data: { ...mine, status: 'moved', original: row.original ?? original },
    })
    await recordOwnerEdit(tx, {
      planId: row.planId,
      userId,
      summary: swappedSummary(session.title, session.date, partner.title, partner.date),
      changes: [
        {
          weekStart: session.weekStart,
          field: 'session.kind',
          from: session.kind,
          to: kind,
          rules: ['F1'],
        },
      ],
      updated: [
        { before: row, after: updated },
        { before: partner, after: partnerUpdated },
      ],
    })
    return updated
  })
  return toPlanSession(saved)
}

/** Compatibility of an activity with a session kind, as the matcher defines it [design 4.1]. */
function compatible(kind: SessionKind, type: string, subtype: string | null): boolean {
  const sub = (subtype ?? '').toLowerCase()
  if (RUN_KINDS.has(kind) && kind !== 'hike') return type === 'run' || type === 'race'
  if (kind === 'hike') return type === 'cross' && (sub === 'hike' || sub === 'walk')
  if (kind === 'strength') return type === 'strength'
  if (kind === 'mobility' || kind === 'cross') return type === 'cross'
  return false
}

/** Links, relinks (`activityId`) or unlinks (`null`) the activity that fulfils a session. */
export async function linkPlanSession(
  deps: Deps,
  args: { userId: string; sessionId: string; activityId: string | null },
): Promise<PlanSession> {
  const { prisma } = deps
  const { userId } = args
  const row = await ownedSession(deps, userId, args.sessionId)

  if (args.activityId === null) {
    const updated = await prisma.planSession.update({
      where: { id: row.id },
      // 'owner' with no activity records the owner's choice: the matcher leaves such a session
      // alone, so the unlinked pair is not linked again.
      data: {
        activityId: null,
        linkSource: 'owner',
        execution: null,
        status: row.status === 'completed' || row.status === 'partial' ? 'planned' : row.status,
      },
    })
    return toPlanSession(updated)
  }

  const activity = await prisma.activity.findFirst({ where: { id: args.activityId, userId } })
  if (!activity) throw notFound('Activity not found.')
  if (!compatible(row.kind as SessionKind, activity.type, activity.subtype)) {
    throw conflict(`A ${activity.type} activity cannot fulfil a ${row.kind} session.`)
  }
  const taken = await prisma.planSession.findFirst({
    where: { activityId: activity.id, id: { not: row.id } },
  })
  if (taken) {
    throw conflict(
      `That activity already fulfils ${taken.title} on ${taken.date}. Unlink it there first.`,
    )
  }
  await prisma.planSession.update({
    where: { id: row.id },
    data: { activityId: activity.id, linkSource: 'owner' },
  })
  return assessSessionById(deps, { userId, sessionId: row.id })
}

// ---------------------------------------------------------------------------------------------
// Zone proposals [rules C8, design 4.3]: proposed by the engine, applied only when the owner accepts
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000

function proposalId(proposal: ZoneProposal): string {
  return `${proposal.boundary}-${proposal.from}-${proposal.to}`
}

function declinedSummary(id: string): string {
  return `Declined zone proposal ${id}.`
}

/**
 * The zone proposals the engine makes from the recent executions, minus those the owner declined
 * within the observation window. Declines are kept as owner revisions of the active plan.
 */
export async function listZoneProposals(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<ZoneProposalView[]> {
  const { prisma } = deps
  const plan = await prisma.plan.findFirst({
    where: { userId: args.userId, status: 'active', generatorVersion: { gte: 2 } },
    orderBy: { createdAt: 'desc' },
  })
  const input = await gatherContextInput(
    deps,
    { userId: args.userId, today: args.today, goalId: plan?.goalId ?? null },
    { existing: true },
  )
  const windowStart = addDays(args.today, -P.zoneProposal.windowDays.value)
  const rows = plan
    ? await prisma.planSession.findMany({
        where: { planId: plan.id, execution: { not: null }, date: { gte: windowStart } },
        orderBy: [{ date: 'asc' }, { order: 'asc' }],
      })
    : []
  const executions: ExecutionRecord[] = rows.map((row) => {
    const session = toPlanSession(row)
    return { date: session.date, kind: session.kind, assessment: session.execution! }
  })
  const proposals = zoneProposals(input, executions)
  if (proposals.length === 0) return []

  const declines = await prisma.planRevision.findMany({
    where: {
      plan: { userId: args.userId },
      reason: 'owner',
      summary: { startsWith: 'Declined zone proposal ' },
      createdAt: { gte: new Date(Date.now() - P.zoneProposal.windowDays.value * DAY_MS) },
    },
    select: { summary: true },
  })
  const declined = new Set(declines.map((d) => d.summary))
  return proposals
    .map((proposal) => ({ ...proposal, id: proposalId(proposal) }))
    .filter((proposal) => !declined.has(declinedSummary(proposal.id)))
}

/** Accepts (applies to the profile) or declines a proposal; the revision log keeps the record. */
export async function decideZoneProposal(
  deps: Deps,
  args: { userId: string; today: string; id: string; decision: 'accept' | 'decline' },
): Promise<void> {
  const { prisma } = deps
  const proposal = (await listZoneProposals(deps, args)).find((p) => p.id === args.id)
  if (!proposal) throw notFound('That zone proposal is no longer open.')
  const plan = await prisma.plan.findFirst({
    where: { userId: args.userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
  })

  if (args.decision === 'decline') {
    if (plan) {
      await recordPlanWrite(prisma, {
        planId: plan.id,
        userId: args.userId,
        reason: 'owner',
        summary: declinedSummary(proposal.id),
        changes: [],
        diff: null,
        undo: null,
      })
    }
    return
  }
  // Only the boundaries the profile stores can be applied; the others have no stored value.
  if (proposal.boundary === 'thresholdPace') {
    await prisma.athleteProfile.update({
      where: { userId: args.userId },
      data: { thresholdPaceSecPerKm: proposal.to },
    })
  } else if (proposal.boundary === 'hrMax') {
    await prisma.athleteProfile.update({
      where: { userId: args.userId },
      data: { hrMax: proposal.to, hrMaxSource: 'measured' },
    })
  } else {
    throw conflict(`The ${proposal.boundary} boundary has no stored value to update.`)
  }
  if (plan) {
    // The profile is not a plan row, so there is nothing for a diff to show or an undo to restore.
    await recordPlanWrite(prisma, {
      planId: plan.id,
      userId: args.userId,
      reason: 'owner',
      summary: `Accepted zone proposal ${proposal.id}: ${proposal.boundary} from ${proposal.from} to ${proposal.to}.`,
      changes: [
        {
          weekStart: mondayOf(args.today),
          field: `zones.${proposal.boundary}`,
          from: proposal.from,
          to: proposal.to,
          rules: proposal.rules,
        },
      ],
      diff: null,
      undo: null,
    })
  }
}

// ---------------------------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------------------------

const UNRATED_DAYS = 7
const UNRATED_LIMIT = 5
const NO_HEAT_NOTE: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'strength',
  'mobility',
  'rest',
])

/** Today's sessions with downgrade-only advice, the heat note, check-in, readiness and unrated runs. */
export async function todayView(
  deps: Deps,
  args: { userId: string; today: string },
): Promise<TodayView> {
  const { prisma } = deps
  const { userId, today } = args
  // The active version-2 plan and readiness come from the snapshot the input below is built on.
  const context = await loadAthleteContext(deps, { userId, today })
  const plan = context.plan
  const input = await gatherContextInput(
    deps,
    { userId, today, goalId: plan?.goalId ?? null },
    { existing: true, forecast: true },
  )
  const rows = plan
    ? await prisma.planSession.findMany({
        where: { planId: plan.id, date: today },
        orderBy: { order: 'asc' },
      })
    : []
  const sessions = rows.map(toPlanSession)
  const advice = todayAdvice(
    input,
    sessions.map((s) => ({ ...sessionSpec(s), id: s.id })),
  ).map((entry, i) => ({ ...entry, session: sessions[i]! }))

  // The snapshot's readiness is shared and frozen, so the screening note goes on a copy.
  const readiness: TodayView['readiness'] = {
    ...context.readiness,
    redFlags: [...context.readiness.redFlags],
  }
  const reds = input.screeningFlags ?? 0
  if (reds >= P.j5.redsHoldFlags.value) {
    readiness.redFlags.push({
      code: 'reds-screen',
      message: `The energy-availability screen showed ${reds} signs. Progression is on hold; a clinician or sports dietitian can help.`,
      rules: ['n-4', 'J5'],
    })
  }

  // The heat note describes the main run of the day; a day with no run has none.
  let heat: TodayView['heat'] = { wbgtC: null, note: null, coolerHour: null }
  const main = sessions.find((s) => !NO_HEAT_NOTE.has(s.kind))
  if (main && input.forecast) {
    const { note, coolerHour } = trainingHeatAdvice(input.forecast, sessionSpec(main))
    let peak: number | null = null
    for (const hour of input.forecast) {
      if (hour.time.slice(0, 10) !== today) continue
      const h = Number(hour.time.slice(11, 13))
      if (h < P.i7.windowStartHour.value || h >= P.i7.windowEndHour.value) continue
      const index = weatherIndex(hour)
      if (index.index === 'wbgt' && (peak === null || index.value > peak)) peak = index.value
    }
    heat = { wbgtC: peak, note, coolerHour }
  }

  const unrated = input.activities
    .filter(
      (a) =>
        (a.type === 'run' || a.type === 'race') &&
        a.feel === null &&
        (a.duplicateStatus === 'none' || a.duplicateStatus === 'dismissed') &&
        a.date >= addDays(today, -UNRATED_DAYS),
    )
    .reverse()
    .slice(0, UNRATED_LIMIT)

  return { date: today, sessions: advice, heat, checkin: readiness.checkin, readiness, unrated }
}
