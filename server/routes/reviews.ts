import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate, mondayOf, todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { saveRaiseAnswer } from '../services/raiseOffer.ts'
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

/** Not now: the only answer a request can record; a yes goes through `POST /api/plan/raise`. */
const raiseAnswerBody = z.strictObject({ answer: z.literal('declined') })

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

  // Not now, to the offer to raise the plan to match recent weeks (rule E7): remembered for the
  // finished week, so the offer does not come back for the same weeks on any device.
  router.put('/:weekStart/raise', async (req, res) => {
    const { weekStart } = parse(weekParam, req.params)
    const { answer } = parse(raiseAnswerBody, req.body)
    await saveRaiseAnswer(deps, { userId: req.userId, weekStart, answer, today: todayIso() })
    res.status(204).end()
  })

  return router
}
