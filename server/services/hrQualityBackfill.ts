import { gunzipSync } from 'node:zlib'
import type { Deps } from '../app.ts'
import { fitHrSource } from '../../shared/importers/files/fit.ts'
import { computeHrQuality, HR_QUALITY_THRESHOLDS } from '../../shared/importers/files/hrQuality.ts'
import type { ActivityStreamData, HrSource } from '../../shared/types.ts'

/** Runs read and written per user per call: small, so a call is short and a request never queues behind it. */
export const HR_QUALITY_BACKFILL_BATCH = 20

export interface HrQualityBackfillResult {
  /** Runs that now have a quality summary. */
  filled: number
  /** Of those, the ones whose stored stream could not be read (they got an all-zero summary). */
  unreadable: string[]
  /** Runs with a stream and no summary that this call left for the next one. */
  remaining: number
}

const RUN_TYPES = ['run', 'race']

/** No summary yet, or one computed with other data-preparation thresholds (`HR_QUALITY_THRESHOLDS`). */
const STALE = [
  { hrQuality: null },
  { NOT: { hrQuality: { contains: `"th":"${HR_QUALITY_THRESHOLDS}"` } } },
]

/** The heart-rate source of a stored original; a file that is not FIT, or cannot be read, is unknown. */
function sourceOfFile(file: { format: string; gz: Uint8Array } | null): HrSource {
  if (file === null || file.format !== 'fit') return 'unknown'
  try {
    return fitHrSource(gunzipSync(file.gz))
  } catch {
    return 'unknown'
  }
}

/**
 * Fills `Activity.hrQuality` from the stored stream for the newest runs and races of one user that
 * have a stream and no summary or a stale one (other thresholds), with the function the import uses (both read the 10 s stream, so
 * the numbers agree). The heart-rate source is read from the stored original FIT file when there is
 * one, because the stream does not carry it. Idempotent and resumable: a run with a summary is never
 * selected again, a run is written only while its column is still null (an import that wins the
 * race is not overwritten), and the batch is one transaction. A stream that cannot be parsed gets an
 * all-zero summary, so the job does not meet it again, and is reported in `unreadable`. Never
 * touches the network.
 */
export async function backfillHrQuality(
  deps: Pick<Deps, 'prisma'>,
  userId: string,
  opts: { limit?: number } = {},
): Promise<HrQualityBackfillResult> {
  const { prisma } = deps
  const where = {
    userId,
    OR: STALE,
    type: { in: RUN_TYPES },
    stream: { isNot: null },
  }
  const rows = await prisma.activity.findMany({
    where,
    select: {
      id: true,
      stream: { select: { data: true, sampleSec: true } },
      file: { select: { format: true, gz: true } },
    },
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    take: opts.limit ?? HR_QUALITY_BACKFILL_BATCH,
  })

  const unreadable: string[] = []
  const writes = rows.map((row) => {
    const source = sourceOfFile(row.file)
    let quality
    try {
      const data = JSON.parse(row.stream!.data) as ActivityStreamData
      quality = computeHrQuality(data, row.stream!.sampleSec, source)
    } catch {
      unreadable.push(row.id)
      quality = computeHrQuality(
        { t: [], d: null, hr: null, alt: null, cad: null, pwr: null },
        10,
        source,
      )
    }
    return prisma.activity.updateMany({
      where: { id: row.id, userId, OR: STALE },
      data: { hrQuality: JSON.stringify(quality) },
    })
  })
  const written = writes.length > 0 ? await prisma.$transaction(writes) : []

  return {
    filled: written.reduce((total, result) => total + result.count, 0),
    unreadable,
    remaining: await prisma.activity.count({ where }),
  }
}
