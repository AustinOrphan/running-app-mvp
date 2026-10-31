// Strength on the server, the write side (strength design 6, 9.3 to 9.5; ADR 0014): the runner's
// setup, the starting points they enter and the logs of their sessions. A log is a manual `strength`
// activity plus its sets, saved by an idempotent `PUT` keyed by an id the client chose, so the
// outbox may send the same save twice. The prescription itself is never stored (design 5.1): the
// log keeps a snapshot of what the sheet showed and the sets that were done.
//
// Writes go through the data-versioned client and never raise the version themselves: all four
// strength models are state (`server/dataVersion.ts`). The read side (the strength state through
// `memoByVersion`, the workouts, the page view, the Today slot, the suggestions after a save) is at
// the end of the file (E14-6).
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { isExerciseId, type ExerciseId } from '../../shared/domain/strengthLibrary.ts'
import { aggregateWeeks } from '../../shared/domain/weeks.ts'
import { plannedMinOf } from '../../shared/engine/limits.ts'
import { strengthOffDay } from '../../shared/engine/micro.ts'
import { P } from '../../shared/engine/params/index.ts'
import { illnessPhase, recentPain } from '../../shared/engine/readiness.ts'
import {
  blockPosition,
  liftFor,
  strengthTemplate,
  summariseHistory,
  workoutFor,
  type LiftHistory,
} from '../../shared/engine/strength.ts'
import type {
  StrengthContext,
  StrengthLogEntry,
  StrengthReadiness,
  StrengthSessionRef,
  StrengthWeek,
} from '../../shared/engine/types.ts'
import { STRENGTH_HISTORY_MAX_SESSIONS } from '../../shared/limits.ts'
import type {
  EquipmentConfig,
  PinnedSlot,
  PlanSessionView,
  StrengthBlockView,
  StrengthDayWorkout,
  StrengthExerciseView,
  StrengthLift,
  StrengthLiftSummary,
  StrengthLog,
  StrengthLogResult,
  StrengthNextLoad,
  StrengthRecentLog,
  StrengthSettings,
  StrengthSnapshot,
  StrengthView,
  StrengthWorkout,
  StrengthWorkoutSource,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { Activity as ActivityRow, PrismaClient } from '../db.ts'
import { conflict, notFound } from '../errors.ts'
import { createLogger } from '../logger.ts'
import {
  toActivity,
  toStrengthLift,
  toStrengthLog,
  toStrengthSettings,
  toWeightUnit,
} from '../serialize.ts'
import { createManualActivity, type ManualActivityDb } from './activityStore.ts'
import {
  goalModelFor,
  loadAthleteContext,
  memoByVersion,
  type AthleteContext,
  type SnapshotDeps,
} from './athleteState.ts'
import { rematchDuplicates } from './duplicates.ts'
import { inputFromContext } from './engineInput.ts'
import { runExecutionQuietly } from './execution.ts'
import { assertLinkable, linkPlanSession, ownedSession } from './planEngine.ts'
import { safeMessage } from './syncLog.ts'

// ---------------------------------------------------------------------------------------------
// Settings and starting points
// ---------------------------------------------------------------------------------------------

/**
 * A change to the setup. A field that is left out keeps its stored value (the setup is five short
 * sheets, each saved on its own); `note: null` clears the note.
 */
export interface StrengthSettingsInput {
  equipment?: EquipmentConfig[]
  level?: StrengthSettings['level']
  currentlyLifting?: boolean
  avoid?: string[]
  pinned?: Partial<Record<PinnedSlot, string>>
  note?: string | null
}

/**
 * Saves the setup and answers with what was kept. The first save, even of an empty change, sets
 * `savedAt`, which is what ends the offer to set up and lets the workout use the equipment; a later
 * save leaves it. Repeating a request leaves the same row.
 */
export async function saveStrengthSettings(
  prisma: Pick<PrismaClient, 'strengthSettings'>,
  userId: string,
  input: StrengthSettingsInput,
): Promise<StrengthSettings> {
  const fields = {
    ...(input.equipment === undefined ? {} : { equipment: JSON.stringify(input.equipment) }),
    ...(input.level === undefined ? {} : { level: input.level }),
    ...(input.currentlyLifting === undefined ? {} : { currentlyLifting: input.currentlyLifting }),
    ...(input.avoid === undefined ? {} : { avoid: JSON.stringify(input.avoid) }),
    ...(input.pinned === undefined ? {} : { pinned: JSON.stringify(input.pinned) }),
    ...(input.note === undefined ? {} : { note: input.note }),
  }
  const existing = await prisma.strengthSettings.findUnique({ where: { userId } })
  const row = await prisma.strengthSettings.upsert({
    where: { userId },
    create: { userId, ...fields, savedAt: new Date() },
    update: existing?.savedAt ? fields : { ...fields, savedAt: new Date() },
  })
  return toStrengthSettings(row)
}

/** A starting point: a recent set or a known maximum. A maximum is one rep with no reps left. */
export type StrengthLiftInput = Omit<StrengthLift, 'exerciseId'>

/** Stores the starting point of an exercise, replacing the previous one. */
export async function saveStrengthLift(
  prisma: Pick<PrismaClient, 'strengthLift'>,
  userId: string,
  exerciseId: string,
  input: StrengthLiftInput,
): Promise<StrengthLift> {
  const row = await prisma.strengthLift.upsert({
    where: { userId_exerciseId: { userId, exerciseId } },
    create: { userId, exerciseId, ...input },
    update: input,
  })
  return toStrengthLift(row)
}

/** Removes the starting point of an exercise; 404 when the runner has none for it. */
export async function deleteStrengthLift(
  prisma: Pick<PrismaClient, 'strengthLift'>,
  userId: string,
  exerciseId: string,
): Promise<void> {
  const { count } = await prisma.strengthLift.deleteMany({ where: { userId, exerciseId } })
  if (count === 0) throw notFound('No starting point is saved for this exercise.')
}

// ---------------------------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------------------------

/** One set as the sheet sends it; its place in the session is its place in the list. */
export interface StrengthSetInput {
  exerciseId: string
  loadG: number | null
  count: number
  rir: number | null
}

/**
 * One save of a session. `rpe`, `pain` and `notes` left out keep what an existing activity holds
 * (an import brings its own) and are empty on a new one; null clears them. The date and the minutes
 * are always written to the activity.
 */
export interface StrengthLogInput {
  date: string
  /** An owned `strength` activity that has no log yet (an import, or an earlier save without sets). */
  activityId?: string | undefined
  /** A planned session of the active plan that this session fulfils. */
  sessionId?: string | undefined
  durationMin: number
  rpe?: number | null | undefined
  pain?: number | null | undefined
  notes?: string | null | undefined
  prescribed: StrengthSnapshot
  sets: StrengthSetInput[]
}

export interface SavedStrengthLog {
  result: StrengthLogResult
  /** True when this save stored the log for the first time; false when it replaced a stored one. */
  created: boolean
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

/** What the log stores of the sheet, as rows of the log. */
async function writeSets(
  tx: ManualActivityDb,
  userId: string,
  logId: string,
  sets: readonly StrengthSetInput[],
): Promise<void> {
  if (sets.length === 0) return
  await tx.strengthSet.createMany({
    data: sets.map((set, position) => ({ logId, userId, position, ...set })),
  })
}

async function createLogRows(
  tx: ManualActivityDb,
  args: { userId: string; logId: string; activityId: string; input: StrengthLogInput },
): Promise<void> {
  const { userId, logId, activityId, input } = args
  await tx.strengthLog.create({
    data: { id: logId, userId, activityId, prescribed: JSON.stringify(input.prescribed) },
  })
  await writeSets(tx, userId, logId, input.sets)
}

/**
 * The fields of an activity that already exists that a save writes. The duration is written only
 * when the minutes differ from the whole minutes the activity shows, so an imported duration is not
 * rounded for nothing.
 */
function activityFields(input: StrengthLogInput, existing: ActivityRow) {
  const minutesChanged = Math.round(existing.durationSec / 60) !== input.durationMin
  return {
    date: input.date,
    ...(minutesChanged ? { durationSec: input.durationMin * 60 } : {}),
    ...(input.rpe === undefined ? {} : { rpe: input.rpe }),
    ...(input.pain === undefined ? {} : { pain: input.pain }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  }
}

/** The 409 for a log that cannot stand on an activity: it is not a strength activity. */
function notStrength(): never {
  throw conflict('Sets can be logged only on a strength activity.')
}

async function readResult(deps: Deps, userId: string, logId: string): Promise<StrengthLogResult> {
  const row = await deps.prisma.strengthLog.findFirstOrThrow({
    where: { id: logId, userId },
    include: { sets: true, activity: true },
  })
  const log = toStrengthLog(row)
  return {
    log,
    activity: toActivity(row.activity),
    next: await suggestionsAfterSave(deps, userId, log),
  }
}

/** One try at a save; `saveStrengthLog` repeats it once after a race on the same `logId`. */
async function attemptSave(
  deps: Deps,
  userId: string,
  logId: string,
  input: StrengthLogInput,
): Promise<SavedStrengthLog> {
  const { prisma } = deps
  const existing = await prisma.strengthLog.findUnique({ where: { id: logId } })
  // The id is the client's choice, so another runner's id is as good as unknown.
  if (existing && existing.userId !== userId) throw notFound('Strength log not found.')

  if (existing && input.activityId !== undefined && input.activityId !== existing.activityId) {
    throw conflict('This log belongs to another activity.', { logId })
  }

  const activityId = existing?.activityId ?? input.activityId
  if (activityId === undefined) {
    // A new session: the activity and the log are stored together.
    if (input.sessionId !== undefined) {
      const session = await ownedSession(deps, userId, input.sessionId)
      await assertLinkable(deps, session, { id: null, type: 'strength', subtype: null })
    }
    await createManualActivity(
      deps,
      userId,
      {
        date: input.date,
        startTime: null,
        type: 'strength',
        durationSec: input.durationMin * 60,
        distanceM: null,
        rpe: input.rpe ?? null,
        avgHr: null,
        maxHr: null,
        elevationGainM: null,
        pain: input.pain ?? null,
        notes: input.notes ?? null,
      },
      {
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
        within: (tx, activity) =>
          createLogRows(tx, { userId, logId, activityId: activity.id, input }),
      },
    )
    return { result: await readResult(deps, userId, logId), created: true }
  }

  const activity = await prisma.activity.findFirst({ where: { id: activityId, userId } })
  if (!activity) throw notFound('Activity not found.')
  if (activity.type !== 'strength') notStrength()
  if (!existing) {
    const held = await prisma.strengthLog.findUnique({ where: { activityId } })
    if (held) throw conflict('This activity already has a strength log.', { logId: held.id })
  }
  if (input.sessionId !== undefined) {
    const session = await ownedSession(deps, userId, input.sessionId)
    await assertLinkable(deps, session, activity)
  }

  // A new day or a new duration is a new answer to "is this the same session as the import?".
  const fields = activityFields(input, activity)
  const matchChanged = fields.date !== activity.date || 'durationSec' in fields
  await prisma.$transaction(async (tx) => {
    await tx.activity.update({
      where: { id: activityId },
      data: {
        ...fields,
        ...(matchChanged ? { duplicateStatus: 'none', duplicateOfId: null } : {}),
      },
    })
    if (existing) {
      await tx.strengthLog.update({
        where: { id: logId },
        data: { prescribed: JSON.stringify(input.prescribed) },
      })
      await tx.strengthSet.deleteMany({ where: { logId } })
      await writeSets(tx, userId, logId, input.sets)
    } else {
      await createLogRows(tx, { userId, logId, activityId, input })
    }
  })
  if (matchChanged) await rematchDuplicates(prisma, userId, activityId)
  await tieToPlan(deps, userId, activity, input)
  return { result: await readResult(deps, userId, logId), created: !existing }
}

/**
 * After a save on an activity that was already stored: the owner's session when named, else the
 * matcher looks again (a new date may no longer fit the session the activity fulfils).
 */
async function tieToPlan(
  deps: Deps,
  userId: string,
  activity: ActivityRow,
  input: StrengthLogInput,
): Promise<void> {
  if (input.sessionId !== undefined) {
    await linkPlanSession(deps, { userId, sessionId: input.sessionId, activityId: activity.id })
    return
  }
  await runExecutionQuietly(deps, {
    userId,
    activityId: activity.id,
    ...(input.date === activity.date ? {} : { reconsider: 'date' as const }),
  })
}

/**
 * The idempotent save of a session (design 9.4): the same `logId` again replaces the sets and the
 * snapshot and leaves one log. Without `activityId` a new `strength` activity is stored with the
 * log; with it the log attaches to an owned strength activity that has none. 404 for an activity,
 * session or log of another runner; 409 for an activity that is not a strength activity, one that
 * has a log under another id (`details.logId` is that id), a log that belongs to another activity,
 * and a session the activity cannot fulfil.
 */
export async function saveStrengthLog(
  deps: Deps,
  userId: string,
  logId: string,
  input: StrengthLogInput,
): Promise<SavedStrengthLog> {
  try {
    return await attemptSave(deps, userId, logId, input)
  } catch (error) {
    // Two sends of one save at once: the loser's write hit the winner's row. By now the log
    // exists, so the second try is a replacement.
    if (!isUniqueViolation(error)) throw error
    return attemptSave(deps, userId, logId, input)
  }
}

/** Removes a log and its sets; the activity stays. 404 for an id that is not the runner's. */
export async function deleteStrengthLog(
  prisma: Pick<PrismaClient, 'strengthLog'>,
  userId: string,
  logId: string,
): Promise<void> {
  const { count } = await prisma.strengthLog.deleteMany({ where: { id: logId, userId } })
  if (count === 0) throw notFound('Strength log not found.')
}

/** Which logs to list: those of one activity, or those on days from `from` to `to`. */
export type StrengthLogQuery = { activityId: string } | { from: string; to: string }

/** Logs with their sets, newest day first. 404 for an activity that is not the runner's. */
export async function listStrengthLogs(
  prisma: PrismaClient,
  userId: string,
  query: StrengthLogQuery,
): Promise<StrengthLog[]> {
  if ('activityId' in query) {
    const activity = await prisma.activity.findFirst({
      where: { id: query.activityId, userId },
      select: { id: true },
    })
    if (!activity) throw notFound('Activity not found.')
  }
  const rows = await prisma.strengthLog.findMany({
    where:
      'activityId' in query
        ? { userId, activityId: query.activityId }
        : { userId, activity: { date: { gte: query.from, lte: query.to } } },
    include: { sets: true, activity: true },
    orderBy: [{ activity: { date: 'desc' } }, { createdAt: 'desc' }],
  })
  return rows.map(toStrengthLog)
}

// ---------------------------------------------------------------------------------------------
// The read side (design 5.1, 9.5, 11, 12; E14-6)
// ---------------------------------------------------------------------------------------------
//
// Everything below is derived on read from the logs, the setup and the stored plan, and nothing is
// stored (ADR 0014). The state the rules read is one memo per data version and day (`strength.state`),
// so a log, a change of equipment or of unit, or midnight rebuilds it and nothing else does.

/** Weeks of logs the state reads: more than the history windows the rules look back over. */
export const STRENGTH_STATE_WEEKS = 26
/** The logged sessions the page lists (design 11.3, part 6). */
export const STRENGTH_RECENT_LOGS = 30
/** The weeks of `StrengthView.weeks`, this one included (design 12.2). */
export const STRENGTH_VIEW_WEEKS = 12
/** The workouts of `StrengthView.next`. */
export const STRENGTH_NEXT_WORKOUTS = 3

/**
 * What the strength reads stand on: the engine's input and the rows it was built from, as the API
 * serves them. A session counts once (design 9.4): the log of a duplicate, confirmed or possible, is
 * left out when its original has a log of its own, because the original carries the session. A
 * confirmation moves the copy's log to the original when that has none, so the log of a confirmed
 * copy that is read here is one that nothing else stands for, and is counted. Frozen, as every
 * memoised value is.
 */
export interface StrengthState {
  context: StrengthContext
  settings: StrengthSettings
  anchors: StrengthLift[]
  /** Newest first. */
  logs: StrengthLog[]
  /**
   * The newest `STRENGTH_RECENT_LOGS` of `logs` with the note about the day each was logged on
   * (design 12.4), read from the stored plan of the snapshot: no query of its own.
   */
  recent: StrengthRecentLog[]
}

type CountedRow = {
  activityId: string
  activity: Pick<ActivityRow, 'duplicateStatus' | 'duplicateOfId'>
}

/**
 * The logs that stand for a session of their own (decided 2026-10-31, E14-6; design 9.4). A copy
 * flagged as a possible or a confirmed duplicate of an activity that has a log is skipped: the
 * original's log is the session. A copy whose original has none (the runner has not decided, or the
 * original is not a strength activity) keeps its log, so no session is dropped for want of another
 * log to stand for it; a dismissed duplicate is a session of its own.
 */
function countedOnce<T extends CountedRow>(rows: readonly T[]): T[] {
  const logged = new Set(rows.map((row) => row.activityId))
  return rows.filter(({ activity }) => {
    const copy = activity.duplicateStatus === 'confirmed' || activity.duplicateStatus === 'possible'
    return !(copy && activity.duplicateOfId !== null && logged.has(activity.duplicateOfId))
  })
}

/** The strength sessions of the stored plan, by date and order. */
export function strengthSessions(athlete: Pick<AthleteContext, 'planSessions'>): PlanSessionView[] {
  return athlete.planSessions.filter((session) => session.kind === 'strength')
}

/** A stored session as the strength engine reads it. */
export function sessionRefOf(
  session: Pick<PlanSessionView, 'id' | 'date' | 'order' | 'durationMin' | 'rules'>,
): StrengthSessionRef {
  return {
    id: session.id,
    date: session.date,
    order: session.order,
    durationMin: session.durationMin,
    rules: session.rules,
  }
}

/** The goal's pace in km/h (distance over expected duration), without the race-day climate. */
async function goalPaceKmh(athlete: AthleteContext): Promise<number | null> {
  if (athlete.goal === null) return null
  const model = await goalModelFor(athlete, athlete.goal.id, { climate: false })
  if (model === null || !(model.expectedDurationSec > 0) || !(model.distanceM > 0)) return null
  return model.distanceM / 1000 / (model.expectedDurationSec / 3600)
}

/** The stored plan's weeks as the engine reads them, with the run minutes of each week. */
function strengthWeeks(athlete: AthleteContext): StrengthWeek[] {
  const weeks = athlete.existing()?.weeks ?? []
  const rows = aggregateWeeks(
    athlete.activities,
    weeks.map((week) => week.weekStart),
  )
  return weeks.map((week, i) => ({
    weekStart: week.weekStart,
    flags: [...week.flags],
    phase: week.phase,
    isRecovery: week.isRecovery,
    plannedRunMin: plannedMinOf(week),
    runMin: rows[i]?.runMin ?? 0,
  }))
}

/**
 * The readiness of today as the rules of lighter days read it (design 10.4): the readiness read's
 * state, the worst recent pain score and the illness phase, the tests J3 applies to runs. The engine
 * applies it to a session on that day only, so a preview or a past day has no reduction.
 */
function strengthReadiness(athlete: AthleteContext): StrengthReadiness {
  const input = inputFromContext(athlete)
  return {
    date: athlete.asOf,
    state: athlete.readiness.state,
    pain: recentPain(input, athlete.asOf),
    illness: illnessPhase(input, athlete.asOf).phase,
  }
}

async function buildStrengthState(
  deps: SnapshotDeps,
  args: { userId: string; today: string },
): Promise<StrengthState> {
  const { prisma } = deps
  const { userId, today } = args
  // One round: the four reads of this state and the picture of the runner start together.
  const [user, settingsRow, liftRows, logRows, athlete] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { weightUnit: true } }),
    prisma.strengthSettings.findUnique({ where: { userId } }),
    prisma.strengthLift.findMany({ where: { userId } }),
    prisma.strengthLog.findMany({
      where: { userId, activity: { date: { gte: addDays(today, -7 * STRENGTH_STATE_WEEKS) } } },
      include: { sets: true, activity: true },
    }),
    loadAthleteContext(deps, { userId, today }),
  ])
  const settings = toStrengthSettings(settingsRow)
  const anchors = liftRows
    .map(toStrengthLift)
    .sort((a, b) => a.exerciseId.localeCompare(b.exerciseId))
  const logs = countedOnce(logRows)
    .map(toStrengthLog)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))

  const { profile } = athlete
  const context: StrengthContext = {
    today,
    weightUnit: toWeightUnit(user?.weightUnit ?? ''),
    setup: {
      saved: settings.savedAt !== null,
      equipment: settings.equipment,
      level: settings.level,
      currentlyLifting: settings.currentlyLifting,
      avoid: settings.avoid,
      pinned: settings.pinned,
    },
    anchors,
    logs: logs.map((log): StrengthLogEntry => ({
      id: log.id,
      activityId: log.activityId,
      date: log.date,
      mode: log.prescribed.mode,
      template: log.prescribed.template,
      sets: log.sets,
      lifts: log.prescribed.lifts.map((lift) => ({
        exerciseId: lift.exerciseId,
        implement: lift.implement,
        baseLoadG: lift.baseLoadG,
      })),
    })),
    weeks: strengthWeeks(athlete),
    sessions: strengthSessions(athlete).map(({ id, date, order }) => ({ id, date, order })),
    athlete: {
      age: profile.birthYear === null ? null : Number(today.slice(0, 4)) - profile.birthYear,
      weightKg: profile.weightKg,
      risk: {
        priorBsi: athlete.state.risk.priorBsi,
        recentInjury: athlete.state.risk.recentInjury,
      },
    },
    goal: { paceKmh: await goalPaceKmh(athlete) },
    readiness: strengthReadiness(athlete),
  }
  const recent = logs.slice(0, STRENGTH_RECENT_LOGS).map((log): StrengthRecentLog => ({
    ...log,
    offDay: strengthOffDay(log.date, athlete.planSessions),
  }))
  return { context, settings, anchors, logs, recent }
}

/**
 * The strength state of a runner for a day: the setup, the starting points and the logs of the last
 * `STRENGTH_STATE_WEEKS` weeks, with the stored plan and the day's readiness from the snapshot,
 * computed once per data version (`memoByVersion`, `strength.state`). Every write of a strength
 * model is state, so a save, a delete, a change of equipment or of the weight unit drops it.
 */
export function loadStrengthState(
  deps: SnapshotDeps,
  args: { userId: string; today: string },
): Promise<StrengthState> {
  return memoByVersion(deps, { ...args, name: 'strength.state' }, () =>
    buildStrengthState(deps, args),
  )
}

/** What `workoutFor`, `suggestLoad` and `summariseHistory` read (`loadStrengthState(...).context`). */
export async function loadStrengthContext(
  deps: SnapshotDeps,
  args: { userId: string; today: string },
): Promise<StrengthContext> {
  return (await loadStrengthState(deps, args)).context
}

/** The workouts of the active plan's strength sessions from `from` to `to`, by date and order. */
export async function strengthWorkouts(
  deps: SnapshotDeps,
  args: { userId: string; today: string; from: string; to: string },
): Promise<StrengthWorkout[]> {
  const { userId, today } = args
  const [athlete, context] = await Promise.all([
    loadAthleteContext(deps, { userId, today }),
    loadStrengthContext(deps, { userId, today }),
  ])
  return strengthSessions(athlete)
    .filter((session) => session.date >= args.from && session.date <= args.to)
    .map((session) => workoutFor(context, sessionRefOf(session)))
}

/**
 * `coach.slots.strength`: the workout of the viewed day's strength session, or null for a day
 * without one. The viewed day's readiness applies to today only (the engine reads it for a session
 * on its own day), so a preview is the workout as of today. A day of the illness rest phase
 * withdraws the session, as it withdraws a run (rule n-3, J3).
 */
export async function todayStrengthSlot(
  deps: SnapshotDeps,
  args: { userId: string; today: string; date: string; preview: boolean; context: AthleteContext },
): Promise<StrengthWorkout | null> {
  const { context, date } = args
  const onDay = strengthSessions(context).filter((session) => session.date === date)
  const session = onDay.find((candidate) => isToRun(candidate.status)) ?? onDay[0]
  if (session === undefined) return null
  if (!args.preview && illnessPhase(inputFromContext(context), date).phase === 'rest') return null
  const strength = await loadStrengthContext(deps, { userId: args.userId, today: args.today })
  return workoutFor(strength, sessionRefOf(session))
}

/**
 * A session that is no stored session: the maintenance session of the week of `date`, which the
 * engine gives the template of that week (maintenance outside a block, the taper or a return week
 * where the plan says so). Its id names nothing in the plan, and the engine counts it as one more
 * session of its week when it picks A or B.
 */
function maintenanceRef(id: string, date: string): StrengthSessionRef {
  return { id, date, order: 0, durationMin: P.f7.maintenanceSessionMin.value, rules: [] }
}

/**
 * `GET /api/strength/workout`: the workout a log made on `date` starts from (design 9.1), derived on
 * read and written nowhere. The planned strength session of that day when it has one (`sessionId`
 * names one of several), else the next planned session still to be done from today on, else the
 * maintenance session of that day's week. With `swap` the answer also carries that exercise as a
 * lift of the same session through `liftFor` (design 7.3, 10.3): the first session of an exercise
 * with no history, else its own history. Throws 404 for a `sessionId` that is not a strength
 * session of the runner's plan on `date`.
 */
export async function strengthDayWorkout(
  deps: SnapshotDeps,
  args: { userId: string; today: string; date: string; sessionId?: string; swap?: ExerciseId },
): Promise<StrengthDayWorkout> {
  const { userId, today, date } = args
  const [athlete, context] = await Promise.all([
    loadAthleteContext(deps, { userId, today }),
    loadStrengthContext(deps, { userId, today }),
  ])
  const sessions = strengthSessions(athlete)
  let source: StrengthWorkoutSource = 'planned'
  let ref: StrengthSessionRef
  if (args.sessionId !== undefined) {
    const named = sessions.find((session) => session.id === args.sessionId && session.date === date)
    if (named === undefined)
      throw notFound('That strength session is not in your plan for that day.')
    ref = sessionRefOf(named)
  } else {
    const onDay = sessions.filter((session) => session.date === date)
    const planned = onDay.find((session) => isToRun(session.status)) ?? onDay[0]
    const next = sessions.find(
      (session) => session.date > date && session.date >= today && isToRun(session.status),
    )
    if (planned !== undefined) {
      ref = sessionRefOf(planned)
    } else if (next !== undefined) {
      source = 'next-planned'
      ref = sessionRefOf(next)
    } else {
      source = 'maintenance'
      ref = maintenanceRef(`maintenance-${date}`, date)
    }
  }
  return {
    source,
    workout: workoutFor(context, ref),
    lift: args.swap === undefined ? null : liftFor(context, ref, args.swap),
  }
}

function liftSummary(lift: LiftHistory): StrengthLiftSummary {
  return {
    exerciseId: lift.exerciseId,
    lastDate: lift.lastDate,
    gapDays: lift.gapDays,
    workingLoadG: lift.workingLoadG,
    estimateG: lift.estimateG,
    lastChange: lift.lastChange,
    sessionCount: lift.sessions.length,
  }
}

/** The benefit and the separation sentences, as facts over their Params (design 11.6). */
function pageFacts(): StrengthView['facts'] {
  const [lo, hi] = P.f7.expectedBenefitPct.value
  return [
    {
      template: 'strength.benefit',
      slots: { lo: { kind: 'count', n: lo }, hi: { kind: 'percent', pct: hi } },
    },
    {
      template: 'strength.separation',
      slots: { hours: { kind: 'count', n: P.f4.strengthSeparationHours.value } },
    },
  ]
}

/** `GET /api/strength`: the page of design 11.3 and the weeks of the review (12.2). */
export async function strengthView(
  deps: SnapshotDeps,
  args: { userId: string; today: string },
): Promise<StrengthView> {
  const { userId, today } = args
  const [athlete, state] = await Promise.all([
    loadAthleteContext(deps, { userId, today }),
    loadStrengthState(deps, { userId, today }),
  ])
  const { context } = state
  const history = summariseHistory(context)
  const thisWeek = mondayOf(today)
  const position = blockPosition(context, thisWeek)
  const week = context.weeks.find((candidate) => candidate.weekStart === thisWeek)
  const block: StrengthBlockView | null =
    position === null
      ? null
      : {
          ...position,
          template: strengthTemplate(week ?? { flags: [], phase: '', isRecovery: false }, position),
        }
  const first = addDays(thisWeek, -7 * (STRENGTH_VIEW_WEEKS - 1))
  return {
    asOf: today,
    settings: state.settings,
    anchors: [...state.anchors],
    setupSaved: state.settings.savedAt !== null,
    block,
    next: strengthSessions(athlete)
      .filter((session) => session.date >= today && isToRun(session.status))
      .slice(0, STRENGTH_NEXT_WORKOUTS)
      .map((session) => workoutFor(context, sessionRefOf(session))),
    recent: state.recent,
    lifts: history.lifts.map(liftSummary),
    weeks: history.weeks.filter((w) => w.weekStart >= first && w.weekStart <= thisWeek),
    lowCountWeeks: history.lowCountWeeks,
    countPrompt: history.countPrompt,
    facts: pageFacts(),
  }
}

/** `GET /api/strength/exercises/:id`: every logged session of one exercise, newest first. */
export async function strengthExerciseView(
  deps: SnapshotDeps,
  args: { userId: string; today: string; exerciseId: string },
): Promise<StrengthExerciseView> {
  const state = await loadStrengthState(deps, args)
  const lift = summariseHistory(state.context).lifts.find(
    (candidate) => candidate.exerciseId === args.exerciseId,
  )
  return {
    exerciseId: args.exerciseId,
    anchor: state.anchors.find((anchor) => anchor.exerciseId === args.exerciseId) ?? null,
    summary: lift === undefined ? null : liftSummary(lift),
    sessions: lift === undefined ? [] : lift.sessions.slice(0, STRENGTH_HISTORY_MAX_SESSIONS),
  }
}

/**
 * The suggestion for next time for each exercise with sets in the log just saved (design 9.5): the
 * next planned strength session that is still to be done, else the maintenance of the day after
 * today, as the rules give its lifts now. A lift the rules move to a harder movement names that one.
 */
async function nextLoads(
  deps: Deps,
  userId: string,
  log: StrengthLog,
): Promise<StrengthNextLoad[]> {
  const today = todayIso()
  const [athlete, context] = await Promise.all([
    loadAthleteContext(deps, { userId, today }),
    loadStrengthContext(deps, { userId, today }),
  ])
  const ahead = strengthSessions(athlete).find(
    (session) => session.date > log.date && session.date >= today && isToRun(session.status),
  )
  const ref: StrengthSessionRef =
    ahead !== undefined
      ? sessionRefOf(ahead)
      : maintenanceRef(log.id, addDays(log.date > today ? log.date : today, 1))
  const seen = new Set<string>()
  const next: StrengthNextLoad[] = []
  for (const set of log.sets) {
    if (seen.has(set.exerciseId) || !isExerciseId(set.exerciseId)) continue
    seen.add(set.exerciseId)
    const lift = liftFor(context, ref, set.exerciseId)
    if (lift !== null)
      next.push({ exerciseId: lift.exerciseId, change: lift.change, loadG: lift.loadG })
  }
  return next
}

/**
 * `nextLoads`, or none when they cannot be worked out: the save is stored by now, and a refusal
 * after the write would show the runner an error for a session that is saved.
 */
async function suggestionsAfterSave(
  deps: Deps,
  userId: string,
  log: StrengthLog,
): Promise<StrengthNextLoad[]> {
  try {
    return await nextLoads(deps, userId, log)
  } catch (error) {
    createLogger(deps.config).warn(
      { reason: safeMessage(error) },
      'the suggestions after a strength save could not be worked out',
    )
    return []
  }
}
