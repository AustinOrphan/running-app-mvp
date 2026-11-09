import type { Deps } from '../app.ts'
import { SURFACE_VERSION, wayClassOfCode } from '../../shared/domain/surface.ts'
import {
  buildWayIndex,
  emptySurfaceBins,
  surfaceBinsOf,
  type IndexedWay,
} from '../../shared/domain/surfaceMatch.ts'
import { decodePolyline } from '../../shared/importers/files/track.ts'

/** Runs read and written per user per call: small, so a call is short and a request never queues behind it. */
export const SURFACE_BACKFILL_BATCH = 20

export interface SurfaceBackfillResult {
  /** Runs that now have shares. */
  filled: number
  /** Of those, the ones whose stored track could not be read (they got all-zero shares). */
  unreadable: string[]
  /** Runs inside the area still without shares after this call. */
  remaining: number
}

/**
 * Clears the shares of every run of a user, one row at a time with `updatedAt` held (as the job's own
 * writes do), so the explain cards do not go stale. A row edited in between keeps its shares until the
 * next clear; the job's `fetchedAt` guard covers the rest.
 */
export async function clearSurfaceBins(
  tx: Pick<Deps['prisma'], 'activity'>,
  userId: string,
): Promise<void> {
  const rows = await tx.activity.findMany({
    where: { userId, surfaceBins: { not: null } },
    select: { id: true, updatedAt: true },
  })
  for (const row of rows) {
    await tx.activity.updateMany({
      where: { id: row.id, updatedAt: row.updatedAt },
      data: { surfaceBins: null, updatedAt: row.updatedAt },
    })
  }
}

const RUN_TYPES = ['run', 'race']

/**
 * Computes `Activity.surfaceBins` (M1d) for the newest runs and races of one user that have a stored
 * track meeting the downloaded map area and no shares yet: each track is matched to the nearest way
 * within 25 m. Idempotent and resumable: a run with shares is never selected again, a run outside the
 * area (no track, or a track whose box misses the area) is never selected and stays null, and a batch
 * is one transaction that writes only while the area is the one it was computed against (a download
 * in between leaves the batch for the next call). A track that cannot be read gets all-zero shares so
 * the job does not meet it again, and is reported in `unreadable`. `updatedAt` is held, so the pass
 * does not make the explain cards stale. Reads the database only; never touches the network.
 *
 * When the area was stored under an older matcher version (`MapArea.matchV`), every run's shares are
 * cleared first and the version is recorded, so a change to the matcher recomputes them all.
 */
export async function backfillSurfaceBins(
  deps: Pick<Deps, 'prisma'>,
  userId: string,
  opts: { limit?: number } = {},
): Promise<SurfaceBackfillResult> {
  const { prisma } = deps
  let area = await prisma.mapArea.findUnique({ where: { userId } })
  if (!area) return { filled: 0, unreadable: [], remaining: 0 }

  if (area.matchV !== SURFACE_VERSION) {
    const stale = area
    await prisma.$transaction(async (tx) => {
      const moved = await tx.mapArea.updateMany({
        where: { userId, fetchedAt: stale.fetchedAt, matchV: stale.matchV },
        data: { matchV: SURFACE_VERSION },
      })
      if (moved.count === 0) return
      await clearSurfaceBins(tx, userId)
    })
    area = await prisma.mapArea.findUnique({ where: { userId } })
    if (!area) return { filled: 0, unreadable: [], remaining: 0 }
  }
  const current = area

  const where = {
    userId,
    surfaceBins: null,
    type: { in: RUN_TYPES },
    track: {
      is: {
        minLat: { lte: current.maxLat },
        maxLat: { gte: current.minLat },
        minLng: { lte: current.maxLng },
        maxLng: { gte: current.minLng },
      },
    },
  }
  const rows = await prisma.activity.findMany({
    where,
    select: { id: true, updatedAt: true, track: { select: { polyline: true, distM: true } } },
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    take: opts.limit ?? SURFACE_BACKFILL_BATCH,
  })
  if (rows.length === 0) return { filled: 0, unreadable: [], remaining: 0 }

  const wayRows = await prisma.mapWay.findMany({
    where: { userId },
    select: { cls: true, polyline: true },
  })
  const ways: IndexedWay[] = []
  for (const way of wayRows) {
    const cls = wayClassOfCode(way.cls)
    if (cls !== null) ways.push({ cls, points: decodePolyline(way.polyline) })
  }
  const index = buildWayIndex(ways, {
    minLat: current.minLat,
    minLng: current.minLng,
    maxLat: current.maxLat,
    maxLng: current.maxLng,
  })

  const unreadable: string[] = []
  const bins = rows.map((row) => {
    try {
      const distM: unknown = JSON.parse(row.track!.distM)
      if (!Array.isArray(distM) || distM.some((d) => typeof d !== 'number')) {
        throw new Error('distances')
      }
      return surfaceBinsOf({ polyline: row.track!.polyline, distM: distM as number[] }, index)
    } catch {
      unreadable.push(row.id)
      return emptySurfaceBins()
    }
  })

  const filled = await prisma.$transaction(async (tx) => {
    const now = await tx.mapArea.findUnique({ where: { userId } })
    if (!now || now.fetchedAt.getTime() !== current.fetchedAt.getTime()) return 0
    let count = 0
    for (const [i, row] of rows.entries()) {
      const written = await tx.activity.updateMany({
        where: { id: row.id, surfaceBins: null, updatedAt: row.updatedAt },
        data: { surfaceBins: JSON.stringify(bins[i]), updatedAt: row.updatedAt },
      })
      count += written.count
    }
    return count
  })

  return {
    filled,
    unreadable: filled === 0 ? [] : unreadable,
    remaining: await prisma.activity.count({ where }),
  }
}
