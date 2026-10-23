import type { Deps } from '../app.ts'
import type { PrismaClient, SyncRun } from '../db.ts'
import { createLogger } from '../logger.ts'
import { SYNC_TEMPLATES } from '../../shared/copy/sync.ts'
import {
  render,
  type SlotSpec,
  type SlotValues,
  type Template,
} from '../../shared/copy/template.ts'
import type {
  SyncChannel,
  SyncFailure,
  SyncRunView,
  SyncStatus,
  SyncTrigger,
  WellnessStatus,
} from '../../shared/types.ts'

/**
 * The sync and job log (spec 4.7). `SyncRun` is non-state: nothing the athlete snapshot reads
 * depends on it, so a write here never invalidates a cache.
 */

/** A stored message or failure reason is cut to this many characters. */
export const MAX_MESSAGE_CHARS = 300
/** Rows kept per user and provider (or job); the oldest go first. */
export const MAX_RUNS_KEPT = 200
/** Rows older than this many days are pruned. */
export const RUN_RETENTION_DAYS = 90
/** Failures stored on one run; the count of the rest is in `failed`. */
export const MAX_FAILURES_STORED = 10
/** `GET /api/integrations/:provider/runs` page size: default and ceiling. */
export const RUNS_DEFAULT_LIMIT = 20
export const RUNS_MAX_LIMIT = 100

const DAY_MS = 86_400_000
const REMOVED = '[removed]'
/** A secret value shorter than this is not searched for: it would shred ordinary words. */
const MIN_SECRET_CHARS = 6

// The key rules keep the key and replace the value, so a message still says what was refused.
// Order matters: query strings go first so that `?access_token=...` is gone before the key rules,
// and the header rules go before the pair rule so that `Cookie: token=...` is removed whole.
const QUERY_STRING = /\?\w[\w.%~+-]*=[^\s"'<>#]*/g
/** A quoted string, or a run up to the next separator. */
const VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s,;&"'}]+)`
/** A credential, or the first `name=value` parameter of a list of them (an OAuth 1 header). */
const CREDENTIAL = String.raw`(?:[\w-]+=)?${VALUE}`
/** `Authorization: <scheme> <credential>` for any scheme (Basic, Token, Digest, OAuth, ...). */
const AUTHORIZATION = new RegExp(
  String.raw`(["']?\bauthorization\b["']?\s*[:=]\s*)(?:[A-Za-z][\w-]*\s+)?${CREDENTIAL}(?:\s*,\s*[\w-]+=${VALUE})*`,
  'gi',
)
/** A `Cookie` or `Set-Cookie` value: a quoted string, or the rest of the line. */
const COOKIE = /(["']?\b(?:set-)?cookie\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\r\n]*)/gi
const SECRET_KEY = String.raw`(?:(?:access|refresh|id|oauth)[_-]?token(?:[_-]?secret)?|token|ticket|client[_-]?secret|api[_-]?key|password)`
const SECRET_PAIR = new RegExp(
  String.raw`(["']?\b${SECRET_KEY}\b["']?\s*[:=]\s*)(?:Bearer\s+)?${VALUE}`,
  'gi',
)
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g

/** The sentences the app writes as the message of a run: the `sync.msg.*` templates. */
export type SyncMessageId = Extract<keyof typeof SYNC_TEMPLATES, `sync.msg.${string}`>

/**
 * One of the app's own sentences for a run's message (or an integration's `lastError`), rendered
 * from `shared/copy/sync.ts` so that the G5 lint covers it. Text a provider or the system returned
 * goes in a text slot, verbatim; `recordSyncRun` still scrubs the whole message.
 */
export function syncMessage<K extends SyncMessageId>(
  id: K,
  slots: SlotValues<(typeof SYNC_TEMPLATES)[K]['slots']>,
): string {
  const template: Template = SYNC_TEMPLATES[id]
  // No sync sentence holds a distance or a pace, so the unit system cannot change a word of it.
  return render(template, slots as SlotValues<SlotSpec>, 'km')
}

/** Every string inside a decrypted secret, at any depth; what `safeMessage` must never let out. */
export function secretValues(secret: unknown): string[] {
  const found: string[] = []
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === 'string') {
      if (value.length >= MIN_SECRET_CHARS) found.push(value)
    } else if (depth < 4 && typeof value === 'object' && value !== null) {
      for (const inner of Object.values(value)) visit(inner, depth + 1)
    }
  }
  visit(secret, 0)
  return found
}

/** The words of an error or a value; an object that has none is written as JSON. */
function textOf(input: unknown): string {
  if (typeof input === 'string') return input
  if (input instanceof Error) return input.message
  if (input === null || input === undefined) return ''
  if (typeof input === 'number' || typeof input === 'boolean' || typeof input === 'bigint') {
    return String(input)
  }
  return JSON.stringify(input) ?? ''
}

/**
 * Text that is safe to store, return and log: the credential of an `Authorization` header (any
 * scheme), `Cookie` and `Set-Cookie` values, `token`, `ticket`, `access_token`, `client_secret`
 * and similar pairs, bearer tokens, JWTs, query strings and every value in `secrets` are replaced,
 * whitespace is collapsed, and the result is cut to `MAX_MESSAGE_CHARS`. Accepts an `Error` or
 * any value. Best effort for a form of credential it does not know: a provider must not put a
 * response body or a request header into an error.
 */
export function safeMessage(input: unknown, secrets: readonly string[] = []): string {
  let text = textOf(input)
  text = text
    .replace(QUERY_STRING, '')
    .replace(AUTHORIZATION, `$1${REMOVED}`)
    .replace(COOKIE, `$1${REMOVED}`)
    .replace(SECRET_PAIR, `$1${REMOVED}`)
    .replace(BEARER, `Bearer ${REMOVED}`)
    .replace(JWT, REMOVED)
  for (const secret of secrets) {
    if (secret.length < MIN_SECRET_CHARS) continue
    for (const form of new Set([secret, encodeURIComponent(secret)])) {
      text = text.split(form).join(REMOVED)
    }
  }
  text = text.replace(/\s+/g, ' ').trim()
  return text.length > MAX_MESSAGE_CHARS
    ? `${text.slice(0, MAX_MESSAGE_CHARS - 1).trimEnd()}…`
    : text
}

export interface SyncRunInput {
  userId: string
  /** The provider key; for channel `job`, the job name. */
  provider: string
  channel: SyncChannel
  trigger: SyncTrigger
  startedAt: Date
  finishedAt?: Date
  status: SyncStatus
  accepted?: number
  duplicate?: number
  failed?: number
  wellnessStatus?: WellnessStatus
  wellnessDays?: number | null
  wellnessTotal?: number | null
  /** An error or text; stored through `safeMessage`. */
  message?: unknown
  /** Decrypted secret values of the provider, so `safeMessage` can strip them. */
  secrets?: readonly string[]
  /** All failures; the first `MAX_FAILURES_STORED` are stored, each reason through `safeMessage`. */
  failures?: ReadonlyArray<{ ref: string; reason: unknown }>
  importBatchId?: string | null
}

const NEWEST_FIRST = [{ startedAt: 'desc' as const }, { id: 'desc' as const }]

/** Deletes rows past the retention window and past the newest `MAX_RUNS_KEPT`. */
async function prune(prisma: PrismaClient, userId: string, provider: string): Promise<void> {
  const cutoff = new Date(Date.now() - RUN_RETENTION_DAYS * DAY_MS)
  await prisma.syncRun.deleteMany({ where: { userId, provider, startedAt: { lt: cutoff } } })
  const surplus = await prisma.syncRun.findMany({
    where: { userId, provider },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    skip: MAX_RUNS_KEPT,
    select: { id: true },
  })
  if (surplus.length > 0) {
    await prisma.syncRun.deleteMany({ where: { id: { in: surplus.map((row) => row.id) } } })
  }
}

/**
 * Stores one finished run and prunes the log. Never throws: a log that cannot be written must not
 * turn a finished sync into an error. A skipped run (already running, paused, not due) is not
 * recorded; the caller simply does not call this.
 */
export async function recordSyncRun(
  deps: Pick<Deps, 'prisma' | 'config'>,
  run: SyncRunInput,
): Promise<void> {
  try {
    const secrets = run.secrets ?? []
    const failures: SyncFailure[] = (run.failures ?? [])
      .slice(0, MAX_FAILURES_STORED)
      .map((failure) => ({
        ref: safeMessage(failure.ref, secrets),
        reason: safeMessage(failure.reason, secrets),
      }))
    await deps.prisma.syncRun.create({
      data: {
        userId: run.userId,
        provider: run.provider,
        channel: run.channel,
        trigger: run.trigger,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? new Date(),
        status: run.status,
        accepted: run.accepted ?? 0,
        duplicate: run.duplicate ?? 0,
        failed: run.failed ?? 0,
        wellnessStatus: run.wellnessStatus ?? 'none',
        wellnessDays: run.wellnessDays ?? null,
        wellnessTotal: run.wellnessTotal ?? null,
        message:
          run.message === undefined || run.message === null
            ? null
            : safeMessage(run.message, secrets),
        failures: JSON.stringify(failures),
        importBatchId: run.importBatchId ?? null,
      },
    })
    await prune(deps.prisma, run.userId, run.provider)
  } catch (error) {
    try {
      createLogger(deps.config).warn(
        { reason: safeMessage(error), provider: run.provider },
        'recording a sync run failed',
      )
    } catch {
      // Logging is the last resort; there is nothing left to try.
    }
  }
}

/** A run with nothing to report: it ended ok and stored, skipped, failed and read nothing. */
function isIdle(run: SyncRunInput): boolean {
  return (
    run.status === 'ok' &&
    (run.accepted ?? 0) === 0 &&
    (run.duplicate ?? 0) === 0 &&
    (run.failed ?? 0) === 0 &&
    (run.wellnessStatus ?? 'none') === 'none' &&
    (run.message === undefined || run.message === null) &&
    (run.failures ?? []).length === 0
  )
}

/**
 * `recordSyncRun` for the jobs that wake every few minutes (the folder scan, the weather
 * backfill). A scheduled run with nothing to report is not stored while the newest stored run of
 * the provider ended ok: one idle row per 5 or 10 minutes would replace the `MAX_RUNS_KEPT` rows
 * within a day or two, and a run that failed would be gone before anyone opened the list. A manual run,
 * a run with a count or an error, and the first idle run after one that did not end ok (or the
 * first run ever) are stored, so the newest row shows the recovery.
 */
export async function recordSyncRunUnlessIdle(
  deps: Pick<Deps, 'prisma' | 'config'>,
  run: SyncRunInput,
): Promise<void> {
  if (run.trigger === 'schedule' && isIdle(run)) {
    try {
      const newest = await deps.prisma.syncRun.findFirst({
        where: { userId: run.userId, provider: run.provider },
        orderBy: NEWEST_FIRST,
        select: { status: true },
      })
      if (newest?.status === 'ok') return
    } catch {
      // Without the answer the run is stored; `recordSyncRun` logs it if the log itself is broken.
    }
  }
  await recordSyncRun(deps, run)
}

function parseFailures(text: string): SyncFailure[] {
  try {
    const value: unknown = JSON.parse(text)
    if (!Array.isArray(value)) return []
    return value.flatMap((item: unknown) => {
      if (typeof item !== 'object' || item === null) return []
      const { ref, reason } = item as Record<string, unknown>
      return typeof ref === 'string' && typeof reason === 'string' ? [{ ref, reason }] : []
    })
  } catch {
    return []
  }
}

export function toSyncRunView(row: SyncRun): SyncRunView {
  return {
    id: row.id,
    provider: row.provider,
    channel: row.channel as SyncChannel,
    trigger: row.trigger as SyncTrigger,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt.toISOString(),
    status: row.status as SyncStatus,
    accepted: row.accepted,
    duplicate: row.duplicate,
    failed: row.failed,
    wellnessStatus: row.wellnessStatus as WellnessStatus,
    wellnessDays: row.wellnessDays,
    wellnessTotal: row.wellnessTotal,
    message: row.message,
    failures: parseFailures(row.failures),
    importBatchId: row.importBatchId,
  }
}

/** A provider's runs, newest first; both directions of one provider share the list. */
export async function listSyncRuns(
  prisma: PrismaClient,
  userId: string,
  provider: string,
  limit: number,
): Promise<SyncRunView[]> {
  const rows = await prisma.syncRun.findMany({
    where: { userId, provider, channel: { not: 'job' } },
    orderBy: NEWEST_FIRST,
    take: limit,
  })
  return rows.map(toSyncRunView)
}

/**
 * The latest run of each job, newest first. The database finds each job's newest start time and
 * only those rows are read, however many runs the log holds (`distinct` would read them all and
 * keep one per job in memory).
 */
export async function latestJobRuns(prisma: PrismaClient, userId: string): Promise<SyncRunView[]> {
  const newest = await prisma.syncRun.groupBy({
    by: ['provider'],
    where: { userId, channel: 'job' },
    _max: { startedAt: true },
  })
  const latest = newest.flatMap(({ provider, _max }) =>
    _max.startedAt === null ? [] : [{ provider, startedAt: _max.startedAt }],
  )
  if (latest.length === 0) return []
  const rows = await prisma.syncRun.findMany({
    where: { userId, channel: 'job', OR: latest },
    orderBy: NEWEST_FIRST,
  })
  // Two runs of one job can start in the same millisecond: the one listed first is the latest.
  const seen = new Set<string>()
  const first = rows.filter((row) => {
    if (seen.has(row.provider)) return false
    seen.add(row.provider)
    return true
  })
  return first.map(toSyncRunView)
}
