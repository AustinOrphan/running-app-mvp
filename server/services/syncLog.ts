import type { Deps } from '../app.ts'
import type { PrismaClient, SyncRun } from '../db.ts'
import { createLogger } from '../logger.ts'
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

// Order matters: query strings go first so that `?access_token=...` is gone before the key rules.
const QUERY_STRING = /\?\w[\w.%~+-]*=[^\s"'<>#]*/g
const BEARER = /\bBearer\s+[\w.~+/=-]+/gi
const SECRET_PAIR =
  /(["']?\b(?:access_token|refresh_token|id_token|client_secret|api[_-]?key|apikey|password|authorization)\b["']?\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;&"'}]+)/gi
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g

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
 * Text that is safe to store, return and log: bearer tokens, `access_token`, `client_secret` and
 * similar values, JWTs, query strings and every value in `secrets` are replaced, whitespace is
 * collapsed, and the result is cut to `MAX_MESSAGE_CHARS`. Accepts an `Error` or any value.
 */
export function safeMessage(input: unknown, secrets: readonly string[] = []): string {
  let text = textOf(input)
  text = text
    .replace(QUERY_STRING, '')
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

const NEWEST_FIRST = [{ startedAt: 'desc' as const }, { id: 'desc' as const }]

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

/** The latest run of each job, newest first. */
export async function latestJobRuns(prisma: PrismaClient, userId: string): Promise<SyncRunView[]> {
  const rows = await prisma.syncRun.findMany({
    where: { userId, channel: 'job' },
    orderBy: NEWEST_FIRST,
    distinct: ['provider'],
  })
  return rows.map(toSyncRunView)
}
