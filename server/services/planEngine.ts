// Version-2 plans: generate with the engine, re-plan, persist weeks, sessions and revisions, and
// link an activity to a session. The owner's edits of a session are `adjust.ts`. The engine
// decides; this module gathers, persists and guards.
import { randomUUID } from 'node:crypto'
import { addDays, daysBetween, mondayOf, todayIso } from '../../shared/dates.ts'
import {
  ACTIVITY_TYPE_WORDS,
  acceptedZoneSummary,
  adjustText,
  checklistRefusedMessage,
  declinedZoneSummary,
  generatedSummary,
  goalSwitchSummary,
  zoneNotStoredText,
} from '../../shared/copy/revision.ts'
import { carryExternalIds, pairSessions } from '../../shared/domain/sessionIdentity.ts'
import { type ExecutionRecord } from '../../shared/engine/adapt.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import {
  recentPaceSecPerKm,
  weekDistanceEstimateM,
  withDistanceEstimate,
  type EstimatePaces,
} from '../../shared/engine/distanceEstimate.ts'
import { compatible } from '../../shared/engine/execution.ts'
import {
  buildPlan,
  keptByReplan,
  weeklyDecision,
  weeklyRamp,
  zoneProposals,
} from '../../shared/engine/index.ts'
import { loadPosition, rebuildZone, type LoadPosition } from '../../shared/engine/loadSetting.ts'
import { resolveMethod, type MethodPosition } from '../../shared/engine/methods.ts'
import { P } from '../../shared/engine/params/index.ts'
import { sessionTitle } from '../../shared/engine/sessions.ts'
import type {
  ChecklistResult,
  EngineInput,
  PlanChange,
  SessionKind,
  SessionSpec,
  WeekDraft,
  WeeklyDecision,
  ZoneProposal,
} from '../../shared/engine/types.ts'
import {
  ZONE_CHANGE_MARK,
  zoneChangeField,
  zoneDecisionsOf,
  type ZoneOutcome,
} from '../../shared/engine/zoneChange.ts'
import type {
  ActivityType,
  PlanRevisionReason,
  PlanSession,
  PlanWithSessions,
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
  parsePlanOptions,
  toPlan,
  toPlanEngineFields,
  toPlanSession,
  toPlanWeek,
} from '../serialize.ts'
import { assessSessionById } from './execution.ts'
import { gatherContextInput, gatherEngineInput } from './engineInput.ts'
import { loadAthleteContext } from './athleteState.ts'
import { withGutTrainingOption } from './fuel.ts'
import { ensureClimate } from './weatherCache.ts'
import { MAX_PLAN_WEEKS } from './plan.ts'
import { recordPrediction } from './predictionLog.ts'
import { recordPlanWrite } from './replan.ts'

/** A plan's rows are written in one transaction; long plans have a thousand sessions. */
export const WRITE_TIMEOUT_MS = 60_000

// Re-plans and revisions are written by `replan.ts` (ADR 0007); the old name stays importable here.
export { replanActivePlan } from './replan.ts'
// Today is composed in `today.ts` from the athlete snapshot; the old name stays importable here.
export { todayView } from './today.ts'

function json(value: unknown): string {
  return JSON.stringify(value)
}

/**
 * The plan with its weeks and sessions in the API shape. Zones are not stored: they follow the
 * data, and so do the distance estimates of the sessions and the weeks, which are worked out here
 * from the zones and the recent logged pace (`estimateDistance`) and never written. `load` is the
 * plan's load setting as `loadPosition` reads it today (null for a version-1 plan), the one source
 * of the position in effect and of why it differs from the one chosen; `method` is the same for the
 * method preset (`resolveMethod`).
 */
function present(
  plan: PlanRow & { weeks: PlanWeekRow[]; sessions: PlanSessionRow[] },
  paces: EstimatePaces,
  load: LoadPosition | null,
  method: MethodPosition | null,
): PlanWithSessions {
  const { zones } = paces
  const engine = plan.generatorVersion >= 2 ? toPlanEngineFields(plan) : null
  const chosenCycle = engine === null ? undefined : parsePlanOptions(plan.options).recoveryCycle
  const sessions = plan.sessions.map((row) => withDistanceEstimate(toPlanSession(row), paces))
  const byWeek = new Map<string, typeof sessions>()
  for (const session of sessions) {
    byWeek.set(session.weekStart, [...(byWeek.get(session.weekStart) ?? []), session])
  }
  return {
    ...toPlan(plan),
    weeks: plan.weeks.map((row) => {
      const week = toPlanWeek(row)
      return { ...week, distanceEstimateM: weekDistanceEstimateM(byWeek.get(week.weekStart) ?? []) }
    }),
    sessions,
    feasibility: engine?.feasibility ?? null,
    warnings: engine?.warnings ?? [],
    checklist: engine?.checklist ?? [],
    zones,
    load,
    method,
    // a stored value that is neither cycle is not a choice, as the engine reads it
    recoveryCycle: chosenCycle === '2:1' || chosenCycle === '3:1' ? chosenCycle : null,
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
  // Zones and the recent pace come from the snapshot, with no read of their own.
  const context =
    plan.generatorVersion >= 2 ? await loadAthleteContext(deps, { userId, today }) : null
  // The load setting and the method preset are read from the plan's own goal, options and the
  // snapshot's state, as the weekly decision is, so that they are the ones the next re-plan applies.
  let load: LoadPosition | null = null
  let method: MethodPosition | null = null
  if (context !== null) {
    const input = await gatherContextInput(deps, {
      userId,
      today,
      goalId: plan.goalId,
      options: context.planOptions,
    })
    load = loadPosition(input, context.state)
    method = resolveMethod(input, context.state, plan.weeks.map(toPlanWeek))
  }
  return present(
    plan,
    {
      zones: context?.zones ?? null,
      recentPaceSecPerKm: context?.recentPaceSecPerKm ?? null,
    },
    load,
    method,
  )
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
    qualitySessions: week.qualitySessions,
    isRecovery: week.isRecovery,
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
  return new HttpError(422, 'validation', checklistRefusedMessage(), { checklist })
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
  // The gut-training switch comes from the stored fuel settings, never from the request (design
  // 10.5): a gut condition or an opt-out builds the plan without the block.
  const options = await withGutTrainingOption(prisma, userId, args.options ?? {})
  const input = await gatherEngineInput(deps, { ...args, options })
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
          options: json(options),
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
  // The zones of the draft, and the recent pace from the same input the draft was built on.
  const state = estimateState(input)
  const recentPace = recentPaceSecPerKm({
    activities: input.activities,
    state,
    zones: draft.zones,
  })
  return present(
    created,
    { zones: draft.zones, recentPaceSecPerKm: recentPace },
    loadPosition(input, state),
    resolveMethod(input, state, created.weeks.map(toPlanWeek)),
  )
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
 * preview of a re-plan and its write both come from here. `heldDates` are the days the runner's
 * rest windows hold (`heldDates` of the engine, from the same input as the draft): an edit or a
 * trim on one of them is released, as the engine released it, or the rows kept here would differ
 * from the sessions the engine drew.
 */
export function planSessionWrites(
  rows: readonly PlanSessionRow[],
  args: { today: string; sessions: SessionSpec[]; heldDates?: ReadonlySet<string> },
): SessionWritePlan {
  // What the engine kept: the past, the finished sessions of the current week and the owner's
  // edits of the next 14 days.
  const isKept = (row: PlanSessionRow) =>
    keptByReplan(
      { date: row.date, status: row.status, rules: toPlanSession(row).rules },
      args.today,
      args.heldDates,
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
  args: { planId: string; today: string; sessions: SessionSpec[]; heldDates?: ReadonlySet<string> },
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
  // The plan's own options carry the load setting, so the suggested week grows as the plan does.
  const input = await gatherContextInput(
    deps,
    {
      userId: args.userId,
      today: args.today,
      goalId: plan.goalId,
      options: parsePlanOptions(plan.options),
    },
    { existing: true },
  )
  // The tightened ramp of an injury or bone-stress profile caps the suggested week too, and so
  // does the rebuild zone of a plan at standard or upper [rules g-8]. The first hot days
  // (heatFirstDays) and the sleep-efficiency drop are not derived from the data yet, so those two
  // holds of rule J5 do not fire.
  const state = estimateState(input)
  const ramp = weeklyRamp(state)
  const rebuild = rebuildZone(input, state)
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
        rebuild,
      }),
    )
  }
  return decisions
}

// ---------------------------------------------------------------------------------------------
// One session of the active plan: finding it and linking an activity. The owner's edits of its day,
// length and place are `adjust.ts` (move, swap, shorten, skip, restore).
// ---------------------------------------------------------------------------------------------

/** A session of the user's active plan, with its plan; 404 for any other. */
export async function ownedSession(deps: Deps, userId: string, id: string) {
  const row = await deps.prisma.planSession.findFirst({
    where: { id, plan: { userId, status: 'active' } },
    include: { plan: true },
  })
  if (!row) throw notFound('Session not found.')
  return row
}

/**
 * Refuses (409) a link the matcher would not make: the session's kind does not take the activity's
 * type, or the activity already fulfils another session. A null `activity.id` is an activity that
 * is not stored yet, which fulfils nothing. Nothing is written.
 */
export async function assertLinkable(
  deps: Deps,
  session: { id: string; kind: string },
  activity: { id: string | null; type: string; subtype: string | null },
): Promise<void> {
  if (!compatible(session.kind as SessionKind, activity)) {
    const words = ACTIVITY_TYPE_WORDS[activity.type as ActivityType] ?? 'activity'
    throw conflict(
      adjustText('adjust.link-kind', {
        activity: words,
        title: sessionTitle(session.kind as SessionKind),
      }),
    )
  }
  if (activity.id === null) return
  const taken = await deps.prisma.planSession.findFirst({
    where: { activityId: activity.id, id: { not: session.id } },
  })
  if (taken) {
    throw conflict(
      adjustText('adjust.link-taken', {
        title: taken.title,
        date: { kind: 'date', iso: taken.date, style: 'weekday' },
      }),
    )
  }
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
  await assertLinkable(deps, row, activity)
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

function proposalId(proposal: Pick<ZoneProposal, 'boundary' | 'from' | 'to'>): string {
  return `${proposal.boundary}-${proposal.from}-${proposal.to}`
}

/** The change that records the owner's decision on a proposal; the values are the proposed ones. */
function zoneChange(proposal: ZoneProposal, outcome: ZoneOutcome, today: string): PlanChange {
  return {
    weekStart: mondayOf(today),
    field: zoneChangeField(proposal.boundary, outcome),
    from: proposal.from,
    to: proposal.to,
    rules: proposal.rules,
  }
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

  // A decline is found by its stored change (`zones.<boundary>.declined`, the proposed values in
  // `from` and `to`), never by the words of the summary.
  const revisions = await prisma.planRevision.findMany({
    where: {
      plan: { userId: args.userId },
      reason: 'owner',
      changes: { contains: ZONE_CHANGE_MARK },
      createdAt: { gte: new Date(Date.now() - P.zoneProposal.windowDays.value * DAY_MS) },
    },
    select: { changes: true },
  })
  const declined = new Set(
    revisions.flatMap((revision) =>
      zoneDecisionsOf(revision.changes)
        .filter((decision) => decision.outcome === 'declined')
        .map(({ boundary, change }) =>
          proposalId({ boundary, from: change.from as number, to: change.to as number }),
        ),
    ),
  )
  return proposals
    .map((proposal) => ({ ...proposal, id: proposalId(proposal) }))
    .filter((proposal) => !declined.has(proposal.id))
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
        summary: declinedZoneSummary(proposal.boundary, args.today),
        changes: [zoneChange(proposal, 'declined', args.today)],
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
    throw conflict(zoneNotStoredText(proposal.boundary))
  }
  if (plan) {
    // The profile is not a plan row, so there is nothing for a diff to show or an undo to restore.
    await recordPlanWrite(prisma, {
      planId: plan.id,
      userId: args.userId,
      reason: 'owner',
      summary: acceptedZoneSummary(proposal.boundary, args.today),
      changes: [zoneChange(proposal, 'accepted', args.today)],
      diff: null,
      undo: null,
    })
  }
}
