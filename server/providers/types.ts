import type { RowError } from '../../shared/importers/csv.ts'
import type {
  ParsedActivity,
  ProviderInfo,
  UploadedFile,
  WellnessInput,
} from '../../shared/types.ts'

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

/**
 * `listWellness` stopped before the whole window was read (a spent request budget). It carries the
 * days it did read, oldest first, so the sync can store them, and how many of the window's days
 * were read. A provider never returns a short list as if it were complete.
 */
export class WellnessTruncated extends RateLimitPause {
  rows: WellnessInput[]
  daysRead: number
  daysTotal: number

  constructor(
    message: string,
    opts: {
      retryAfterSec: number
      rows: WellnessInput[]
      daysRead: number
      daysTotal: number
    },
  ) {
    super(message, { retryAfterSec: opts.retryAfterSec })
    this.name = 'WellnessTruncated'
    this.rows = opts.rows
    this.daysRead = opts.daysRead
    this.daysTotal = opts.daysTotal
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
  /**
   * Daily wellness for `from` to `to`, oldest first. Throws `WellnessTruncated` (with the days it
   * read) instead of returning less than the window.
   */
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
