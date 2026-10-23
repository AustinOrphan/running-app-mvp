import type { RowError } from '../../shared/importers/csv.ts'
import type {
  ParsedActivity,
  ProviderInfo,
  UploadedFile,
  WellnessInput,
} from '../../shared/types.ts'
import type { WorkoutPlan } from '../../shared/workouts/types.ts'

export type { ProviderInfo }

export type FileFormat = 'fit' | 'gpx' | 'tcx'

/** What a provider needs for one call; every network client uses the injected `fetch`. */
export interface ProviderCtx {
  fetch: typeof fetch
  /** The profile timezone (IANA). */
  timezone: string
  /** Decrypted secrets; `{}` before the first connect. */
  secret: Record<string, unknown>
  /** The integration's non-secret config. */
  config: Record<string, unknown>
  /** Persists a refreshed secret (encrypted by the caller). */
  saveSecret(next: Record<string, unknown>): Promise<void>
  /** Parses an activity file; providers call this, never the parser module directly. */
  parseFile(name: string, bytes: Uint8Array): ParsedActivity[]
  sleep(ms: number): Promise<void>
  now(): Date
  userId: string
}

export interface RemoteActivityRef {
  id: string
  startUtc: string
}

/** A pull run that stopped early. The sync service saves `cursor` and pauses the provider. */
export class RateLimitPause extends Error {
  cursor?: string
  retryAfterSec: number

  constructor(message: string, opts: { retryAfterSec: number; cursor?: string }) {
    super(message)
    this.name = 'RateLimitPause'
    this.retryAfterSec = opts.retryAfterSec
    if (opts.cursor !== undefined) this.cursor = opts.cursor
  }
}

/** The server fetches on a schedule. */
export interface PullProvider {
  connect(input: unknown, ctx: ProviderCtx): Promise<{ config: object; secret: object }>
  listActivities(since: string, ctx: ProviderCtx): AsyncIterable<RemoteActivityRef>
  fetchActivity(
    ref: RemoteActivityRef,
    ctx: ProviderCtx,
  ): Promise<{
    parsed: ParsedActivity
    file?: { name: string; format: FileFormat; bytes: Uint8Array }
  } | null>
  listWellness?(from: string, to: string, ctx: ProviderCtx): Promise<WellnessInput[]>
}

/** The source posts to /api/ingest/<key> with a bearer token. */
export interface PushProvider {
  parsePush(
    body: unknown,
    ctx: ProviderCtx,
  ): {
    activities: ParsedActivity[]
    wellness: WellnessInput[]
    ignored?: Record<string, number>
  }
}

/** The browser uploads an export the user downloaded. */
export interface UploadProvider {
  parseUpload(
    files: UploadedFile[],
    ctx: ProviderCtx,
  ): Promise<{
    activities: ParsedActivity[]
    wellness: WellnessInput[]
    skipped: RowError[]
  }>
}

/** What the remote knows about the runner's own limits, which a target is written against. */
export interface PublishReference {
  maxHr: number | null
  lthr: number | null
  /** Running threshold pace in metres per second. */
  thresholdPaceMps: number | null
}

/** One session as the remote should hold it. */
export interface OutboundWorkout {
  /** `workoutExternalId(externalId, userTag)`: the only id a published workout carries. */
  externalId: string
  /** YYYY-MM-DD, the runner's local day. */
  date: string
  /** The allowlisted public title (`publicTitle`). */
  name: string
  plan: WorkoutPlan
  /** The remote event id from an earlier send; null for a workout the remote has never been sent. */
  remoteId: string | null
}

/**
 * Why a workout did not reach the remote. `owner-removed` is a PUT answered 404: the runner deleted
 * the event, so the app leaves it alone until the content changes. `no-threshold` is reserved for
 * the service; the intervals.icu module sends a session without a threshold pace and warns instead.
 */
export type PublishFailCode =
  | 'auth'
  | 'rate-limit'
  | 'no-threshold'
  | 'rejected'
  | 'network'
  | 'device'
  | 'not-connected'
  | 'owner-removed'

export type UpsertOutcome =
  | {
      externalId: string
      ok: true
      remoteId: string
      /** Codes for the service to word: `unparsed-steps`, `no-max-hr`, `no-threshold-pace`. */
      warnings: string[]
      /** What the remote reports about the watch upload (sanitised, at most 200 characters). */
      deviceMessage: string | null
    }
  | { externalId: string; ok: false; code: PublishFailCode; message: string }

/** An event the remote holds in the asked range. */
export interface RemoteWorkout {
  remoteId: string
  /** The `external_id` the event carries; null for an event the runner made. */
  externalId: string | null
  date: string
  name: string
  deviceMessage: string | null
}

/** The app writes planned workouts into the runner's account (ADR 0008). Never touches the database. */
export interface PublishProvider {
  /** @throws PublishError, or RateLimitPause on a 429 */
  reference(ctx: ProviderCtx): Promise<PublishReference>
  /**
   * One outcome per workout, in the order given. A 429 throws `PublishPause`, which carries the
   * outcomes of the workouts handled before it, so a created event's id is never lost.
   */
  upsert(
    workouts: OutboundWorkout[],
    ref: PublishReference,
    ctx: ProviderCtx,
  ): Promise<UpsertOutcome[]>
  /** @throws PublishError, or RateLimitPause on a 429 */
  withdraw(
    refs: Array<{ externalId: string; remoteId: string | null }>,
    ctx: ProviderCtx,
  ): Promise<void>
  /** @throws PublishError, or RateLimitPause on a 429 */
  list(range: { from: string; to: string }, ctx: ProviderCtx): Promise<RemoteWorkout[]>
}

/** A publish call that failed; `message` is safe to store and show (no secret, at most 200 characters). */
export class PublishError extends Error {
  code: PublishFailCode

  constructor(code: PublishFailCode, message: string) {
    super(message)
    this.name = 'PublishError'
    this.code = code
  }
}

/** A 429 during `upsert`: the pause, and the outcomes of everything handled before it. */
export class PublishPause extends RateLimitPause {
  outcomes: UpsertOutcome[]

  constructor(message: string, opts: { retryAfterSec: number; outcomes: UpsertOutcome[] }) {
    super(message, { retryAfterSec: opts.retryAfterSec })
    this.name = 'PublishPause'
    this.outcomes = opts.outcomes
  }
}
