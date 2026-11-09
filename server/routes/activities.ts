import { gunzipSync } from 'node:zlib'
import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { conflict, notFound, parse, validationError } from '../errors.ts'
import { loadActivities, loadActivityPage, toActivity } from '../serialize.ts'
import { activityCsvHeader, activityCsvLine } from '../services/activitiesCsv.ts'
import { createManualActivity, saveDoneActivity, toTrack } from '../services/activityStore.ts'
import {
  moveConfirmedLogs,
  rematchDuplicates,
  releaseDuplicatesOf,
} from '../services/duplicates.ts'
import { runExecutionQuietly } from '../services/execution.ts'
import { loadGlyphs } from '../services/glyphs.ts'
import { standoutView } from '../services/insight.ts'
import { strengthTypeLockedMessage } from '../../shared/copy/strengthTemplates.ts'
import { isIsoDate, todayIso } from '../../shared/dates.ts'
import {
  ACTIVITY_GLYPH_IDS_MAX,
  ACTIVITY_OFFSET_MAX,
  ACTIVITY_PAGE_DEFAULT,
  ACTIVITY_PAGE_MAX,
  MAX_DISTANCE_M,
  MAX_DURATION_SEC,
  MAX_ELEVATION_GAIN_M,
  MAX_NOTES,
} from '../../shared/limits.ts'
import { MAP_END_TRIM_M, trimTrackEnds } from '../../shared/importers/files/track.ts'
import type {
  ActivityDetail,
  ActivityTrackView,
  ActivityStreamData,
  Lap,
} from '../../shared/types.ts'

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date as YYYY-MM-DD.')
  .refine(isIsoDate, 'Use a real calendar date.')

/** An optional integer field: absent and null both store null. */
function optionalInt(min: number, max: number) {
  return z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((value) => value ?? null)
}

/** Absent leaves the stored value alone; null clears it. */
function optionalKeepInt(min: number, max: number) {
  return z.number().int().min(min).max(max).nullable().optional()
}

/**
 * The sub-types an activity may carry (`Activity.subtype`): the surface of a run and the sport of
 * a cross-training entry. The plan matcher reads it: a hike session is fulfilled only by a `cross`
 * activity of sub-type `hike` or `walk` (`compatible`, `shared/engine/execution.ts`).
 */
const SUBTYPES = [
  'road',
  'trail',
  'track',
  'treadmill',
  'bike',
  'hike',
  'walk',
  'swim',
  'ski',
  'elliptical',
  'other',
] as const

const activitySchema = z.object({
  date: dateSchema,
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time as HH:MM.')
    .nullish()
    .transform((value) => value ?? null),
  type: z.enum(['run', 'race', 'strength', 'cross']),
  /** Absent leaves the stored sub-type alone (an edit from the form never sends one); null clears it. */
  subtype: z.enum(SUBTYPES).nullable().optional(),
  durationSec: z.number().int().min(1).max(MAX_DURATION_SEC),
  distanceM: optionalInt(0, MAX_DISTANCE_M),
  rpe: optionalInt(1, 10),
  avgHr: optionalInt(30, 250),
  maxHr: optionalInt(30, 250),
  elevationGainM: optionalInt(0, MAX_ELEVATION_GAIN_M),
  feel: optionalKeepInt(-2, 2),
  pain: optionalKeepInt(0, 10),
  notes: z
    .string()
    .trim()
    .max(MAX_NOTES)
    .nullish()
    .transform((value) => (value ? value : null)),
})

/** A whole number in a query string: digits only, then range-checked, with `message` on any miss. */
function queryInt(min: number, max: number, message: string) {
  return z
    .string()
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().int().min(min, message).max(max, message))
}

const listSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  type: z.enum(['run', 'race', 'strength', 'cross']).optional(),
  // The runs of one import batch, so the import's result can link to the newest of them.
  importBatchId: z.string().min(1).max(64).optional(),
  limit: queryInt(1, ACTIVITY_PAGE_MAX, `Use a whole number from 1 to ${ACTIVITY_PAGE_MAX}.`)
    .optional()
    .transform((value) => value ?? ACTIVITY_PAGE_DEFAULT),
  offset: queryInt(0, ACTIVITY_OFFSET_MAX, `Use a whole number from 0 to ${ACTIVITY_OFFSET_MAX}.`)
    .optional()
    .transform((value) => value ?? 0),
})

const glyphsSchema = z.object({
  ids: z
    .string()
    .min(1, 'Give the ids to draw, separated by commas.')
    .transform((text) => [...new Set(text.split(',').filter((id) => id !== ''))])
    .pipe(
      z
        .array(z.string().min(1).max(64))
        .max(ACTIVITY_GLYPH_IDS_MAX, `Ask for at most ${ACTIVITY_GLYPH_IDS_MAX} ids at a time.`),
    ),
})

const feedbackSchema = z.strictObject({
  rpe: optionalKeepInt(1, 10),
  feel: optionalKeepInt(-2, 2),
  pain: optionalKeepInt(0, 10),
  /** Absent leaves the mark alone; null clears it (rule I8). */
  heatExposure: z.enum(['overdressed', 'passive']).nullable().optional(),
})

/** The id the client chose for a Done: a UUID, as the outbox's route pattern reads it. */
const doneIdParam = z.object({
  activityId: z.string().regex(/^[\w-]{8,64}$/, 'Use an id of 8 to 64 letters, digits, - or _.'),
})

/** A Done is an activity plus the session it marks done. */
const doneSchema = activitySchema.extend({ sessionId: z.string().min(1).max(64).optional() })

const FILE_TYPES: Record<string, string> = {
  fit: 'application/octet-stream',
  gpx: 'application/gpx+xml',
  tcx: 'application/vnd.garmin.tcx+xml',
}

/** Parses stored JSON text; any failure gives null. */
function parseJsonOrNull<T>(text: string | null): T | null {
  if (text === null) return null
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** A header-safe download name: no quotes, slashes or control characters. */
function attachmentName(stored: string | null, format: string, id: string): string {
  const stem = (stored ?? '')
    .replace(/[^\w. -]/g, '_')
    .trim()
    .slice(0, 100)
  return stem === '' || stem === `.${format}` ? `activity-${id}.${format}` : stem
}

const resolveSchema = z.object({ status: z.enum(['confirmed', 'dismissed']) })

function idParam(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function activitiesRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  async function findOwned(userId: string, id: string) {
    const row = id ? await prisma.activity.findFirst({ where: { id, userId } }) : null
    if (!row) throw notFound('Activity not found.')
    return row
  }

  router.get('/', async (req, res) => {
    const query = parse(listSchema, req.query)
    if (query.from && query.to && query.from > query.to) {
      throw validationError('The start date is after the end date.', [
        { path: 'from', message: 'Use a start date on or before the end date.' },
      ])
    }
    res.json(await loadActivityPage(prisma, req.userId, query))
  })

  // Registered before /:id so "export.csv" is not read as an id.
  router.get('/export.csv', async (req, res) => {
    const rows = (await loadActivities(prisma, req.userId)).reverse()
    const lines = [activityCsvHeader(), ...rows.map(activityCsvLine)]
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="activities-${todayIso()}.csv"`)
      .send(`${lines.join('\r\n')}\r\n`)
  })

  // Registered before /:id. The route glyphs of one page of rows in a single read; see `loadGlyphs`.
  router.get('/glyphs', async (req, res) => {
    const { ids } = parse(glyphsSchema, req.query)
    res.json(await loadGlyphs(prisma, req.userId, ids))
  })

  router.post('/', async (req, res) => {
    const body = parse(activitySchema, req.body)
    res.status(201).json(toActivity(await createManualActivity(deps, req.userId, body)))
  })

  // Registered before /:id. `PUT` of a client-chosen id is the idempotent create the outbox queues
  // (ADR 0012): a repeat of the id answers 200 with the stored activity and writes nothing.
  router.put('/done/:activityId', async (req, res) => {
    const { activityId } = parse(doneIdParam, req.params)
    const { sessionId, ...body } = parse(doneSchema, req.body)
    const saved = await saveDoneActivity(deps, req.userId, activityId, body, sessionId)
    res.status(saved.created ? 201 : 200).json(toActivity(saved.activity))
  })

  router.get('/:id', async (req, res) => {
    res.json(toActivity(await findOwned(req.userId, idParam(req.params.id))))
  })

  router.get('/:id/detail', async (req, res) => {
    const row = await findOwned(req.userId, idParam(req.params.id))
    const [stream, file] = await Promise.all([
      prisma.activityStream.findUnique({ where: { activityId: row.id } }),
      prisma.activityFile.findUnique({
        where: { activityId: row.id },
        select: { activityId: true },
      }),
    ])
    const data = stream ? parseJsonOrNull<ActivityStreamData>(stream.data) : null
    const detail: ActivityDetail = {
      activity: toActivity(row),
      stream: stream && data ? { ...data, sampleSec: stream.sampleSec } : null,
      laps: stream ? parseJsonOrNull<Lap[]>(stream.laps) : null,
      hasFile: file !== null,
    }
    res.json(detail)
  })

  // The simplified route of a run for its map. 404 when the run has none (a treadmill run, no
  // positions, not backfilled yet) or when hiding its ends leaves nothing. With `hideMapEnds` on
  // (the default) the first and last 200 m are cut here, so a stored whole track never leaves the
  // server and a screenshot of a map never shows the start.
  router.get('/:id/track', async (req, res) => {
    const row = await findOwned(req.userId, idParam(req.params.id))
    const [stored, account] = await Promise.all([
      prisma.activityTrack.findUnique({ where: { activityId: row.id } }),
      prisma.user.findUnique({ where: { id: req.userId }, select: { hideMapEnds: true } }),
    ])
    const whole = stored ? toTrack(stored) : null
    if (!whole) throw notFound('This activity has no track.')
    const hide = account?.hideMapEnds !== false
    const track = hide ? trimTrackEnds(whole, MAP_END_TRIM_M) : whole
    if (!track) throw notFound('This activity has no track.')
    const view: ActivityTrackView = {
      activityId: row.id,
      v: track.v,
      polyline: track.polyline,
      distM: track.distM,
      pointCount: track.pointCount,
      bbox: track.bbox,
      endsHiddenM: hide ? MAP_END_TRIM_M : 0,
    }
    res.json(view)
  })

  // What stood out on a run: at most three facts, computed on the first read and stored, then
  // computed again after a rating, an edit or a change of version. None for strength and cross.
  router.get('/:id/standout', async (req, res) => {
    res.json(await standoutView(deps, { userId: req.userId, activityId: idParam(req.params.id) }))
  })

  router.get('/:id/file', async (req, res) => {
    const row = await findOwned(req.userId, idParam(req.params.id))
    const file = await prisma.activityFile.findUnique({ where: { activityId: row.id } })
    if (!file) throw notFound('This activity has no original file.')
    const bytes = gunzipSync(file.gz)
    res
      .status(200)
      .type(FILE_TYPES[file.format] ?? 'application/octet-stream')
      .set(
        'Content-Disposition',
        `attachment; filename="${attachmentName(file.fileName, file.format, row.id)}"`,
      )
      .send(bytes)
  })

  // PATCH and PUT are the same write: a rating stores the keys it names and nothing else, so a
  // repeat changes nothing. The outbox queues the PUT.
  const saveFeedback: RequestHandler = async (req, res) => {
    const id = idParam(req.params.id)
    await findOwned(req.userId, id)
    const body = parse(feedbackSchema, req.body)
    await prisma.activity.update({ where: { id }, data: body })
    // A new rating changes the assessment of the session this activity fulfils.
    await runExecutionQuietly(deps, { userId: req.userId, activityId: id })
    res.json(toActivity(await findOwned(req.userId, id)))
  }
  router.patch('/:id/feedback', saveFeedback)
  router.put('/:id/feedback', saveFeedback)

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const existing = await findOwned(req.userId, id)
    const body = parse(activitySchema, req.body)

    // The sets of a strength log are tied to a strength activity (design 9.4): the type stays
    // while a log exists, and the log has to go first.
    if (existing.type === 'strength' && body.type !== 'strength') {
      const log = await prisma.strengthLog.findUnique({
        where: { activityId: id },
        select: { id: true },
      })
      if (log) throw conflict(strengthTypeLockedMessage(), { logId: log.id })
    }

    // A strength session has no distance, so its duration is what the duplicate pass compares.
    const matchChanged =
      body.date !== existing.date ||
      body.distanceM !== existing.distanceM ||
      body.type !== existing.type ||
      (body.type === 'strength' && body.durationSec !== existing.durationSec)
    await prisma.activity.update({
      where: { id },
      data: {
        ...body,
        ...(matchChanged ? { duplicateStatus: 'none', duplicateOfId: null } : {}),
      },
    })
    if (matchChanged) await rematchDuplicates(prisma, req.userId, id)
    // A new date, type or sub-type may no longer fit the session this activity fulfils.
    const subtypeChanged = body.subtype !== undefined && body.subtype !== existing.subtype
    const reconsider =
      body.date !== existing.date
        ? 'date'
        : body.type !== existing.type || subtypeChanged
          ? 'type'
          : undefined
    await runExecutionQuietly(deps, { userId: req.userId, activityId: id, reconsider })
    res.json(toActivity(await findOwned(req.userId, id)))
  })

  router.delete('/:id', async (req, res) => {
    const id = idParam(req.params.id)
    await findOwned(req.userId, id)
    await releaseDuplicatesOf(prisma, req.userId, id)
    await prisma.activity.delete({ where: { id } })
    res.status(204).end()
  })

  router.post('/:id/duplicate', async (req, res) => {
    const id = idParam(req.params.id)
    const existing = await findOwned(req.userId, id)
    const { status } = parse(resolveSchema, req.body)
    if (existing.duplicateStatus === 'none' || existing.duplicateOfId === null) {
      throw conflict('This activity is not flagged as a possible duplicate.')
    }
    const updated = await prisma.activity.update({
      where: { id },
      data: { duplicateStatus: status },
    })
    if (status === 'confirmed') {
      await moveConfirmedLogs(prisma, req.userId, existing.duplicateOfId)
    }
    res.json(toActivity(updated))
  })

  return router
}
