// Strength on the server, the write side (strength design 6, 9.3 to 9.5; ADR 0014): the runner's
// setup, the starting points they enter and the logs of their sessions. A log is a manual `strength`
// activity plus its sets, saved by an idempotent `PUT` keyed by an id the client chose, so the
// outbox may send the same save twice. The prescription itself is never stored (design 5.1): the
// log keeps a snapshot of what the sheet showed and the sets that were done.
//
// Writes go through the data-versioned client and never raise the version themselves: all four
// strength models are state (`server/dataVersion.ts`). The read side (the workout, the page view,
// `loadStrengthContext`) is task E14-6.
import type {
  EquipmentConfig,
  PinnedSlot,
  StrengthLift,
  StrengthLog,
  StrengthLogResult,
  StrengthSettings,
  StrengthSnapshot,
} from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { Activity as ActivityRow, PrismaClient } from '../db.ts'
import { conflict, notFound } from '../errors.ts'
import { toActivity, toStrengthLift, toStrengthLog, toStrengthSettings } from '../serialize.ts'
import { createManualActivity, type ManualActivityDb } from './activityStore.ts'
import { runExecutionQuietly } from './execution.ts'
import { assertLinkable, linkPlanSession, ownedSession } from './planEngine.ts'

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

/** The fields of the activity that a save writes. */
function activityFields(input: StrengthLogInput) {
  return {
    date: input.date,
    durationSec: input.durationMin * 60,
    ...(input.rpe === undefined ? {} : { rpe: input.rpe }),
    ...(input.pain === undefined ? {} : { pain: input.pain }),
    ...(input.notes === undefined ? {} : { notes: input.notes }),
  }
}

/** The 409 for a log that cannot stand on an activity: it is not a strength activity. */
function notStrength(): never {
  throw conflict('Sets can be logged only on a strength activity.')
}

async function readResult(
  prisma: PrismaClient,
  userId: string,
  logId: string,
): Promise<StrengthLogResult> {
  const row = await prisma.strengthLog.findFirstOrThrow({
    where: { id: logId, userId },
    include: { sets: true, activity: true },
  })
  // `next` is the read side's (E14-6): it needs the suggestion rules over the log just saved.
  return { log: toStrengthLog(row), activity: toActivity(row.activity), next: [] }
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
    return { result: await readResult(prisma, userId, logId), created: true }
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

  await prisma.$transaction(async (tx) => {
    await tx.activity.update({ where: { id: activityId }, data: activityFields(input) })
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
  await tieToPlan(deps, userId, activity, input)
  return { result: await readResult(prisma, userId, logId), created: !existing }
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
