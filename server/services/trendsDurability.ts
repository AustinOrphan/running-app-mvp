import { addDays } from '../../shared/dates.ts'
import {
  durabilityByHour,
  type DurabilityLeftOut,
  type DurabilityRun,
  type TrendsDurabilityView,
} from '../../shared/domain/durabilityByHour.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { ActivityStreamData, HrQuality } from '../../shared/types.ts'
import type { PrismaClient } from '../db.ts'
import { loadRunSeries } from '../serialize.ts'
import { bandRatios } from './trendsCurve.ts'

/** Same span as the page: 104 weeks, to the day. */
const SPAN_DAYS = 104 * 7

function parseJson<T>(text: string | null): T | null {
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * The hour-by-hour read-out of every run or race of `a7.driftInferenceLimitMin` minutes or more in
 * the last 104 weeks (rule T1, DR1): the stored 10 s stream, the stored heart-rate quality summary,
 * the fuel log (a log that was not skipped puts a run in the logged group; no log, or a skipped one,
 * is "none") and the grade ratios of the day (`bandRatios`, rule I13, as the drift panel's). Reads
 * only; nothing is stored. Flagged duplicates are left out, as every statistic does.
 */
export async function loadDurability(
  prisma: PrismaClient,
  userId: string,
  today: string,
): Promise<TrendsDurabilityView> {
  const from = addDays(today, -SPAN_DAYS + 1)
  const rows = await prisma.activity.findMany({
    where: {
      userId,
      type: { in: ['run', 'race'] },
      duplicateStatus: { in: ['none', 'dismissed'] },
      date: { gte: from, lte: today },
      durationSec: { gte: P.a7.driftInferenceLimitMin.value * 60 },
    },
    select: { id: true, date: true, type: true, durationSec: true, hrQuality: true },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  })
  const leftOut: DurabilityLeftOut[] = []
  if (rows.length === 0) return { asOf: today, runs: [], leftOut }

  const ids = rows.map((row) => row.id)
  const [streams, fuelLogs, series] = await Promise.all([
    prisma.activityStream.findMany({
      where: { activityId: { in: ids } },
      select: { activityId: true, sampleSec: true, data: true },
    }),
    prisma.fuelLog.findMany({
      where: { activityId: { in: ids }, skipped: false },
      select: { activityId: true },
    }),
    // The runner's grade curve reads the terrain bins of the runs the drift panel loads.
    loadRunSeries(prisma, userId, { from: addDays(today, -SPAN_DAYS), to: today }),
  ])
  const ratios = bandRatios(series, today)
  const streamOf = new Map(streams.map((row) => [row.activityId, row]))
  const logged = new Set(fuelLogs.map((row) => row.activityId))

  const runs: DurabilityRun[] = []
  for (const row of rows) {
    const stored = streamOf.get(row.id)
    const stream = stored === undefined ? null : parseJson<ActivityStreamData>(stored.data)
    if (stored === undefined || stream === null) {
      leftOut.push({ date: row.date, reason: 'no-stream' })
      continue
    }
    const read = durabilityByHour(
      stream,
      stored.sampleSec,
      parseJson<HrQuality>(row.hrQuality),
      ratios,
    )
    if (read === null) {
      leftOut.push({ date: row.date, reason: 'no-grade' })
      continue
    }
    runs.push({
      activityId: row.id,
      date: row.date,
      type: row.type === 'race' ? 'race' : 'run',
      durationSec: row.durationSec,
      fuel: logged.has(row.id) ? 'logged' : 'none',
      hours: read.hours,
      hrGap: read.hrGap,
    })
  }
  return { asOf: today, runs, leftOut }
}
