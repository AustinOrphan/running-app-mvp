import type { Deps } from '../app.ts'
import { computeTerrainBins } from '../../shared/importers/files/terrainBins.ts'
import type { ActivityStreamData } from '../../shared/types.ts'

/** Runs read and written per user per call: small, so a call is short and a request never queues behind it. */
export const TERRAIN_BACKFILL_BATCH = 20

export interface TerrainBackfillResult {
  /** Runs that now have bins. */
  filled: number
  /** Of those, the ones whose stored stream could not be read (they got all-zero bins). */
  unreadable: string[]
  /** Runs with a stream and no bins that this call left for the next one. */
  remaining: number
}

const RUN_TYPES = ['run', 'race']

/**
 * Fills `Activity.terrainBins` from the stored stream for the newest runs and races of one user
 * that have a stream and no bins, with the function the import uses (both read the 10 s stream,
 * so the numbers agree). Idempotent and resumable: a run with bins is never selected again, a run
 * is written only while its column is still null (an import that wins the race is not overwritten),
 * and the batch is one transaction, so an interrupted call leaves no half-filled batch. A stream
 * that cannot be parsed gets all-zero bins, so the job does not meet it again, and is reported in
 * `unreadable`. Reads `ActivityStream`, never the original file, and never touches the network.
 */
export async function backfillTerrainBins(
  deps: Pick<Deps, 'prisma'>,
  userId: string,
  opts: { limit?: number } = {},
): Promise<TerrainBackfillResult> {
  const { prisma } = deps
  const where = {
    userId,
    terrainBins: null,
    type: { in: RUN_TYPES },
    stream: { isNot: null },
  }
  const rows = await prisma.activity.findMany({
    where,
    select: { id: true, stream: { select: { data: true, sampleSec: true } } },
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    take: opts.limit ?? TERRAIN_BACKFILL_BATCH,
  })

  const unreadable: string[] = []
  const writes = rows.map((row) => {
    let bins
    try {
      const data = JSON.parse(row.stream!.data) as ActivityStreamData
      bins = computeTerrainBins(data, row.stream!.sampleSec)
    } catch {
      unreadable.push(row.id)
      bins = computeTerrainBins({ t: [], d: null, hr: null, alt: null, cad: null, pwr: null }, 10)
    }
    return prisma.activity.updateMany({
      where: { id: row.id, terrainBins: null },
      data: { terrainBins: JSON.stringify(bins) },
    })
  })
  const written = writes.length > 0 ? await prisma.$transaction(writes) : []

  return {
    filled: written.reduce((total, result) => total + result.count, 0),
    unreadable,
    remaining: await prisma.activity.count({ where }),
  }
}
