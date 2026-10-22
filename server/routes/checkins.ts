import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate } from '../../shared/dates.ts'
import type { Checkin } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import type { WellnessDay as WellnessRow } from '../db.ts'
import { parse } from '../errors.ts'
import { toCheckin } from '../serialize.ts'

const isoDate = z.string().refine(isIsoDate, 'Use a real date written YYYY-MM-DD.')

/** 1-5 with 3 as normal [rules J2]. */
const score = z.number().int().min(1).max(5).nullable()

// Absent keys leave the stored value alone; null clears it.
const checkinSchema = z.strictObject({
  fatigue: score.optional(),
  soreness: score.optional(),
  sleepQuality: score.optional(),
  mood: score.optional(),
  stress: score.optional(),
  illness: z.boolean().optional(),
  painScore: z.number().int().min(0).max(10).nullable().optional(),
  painArea: z
    .string()
    .trim()
    .max(100)
    .transform((text) => (text === '' ? null : text))
    .nullable()
    .optional(),
  painFocalBone: z.boolean().optional(),
})

function checkinOf(row: WellnessRow): Checkin {
  return {
    date: row.date,
    fatigue: row.fatigue,
    soreness: row.soreness,
    sleepQuality: row.sleepQuality,
    mood: row.mood,
    stress: row.stress,
    illness: row.illness,
    painScore: row.painScore,
    painArea: row.painArea,
    painFocalBone: row.painFocalBone,
  }
}

/** GET and PUT /api/checkins/:date: the check-in fields of a WellnessDay. */
export function checkinsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  /** Whether the newest check-in before `date` reports focal bone pain. */
  async function boneReportedBefore(userId: string, date: string): Promise<boolean> {
    const rows = await prisma.wellnessDay.findMany({
      where: { userId, date: { lt: date } },
      orderBy: { date: 'desc' },
      take: 120,
    })
    const newest = rows.find((row) => toCheckin(row) !== null)
    return newest?.painFocalBone === true
  }

  router.get('/:date', async (req, res) => {
    const date = parse(isoDate, req.params.date)
    const row = await prisma.wellnessDay.findUnique({
      where: { userId_date: { userId: req.userId, date } },
    })
    res.json(row ? toCheckin(row) : null)
  })

  router.put('/:date', async (req, res) => {
    const date = parse(isoDate, req.params.date)
    const body = parse(checkinSchema, req.body)
    const existing = await prisma.wellnessDay.findUnique({
      where: { userId_date: { userId: req.userId, date } },
    })
    // Bone tenderness stays reported until the runner clears it [rules n-1]: a first check-in for
    // the day that does not mention it inherits the newest earlier report, so a stored false
    // always comes from the runner's own action.
    const fields =
      body.painFocalBone === undefined && (existing === null || toCheckin(existing) === null)
        ? { ...body, painFocalBone: await boneReportedBefore(req.userId, date) }
        : body
    // A row created here is the owner's own; one a provider created keeps its source.
    const row = await prisma.wellnessDay.upsert({
      where: { userId_date: { userId: req.userId, date } },
      create: { userId: req.userId, date, source: 'manual', ...fields },
      update: fields,
    })
    res.json(checkinOf(row))
  })

  return router
}
