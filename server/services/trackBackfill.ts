import { gunzipSync } from 'node:zlib'
import type { Deps } from '../app.ts'
import { SecretError } from '../crypto.ts'
import { getProvider } from '../providers/registry.ts'
import { RateLimitPause } from '../providers/types.ts'
import { loadProfile } from '../serialize.ts'
import { trackRow } from './activityStore.ts'
import { isSyncing, openIntegration, providerContext } from './sync.ts'
import { safeMessage, secretValues } from './syncLog.ts'
import { parseActivityFile } from '../../shared/importers/files/index.ts'
import { TRACK_VERSION, buildTrack, type RoutePoint } from '../../shared/importers/files/track.ts'
import type { ParsedActivity } from '../../shared/types.ts'

/** Stored originals parsed per user per call: local work, no network. */
export const TRACK_FILE_BATCH = 20
/**
 * intervals.icu stream requests per user per call. With the 5-minute tick that is one request a
 * minute, far under the provider's limits, and 76 runs take 16 ticks (80 minutes).
 */
export const TRACK_STREAM_BATCH = 5

const PROVIDER = 'intervals'
const RUN_TYPES = ['run', 'race']

export interface TrackBackfillResult {
  /** Runs that now have a track. */
  filled: number
  /** Runs looked at that have no positions (a treadmill file, an indoor run): marked, no row. */
  withoutPositions: number
  /** Stored originals that could not be read (marked, so the job does not meet them again). */
  unreadable: string[]
  /** intervals.icu requests made. */
  requests: number
  /** Failures that left a run for the next call, as `{ ref, reason }`. */
  failures: Array<{ ref: string; reason: string }>
  /** Set when intervals.icu answered 429 or the integration is paused: the stream part waited. */
  pause: { retryAfterSec: number } | null
  /** Runs still waiting for a look. */
  remaining: number
}

/** A run that may have a track: a run or race, not on a treadmill, not looked at yet. */
function waiting(userId: string) {
  return {
    userId,
    trackV: null,
    type: { in: RUN_TYPES },
    // `not` alone would leave out a null subtype.
    AND: [{ OR: [{ subtype: null }, { subtype: { not: 'treadmill' } }] }],
  }
}

/** The session of a parsed file that belongs to a stored activity. */
function sessionFor(
  parsed: ParsedActivity[],
  activity: { providerKey: string | null; startUtc: string | null },
): ParsedActivity | undefined {
  return (
    parsed.find((p) => p.providerKey === activity.providerKey) ??
    (parsed.length === 1 ? parsed[0] : undefined) ??
    parsed.find((p) => p.startUtc === activity.startUtc)
  )
}

/**
 * Fills `ActivityTrack` for runs imported before it existed, in two parts that share one idempotency
 * mark, `Activity.trackV`: a run whose positions were looked for (a track written, or none to
 * write) is never selected again, and `trackV` is written with `updatedAt` held, so the pass does
 * not make the explain cards stale.
 *
 * 1. Runs with a stored original (`ActivityFile`): the file is parsed again, no network.
 * 2. Pulled intervals.icu runs with no original: one `latlng,distance` stream request each, newest
 *    first, `TRACK_STREAM_BATCH` per call, only while the integration is connected, not paused and
 *    not syncing. A 429 stops the part and sets the integration's `pausedUntil` as the sync does; a
 *    404 means no streams (marked); any other failure ends the part and leaves the run for the next
 *    call.
 *
 * A run is written only while `trackV` is still null (an import that wins the race is not
 * overwritten). It never reads the network except through the provider's `fetchRoute`, with the
 * injected `fetch`.
 */
export async function backfillTracks(
  deps: Deps,
  userId: string,
  opts: { fileLimit?: number; streamLimit?: number; now?: Date } = {},
): Promise<TrackBackfillResult> {
  const { prisma } = deps
  const now = opts.now ?? new Date()
  const result: TrackBackfillResult = {
    filled: 0,
    withoutPositions: 0,
    unreadable: [],
    requests: 0,
    failures: [],
    pause: null,
    remaining: 0,
  }

  /** Marks a run looked at, with or without a track, in one transaction. */
  async function settle(
    activity: { id: string; updatedAt: Date },
    route: ReadonlyArray<RoutePoint> | null | undefined,
  ): Promise<void> {
    const track = route ? buildTrack(route) : null
    const written = await prisma.$transaction(async (tx) => {
      const marked = await tx.activity.updateMany({
        where: { id: activity.id, trackV: null },
        data: { trackV: TRACK_VERSION, updatedAt: activity.updatedAt },
      })
      if (marked.count === 0) return false
      if (track) {
        const row = trackRow(track)
        await tx.activityTrack.upsert({
          where: { activityId: activity.id },
          create: { activityId: activity.id, ...row },
          update: row,
        })
      }
      return track !== null
    })
    if (written) result.filled += 1
    else result.withoutPositions += 1
  }

  // Part 1: stored originals.
  const withFile = await prisma.activity.findMany({
    where: { ...waiting(userId), file: { isNot: null } },
    select: {
      id: true,
      providerKey: true,
      startUtc: true,
      updatedAt: true,
      file: { select: { fileName: true, format: true, gz: true } },
    },
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    take: opts.fileLimit ?? TRACK_FILE_BATCH,
  })
  if (withFile.length > 0) {
    const { timezone } = await loadProfile(prisma, userId)
    for (const row of withFile) {
      let route: ParsedActivity['route'] = null
      try {
        const file = row.file!
        const bytes = new Uint8Array(gunzipSync(file.gz))
        const parsed = parseActivityFile(file.fileName ?? `${row.id}.${file.format}`, bytes, {
          timezone,
        })
        route = sessionFor(parsed, row)?.route ?? null
      } catch {
        result.unreadable.push(row.id)
      }
      await settle(row, route)
    }
  }

  // Part 2: pulled intervals.icu runs with no original.
  const integration = await prisma.integration.findUnique({
    where: { userId_provider: { userId, provider: PROVIDER } },
  })
  const pull = getProvider(PROVIDER).pull
  const streamWhere = {
    ...waiting(userId),
    file: { is: null },
    providerKey: { startsWith: `${PROVIDER}:` },
  }
  if (integration && pull?.fetchRoute && integration.status === 'connected') {
    if (integration.pausedUntil !== null && integration.pausedUntil > now) {
      result.pause = {
        retryAfterSec: Math.ceil((integration.pausedUntil.getTime() - now.getTime()) / 1000),
      }
    } else if (!isSyncing(userId, PROVIDER)) {
      await streamPart(integration)
    }
  }

  async function streamPart(row: NonNullable<typeof integration>): Promise<void> {
    let opened: ReturnType<typeof openIntegration>
    try {
      opened = openIntegration(row, deps.config.sessionSecret)
    } catch (error) {
      if (error instanceof SecretError) return
      throw error
    }
    const secrets = secretValues(opened.secret)
    const ctx = await providerContext(deps, userId, PROVIDER, opened)
    const runs = await prisma.activity.findMany({
      where: streamWhere,
      select: { id: true, providerKey: true, startUtc: true, updatedAt: true },
      orderBy: [{ date: 'desc' }, { id: 'asc' }],
      take: opts.streamLimit ?? TRACK_STREAM_BATCH,
    })
    for (const run of runs) {
      const remoteId = run.providerKey!.slice(PROVIDER.length + 1)
      try {
        result.requests += 1
        const route = await pull!.fetchRoute!(
          { id: remoteId, startUtc: run.startUtc ?? now.toISOString() },
          ctx,
        )
        await settle(run, route)
      } catch (error) {
        if (error instanceof RateLimitPause) {
          const until = new Date(now.getTime() + error.retryAfterSec * 1000)
          await prisma.integration.updateMany({
            where: { id: row.id },
            data: { pausedUntil: until },
          })
          result.pause = { retryAfterSec: error.retryAfterSec }
        } else {
          result.failures.push({
            ref: run.providerKey!,
            reason: safeMessage(error, secrets),
          })
        }
        return
      }
    }
  }

  result.remaining = await prisma.activity.count({
    where: {
      ...waiting(userId),
      OR: [
        { file: { isNot: null } },
        ...(integration && pull?.fetchRoute
          ? [{ file: { is: null }, providerKey: { startsWith: `${PROVIDER}:` } }]
          : []),
      ],
    },
  })
  return result
}
