import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { Deps } from '../app.ts'
import type { Activity as ActivityRow, PrismaClient } from '../db.ts'
import { loadProfile } from '../serialize.ts'
import { createLogger } from '../logger.ts'
import { markDuplicates } from './duplicates.ts'
import { assessSessionById, runExecutionForActivity, runExecutionQuietly } from './execution.ts'
import { assertLinkable, linkPlanSession } from './planEngine.ts'
import { conflict, notFound } from '../errors.ts'
import { render } from '../../shared/copy/template.ts'
import { TEMPLATES } from '../../shared/copy/templates.ts'
import { localDateTime, summarize } from '../../shared/importers/files/index.ts'
import { computeTerrainBins, hasTerrainBins } from '../../shared/importers/files/terrainBins.ts'
import { TRACK_VERSION, buildTrack, hasTrack } from '../../shared/importers/files/track.ts'
import type { Track } from '../../shared/importers/files/track.ts'
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

/** The `ActivityTrack` columns of a built track. */
export function trackRow(track: Track) {
  return {
    v: track.v,
    polyline: track.polyline,
    distM: JSON.stringify(track.distM),
    pointCount: track.pointCount,
    minLat: track.bbox.minLat,
    minLng: track.bbox.minLng,
    maxLat: track.bbox.maxLat,
    maxLng: track.bbox.maxLng,
    toleranceM: track.toleranceM,
  }
}

/** A stored `ActivityTrack` row as a `Track`; null when its distance list is unreadable. */
export function toTrack(row: {
  v: number
  polyline: string
  distM: string
  pointCount: number
  minLat: number
  minLng: number
  maxLat: number
  maxLng: number
  toleranceM: number
}): Track | null {
  let distM: unknown
  try {
    distM = JSON.parse(row.distM)
  } catch {
    return null
  }
  if (!Array.isArray(distM) || distM.some((d) => typeof d !== 'number')) return null
  return {
    v: row.v,
    polyline: row.polyline,
    distM: distM as number[],
    pointCount: row.pointCount,
    bbox: { minLat: row.minLat, minLng: row.minLng, maxLat: row.maxLat, maxLng: row.maxLng },
    toleranceM: row.toleranceM,
  }
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
  // A run with positions keeps its simplified route; a treadmill run or one with none keeps no row,
  // and a re-import without positions leaves a track it already has. `trackV` records that the
  // positions were looked for (a file, or a provider answer that says so), so the backfill skips
  // the run; an import that knows nothing about positions leaves it as it was.
  const looksForTrack = hasTrack(parsed.type, parsed.subtype)
  const track = looksForTrack && parsed.route ? buildTrack(parsed.route) : null
  const lookedForTrack = looksForTrack && (opts.file !== undefined || parsed.route !== undefined)
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
    ...(lookedForTrack ? { trackV: TRACK_VERSION } : {}),
    terrainBins: hasTerrainBins(parsed.type)
      ? JSON.stringify(computeTerrainBins(summary.stream, sampleSec))
      : null,
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

      if (track) {
        const row = trackRow(track)
        await tx.activityTrack.upsert({
          where: { activityId },
          create: { activityId, ...row },
          update: row,
        })
      }

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
export type ManualActivityDb = Pick<
  PrismaClient,
  'activity' | 'strengthLog' | 'strengthSet' | 'planSession'
>

export interface ManualActivityOptions {
  /**
   * Writes that must stand or fall with the activity, in its transaction: a strength log and its
   * sets. The activity is stored only if this resolves.
   */
  within?: (tx: ManualActivityDb, activity: ActivityRow) => Promise<void | 'unlinked'>
  /**
   * The planned session the activity fulfils, set as the owner's choice. Without it the matcher
   * ties the activity to a session as for any other. The caller has checked the pair
   * (`assertLinkable`).
   */
  sessionId?: string
  /** The id the row is stored under, when the client chose it (`saveDoneActivity`). */
  id?: string
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
  const data = {
    ...input,
    ...(opts.id === undefined ? {} : { id: opts.id }),
    userId,
    source: 'manual',
    duplicateStatus: 'none',
  }
  const { within } = opts
  // `within` answers 'unlinked' when the session it was to claim is gone: the run is kept and the
  // matcher ties it, as for a run with no session.
  let unlinked = false
  const created = within
    ? await prisma.$transaction(async (tx) => {
        const row = await tx.activity.create({ data })
        unlinked = (await within(tx, row)) === 'unlinked'
        return row
      })
    : await prisma.activity.create({ data })
  await markDuplicates(prisma, userId, [created.id])
  if (opts.sessionId === undefined || unlinked) {
    await runExecutionQuietly(deps, { userId, activityId: created.id })
  } else {
    await linkPlanSession(deps, { userId, sessionId: opts.sessionId, activityId: created.id })
  }
  return prisma.activity.findFirstOrThrow({ where: { id: created.id, userId } })
}

/** The 409 for a session that already has a run; `details.code` tells it from a kind that no longer fits. */
function alreadyLogged(sessionId: string | undefined) {
  return conflict(render(TEMPLATES['today.done.already-logged'], {}, 'mi'), {
    code: SESSION_LOGGED,
    sessionId,
  })
}

/** `details.code` of the 409 `saveDoneActivity` answers when the session already has a run. */
export const SESSION_LOGGED = 'session-logged'

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

/** What `saveDoneActivity` did: `created` is false for a repeat of an id already stored. */
export interface SavedDoneActivity {
  activity: ActivityRow
  created: boolean
}

/**
 * The idempotent create behind "Done" (ADR 0012, the queued writes): the client chooses the
 * activity's id, so a send that is repeated after a lost answer, or replayed by the outbox, is the
 * same write and stores one activity. A repeat returns the stored row and changes nothing, so it
 * never undoes an edit made since. An id held by another runner is as good as unknown (404).
 *
 * `sessionId` is the session the runner marked done. When that session already has an activity
 * (done on another device, or matched from a sync) the write is refused with 409 and nothing is
 * stored. A session the plan no longer holds is not an error: the run is kept and the matcher ties
 * it to the plan as for any other, so a run logged at a trailhead is never lost to a re-plan.
 */
export async function saveDoneActivity(
  deps: Deps,
  userId: string,
  activityId: string,
  input: ManualActivityInput,
  sessionId?: string,
): Promise<SavedDoneActivity> {
  const { prisma } = deps
  const repeat = async (): Promise<SavedDoneActivity | null> => {
    const existing = await prisma.activity.findUnique({ where: { id: activityId } })
    if (!existing) return null
    if (existing.userId !== userId) throw notFound('Activity not found.')
    // A failure after the claim committed (the assessment) leaves a linked run that was never
    // assessed; the replay does the missing step before it answers.
    const unassessed = await prisma.planSession.findFirst({
      where: { activityId: existing.id, execution: null },
      select: { id: true },
    })
    if (unassessed) await assessSessionById(deps, { userId, sessionId: unassessed.id })
    return { activity: existing, created: false }
  }
  const already = await repeat()
  if (already) return already

  let linkTo: string | undefined
  if (sessionId !== undefined) {
    const session = await prisma.planSession.findFirst({
      where: { id: sessionId, plan: { userId, status: 'active' } },
    })
    if (session) {
      if (session.activityId !== null) {
        throw alreadyLogged(sessionId)
      }
      await assertLinkable(deps, session, {
        id: null,
        type: input.type,
        subtype: input.subtype ?? null,
      })
      linkTo = session.id
    }
  }
  try {
    // The claim of the session is part of the create: two sends for one session (or a sync that
    // matched it first) cannot both pass, and the loser's activity is rolled back with its 409.
    const activity = await createManualActivity(deps, userId, input, {
      id: activityId,
      ...(linkTo === undefined
        ? {}
        : {
            sessionId: linkTo,
            within: async (tx, row) => {
              const { count } = await tx.planSession.updateMany({
                where: { id: linkTo, activityId: null },
                data: { activityId: row.id, linkSource: 'owner' },
              })
              if (count === 0) {
                // Another activity holds the session: refuse. A session a re-plan removed between
                // the check and the claim holds nothing: keep the run unlinked.
                const held = await tx.planSession.findFirst({ where: { id: linkTo } })
                if (held && held.activityId !== null) throw alreadyLogged(sessionId)
                return 'unlinked'
              }
              return undefined
            },
          }),
    })
    return { activity, created: true }
  } catch (error) {
    // Two sends of one id at once: the loser hit the winner's row, and is a repeat.
    if (!isUniqueViolation(error)) throw error
    const winner = await repeat()
    if (winner) return winner
    throw error
  }
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
