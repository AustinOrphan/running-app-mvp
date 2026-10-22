import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { toWellnessDay } from '../serialize.ts'
import { isIsoDate } from '../../shared/dates.ts'

const isoDate = z.string().refine(isIsoDate, 'Use a real date written YYYY-MM-DD.')

const rangeSchema = z.object({ from: isoDate.optional(), to: isoDate.optional() })

const nullableNumber = (min: number, max: number) => z.number().min(min).max(max).nullable()
const nullableInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable()

// Absent keys leave the stored value alone; null clears it.
const daySchema = z.strictObject({
  restingHr: nullableInt(25, 110).optional(),
  hrvRmssd: nullableNumber(0, 500).optional(),
  hrvSdnn: nullableNumber(0, 500).optional(),
  sleepSec: nullableInt(0, 86_400).optional(),
  sleepScore: nullableInt(0, 100).optional(),
  weightKg: nullableNumber(30, 250).optional(),
  vo2max: nullableNumber(10, 100).optional(),
  notes: z
    .string()
    .trim()
    .max(1000)
    .transform((text) => (text === '' ? null : text))
    .nullable()
    .optional(),
})

/** Without a range the newest rows are returned, so an old account cannot answer with years. */
const UNBOUNDED_LIMIT = 1000

export function wellnessRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/', async (req, res) => {
    const { from, to } = parse(rangeSchema, req.query)
    const rows = await prisma.wellnessDay.findMany({
      where: {
        userId: req.userId,
        ...(from || to
          ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
      orderBy: { date: 'desc' },
      take: UNBOUNDED_LIMIT,
    })
    res.json(rows.reverse().map(toWellnessDay))
  })

  router.put('/:date', async (req, res) => {
    const date = parse(isoDate, req.params.date)
    const body = parse(daySchema, req.body)
    const data = { ...body, source: 'manual' }
    const row = await prisma.wellnessDay.upsert({
      where: { userId_date: { userId: req.userId, date } },
      create: { userId: req.userId, date, ...data },
      update: data,
    })
    res.json(toWellnessDay(row))
  })

  return router
}
