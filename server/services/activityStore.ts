import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { Deps } from '../app.ts'
import type { Activity as ActivityRow, PrismaClient } from '../db.ts'
import { loadProfile } from '../serialize.ts'
import { createLogger } from '../logger.ts'
import { markDuplicates } from './duplicates.ts'
import { runExecutionForActivity, runExecutionQuietly } from './execution.ts'
import { linkPlanSession } from './planEngine.ts'
import { localDateTime, summarize } from '../../shared/importers/files/index.ts'
import type { ActivityType, ParsedActivity, WellnessInput } from '../../shared/types.ts'

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

  const stored = await prisma.$transaction(
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

  // A stored activity may fulfil a planned session. The activity is already saved, so a failure
  // here is logged and never fails the import; the nightly sweep tries again.
  if (stored.outcome !== 'duplicate') {
    try {
      await runExecutionForActivity(deps, { userId, activityId: stored.activityId })
    } catch (error) {
      createLogger(deps.config).warn(
        { err: error },
        'matching a stored activity to the plan failed',
      )
    }
  }
  return stored
}

/**
 * The fields of an activity the runner enters by hand, as `POST /api/activities` validates them
 * (`activitySchema`). A field the form does not send is left out or null.
 */
export interface ManualActivityInput {
  date: string
  startTime: string | null
  type: ActivityType
  subtype?: string | null | undefined
  durationSec: number
  distanceM: number | null
  rpe: number | null
  avgHr: number | null
  maxHr: number | null
  elevationGainM: number | null
  feel?: number | null | undefined
  pain?: number | null | undefined
  notes: string | null
}

/** The tables a write beside a manual activity may use inside its transaction. */
export type ManualActivityDb = Pick<PrismaClient, 'activity' | 'strengthLog' | 'strengthSet'>

export interface ManualActivityOptions {
  /**
   * Writes that must stand or fall with the activity, in its transaction: a strength log and its
   * sets. The activity is stored only if this resolves.
   */
  within?: (tx: ManualActivityDb, activity: ActivityRow) => Promise<void>
  /**
   * The planned session the activity fulfils, set as the owner's choice. Without it the matcher
   * ties the activity to a session as for any other. The caller has checked the pair
   * (`assertLinkable`).
   */
  sessionId?: string
}

/**
 * The only writer of an activity the runner enters by hand (source `manual`): `POST
 * /api/activities` and the first save of a strength log. It stores the row, flags a possible
 * duplicate, then ties the activity to the plan: to `sessionId` when given, else by the matcher
 * (which never fails the request, because the activity is saved by then). Returns the row as it
 * stands after both.
 */
export async function createManualActivity(
  deps: Deps,
  userId: string,
  input: ManualActivityInput,
  opts: ManualActivityOptions = {},
): Promise<ActivityRow> {
  const { prisma } = deps
  const data = { ...input, userId, source: 'manual', duplicateStatus: 'none' }
  const { within } = opts
  const created = within
    ? await prisma.$transaction(async (tx) => {
        const row = await tx.activity.create({ data })
        await within(tx, row)
        return row
      })
    : await prisma.activity.create({ data })
  await markDuplicates(prisma, userId, [created.id])
  if (opts.sessionId === undefined) {
    await runExecutionQuietly(deps, { userId, activityId: created.id })
  } else {
    await linkPlanSession(deps, { userId, sessionId: opts.sessionId, activityId: created.id })
  }
  return prisma.activity.findFirstOrThrow({ where: { id: created.id, userId } })
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

/** Wellness columns stored as integers; providers may report fractions (e.g. averaged HR). */
const WELLNESS_INT_FIELDS = new Set<string>(['restingHr', 'sleepSec', 'sleepScore'])

function wellnessValue(field: (typeof WELLNESS_FIELDS)[number], value: number): number {
  return WELLNESS_INT_FIELDS.has(field) ? Math.round(value) : value
}

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
              ...Object.fromEntries(
                incoming.map((field) => [field, wellnessValue(field, row[field] as number)]),
              ),
            },
          })
          written += 1
          continue
        }

        const manual = existing.source === 'manual'
        const data: Partial<Record<(typeof WELLNESS_FIELDS)[number], number>> = {}
        for (const field of incoming) {
          if (manual && existing[field] !== null) continue
          data[field] = wellnessValue(field, row[field] as number)
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

/**
 * Marks a stored run as a race, which is what linking it to a race result does (phase 3a design
 * 11.4), and returns whether the type changed. The type is the owner's field, so a later import of
 * the same activity leaves it alone (`storeParsed`). A run and a race both count as runs for
 * duplicates, session matching and totals, so no duplicate pass follows. An activity of another
 * user, of another type or one that is a race already changes nothing.
 */
export async function markActivityAsRace(
  db: Pick<PrismaClient, 'activity'>,
  userId: string,
  activityId: string,
): Promise<boolean> {
  const { count } = await db.activity.updateMany({
    where: { id: activityId, userId, type: 'run' },
    data: { type: 'race' },
  })
  return count > 0
}
