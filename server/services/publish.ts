// The publisher (ADR 0008, phase 3a design 4.4, 6.4 and 6.8): keeps the next 14 days of run sessions
// of the active plan in the runner's intervals.icu calendar, where intervals.icu's own Garmin upload
// carries them to the watch. This module owns the `WristPublication` and `DeliveryChannel` rows, as
// `activityStore.ts` owns imported activities; the provider module only talks to intervals.icu.
//
// A run (`publishForUser`) reads first and writes second:
//   1. load the integration and the channel (publishing is off until the runner turns it on);
//   2. build the deliverables of today to +13 (`buildDeliverables`, the one builder of the files,
//      the feed and this);
//   3. read the reference (maximum heart rate, threshold pace; cached for 6 hours), because the
//      text of an event holds percentages of it;
//   4. list what intervals.icu holds in the range (owner removals, adoption, device messages);
//   5. upsert new or changed content, before anything is withdrawn, so no day is left without a
//      session while a replacement is being made;
//   6. withdraw what is no longer desired (skipped, a rest advice, a session the plan dropped);
//   7. store every outcome per session;
//   8. record one `SyncRun`.
//
// Identity: a session goes out as `workoutExternalId(externalId, userTagOf(userId))` and nothing
// about the id is derived from the date, the kind or the order (design 4.1). A re-plan that changes
// a session's day or kind is a removal plus an addition (create the new event, then withdraw the
// old); an owner move keeps the session, so the event is updated in place by a PUT.
//
// The tables are non-state: a run never raises the data version, and it opens no transaction (a
// transaction raises the version when it ends). The run is a function of the composed change key
// (`publishChangeKey`), a retry that is due and a 30-minute backstop; there is no other watermark.
import { createHash } from 'node:crypto'
import { addDays, daysBetween, isIsoDate, todayIso } from '../../shared/dates.ts'
import { publishSentence, wristSentence } from '../../shared/copy/publish.ts'
import { isToRun } from '../../shared/domain/sessionStatus.ts'
import { workoutExternalId } from '../../shared/domain/sessionIdentity.ts'
import type {
  PlanSession,
  SyncStatus,
  SyncTrigger,
  WristItem,
  WristSettings,
  WristStatus,
} from '../../shared/types.ts'
import { publishable } from '../../shared/workouts/labels.ts'
import type { WorkoutPlan } from '../../shared/workouts/types.ts'
import type { Deps } from '../app.ts'
import { SecretError, userTagOf } from '../crypto.ts'
import type { DeliveryChannel, WristPublication } from '../db.ts'
import { conflict, notFound } from '../errors.ts'
import { createLogger } from '../logger.ts'
import { renderIntervalsDescription } from '../providers/intervalsPublish.ts'
import { getProvider } from '../providers/registry.ts'
import {
  PublishError,
  PublishPause,
  RateLimitPause,
  type OutboundWorkout,
  type ProviderCtx,
  type PublishFailCode,
  type PublishProvider,
  type PublishReference,
  type RemoteWorkout,
  type UpsertOutcome,
} from '../providers/types.ts'
import { toWristItem, wristItemStatus } from '../serialize.ts'
import { athleteKey, loadAthleteContext } from './athleteState.ts'
import { CALENDAR_CHANNEL } from './calendar.ts'
import { dataVersionKey, openTransactions } from '../dataVersion.ts'
import { registerHealthNoteProducer, tomorrowNotOnWatch } from './todayHealth.ts'
import { registerTodayStamp } from './today.ts'
import { SECRET_CHANGED, openIntegration, providerContext, trackBackground } from './sync.ts'
import { recordSyncRun, recordSyncRunUnlessIdle, safeMessage, secretValues } from './syncLog.ts'
import { buildDeliverables, type SendDeliverable } from './workouts.ts'
import { forecastStamp } from './weatherCache.ts'

/** The `DeliveryChannel.channel` and `WristPublication.channel` of the intervals.icu publisher. */
export const CHANNEL = 'intervals'
/** The provider key: the registry entry, the integration row and the `SyncRun.provider`. */
const PROVIDER = 'intervals'
/** Days published, today included: today to +13. */
export const PUBLISH_HORIZON_DAYS = 14
/** A run happens at least this often while publishing is on (design 4.4). */
export const PUBLISH_BACKSTOP_MS = 30 * 60_000
/** How long a reference read is kept (design 6.8). */
export const REFERENCE_TTL_MS = 6 * 3_600_000
/**
 * A reference that lacks the maximum heart rate or the threshold pace is read again at the next
 * backstop run, so a figure the runner has just set in intervals.icu reaches the watch soon.
 */
export const INCOMPLETE_REFERENCE_TTL_MS = PUBLISH_BACKSTOP_MS
/**
 * Bump when a renderer changes what an event holds (the intervals.icu text, the event body), so
 * every event is sent again with the new text.
 */
export const DELIVERY_VERSION = 2
/** Back-off of a send that did not go through: `min(2^attempts, 60)` minutes. */
const MAX_BACKOFF_MIN = 60
/** A rejected workout is tried this many times in all (the first and two retries). */
const REJECTED_ATTEMPTS = 3
/** A run that could not read or write at all waits this long before the next one. */
const RUN_RETRY_MIN = 5
/** The longest a request that takes events off the calendar may take (design 6.4). */
export const REMOVE_TIMEOUT_MS = 20_000
/** Withdrawn and owner-removed rows older than this are deleted (design 6.3). */
const PRUNE_DAYS = 60
/** Days a status request may span (design 6.4). */
export const STATUS_MAX_DAYS = 60

const MIN_MS = 60_000

/** Failure codes that wait for a reconnect, not for the clock: retried as soon as one is possible. */
const RECONNECT_CODES: ReadonlySet<string> = new Set<PublishFailCode>(['auth', 'not-connected'])

// ---------------------------------------------------------------------------------------------
// Identity and change detection
// ---------------------------------------------------------------------------------------------

/**
 * What an event holds, as a hash: the delivery version, the day, the name and the text. A move
 * changes the day and so republishes; a zone change, an eased day, a forecast that changes the heat
 * note and a new threshold pace in intervals.icu change the text.
 */
export function contentHash(parts: { date: string; name: string; description: string }): string {
  return createHash('sha256')
    .update(JSON.stringify([DELIVERY_VERSION, parts.date, parts.name, parts.description]))
    .digest('hex')
}

/**
 * What a run is valid for: the athlete key (data version, day, parameter version) and the fetch
 * time of the home forecast (design 4.3). A state write, midnight and a forecast refresh change it;
 * the publisher's own writes do not.
 */
export async function publishChangeKey(
  deps: Pick<Deps, 'prisma'>,
  userId: string,
  today: string,
): Promise<string> {
  const [version, forecast] = await Promise.all([
    dataVersionKey(deps.prisma),
    forecastStamp(deps.prisma, userId),
  ])
  return `${athleteKey(version, today)}~${forecast}`
}

// ---------------------------------------------------------------------------------------------
// One run per user at a time
// ---------------------------------------------------------------------------------------------

const flights = new Map<string, Promise<unknown>>()

/** True while a run, or a change of the settings, is in progress for the user. */
export function isPublishing(userId: string): boolean {
  return flights.has(userId)
}

/** Waits for the flight in progress, then holds the user's flight while `fn` runs. */
async function exclusive<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  while (flights.has(userId)) {
    await flights.get(userId)?.catch(() => undefined)
  }
  const flight = fn()
  flights.set(userId, flight)
  try {
    return await flight
  } finally {
    if (flights.get(userId) === flight) flights.delete(userId)
  }
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export interface PublishOptions {
  trigger?: Extract<SyncTrigger, 'schedule' | 'manual'>
  fetch?: typeof fetch
  now?: Date
}

export interface PublishResult {
  /** False when nothing was done: publishing is off, intervals.icu is not usable, a run is in progress. */
  ran: boolean
  status: SyncStatus
  /** Events created or updated. */
  sent: number
  /** Sessions already on intervals.icu with the right content. */
  unchanged: number
  /** Sessions taken off intervals.icu. */
  withdrawn: number
  /** Sessions that could not be sent in this run. */
  failed: number
}

const NOT_RUN: PublishResult = {
  ran: false,
  status: 'ok',
  sent: 0,
  unchanged: 0,
  withdrawn: 0,
  failed: 0,
}

/** A session the plan wants on the watch, ready to send. */
interface Desired {
  /** `PlanSession.externalId`. */
  externalId: string
  /** `workoutExternalId(...)`: the id the event carries. */
  remoteExternalId: string
  date: string
  order: number
  kind: string
  variant: 'planned' | 'eased'
  title: string
  plan: WorkoutPlan
  hash: string
}

/** The columns a run writes; the rest are set by the database. */
interface RowData {
  date: string
  kind: string
  variant: string
  title: string
  remoteId: string | null
  state: string
  desiredHash: string
  sentHash: string | null
  failCode: string | null
  failMessage: string | null
  deviceMessage: string | null
  warnings: string
  attempts: number
  nextAttemptAt: Date | null
  sentAt: Date | null
}

interface SendItem {
  desired: Desired
  row: WristPublication | undefined
  /** The event to update; null creates one. */
  remoteId: string | null
}

const backoffMin = (attempts: number): number => Math.min(2 ** attempts, MAX_BACKOFF_MIN)

const capped = (text: string): string =>
  text.length > 200 ? `${text.slice(0, 199).trimEnd()}…` : text

/** The stored reference and when it was read, or null when there is none or it is unreadable. */
function parseStoredReference(text: string | null): { ref: PublishReference; readAt: Date } | null {
  if (text === null) return null
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    const finite = (v: unknown): number | null =>
      typeof v === 'number' && Number.isFinite(v) ? v : null
    const readAt = typeof value['readAt'] === 'string' ? new Date(value['readAt']) : null
    if (readAt === null || Number.isNaN(readAt.getTime())) return null
    return {
      ref: {
        maxHr: finite(value['maxHr']),
        lthr: finite(value['lthr']),
        thresholdPaceMps: finite(value['thresholdPaceMps']),
      },
      readAt,
    }
  } catch {
    return null
  }
}

/**
 * The reference for the text of the events: the cached read while it is fresh, else a new read.
 * A read that fails for a reason other than a reconnect or a rate limit falls back to the cached
 * one, however old, because sending with older figures beats sending nothing.
 */
async function referenceFor(
  channel: DeliveryChannel,
  publish: PublishProvider,
  ctx: ProviderCtx,
  now: Date,
): Promise<{ ref: PublishReference; json: string | null }> {
  const cached = parseStoredReference(channel.referenceJson)
  if (cached !== null) {
    const complete = cached.ref.maxHr !== null && cached.ref.thresholdPaceMps !== null
    const ttl = complete ? REFERENCE_TTL_MS : INCOMPLETE_REFERENCE_TTL_MS
    if (now.getTime() - cached.readAt.getTime() < ttl) return { ref: cached.ref, json: null }
  }
  try {
    const ref = await publish.reference(ctx)
    return { ref, json: JSON.stringify({ ...ref, readAt: now.toISOString() }) }
  } catch (error) {
    const usable = error instanceof PublishError && error.code !== 'auth'
    if (cached !== null && usable) return { ref: cached.ref, json: null }
    throw error
  }
}

/**
 * Publishes the next 14 days of run sessions of the user's active plan to intervals.icu. One run
 * per user at a time: a call while one is in progress returns `ran: false`. Records one `SyncRun`
 * of channel `publish` when it ran. Never raises the data version.
 */
export async function publishForUser(
  deps: Deps,
  userId: string,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  if (flights.has(userId)) return NOT_RUN
  const flight = runOnce(deps, userId, opts)
  flights.set(userId, flight)
  try {
    return await flight
  } finally {
    if (flights.get(userId) === flight) flights.delete(userId)
  }
}

async function runOnce(deps: Deps, userId: string, opts: PublishOptions): Promise<PublishResult> {
  const { prisma, config } = deps
  const publish = getProvider(PROVIDER).publish
  if (!publish) throw new Error('intervals.icu has no publish channel.')
  const now = opts.now ?? new Date()
  const trigger = opts.trigger ?? 'schedule'

  const [integration, channel] = await Promise.all([
    prisma.integration.findUnique({ where: { userId_provider: { userId, provider: PROVIDER } } }),
    prisma.deliveryChannel.findUnique({ where: { userId_channel: { userId, channel: CHANNEL } } }),
  ])
  if (!integration || !channel?.enabled || integration.status === 'needs_auth') return NOT_RUN
  if (channel.pausedUntil !== null && channel.pausedUntil > now) return NOT_RUN

  const startedAt = new Date()
  let opened: ReturnType<typeof openIntegration>
  try {
    opened = openIntegration(integration, config.sessionSecret)
  } catch (error) {
    if (!(error instanceof SecretError)) throw error
    await prisma.integration.updateMany({
      where: { id: integration.id },
      data: { status: 'needs_auth', lastSyncStatus: 'error', lastError: SECRET_CHANGED },
    })
    await recordSyncRun(deps, {
      userId,
      provider: PROVIDER,
      channel: 'publish',
      trigger,
      startedAt,
      status: 'error',
      message: SECRET_CHANGED,
    })
    return { ...NOT_RUN, ran: true, status: 'error' }
  }
  const secrets = secretValues(opened.secret)
  const ctx = await providerContext(deps, userId, PROVIDER, { ...opened, fetch: opts.fetch })

  const today = todayIso(now)
  const to = addDays(today, PUBLISH_HORIZON_DAYS - 1)
  const tag = userTagOf(userId)
  const tally = { sent: 0, unchanged: 0, withdrawn: 0, failed: 0 }
  const failures: Array<{ ref: string; reason: string }> = []
  /** What ends the run early: a reconnect, a rate limit, or a request that could not be made. */
  let stop: { kind: 'auth' | 'pause' | 'error'; message: unknown; pauseUntil?: Date } | null = null
  let referenceJson: string | null = null
  let unexpected: Error | null = null
  /** A withdrawal left to the next run, because the plan changed while this one read it. */
  let deferred = false

  // Read before the build, so a write that lands during the run makes the next run due.
  const key = await publishChangeKey(deps, userId, today)

  try {
    const deliverables = await buildDeliverables(deps, userId, { from: today, to, today })
    const sends = deliverables.filter((d): d is SendDeliverable => d.action === 'send')
    const context = await loadAthleteContext(deps, { userId, today })
    const sessionByExt = new Map(context.planSessions.map((s) => [s.externalId, s]))

    let ref: PublishReference = { maxHr: null, lthr: null, thresholdPaceMps: null }
    if (sends.length > 0) {
      const read = await referenceFor(channel, publish, ctx, now)
      ref = read.ref
      referenceJson = read.json
    }
    const desired: Desired[] = sends.map((d) => ({
      externalId: d.externalId,
      remoteExternalId: workoutExternalId(d.externalId, tag),
      date: d.date,
      order: d.order,
      kind: d.plan.kind,
      variant: d.plan.eased ? 'eased' : 'planned',
      title: d.plan.title,
      plan: d.plan,
      hash: contentHash({
        date: d.date,
        name: d.plan.title,
        description: renderIntervalsDescription(d.plan, ref).text,
      }),
    }))

    const remote = await publish.list({ from: today, to }, ctx)
    const desiredIds = new Set(desired.map((d) => d.externalId))
    const rows = await prisma.wristPublication.findMany({
      where: {
        userId,
        channel: CHANNEL,
        OR: [{ date: { gte: today } }, { externalId: { in: [...desiredIds] } }],
      },
    })

    const writer = rowWriter(prisma, userId)
    const plan = decide({ desired, rows, remote, sessionByExt, tag, today, to, now, writer })
    // The device messages intervals.icu reports now, for events that are in sync.
    await plan.settle()

    // 5. New or changed content first, so no day is left without a session.
    const upserted = await upsertAll({
      publish,
      ctx,
      ref,
      items: plan.sends,
      writer,
      now,
      tally,
      failures,
    })
    if (upserted.stop !== null) stop = upserted.stop

    // 6. Then what is no longer desired, except on a day whose replacement did not arrive.
    if (stop === null) {
      const blocked = new Set(upserted.blockedDates)
      const ready = plan.withdrawals.filter((row) => !blocked.has(row.date))
      // A withdrawal is the one step that is hard to take back, and it rests on a read of the plan.
      // If a write landed meanwhile, or one is still open (a re-plan or a regenerate), that read may
      // be half of a change: the next run, which is due because the key moved, decides instead.
      const settled =
        ready.length === 0 ||
        (openTransactions(prisma) === 0 && (await publishChangeKey(deps, userId, today)) === key)
      if (!settled) {
        deferred = true
      } else {
        try {
          await withdrawRows({ publish, ctx, rows: ready, tag, writer })
          tally.withdrawn += ready.length
        } catch (error) {
          stop = stopFor(error, now) ?? { kind: 'error', message: error }
          if (!(error instanceof PublishError) && !(error instanceof RateLimitPause)) {
            unexpected = asError(error)
          }
        }
      }
    }

    await prisma.wristPublication.deleteMany({
      where: {
        userId,
        channel: CHANNEL,
        state: { in: ['withdrawn', 'owner-removed'] },
        date: { lt: addDays(today, -PRUNE_DAYS) },
      },
    })
    tally.unchanged += plan.unchanged
  } catch (error) {
    stop = stopFor(error, now) ?? { kind: 'error', message: error }
    if (!(error instanceof PublishError) && !(error instanceof RateLimitPause)) {
      unexpected = asError(error)
    }
  }

  if (stop?.kind === 'auth') {
    await prisma.integration.updateMany({
      where: { id: integration.id },
      data: { status: 'needs_auth', lastError: safeMessage(stop.message, secrets) },
    })
  }

  const finished = stop === null && !deferred
  const pauseUntil =
    stop === null
      ? null
      : stop.kind === 'pause'
        ? (stop.pauseUntil ?? new Date(now.getTime() + RUN_RETRY_MIN * MIN_MS))
        : stop.kind === 'error'
          ? new Date(now.getTime() + RUN_RETRY_MIN * MIN_MS)
          : null
  await prisma.deliveryChannel.updateMany({
    where: { userId, channel: CHANNEL },
    data: {
      lastRunAt: now,
      // An unfinished run leaves the key behind, so the next tick finds the work still due.
      ...(finished ? { dataKey: key } : {}),
      pausedUntil: pauseUntil,
      ...(referenceJson === null ? {} : { referenceJson }),
    },
  })

  const status: SyncStatus =
    stop === null
      ? tally.failed === 0
        ? 'ok'
        : tally.sent + tally.unchanged + tally.withdrawn > 0
          ? 'partial'
          : 'error'
      : stop.kind === 'pause'
        ? 'paused'
        : stop.kind === 'error' && tally.sent + tally.unchanged + tally.withdrawn > 0
          ? 'partial'
          : 'error'
  const idle = status === 'ok' && tally.sent === 0 && tally.withdrawn === 0
  // A run with nothing to say is not stored while the newest stored run was fine: this job wakes
  // every two minutes and would push the runs that did something out of the 200 kept.
  const record = idle ? recordSyncRunUnlessIdle : recordSyncRun
  await record(deps, {
    userId,
    provider: PROVIDER,
    channel: 'publish',
    trigger,
    startedAt,
    status,
    accepted: tally.sent,
    duplicate: idle ? 0 : tally.unchanged,
    failed: tally.failed,
    message: stop === null ? null : stop.message,
    secrets,
    failures,
  })
  if (unexpected !== null) throw unexpected
  return { ran: true, status, ...tally }
}

/** What was thrown, as an `Error` (the message scrubbed of credentials when it was not one). */
function asError(thrown: unknown): Error {
  return thrown instanceof Error ? thrown : new Error(safeMessage(thrown))
}

/** The run-level stop a thrown error means, or null for an error the run does not understand. */
function stopFor(
  error: unknown,
  now: Date,
): { kind: 'auth' | 'pause' | 'error'; message: unknown; pauseUntil?: Date } | null {
  if (error instanceof RateLimitPause) {
    return {
      kind: 'pause',
      message: error.message,
      pauseUntil: new Date(now.getTime() + error.retryAfterSec * 1000),
    }
  }
  if (error instanceof PublishError) {
    return {
      kind: RECONNECT_CODES.has(error.code) ? 'auth' : 'error',
      message: error.message,
    }
  }
  return null
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

interface RowWriter {
  /** Writes the row of a session: its stored columns with `patch` on top. */
  save(
    externalId: string,
    base: WristPublication | undefined,
    desired: Desired | null,
    patch: Partial<RowData>,
  ): Promise<void>
}

function rowWriter(prisma: Deps['prisma'], userId: string): RowWriter {
  return {
    async save(externalId, base, desired, patch) {
      const stored: RowData =
        base === undefined
          ? {
              date: desired?.date ?? '',
              kind: desired?.kind ?? '',
              variant: desired?.variant ?? 'planned',
              title: desired?.title ?? '',
              remoteId: null,
              state: 'pending',
              desiredHash: desired?.hash ?? '',
              sentHash: null,
              failCode: null,
              failMessage: null,
              deviceMessage: null,
              warnings: '[]',
              attempts: 0,
              nextAttemptAt: null,
              sentAt: null,
            }
          : {
              date: base.date,
              kind: base.kind,
              variant: base.variant,
              title: base.title,
              remoteId: base.remoteId,
              state: base.state,
              desiredHash: base.desiredHash,
              sentHash: base.sentHash,
              failCode: base.failCode,
              failMessage: base.failMessage,
              deviceMessage: base.deviceMessage,
              warnings: base.warnings,
              attempts: base.attempts,
              nextAttemptAt: base.nextAttemptAt,
              sentAt: base.sentAt,
            }
      const attributes =
        desired === null
          ? {}
          : {
              date: desired.date,
              kind: desired.kind,
              variant: desired.variant,
              title: desired.title,
              desiredHash: desired.hash,
            }
      const data: RowData = { ...stored, ...attributes, ...patch }
      await prisma.wristPublication.upsert({
        where: { userId_channel_externalId: { userId, channel: CHANNEL, externalId } },
        create: { userId, channel: CHANNEL, externalId, ...data },
        update: data,
      })
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------------------------

interface Plan {
  sends: SendItem[]
  /** Rows whose event is to come off intervals.icu (or be marked so, when it was never sent). */
  withdrawals: WristPublication[]
  /** Sessions already on intervals.icu with the right content. */
  unchanged: number
  /** Stores what the decision learned without sending: removals, device messages. */
  settle(): Promise<void>
}

/**
 * Decides, from what the plan wants, what the app has stored and what intervals.icu holds, which
 * sessions to send and which rows to withdraw. Reads nothing and calls nothing; `settle` stores
 * the facts it found (an event the runner deleted, a changed device message).
 */
function decide(args: {
  desired: Desired[]
  rows: WristPublication[]
  remote: RemoteWorkout[]
  sessionByExt: Map<string, PlanSession>
  tag: string
  today: string
  to: string
  now: Date
  writer: RowWriter
}): Plan {
  const { desired, rows, remote, sessionByExt, tag, today, to, now, writer } = args
  const rowByExt = new Map(rows.map((row) => [row.externalId, row]))
  const remoteById = new Map(remote.map((event) => [event.remoteId, event]))
  const prefix = `rl-${tag}-`
  const remoteByExt = new Map<string, RemoteWorkout>()
  for (const event of remote) {
    if (event.externalId !== null && event.externalId.startsWith(prefix)) {
      remoteByExt.set(event.externalId, event)
    }
  }
  const desiredIds = new Set(desired.map((d) => d.externalId))
  const facts: Array<() => Promise<void>> = []
  const plan: Plan = {
    sends: [],
    withdrawals: [],
    unchanged: 0,
    settle: async () => {
      for (const fact of facts) await fact()
    },
  }
  const inRange = (date: string): boolean => date >= today && date <= to

  for (const d of desired) {
    const row = rowByExt.get(d.externalId)
    // The event this session is on: the one that echoes its id (adoption after a lost row), else the
    // stored one while intervals.icu still lists it.
    const echoed = remoteByExt.get(d.remoteExternalId)
    let remoteId: string | null = null
    let gone = false
    if (echoed !== undefined) {
      remoteId = echoed.remoteId
    } else if (row !== undefined && row.remoteId !== null) {
      if (remoteById.has(row.remoteId)) {
        remoteId = row.remoteId
      } else if (row.state === 'sent' || row.state === 'pending' || row.state === 'failed') {
        // Listed days must show it; a day outside the list is checked by the PUT (a 404).
        if (inRange(row.date)) gone = true
        else remoteId = row.remoteId
      }
    }

    if (gone && row !== undefined) {
      // The runner deleted it. That is respected as of this content: it comes back only when the
      // content changes (a move, a new text).
      facts.push(() =>
        writer.save(d.externalId, row, d, {
          state: 'owner-removed',
          sentHash: d.hash,
          failCode: null,
          failMessage: null,
          nextAttemptAt: null,
          attempts: 0,
        }),
      )
      continue
    }
    if (row?.state === 'owner-removed' && remoteId === null && row.sentHash === d.hash) continue

    if (row !== undefined && row.state === 'sent' && row.sentHash === d.hash && remoteId !== null) {
      plan.unchanged += 1
      const device = remoteById.get(remoteId)?.deviceMessage ?? null
      if (device !== row.deviceMessage || row.remoteId !== remoteId) {
        facts.push(() => writer.save(d.externalId, row, d, { deviceMessage: device, remoteId }))
      }
      continue
    }
    if (
      row !== undefined &&
      remoteId !== null &&
      row.sentHash === d.hash &&
      (row.state === 'owner-removed' || row.state === 'withdrawn')
    ) {
      // The event is on intervals.icu again with the content the app sent last (the runner brought
      // it back, or the connection was dropped without removing it): adopt it.
      plan.unchanged += 1
      facts.push(() =>
        writer.save(d.externalId, row, d, {
          state: 'sent',
          remoteId,
          deviceMessage: remoteById.get(remoteId)?.deviceMessage ?? null,
          failCode: null,
          failMessage: null,
          attempts: 0,
          nextAttemptAt: null,
        }),
      )
      continue
    }

    // A send that did not go through waits for its back-off; one that cannot be retried waits for
    // new content or "Send again", except after a reconnect.
    if (
      row !== undefined &&
      (row.state === 'failed' || row.state === 'pending') &&
      row.desiredHash === d.hash
    ) {
      const retriesAfterReconnect = row.failCode !== null && RECONNECT_CODES.has(row.failCode)
      const waits =
        row.nextAttemptAt !== null
          ? row.nextAttemptAt > now
          : row.state === 'failed' && !retriesAfterReconnect
      if (waits) continue
    }
    plan.sends.push({ desired: d, row, remoteId })
  }
  plan.sends.sort(
    (a, b) => a.desired.date.localeCompare(b.desired.date) || a.desired.order - b.desired.order,
  )

  for (const row of rows) {
    if (desiredIds.has(row.externalId) || row.state === 'owner-removed') continue
    const session = sessionByExt.get(row.externalId)
    // Past days and sessions the runner has done stay as they are: intervals.icu pairs a done
    // session with its planned workout.
    const settled = session?.status === 'completed' || session?.status === 'partial'
    if (settled || row.date < today) continue
    if (row.state === 'withdrawn') {
      // Only an event that is still there (connection dropped without removing it) needs a call.
      if (row.remoteId !== null && remoteById.has(row.remoteId)) plan.withdrawals.push(row)
      continue
    }
    plan.withdrawals.push(row)
  }
  return plan
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

type RunStop = { kind: 'auth' | 'pause' | 'error'; message: unknown; pauseUntil?: Date }

async function upsertAll(args: {
  publish: PublishProvider
  ctx: ProviderCtx
  ref: PublishReference
  items: SendItem[]
  writer: RowWriter
  now: Date
  tally: { sent: number; failed: number }
  failures: Array<{ ref: string; reason: string }>
}): Promise<{ stop: RunStop | null; blockedDates: string[] }> {
  const { publish, ctx, ref, items, writer, now, tally, failures } = args
  if (items.length === 0) return { stop: null, blockedDates: [] }

  const workouts: OutboundWorkout[] = items.map(({ desired, remoteId }) => ({
    externalId: desired.remoteExternalId,
    date: desired.date,
    name: desired.title,
    plan: desired.plan,
    remoteId,
  }))
  let outcomes: UpsertOutcome[] = []
  let pause: RateLimitPause | null = null
  try {
    outcomes = await publish.upsert(workouts, ref, ctx)
  } catch (error) {
    if (error instanceof PublishPause) {
      outcomes = error.outcomes
      pause = error
    } else if (error instanceof RateLimitPause) {
      pause = error
    } else {
      throw error
    }
  }
  const byExternalId = new Map(outcomes.map((outcome) => [outcome.externalId, outcome]))
  const pausedUntil = pause === null ? null : new Date(now.getTime() + pause.retryAfterSec * 1000)
  let stop: RunStop | null = null
  const blockedDates = new Set<string>()

  const fail = async (
    item: SendItem,
    code: PublishFailCode,
    message: string,
    notBefore?: Date,
  ): Promise<void> => {
    const { desired, row } = item
    const attempts = (row !== undefined && row.desiredHash === desired.hash ? row.attempts : 0) + 1
    // The formula of design 6.8; a rate limit waits at least as long as intervals.icu asked.
    const backoff = new Date(now.getTime() + backoffMin(attempts) * MIN_MS)
    const retries = code === 'network' || code === 'rate-limit' || attempts < REJECTED_ATTEMPTS
    const next = RECONNECT_CODES.has(code)
      ? null
      : !retries
        ? null
        : notBefore !== undefined && notBefore > backoff
          ? notBefore
          : backoff
    await writer.save(desired.externalId, row, desired, {
      state: 'failed',
      failCode: code,
      failMessage: capped(message),
      attempts,
      nextAttemptAt: next,
      // A stored id the event no longer has must not outlive a create that is being retried.
      remoteId: item.remoteId,
    })
    tally.failed += 1
    failures.push({ ref: `${desired.date} ${desired.title}`, reason: message })
    blockedDates.add(desired.date)
  }

  for (const item of items) {
    const { desired, row } = item
    const outcome = byExternalId.get(desired.remoteExternalId)
    if (outcome === undefined) {
      // Not reached: the run was cut short by a rate limit.
      if (pause !== null) await fail(item, 'rate-limit', pause.message, pausedUntil ?? undefined)
      else await fail(item, 'network', publishSentence('publish.unreachable'))
      continue
    }
    if (outcome.ok) {
      await writer.save(desired.externalId, row, desired, {
        state: 'sent',
        remoteId: outcome.remoteId,
        sentHash: desired.hash,
        failCode: null,
        failMessage: null,
        deviceMessage: outcome.deviceMessage,
        warnings: JSON.stringify(outcome.warnings),
        attempts: 0,
        nextAttemptAt: null,
        sentAt: now,
      })
      tally.sent += 1
      continue
    }
    if (outcome.code === 'owner-removed') {
      // The PUT found no event: the runner deleted it, and it stays deleted until the content changes.
      await writer.save(desired.externalId, row, desired, {
        state: 'owner-removed',
        sentHash: desired.hash,
        failCode: null,
        failMessage: null,
        attempts: 0,
        nextAttemptAt: null,
      })
      continue
    }
    if (RECONNECT_CODES.has(outcome.code)) {
      stop ??= { kind: 'auth', message: outcome.message }
    }
    await fail(item, outcome.code, outcome.message)
  }
  if (stop === null && pause !== null) {
    stop = { kind: 'pause', message: pause.message, pauseUntil: pausedUntil ?? undefined }
  }
  return { stop, blockedDates: [...blockedDates] }
}

/** Takes the rows' events off intervals.icu (when they were sent) and marks the rows withdrawn. */
async function withdrawRows(args: {
  publish: PublishProvider
  ctx: ProviderCtx
  rows: WristPublication[]
  tag: string
  writer: RowWriter
}): Promise<void> {
  const { publish, ctx, rows, tag, writer } = args
  if (rows.length === 0) return
  const refs = rows.flatMap((row) =>
    row.remoteId === null
      ? []
      : [{ externalId: workoutExternalId(row.externalId, tag), remoteId: row.remoteId }],
  )
  if (refs.length > 0) await publish.withdraw(refs, ctx)
  for (const row of rows) {
    await writer.save(row.externalId, row, null, {
      state: 'withdrawn',
      failCode: null,
      failMessage: null,
      deviceMessage: null,
      attempts: 0,
      nextAttemptAt: null,
    })
  }
}

// ---------------------------------------------------------------------------------------------
// Whether a run is due
// ---------------------------------------------------------------------------------------------

/**
 * Whether the scheduler's tick should run the publisher for a channel: the composed key moved, a
 * retry is due (or a send waits for a reconnect that has happened), or 30 minutes have passed. A
 * channel that is off, paused or waiting for a reconnect is never due.
 */
export async function isPublishDue(
  deps: Deps,
  channel: DeliveryChannel,
  now: Date,
): Promise<boolean> {
  if (!channel.enabled) return false
  if (channel.pausedUntil !== null && channel.pausedUntil > now) return false
  const { prisma } = deps
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId: channel.userId, provider: PROVIDER } },
    select: { status: true },
  })
  if (!integration || integration.status === 'needs_auth') return false
  if (channel.lastRunAt === null) return true
  if (now.getTime() - channel.lastRunAt.getTime() >= PUBLISH_BACKSTOP_MS) return true
  if (channel.dataKey !== (await publishChangeKey(deps, channel.userId, todayIso(now)))) return true
  const waiting = await prisma.wristPublication.count({
    where: {
      userId: channel.userId,
      channel: CHANNEL,
      state: { in: ['pending', 'failed'] },
      OR: [{ nextAttemptAt: { lte: now } }, { failCode: { in: [...RECONNECT_CODES] } }],
    },
  })
  return waiting > 0
}

// ---------------------------------------------------------------------------------------------
// Settings, removal and disconnect
// ---------------------------------------------------------------------------------------------

export async function wristSettings(deps: Deps, userId: string): Promise<WristSettings> {
  const channel = await deps.prisma.deliveryChannel.findUnique({
    where: { userId_channel: { userId, channel: CHANNEL } },
  })
  return {
    enabled: channel?.enabled ?? false,
    garminLinked: channel?.garminLinked ?? false,
    lastRunAt: channel?.lastRunAt?.toISOString() ?? null,
    running: isPublishing(userId),
  }
}

type Requires = 'connect-intervals' | 'reconnect-intervals'

/** The integration row when it is usable, else the 409 that says what to do. */
async function connectedIntegration(deps: Deps, userId: string) {
  const integration = await deps.prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  })
  if (!integration) {
    throw conflict(wristSentence('publish.wrist.connect'), {
      requires: 'connect-intervals' satisfies Requires,
    })
  }
  if (integration.status === 'needs_auth') {
    throw conflict(wristSentence('publish.wrist.reconnect'), {
      requires: 'reconnect-intervals' satisfies Requires,
    })
  }
  return integration
}

/**
 * Takes the events the app sent off intervals.icu: those of today and later with a stored id. The
 * whole request is capped at `REMOVE_TIMEOUT_MS`. Throws what the provider throws (or a timeout).
 */
async function removeSentEvents(
  deps: Deps,
  userId: string,
  opts: { fetch?: typeof fetch; now?: Date; timeoutMs?: number },
): Promise<void> {
  const { prisma, config } = deps
  const today = todayIso(opts.now ?? new Date())
  const rows = await prisma.wristPublication.findMany({
    where: {
      userId,
      channel: CHANNEL,
      state: { in: ['sent', 'pending', 'failed'] },
      remoteId: { not: null },
      date: { gte: today },
    },
  })
  if (rows.length === 0) return
  const integration = await connectedIntegration(deps, userId)
  const publish = getProvider(PROVIDER).publish
  if (!publish) throw new Error('intervals.icu has no publish channel.')
  let opened: ReturnType<typeof openIntegration>
  try {
    opened = openIntegration(integration, config.sessionSecret)
  } catch (error) {
    if (error instanceof SecretError) throw new PublishError('auth', SECRET_CHANGED)
    throw error
  }
  const signal = AbortSignal.timeout(opts.timeoutMs ?? REMOVE_TIMEOUT_MS)
  const base = await providerContext(deps, userId, PROVIDER, { ...opened, fetch: opts.fetch })
  // One signal for the whole request, however many calls it makes.
  const ctx: ProviderCtx = {
    ...base,
    fetch: (input, init) => base.fetch(input, { ...init, signal }),
  }
  const tag = userTagOf(userId)
  await publish.withdraw(
    rows.flatMap((row) =>
      row.remoteId === null
        ? []
        : [{ externalId: workoutExternalId(row.externalId, tag), remoteId: row.remoteId }],
    ),
    ctx,
  )
}

/** Turns the channel off: the rows that were on the calendar become withdrawn, ids kept. */
async function switchOff(deps: Deps, userId: string, garminLinked: boolean | null): Promise<void> {
  const { prisma } = deps
  await prisma.wristPublication.updateMany({
    where: { userId, channel: CHANNEL, state: { in: ['sent', 'pending', 'failed'] } },
    data: { state: 'withdrawn', failCode: null, failMessage: null, nextAttemptAt: null },
  })
  await prisma.deliveryChannel.upsert({
    where: { userId_channel: { userId, channel: CHANNEL } },
    create: { userId, channel: CHANNEL, enabled: false, garminLinked: garminLinked ?? false },
    update: {
      enabled: false,
      ...(garminLinked === null ? {} : { garminLinked }),
      dataKey: null,
      pausedUntil: null,
    },
  })
}

/** The 409 of a removal that did not go through; the cause is logged, scrubbed. */
function removeFailed(deps: Deps, error: unknown): never {
  createLogger(deps.config).warn(
    { reason: safeMessage(error) },
    'removing the sent sessions from intervals.icu failed',
  )
  throw conflict(wristSentence('publish.wrist.remove-failed'), { code: 'remove-failed' })
}

/**
 * `PUT /api/wrist/intervals`. Turning publishing on needs a working connection (409 `requires`) and
 * starts a tracked background run. Turning it off with `removeSent` first takes the sent events off
 * intervals.icu (409 `remove-failed` keeps publishing on); without it the events stay and the rows
 * become withdrawn with their ids kept, so turning it on again adopts them.
 */
export async function setPublishing(
  deps: Deps,
  userId: string,
  input: { enabled: boolean; garminLinked: boolean; removeSent: boolean },
  opts: { fetch?: typeof fetch; now?: Date; timeoutMs?: number } = {},
): Promise<WristSettings> {
  const { prisma } = deps
  const start = await exclusive(userId, async () => {
    const before = await prisma.deliveryChannel.findUnique({
      where: { userId_channel: { userId, channel: CHANNEL } },
    })
    if (input.enabled) {
      await connectedIntegration(deps, userId)
      const wasEnabled = before?.enabled === true
      await prisma.deliveryChannel.upsert({
        where: { userId_channel: { userId, channel: CHANNEL } },
        create: { userId, channel: CHANNEL, enabled: true, garminLinked: input.garminLinked },
        update: {
          enabled: true,
          garminLinked: input.garminLinked,
          ...(wasEnabled ? {} : { dataKey: null, pausedUntil: null }),
        },
      })
      return !wasEnabled
    }
    if (input.removeSent) {
      await connectedIntegration(deps, userId)
      try {
        await removeSentEvents(deps, userId, opts)
      } catch (error) {
        removeFailed(deps, error)
      }
    }
    await switchOff(deps, userId, input.garminLinked)
    return false
  })
  if (start) startBackgroundRun(deps, userId, opts)
  return wristSettings(deps, userId)
}

function startBackgroundRun(
  deps: Deps,
  userId: string,
  opts: { fetch?: typeof fetch; now?: Date },
): void {
  trackBackground(publishForUser(deps, userId, { ...opts, trigger: 'manual' }), (error) =>
    createLogger(deps.config).warn({ reason: safeMessage(error) }, 'publishing failed'),
  )
}

/**
 * `POST /api/wrist/publish`: "Send again". Clears the back-off of one session's publication (or of
 * every waiting one), then starts a tracked background run. A run already in progress is not
 * doubled; the cleared back-offs make the next tick pick them up.
 */
export async function requestPublish(
  deps: Deps,
  userId: string,
  input: { sessionId?: string },
  opts: { fetch?: typeof fetch; now?: Date } = {},
): Promise<WristSettings> {
  const { prisma } = deps
  await connectedIntegration(deps, userId)
  const channel = await prisma.deliveryChannel.findUnique({
    where: { userId_channel: { userId, channel: CHANNEL } },
  })
  if (!channel?.enabled)
    throw conflict(wristSentence('publish.wrist.off'), { requires: 'enable-publishing' })
  let externalId: string | undefined
  if (input.sessionId !== undefined) {
    const session = await prisma.planSession.findFirst({
      where: { id: input.sessionId, plan: { userId, status: 'active' } },
      select: { externalId: true },
    })
    if (!session) throw notFound(wristSentence('publish.wrist.not-found'))
    externalId = session.externalId
  }
  // After the run in progress, whose rows would otherwise write the old back-off over this one.
  await exclusive(userId, () =>
    prisma.wristPublication.updateMany({
      where: {
        userId,
        channel: CHANNEL,
        state: { in: ['pending', 'failed'] },
        ...(externalId === undefined ? {} : { externalId }),
      },
      data: { nextAttemptAt: opts.now ?? new Date(), attempts: 0 },
    }),
  )
  startBackgroundRun(deps, userId, opts)
  return wristSettings(deps, userId)
}

/**
 * Disconnecting intervals.icu (`DELETE /api/integrations/intervals`): with `removeSent`, takes the
 * sent events off first (409 `remove-failed` keeps the integration, because the key is needed to
 * remove them), then turns the channel off and drops the cached reference. Called before the
 * integration row is deleted.
 */
export async function prepareDisconnect(
  deps: Deps,
  userId: string,
  opts: { removeSent: boolean; fetch?: typeof fetch; now?: Date; timeoutMs?: number },
): Promise<void> {
  await exclusive(userId, async () => {
    if (opts.removeSent) {
      const integration = await deps.prisma.integration.findUnique({
        where: { userId_provider: { userId, provider: PROVIDER } },
      })
      if (integration) {
        try {
          await removeSentEvents(deps, userId, opts)
        } catch (error) {
          removeFailed(deps, error)
        }
      }
    }
    // A runner who never turned publishing on has no channel row, and disconnecting makes none.
    const channel = await deps.prisma.deliveryChannel.findUnique({
      where: { userId_channel: { userId, channel: CHANNEL } },
      select: { id: true },
    })
    if (channel === null) return
    await switchOff(deps, userId, false)
    await deps.prisma.deliveryChannel.updateMany({
      where: { userId, channel: CHANNEL },
      data: { referenceJson: null },
    })
  })
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

/** The 400 message of a range the status route refuses, or null when it is fine. */
export function statusRangeIssue(from: string, to: string): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return null
  const span = daysBetween(from, to) + 1
  return span < 1 || span > STATUS_MAX_DAYS ? wristSentence('publish.wrist.range') : null
}

/**
 * `GET /api/wrist/status`: the settings, the calendar link and one item per session in the range,
 * joined by `externalId`. While publishing is on, a run session of the next 14 days that has no
 * publication yet is listed as `not-sent`.
 */
export async function wristStatus(
  deps: Deps,
  userId: string,
  range: { from: string; to: string },
  now: Date = new Date(),
): Promise<WristStatus> {
  const { prisma } = deps
  const today = todayIso(now)
  const [channel, calendar, integration, context] = await Promise.all([
    prisma.deliveryChannel.findUnique({ where: { userId_channel: { userId, channel: CHANNEL } } }),
    prisma.deliveryChannel.findUnique({
      where: { userId_channel: { userId, channel: CALENDAR_CHANNEL } },
      select: { enabled: true, tokenCreatedAt: true },
    }),
    prisma.integration.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
      select: { status: true },
    }),
    loadAthleteContext(deps, { userId, today }),
  ])
  const enabled = channel?.enabled === true
  const garminLinked = channel?.garminLinked === true
  const sessions = context.planSessions.filter(
    (s) => s.date >= range.from && s.date <= range.to && publishable(s.kind),
  )
  const rows = await prisma.wristPublication.findMany({
    where: {
      userId,
      channel: CHANNEL,
      OR: [
        { date: { gte: range.from, lte: range.to } },
        { externalId: { in: sessions.map((s) => s.externalId) } },
      ],
    },
  })
  const sessionByExt = new Map(context.planSessions.map((s) => [s.externalId, s]))
  const items: Array<{ item: WristItem; order: number }> = []
  const seen = new Set<string>()
  for (const row of rows) {
    const session = sessionByExt.get(row.externalId)
    seen.add(row.externalId)
    const date = session?.date ?? row.date
    if (date < range.from || date > range.to) continue
    items.push({
      item: toWristItem(row, {
        sessionId: session?.id ?? null,
        date,
        status: wristItemStatus(row, { garminLinked, now, sessionDate: session?.date ?? null }),
      }),
      order: session?.order ?? 0,
    })
  }
  if (enabled) {
    const last = addDays(today, PUBLISH_HORIZON_DAYS - 1)
    for (const session of sessions) {
      if (seen.has(session.externalId)) continue
      if (session.date < today || session.date > last) continue
      if (!isToRun(session.status)) continue
      items.push({
        item: {
          externalId: session.externalId,
          sessionId: session.id,
          date: session.date,
          kind: session.kind,
          title: '',
          variant: 'planned',
          status: 'not-sent',
          failCode: null,
          failMessage: null,
          deviceMessage: null,
          warnings: [],
          retryAt: null,
          sentAt: null,
        },
        order: session.order,
      })
    }
  }
  items.sort(
    (a, b) =>
      a.item.date.localeCompare(b.item.date) ||
      a.order - b.order ||
      a.item.externalId.localeCompare(b.item.externalId),
  )
  return {
    from: range.from,
    to: range.to,
    connection: integration ? (integration.status as WristStatus['connection']) : 'disconnected',
    settings: {
      enabled,
      garminLinked,
      lastRunAt: channel?.lastRunAt?.toISOString() ?? null,
      running: isPublishing(userId),
    },
    // Whether the calendar link works, and since when; the token is never read back.
    calendar: {
      enabled: calendar?.enabled === true,
      tokenCreatedAt: calendar?.tokenCreatedAt?.toISOString() ?? null,
    },
    items: items.map(({ item }) => item),
  }
}

// ---------------------------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------------------------

// A note about tomorrow's run reads `WristPublication`, which the data version does not cover, so
// the page's tag follows these rows too (see `registerTodayStamp`).
registerHealthNoteProducer(tomorrowNotOnWatch)
registerTodayStamp(async ({ deps, userId }) => {
  const groups = await deps.prisma.wristPublication.groupBy({
    by: ['state'],
    where: { userId, channel: CHANNEL },
    _count: { _all: true },
    _max: { updatedAt: true },
  })
  // The count of each state and the newest write of each: a row that changes state or content
  // moves it, even when two writes share a millisecond. Turning publishing off marks every row
  // withdrawn, so the channel's own switch needs no read here.
  return `wrist:${groups
    .map((g) => `${g.state}=${String(g._count._all)}@${String(g._max.updatedAt?.getTime() ?? 0)}`)
    .sort()
    .join(',')}`
})
