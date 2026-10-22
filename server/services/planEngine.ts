// Version-2 plans: generate with the engine, re-plan, persist weeks, sessions and revisions, and the
// owner's edits to single sessions. The engine decides; this module gathers, persists and guards.
import { addDays, daysBetween, isIsoDate, mondayOf, todayIso } from '../../shared/dates.ts'
import { type ExecutionRecord } from '../../shared/engine/adapt.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { weatherIndex, trainingHeatAdvice } from '../../shared/engine/heat.ts'
import {
  buildPlan,
  replan,
  todayAdvice,
  weeklyDecision,
  zoneProposals,
} from '../../shared/engine/index.ts'
import { P } from '../../shared/engine/params/index.ts'
import { readinessSnapshot } from '../../shared/engine/readiness.ts'
import type {
  ChecklistResult,
  EngineInput,
  PlanChange,
  PlanDraft,
  SessionKind,
  SessionSpec,
  WeekDraft,
  ZoneProposal,
  ZoneSet,
} from '../../shared/engine/types.ts'
import type {
  PlanRevision,
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
  loadProfile,
  toPlan,
  toPlanEngineFields,
  toPlanRevision,
  toPlanSession,
  toPlanWeek,
} from '../serialize.ts'
import { assessSessionById } from './execution.ts'
import {
  currentZones,
  gatherContextInput,
  gatherEngineInput,
  latestRedsFlags,
  sessionSpec,
} from './engineInput.ts'
import { MAX_PLAN_WEEKS } from './plan.ts'

/** A plan's rows are written in one transaction; long plans have a thousand sessions. */
const WRITE_TIMEOUT_MS = 60_000

type DbClient = Pick<PrismaClient, 'planRevision' | 'predictionLog'>

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

function weekRow(week: WeekDraft) {
  return {
    weekStart: week.weekStart,
    index: week.index,
    phase: week.phase,
    focus: week.focus,
    baselineRunMin: week.targetRunMin,
    targetRunMin: week.targetRunMin,
    targetSource: 'baseline',
    longRunMin: week.longRunMin,
    day2Min: null,
    runDays: week.runDays,
    strengthSessions: week.strengthSessions,
    overrideNote: null,
    tid: json(week.tid),
    flags: json(week.flags),
    gainTargetM: week.gainTargetM,
  }
}

function sessionRow(planId: string, spec: SessionSpec) {
  return {
    planId,
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
    flags: json(spec.flags),
    status: 'planned',
  }
}

/** Writes a revision; callers inside a transaction pass the transaction client. */
export async function writeRevision(
  db: Pick<PrismaClient, 'planRevision'>,
  planId: string,
  reason: PlanRevisionReason,
  summary: string,
  changes: PlanChange[],
): Promise<PlanRevision> {
  const row = await db.planRevision.create({
    data: { planId, reason, summary, changes: json(changes) },
  })
  return toPlanRevision(row)
}

async function logPrediction(
  db: DbClient & Pick<PrismaClient, 'predictionLog'>,
  args: { userId: string; goalId: string; draft: PlanDraft; today: string },
): Promise<void> {
  const { prediction } = args.draft
  if (prediction === null) return
  await db.predictionLog.create({
    data: {
      userId: args.userId,
      goalId: args.goalId,
      method: prediction.method,
      predictedSec: Math.round(prediction.predictedSec),
      lowSec: Math.round(prediction.lowSec),
      highSec: Math.round(prediction.highSec),
      inputs: json({
        today: args.today,
        conditions: prediction.conditions,
        rules: prediction.rules,
        paramsVersion: args.draft.paramsVersion,
      }),
    },
  })
}

function failedChecklist(checklist: ChecklistResult[]): HttpError | null {
  const failed = checklist.filter((item) => !item.ok)
  if (failed.length === 0) return null
  return new HttpError(
    422,
    'validation',
    `The plan did not pass the quality checklist (${failed.map((item) => item.id).join(', ')}), so it was not published.`,
    { checklist },
  )
}

/** Runs `buildPlan`, the checklist, persists plan, weeks, sessions and a 'generate' revision. */
export async function generateEnginePlan(
  deps: Deps,
  args: { userId: string; goalId: string; today: string; options?: EngineInput['options'] },
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

  const input = await gatherEngineInput(deps, { ...args, options: args.options ?? {} })
  const draft = buildPlan(input)
  const blocked = failedChecklist(draft.checklist)
  if (blocked) throw blocked

  const created = await prisma.$transaction(
    async (tx) => {
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
        data: draft.sessions.map((spec) => sessionRow(plan.id, spec)),
      })
      await writeRevision(
        tx,
        plan.id,
        'generate',
        `Plan generated for ${goal.name}: ${draft.weeks.length} weeks, ${draft.sessions.length} sessions.`,
        [],
      )
      await logPrediction(tx, { userId, goalId: goal.id, draft, today })
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

function sameSlot(row: PlanSessionRow, spec: SessionSpec): boolean {
  return row.date === spec.date && row.order === spec.order && row.kind === spec.kind
}

function describeChanges(changes: PlanChange[]): string {
  if (changes.length === 0) return 'No changes to the plan.'
  const weeks = new Set(changes.map((c) => c.weekStart)).size
  return `${changes.length} change${changes.length === 1 ? '' : 's'} across ${weeks} week${weeks === 1 ? '' : 's'}.`
}

/** Re-plans the active plan from the updated state and writes a `PlanRevision`. */
export async function replanActivePlan(
  deps: Deps,
  args: { userId: string; reason: PlanRevisionReason; today: string },
): Promise<PlanRevision> {
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
  const input = await gatherEngineInput(
    deps,
    { userId, goalId: plan.goalId, today, options },
    { existing: true },
  )
  const { draft, changes } = replan(input)
  const blocked = failedChecklist(draft.checklist)
  if (blocked) throw blocked

  // The decision for the week that just finished goes into the summary; the review page reads it
  // from the engine with the same inputs.
  const lastWeek = addDays(mondayOf(today), -7)
  const redsFlags = await latestRedsFlags(deps, userId)
  const decision = input.existing?.weeks.some((w) => w.weekStart === lastWeek)
    ? weeklyDecision(input, lastWeek, { redsFlags })
    : null
  const state = estimateState(input)
  const reason: PlanRevisionReason =
    args.reason === 'weekly' && state.layoffDays >= P.j7.tier1Days.value ? 'break' : args.reason
  const summary = [
    describeChanges(changes),
    decision
      ? `Last week's decision: ${decision.decision}, next week up to ${decision.nextWeekTargetMin} min.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join(' ')

  const currentMonday = mondayOf(today)
  const revision = await prisma.$transaction(
    async (tx) => {
      const rows = await tx.planSession.findMany({ where: { planId: plan.id } })
      // What the engine kept: the past and the finished sessions of the current week.
      const keptRows = rows.filter(
        (r) => r.date < today || (r.weekStart === currentMonday && r.status !== 'planned'),
      )
      const replaced = rows.filter((r) => !keptRows.includes(r))
      await tx.planSession.deleteMany({ where: { id: { in: replaced.map((r) => r.id) } } })
      const unmatched = [...keptRows]
      const fresh: SessionSpec[] = []
      for (const spec of draft.sessions) {
        const at = unmatched.findIndex((r) => sameSlot(r, spec))
        if (at >= 0) unmatched.splice(at, 1)
        else fresh.push(spec)
      }
      await tx.planSession.createMany({ data: fresh.map((spec) => sessionRow(plan.id, spec)) })

      const weeks = await tx.planWeek.findMany({ where: { planId: plan.id } })
      const byStart = new Map(weeks.map((w) => [w.weekStart, w]))
      const future = draft.weeks.filter((w) => w.weekStart >= currentMonday)
      for (const week of future) {
        const row = weekRow(week)
        const old = byStart.get(week.weekStart)
        if (!old) {
          await tx.planWeek.create({ data: { ...row, planId: plan.id } })
          continue
        }
        // The owner's working target stays while it is within the engine's limit [rules g-2].
        const keep =
          (old.targetSource === 'override' || old.targetSource === 'review') &&
          old.targetRunMin <= week.targetRunMin
        await tx.planWeek.update({
          where: { id: old.id },
          data: keep
            ? {
                ...row,
                targetRunMin: old.targetRunMin,
                targetSource: old.targetSource,
                overrideNote: old.overrideNote,
              }
            : row,
        })
      }
      const futureStarts = new Set(future.map((w) => w.weekStart))
      const dropped = weeks.filter(
        (w) => w.weekStart >= currentMonday && !futureStarts.has(w.weekStart),
      )
      if (dropped.length > 0) {
        await tx.planWeek.deleteMany({ where: { id: { in: dropped.map((w) => w.id) } } })
      }
      await tx.plan.update({
        where: { id: plan.id },
        data: {
          raceWeekStart: mondayOf(plan.goal.targetDate),
          paramsVersion: draft.paramsVersion,
          feasibility: json(draft.feasibility),
          warnings: json(draft.warnings),
          checklist: json(draft.checklist),
        },
      })
      await logPrediction(tx, { userId, goalId: plan.goalId, draft, today })
      return writeRevision(tx, plan.id, reason, summary, changes)
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
  return revision
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
  'flags',
] as const

/** Owner edits: move within the week, swap kinds within the week, skip or restore. */
export async function updatePlanSession(
  deps: Deps,
  args: { userId: string; sessionId: string; patch: PlanSessionPatch; today: string },
): Promise<PlanSession> {
  const { prisma } = deps
  const { userId, today, patch } = args
  const row = await ownedSession(deps, userId, args.sessionId)
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
        await writeRevision(
          tx,
          row.planId,
          'owner',
          `Skipped ${session.title} on ${session.date}.`,
          [
            {
              weekStart: session.weekStart,
              field: 'session.status',
              from: session.status,
              to: 'skipped',
              rules: ['g-6'],
            },
          ],
        )
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
      await writeRevision(
        tx,
        row.planId,
        'owner',
        `Restored ${session.title} on ${session.date}.`,
        [
          {
            weekStart: session.weekStart,
            field: 'session.status',
            from: 'skipped',
            to: 'planned',
            rules: ['g-6'],
          },
        ],
      )
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
      await writeRevision(
        tx,
        row.planId,
        'owner',
        `Moved ${session.title} from ${session.date} to ${patch.date}.`,
        [
          {
            weekStart: session.weekStart,
            field: 'session.date',
            from: session.date,
            to: patch.date,
            rules: ['F1'],
          },
        ],
      )
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
    await tx.planSession.update({
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
    await writeRevision(
      tx,
      row.planId,
      'owner',
      `Swapped ${session.title} on ${session.date} with ${partner.title} on ${partner.date}.`,
      [
        {
          weekStart: session.weekStart,
          field: 'session.kind',
          from: session.kind,
          to: kind,
          rules: ['F1'],
        },
      ],
    )
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
      data: {
        activityId: null,
        linkSource: null,
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
    if (plan) await writeRevision(prisma, plan.id, 'owner', declinedSummary(proposal.id), [])
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
    await writeRevision(
      prisma,
      plan.id,
      'owner',
      `Accepted zone proposal ${proposal.id}: ${proposal.boundary} from ${proposal.from} to ${proposal.to}.`,
      [
        {
          weekStart: mondayOf(args.today),
          field: `zones.${proposal.boundary}`,
          from: proposal.from,
          to: proposal.to,
          rules: proposal.rules,
        },
      ],
    )
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
  const plan = await prisma.plan.findFirst({
    where: { userId, status: 'active', generatorVersion: { gte: 2 } },
    orderBy: { createdAt: 'desc' },
  })
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

  const readiness = readinessSnapshot(input, today)
  const reds = await latestRedsFlags(deps, userId)
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
