import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate, todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { toScreening } from '../serialize.ts'

const LIST_LIMIT = 50

const screeningBody = z.strictObject({
  date: z.string().refine(isIsoDate, 'Use a real date as YYYY-MM-DD.').optional(),
  answers: z
    .record(
      z.string().min(1).max(100),
      z.union([z.boolean(), z.string().max(500), z.number(), z.null()]),
    )
    .refine((answers) => Object.keys(answers).length <= 100, 'At most 100 answers.'),
})

/** GET and POST /api/screenings: the REDs screen. A flag is a question answered yes (`true`). */
export function screeningsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/', async (req, res) => {
    const rows = await prisma.screening.findMany({
      where: { userId: req.userId, kind: 'reds' },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: LIST_LIMIT,
    })
    res.json(rows.map(toScreening))
  })

  router.post('/', async (req, res) => {
    const body = parse(screeningBody, req.body)
    const flags = Object.values(body.answers).filter((answer) => answer === true).length
    const row = await prisma.screening.create({
      data: {
        userId: req.userId,
        date: body.date ?? todayIso(),
        kind: 'reds',
        answers: JSON.stringify(body.answers),
        flags,
      },
    })
    res.status(201).json(toScreening(row))
  })

  return router
}
