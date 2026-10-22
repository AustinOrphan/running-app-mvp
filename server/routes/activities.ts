import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { conflict, notFound, parse, validationError } from '../errors.ts'
import { loadActivities, toActivity } from '../serialize.ts'
import { markDuplicates, releaseDuplicates, releaseDuplicatesOf } from '../services/duplicates.ts'
import { findPossibleDuplicate } from '../../shared/domain/duplicates.ts'
import { isIsoDate, todayIso } from '../../shared/dates.ts'
import { mToMiles } from '../../shared/units.ts'

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

const activitySchema = z.object({
  date: dateSchema,
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time as HH:MM.')
    .nullish()
    .transform((value) => value ?? null),
  type: z.enum(['run', 'race', 'strength', 'cross']),
  durationSec: z.number().int().min(1).max(172_800),
  distanceM: optionalInt(0, 1_000_000),
  rpe: optionalInt(1, 10),
  avgHr: optionalInt(30, 250),
  maxHr: optionalInt(30, 250),
  elevationGainM: optionalInt(0, 9000),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullish()
    .transform((value) => (value ? value : null)),
})

const listSchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  type: z.enum(['run', 'race', 'strength', 'cross']).optional(),
})

const resolveSchema = z.object({ status: z.enum(['confirmed', 'dismissed']) })

const EXPORT_HEADER = [
  'date',
  'start_time',
  'type',
  'minutes',
  'miles',
  'avg_hr',
  'max_hr',
  'elevation_gain_m',
  'rpe',
  'notes',
  'source',
  'duplicate_status',
]

/** One text cell: quoted when needed (RFC 4180) and defused when a spreadsheet would run it. */
function textCell(value: string | null): string {
  if (value === null || value === '') return ''
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

function numberCell(value: number | null, digits?: number): string {
  if (value === null) return ''
  return digits === undefined ? String(value) : value.toFixed(digits)
}

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

  /**
   * Confirmed rows pointing at an edited original stay confirmed while the pair still matches;
   * the others go back to `none` so their totals recover. Returns the released ids.
   */
  async function releaseStaleConfirmed(userId: string, originalId: string): Promise<string[]> {
    const original = toActivity(await findOwned(userId, originalId))
    const confirmed = await prisma.activity.findMany({
      where: { userId, duplicateOfId: originalId, duplicateStatus: 'confirmed' },
    })
    const stale = confirmed
      .filter((row) => findPossibleDuplicate(toActivity(row), [original]) === null)
      .map((row) => row.id)
    if (stale.length === 0) return []
    await prisma.activity.updateMany({
      where: { id: { in: stale } },
      data: { duplicateStatus: 'none', duplicateOfId: null },
    })
    return stale
  }

  router.get('/', async (req, res) => {
    const query = parse(listSchema, req.query)
    if (query.from && query.to && query.from > query.to) {
      throw validationError('The start date is after the end date.', [
        { path: 'from', message: 'Use a start date on or before the end date.' },
      ])
    }
    res.json(await loadActivities(prisma, req.userId, query))
  })

  // Registered before /:id so "export.csv" is not read as an id.
  router.get('/export.csv', async (req, res) => {
    const rows = (await loadActivities(prisma, req.userId)).reverse()
    const lines = [EXPORT_HEADER.join(',')]
    for (const a of rows) {
      lines.push(
        [
          a.date,
          a.startTime ?? '',
          a.type,
          numberCell(a.durationSec / 60, 2),
          numberCell(a.distanceM === null ? null : mToMiles(a.distanceM), 4),
          numberCell(a.avgHr),
          numberCell(a.maxHr),
          numberCell(a.elevationGainM),
          numberCell(a.rpe),
          textCell(a.notes),
          a.source,
          a.duplicateStatus,
        ].join(','),
      )
    }
    res
      .status(200)
      .type('text/csv; charset=utf-8')
      .set('Content-Disposition', `attachment; filename="activities-${todayIso()}.csv"`)
      .send(`${lines.join('\r\n')}\r\n`)
  })

  router.post('/', async (req, res) => {
    const body = parse(activitySchema, req.body)
    const created = await prisma.activity.create({
      data: { ...body, userId: req.userId, source: 'manual', duplicateStatus: 'none' },
    })
    await markDuplicates(prisma, req.userId, [created.id])
    res.status(201).json(toActivity(await findOwned(req.userId, created.id)))
  })

  router.get('/:id', async (req, res) => {
    res.json(toActivity(await findOwned(req.userId, idParam(req.params.id))))
  })

  router.put('/:id', async (req, res) => {
    const id = idParam(req.params.id)
    const existing = await findOwned(req.userId, id)
    const body = parse(activitySchema, req.body)

    const matchChanged =
      body.date !== existing.date ||
      body.distanceM !== existing.distanceM ||
      body.type !== existing.type
    await prisma.activity.update({
      where: { id },
      data: {
        ...body,
        ...(matchChanged ? { duplicateStatus: 'none', duplicateOfId: null } : {}),
      },
    })
    if (matchChanged) {
      const released = await releaseDuplicates(prisma, req.userId, id, ['possible'])
      released.push(...(await releaseStaleConfirmed(req.userId, id)))
      await markDuplicates(prisma, req.userId, [id, ...released])
    }
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
    res.json(toActivity(updated))
  })

  return router
}
