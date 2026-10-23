import type { Integration } from '../db.ts'
import type { Deps } from '../app.ts'
import { decryptSecret, encryptSecret, SecretError } from '../crypto.ts'
import { HttpError, conflict, notFound, validationError } from '../errors.ts'
import { getProvider } from '../providers/registry.ts'
import { RateLimitPause, WellnessTruncated, type ProviderCtx } from '../providers/types.ts'
import { toImportBatch, loadProfile } from '../serialize.ts'
import { storeParsed, storeWellness } from './activityStore.ts'
import {
  MAX_FAILURES_STORED,
  recordSyncRun,
  safeMessage,
  secretValues,
  syncMessage,
} from './syncLog.ts'
import { localDateTime, parseActivityFile } from '../../shared/importers/files/index.ts'
import type {
  ImportBatch,
  ImportReportRow,
  SyncFailure,
  SyncTrigger,
  WellnessStatus,
} from '../../shared/types.ts'

const DAY_MS = 86_400_000
/** First run without a start date reaches this far back. */
const DEFAULT_BACKFILL_DAYS = 365
/**
 * A run lists from the cursor minus this overlap, because a watch can upload an older workout
 * after a newer one. Activities already stored are skipped before any download.
 */
const CURSOR_OVERLAP_DAYS = 3
/** Wellness is re-read for this many days before the last successful run. */
const WELLNESS_OVERLAP_DAYS = 7
/** A run stops after this many activities in a row fail, so a dead credential fails fast. */
const MAX_CONSECUTIVE_FAILURES = 5
const MAX_REPORT_ROWS = 100

export const SECRET_CHANGED = syncMessage('sync.msg.secret-changed', {})

/** One run per user and provider at a time. */
const running = new Set<string>()
/** Background runs started by the route, so tests (and shutdown) can wait for them. */
const background = new Set<Promise<unknown>>()

/** Tracks a background run; the returned promise never rejects. */
export function trackBackground(run: Promise<unknown>, onError: (error: unknown) => void): void {
  const tracked = run.catch(onError).finally(() => background.delete(tracked))
  background.add(tracked)
}

/** Resolves when every background run started so far has finished. */
export async function settleBackground(): Promise<void> {
  while (background.size > 0) await Promise.all([...background])
}

export function isSyncing(userId: string, provider: string): boolean {
  return running.has(`${userId}:${provider}`)
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** The decrypted secret and parsed config of a row. Throws `SecretError` after a key change. */
export function openIntegration(
  row: Pick<Integration, 'secret' | 'config'>,
  sessionSecret: string,
): { secret: Record<string, unknown>; config: Record<string, unknown> } {
  return {
    secret: parseObject(decryptSecret(row.secret, sessionSecret)),
    config: parseObject(row.config),
  }
}

export function sealSecret(secret: object, sessionSecret: string): string {
  return encryptSecret(JSON.stringify(secret), sessionSecret)
}

/** The context a provider call needs; `saveSecret` writes a refreshed secret back, encrypted. */
export async function providerContext(
  deps: Deps,
  userId: string,
  provider: string,
  opts: {
    secret: Record<string, unknown>
    config: Record<string, unknown>
    fetch?: typeof fetch
  },
): Promise<ProviderCtx> {
  const { timezone } = await loadProfile(deps.prisma, userId)
  const fetchFn = opts.fetch ?? deps.fetch ?? ((input, init) => fetch(input, init))
  return {
    fetch: fetchFn,
    timezone,
    secret: opts.secret,
    config: opts.config,
    userId,
    async saveSecret(next) {
      await deps.prisma.integration.updateMany({
        where: { userId, provider },
        data: { secret: sealSecret(next, deps.config.sessionSecret) },
      })
    },
    parseFile: (name, bytes) => parseActivityFile(name, bytes, { timezone }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A failure the owner can only fix by connecting again. */
function needsReconnect(error: unknown): boolean {
  if (error instanceof HttpError && error.status === 401) return true
  return /reconnect/i.test(message(error))
}

function isoZ(ms: number): string {
  return new Date(ms).toISOString()
}

function validMs(text: string | null | undefined): number | null {
  if (!text) return null
  const ms = Date.parse(text)
  return Number.isNaN(ms) ? null : ms
}

/** Where a pull run starts: an explicit start wins, then the cursor, then one year back. */
function sinceFor(row: Integration, from: string | undefined, now: Date): string {
  if (from) return from
  const cursorMs = validMs(row.cursor)
  if (cursorMs !== null) return isoZ(cursorMs - CURSOR_OVERLAP_DAYS * DAY_MS)
  return isoZ(now.getTime() - DEFAULT_BACKFILL_DAYS * DAY_MS)
}

/** What a pull run did about wellness, as the sync log stores it. */
interface WellnessOutcome {
  status: WellnessStatus
  days: number | null
  total: number | null
}

const WELLNESS_NONE: WellnessOutcome = { status: 'none', days: null, total: null }

/**
 * Pulls new activities and wellness from one provider and advances its cursor. Runs one at a time
 * per user and provider: a second call while one is running returns null and records nothing.
 * Returns the run's `ImportBatch`, or null when nothing new was stored, the provider was already
 * syncing, or the stored secret could not be decrypted (the integration is then marked
 * `needs_auth`). Every run that starts writes one `SyncRun`, idle runs included.
 *
 * The cursor never moves past an activity that failed, so the next run tries it again. A
 * `RateLimitPause` keeps the cursor it carries, sets `lastSyncStatus 'paused'` and `pausedUntil`.
 * Wellness that stopped early (`WellnessTruncated`) stores the days it read and pauses the same
 * way, never reporting `ok`.
 */
export async function syncProvider(
  deps: Deps,
  userId: string,
  provider: string,
  opts: {
    from?: string
    fetch?: typeof fetch
    trigger?: Extract<SyncTrigger, 'schedule' | 'manual'>
  } = {},
): Promise<ImportBatch | null> {
  const { prisma, config } = deps
  const registered = getProvider(provider)
  const pull = registered.pull
  if (!pull) throw validationError(`${registered.info.label} does not sync by itself.`)

  const row = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider } },
  })
  if (!row) throw notFound(`${registered.info.label} is not connected.`)
  if (row.status === 'needs_auth') {
    throw conflict(`Reconnect ${registered.info.label} before syncing.`)
  }

  const lock = `${userId}:${provider}`
  if (running.has(lock)) return null
  running.add(lock)
  const trigger = opts.trigger ?? 'schedule'
  const startedAt = new Date()
  let secrets: string[] = []
  try {
    let opened: ReturnType<typeof openIntegration>
    try {
      opened = openIntegration(row, config.sessionSecret)
    } catch (error) {
      if (!(error instanceof SecretError)) throw error
      await prisma.integration.update({
        where: { id: row.id },
        data: { status: 'needs_auth', lastSyncStatus: 'error', lastError: SECRET_CHANGED },
      })
      await recordSyncRun(deps, {
        userId,
        provider,
        channel: 'pull',
        trigger,
        startedAt,
        status: 'error',
        message: SECRET_CHANGED,
      })
      return null
    }
    secrets = secretValues(opened.secret)
    return await run(deps, userId, provider, row, opened, { ...opts, trigger })
  } catch (error) {
    // `run` records its own outcome last, so only a throw before that point reaches here.
    await recordSyncRun(deps, {
      userId,
      provider,
      channel: 'pull',
      trigger,
      startedAt,
      status: 'error',
      message: error,
      secrets,
    })
    throw error
  } finally {
    running.delete(lock)
  }
}

async function run(
  deps: Deps,
  userId: string,
  provider: string,
  row: Integration,
  opened: { secret: Record<string, unknown>; config: Record<string, unknown> },
  opts: { from?: string; fetch?: typeof fetch; trigger: SyncTrigger },
): Promise<ImportBatch | null> {
  const { prisma } = deps
  const pull = getProvider(provider).pull
  if (!pull) return null
  const ctx = await providerContext(deps, userId, provider, { ...opened, fetch: opts.fetch })
  const startedAt = ctx.now()
  const since = sinceFor(row, opts.from, startedAt)
  const previousCursor = validMs(row.cursor)
  const secrets = secretValues(opened.secret)
  /** Text that is stored, returned or logged never carries a token or a secret value. */
  const safe = (value: unknown): string => safeMessage(value, secrets)

  let batchId: string | null = null
  const counts = { accepted: 0, skippedDuplicate: 0, skippedInvalid: 0 }
  const report: ImportReportRow[] = []
  const failureLog: SyncFailure[] = []
  let newestMs: number | null = null
  let failureMs: number | null = null
  let failures = 0
  let consecutive = 0
  let pause: RateLimitPause | null = null
  let fatal: unknown = null

  /** The run's batch is created at the first activity that is stored or fails, never for an idle run. */
  async function ensureBatch(): Promise<string> {
    if (batchId === null) {
      const created = await prisma.importBatch.create({
        data: {
          userId,
          source: provider,
          fileName: null,
          rowCount: 0,
          accepted: 0,
          skippedDuplicate: 0,
          skippedInvalid: 0,
          errors: '[]',
        },
      })
      batchId = created.id
    }
    return batchId
  }

  function reached(ms: number | null): void {
    if (ms !== null && (newestMs === null || ms > newestMs)) newestMs = ms
  }

  try {
    for await (const ref of pull.listActivities(since, ctx)) {
      const refMs = validMs(ref.startUtc)
      // Provider keys are `<provider>:<remote id>`; a stored activity needs no second download.
      const known = await prisma.activity.findUnique({
        where: { userId_providerKey: { userId, providerKey: `${provider}:${ref.id}` } },
        select: { id: true },
      })
      if (known) {
        reached(refMs)
        continue
      }
      try {
        const fetched = await pull.fetchActivity(ref, ctx)
        // Nothing to import (the remote activity has no data); it is not retried.
        if (!fetched) {
          reached(refMs)
          continue
        }
        const importBatchId = await ensureBatch()
        const stored = await storeParsed(deps, userId, fetched.parsed, {
          source: provider,
          importBatchId,
          channel: 'provider',
          ...(fetched.file ? { file: fetched.file } : {}),
        })
        if (stored.outcome === 'duplicate') counts.skippedDuplicate += 1
        else counts.accepted += 1
        consecutive = 0
        reached(refMs)
      } catch (error) {
        if (error instanceof RateLimitPause) throw error
        await ensureBatch()
        failures += 1
        consecutive += 1
        counts.skippedInvalid += 1
        if (refMs !== null && (failureMs === null || refMs < failureMs)) failureMs = refMs
        const reason = safe(message(error))
        if (report.length < MAX_REPORT_ROWS) {
          report.push({ line: null, reason: `${provider}:${ref.id}: ${reason}` })
        }
        if (failureLog.length < MAX_FAILURES_STORED) {
          failureLog.push({ ref: `${provider}:${ref.id}`, reason })
        }
        if (consecutive >= MAX_CONSECUTIVE_FAILURES) throw error
      }
    }
  } catch (error) {
    if (error instanceof RateLimitPause) pause = error
    else fatal = error
  }

  let wellnessError: unknown = null
  let wellness = WELLNESS_NONE
  if (fatal === null && pause === null) {
    try {
      wellness = await pullWellness(deps, userId, provider, row, ctx, opts.from, startedAt)
    } catch (error) {
      if (error instanceof WellnessTruncated) {
        pause = error
        wellness = { status: 'truncated', days: error.daysRead, total: error.daysTotal }
      } else if (error instanceof RateLimitPause) {
        pause = error
        wellness = { status: 'error', days: null, total: null }
      } else {
        wellnessError = error
        wellness = { status: 'error', days: null, total: null }
      }
    }
  } else if (fatal === null && getProvider(provider).pull?.listWellness) {
    // The activity pass paused first: wellness was not attempted and follows on a later run.
    wellness = { status: 'waiting', days: null, total: null }
  }

  // The cursor holds at the oldest failure so that activity is listed again next run.
  let cursorMs: number | null =
    pause?.cursor !== undefined
      ? validMs(pause.cursor)
      : newestMs === null
        ? previousCursor
        : Math.max(newestMs, previousCursor ?? newestMs)
  if (cursorMs === null) cursorMs = previousCursor
  if (failureMs !== null && (cursorMs === null || cursorMs > failureMs - 1000)) {
    cursorMs = failureMs - 1000
  }

  const failedHard = fatal !== null
  const lastError =
    fatal !== null
      ? safe(message(fatal))
      : pause instanceof WellnessTruncated
        ? `Wellness stopped after ${pause.daysRead} of ${pause.daysTotal} days: ${safe(pause.message)}`
        : pause !== null
          ? safe(pause.message)
          : wellnessError !== null
            ? `Wellness could not be read: ${safe(message(wellnessError))}`
            : failures > 0
              ? `${failures} ${failures === 1 ? 'activity' : 'activities'} could not be imported; see the import report.`
              : null
  const lastSyncStatus = failedHard
    ? 'error'
    : pause !== null
      ? 'paused'
      : wellnessError !== null || failures > 0
        ? 'partial'
        : 'ok'

  // `updateMany` so that a disconnect during the run does not turn into an error.
  await prisma.integration.updateMany({
    where: { id: row.id },
    data: {
      status: failedHard ? (needsReconnect(fatal) ? 'needs_auth' : 'error') : 'connected',
      cursor: cursorMs === null ? null : isoZ(cursorMs),
      lastSyncAt: startedAt,
      lastSyncStatus,
      lastError,
      pausedUntil: pause ? new Date(startedAt.getTime() + pause.retryAfterSec * 1000) : null,
    },
  })

  let batch: ImportBatch | null = null
  if (batchId !== null) {
    const updated = await prisma.importBatch.update({
      where: { id: batchId },
      data: {
        ...counts,
        rowCount: counts.accepted + counts.skippedDuplicate + counts.skippedInvalid,
        errors: JSON.stringify(report),
      },
    })
    batch = toImportBatch(updated)
  }

  // Last, so that a throw above is recorded once by `syncProvider` and never twice.
  await recordSyncRun(deps, {
    userId,
    provider,
    channel: 'pull',
    trigger: opts.trigger,
    startedAt,
    finishedAt: ctx.now(),
    status: lastSyncStatus,
    accepted: counts.accepted,
    duplicate: counts.skippedDuplicate,
    failed: counts.skippedInvalid,
    wellnessStatus: wellness.status,
    wellnessDays: wellness.days,
    wellnessTotal: wellness.total,
    message:
      fatal !== null
        ? fatal
        : pause !== null
          ? pause.message
          : wellnessError !== null
            ? wellnessError
            : null,
    secrets,
    failures: failureLog,
    importBatchId: batchId,
  })
  return batch
}

async function pullWellness(
  deps: Deps,
  userId: string,
  provider: string,
  row: Integration,
  ctx: ProviderCtx,
  from: string | undefined,
  now: Date,
): Promise<WellnessOutcome> {
  const pull = getProvider(provider).pull
  if (!pull?.listWellness) return WELLNESS_NONE
  const { timezone } = ctx
  const dayOf = (ms: number): string => localDateTime(isoZ(ms), null, timezone).date
  // Only a run that read wellness successfully lets the next one start late.
  const current =
    row.lastSyncAt !== null &&
    (row.lastSyncStatus === 'ok' || row.lastSyncStatus === 'partial') &&
    !row.lastError?.startsWith('Wellness')
  const start = from
    ? from.slice(0, 10)
    : current && row.lastSyncAt
      ? dayOf(row.lastSyncAt.getTime() - WELLNESS_OVERLAP_DAYS * DAY_MS)
      : dayOf(now.getTime() - DEFAULT_BACKFILL_DAYS * DAY_MS)
  const end = dayOf(now.getTime())
  if (start > end) return WELLNESS_NONE
  try {
    const rows = await pull.listWellness(start, end, ctx)
    await storeWellness(deps, userId, rows, provider)
    return { status: 'read', days: rows.length, total: null }
  } catch (error) {
    // A truncated read still hands back the days it got; they are stored before the run pauses.
    if (error instanceof WellnessTruncated) await storeWellness(deps, userId, error.rows, provider)
    throw error
  }
}
