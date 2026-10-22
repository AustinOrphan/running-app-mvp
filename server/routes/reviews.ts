import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate, mondayOf, todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { listReviews, saveReview } from '../services/reviews.ts'
import { parseWeekRange } from './weeks.ts'

const weekParam = z.object({
  weekStart: z
    .string()
    .refine((value) => isIsoDate(value) && mondayOf(value) === value, 'Use a Monday, YYYY-MM-DD.'),
})

const reviewBody = z.strictObject({
  dataStatus: z.enum(['unconfirmed', 'complete', 'missing']).optional(),
  fatigue: z.number().int().min(1).max(10).nullable().optional(),
  symptoms: z.enum(['none', 'mild', 'persistent']).nullable().optional(),
  recoveryConstrained: z.boolean().optional(),
  finalDecision: z.string().trim().min(1).max(40).nullable().optional(),
  finalNextMin: z.number().int().min(0).max(100_000).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
})

export function reviewsRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const weekStarts = parseWeekRange(req.query)
    res.json(await listReviews(deps, req.userId, weekStarts, todayIso()))
  })

  router.put('/:weekStart', async (req, res) => {
    const { weekStart } = parse(weekParam, req.params)
    const patch = parse(reviewBody, req.body ?? {})
    res.json(await saveReview(deps, req.userId, weekStart, patch, todayIso()))
  })

  return router
}
