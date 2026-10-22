import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { Deps } from '../app.ts'
import { loadProfile } from '../serialize.ts'
import { markDuplicates } from './duplicates.ts'
import { localDateTime, summarize } from '../../shared/importers/files/index.ts'
import type { ParsedActivity, WellnessInput } from '../../shared/types.ts'

export interface StoreOptions {
  source: string
  importBatchId: string | null
  file?: { name: string; format: 'fit' | 'gpx' | 'tcx'; bytes: Uint8Array }
  channel: 'upload' | 'folder' | 'provider' | 'push'
}

export interface StoreResult {
  outcome: 'imported' | 'updated' | 'duplicate'
  activityId: string
}

const WRITE_TIMEOUT_MS = 60_000

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value)
}

/** Start coordinates are kept to 0.01 degrees (about 1 km). */
function roundCoordinate(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100
}

/**
 * The only writer of imported activities: upserts by `(userId, providerKey)`. The activity, its
 * stream, the original file and the `ImportedFile` row are written in one transaction, then the
 * duplicate pass runs for the row. An update from the same key replaces the provider's fields and
 * the stream, but never the owner's own (`rpe`, `feel`, `pain`, `notes`, `type`, and a subtype
 * already set), nor the import batch, source or file of the first import unless the update
 * carries a file.
 */
export async function storeParsed(
  deps: Deps,
  userId: string,
  parsed: ParsedActivity,
  opts: StoreOptions,
): Promise<StoreResult> {
  const { prisma } = deps
  const { timezone } = await loadProfile(prisma, userId)
  const summary = summarize(parsed)
  const local = localDateTime(parsed.startUtc, parsed.utcOffsetMin, timezone)
  const sha256 = opts.file ? createHash('sha256').update(opts.file.bytes).digest('hex') : null
  const gz = opts.file ? gzipSync(opts.file.bytes) : null

  const { sampleSec, ...streamData } = summary.stream
  const streamRow = {
    sampleSec,
    data: JSON.stringify(streamData),
    laps: parsed.laps.length > 0 ? JSON.stringify(parsed.laps) : null,
  }
  const fields = {
    date: local.date,
    startTime: local.startTime,
    durationSec: Math.round(parsed.elapsedSec),
    distanceM: roundOrNull(parsed.distanceM),
    avgHr: roundOrNull(parsed.avgHr),
    maxHr: roundOrNull(parsed.maxHr),
    elevationGainM: roundOrNull(parsed.elevationGainM),
    elevationLossM: roundOrNull(parsed.elevationLossM),
    startUtc: parsed.startUtc,
    utcOffsetMin: parsed.utcOffsetMin,
    movingSec: roundOrNull(parsed.movingSec ?? summary.movingSec),
    avgCadence: roundOrNull(parsed.avgCadence),
    avgPowerW: roundOrNull(parsed.avgPowerW),
    deviceName: parsed.deviceName,
    hrHistogram: summary.hrHistogram ? JSON.stringify(summary.hrHistogram) : null,
    decouplingPct: summary.decouplingPct,
    gapDistanceM: roundOrNull(summary.gapDistanceM),
  }
  const startLat = roundCoordinate(parsed.startLat)
  const startLng = roundCoordinate(parsed.startLng)

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.activity.findUnique({
        where: { userId_providerKey: { userId, providerKey: parsed.providerKey } },
      })

      // The same bytes seen before for an activity that still exists change nothing. A file that
      // holds several sessions passes this check for each session after the first, because
      // their provider keys differ.
      const seenFile =
        sha256 === null
          ? null
          : await tx.importedFile.findUnique({
              where: { userId_sha256: { userId, sha256 } },
            })
      if (existing && seenFile?.outcome === 'imported') {
        return { outcome: 'duplicate' as const, activityId: existing.id }
      }

      let activityId: string
      let outcome: 'imported' | 'updated'
      if (existing) {
        outcome = 'updated'
        activityId = existing.id
        await tx.activity.update({
          where: { id: existing.id },
          data: {
            ...fields,
            subtype: existing.subtype ?? parsed.subtype,
            startLat: startLat ?? existing.startLat,
            startLng: startLng ?? existing.startLng,
            importBatchId: existing.importBatchId ?? opts.importBatchId,
          },
        })
      } else {
        outcome = 'imported'
        const created = await tx.activity.create({
          data: {
            ...fields,
            userId,
            type: parsed.type,
            subtype: parsed.subtype,
            source: opts.source,
            providerKey: parsed.providerKey,
            importBatchId: opts.importBatchId,
            startLat,
            startLng,
          },
        })
        activityId = created.id
      }

      await tx.activityStream.upsert({
        where: { activityId },
        create: { activityId, ...streamRow },
        update: streamRow,
      })

      if (opts.file && sha256 !== null && gz !== null) {
        const fileRow = {
          format: opts.file.format,
          fileName: opts.file.name,
          sizeBytes: opts.file.bytes.length,
          sha256,
          gz: new Uint8Array(gz),
        }
        await tx.activityFile.upsert({
          where: { activityId },
          create: { activityId, ...fileRow },
          update: fileRow,
        })
        // A multi-session file keeps pointing at its first activity while that one exists.
        const keepsFirst =
          seenFile?.outcome === 'imported' &&
          seenFile.activityId !== null &&
          (await tx.activity.count({ where: { id: seenFile.activityId } })) > 0
        await tx.importedFile.upsert({
          where: { userId_sha256: { userId, sha256 } },
          create: {
            userId,
            sha256,
            fileName: opts.file.name,
            channel: opts.channel,
            outcome: 'imported',
            activityId,
          },
          update: {
            fileName: opts.file.name,
            channel: opts.channel,
            outcome: 'imported',
            ...(keepsFirst ? {} : { activityId }),
          },
        })
      }

      await markDuplicates(tx, userId, [activityId])
      return { outcome, activityId }
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
}

const WELLNESS_FIELDS = [
  'restingHr',
  'hrvRmssd',
  'hrvSdnn',
  'sleepSec',
  'sleepScore',
  'weightKg',
  'vo2max',
] as const

/**
 * Upserts wellness rows by date and returns how many rows were written. A null field never
 * overwrites a stored value. A row the owner entered by hand (`source 'manual'`) only gains the
 * fields it lacks and stays manual; any other row takes the incoming non-null fields and the
 * incoming source. A row with no values at all is skipped.
 */
export async function storeWellness(
  deps: Deps,
  userId: string,
  rows: WellnessInput[],
  source: string,
): Promise<number> {
  const { prisma } = deps
  return prisma.$transaction(
    async (tx) => {
      let written = 0
      for (const row of rows) {
        const incoming = WELLNESS_FIELDS.filter((field) => row[field] !== null)
        if (incoming.length === 0) continue

        const existing = await tx.wellnessDay.findUnique({
          where: { userId_date: { userId, date: row.date } },
        })
        if (!existing) {
          await tx.wellnessDay.create({
            data: {
              userId,
              date: row.date,
              source,
              restingHr: row.restingHr,
              hrvRmssd: row.hrvRmssd,
              hrvSdnn: row.hrvSdnn,
              sleepSec: row.sleepSec,
              sleepScore: row.sleepScore,
              weightKg: row.weightKg,
              vo2max: row.vo2max,
            },
          })
          written += 1
          continue
        }

        const manual = existing.source === 'manual'
        const data: Partial<Record<(typeof WELLNESS_FIELDS)[number], number>> = {}
        for (const field of incoming) {
          if (manual && existing[field] !== null) continue
          data[field] = row[field] as number
        }
        if (Object.keys(data).length === 0) continue
        await tx.wellnessDay.update({
          where: { id: existing.id },
          data: manual ? data : { ...data, source },
        })
        written += 1
      }
      return written
    },
    { timeout: WRITE_TIMEOUT_MS },
  )
}
