import { Router } from 'express'
import { z } from 'zod'
import { isIsoDate, mondayOf } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { briefList, briefView, markBriefSeen } from '../services/brief.ts'

/** A date, snapped to the Monday of its week as the weeks and Explain routes do. */
const weekStart = z
  .string()
  .refine(isIsoDate, 'Use a real date written YYYY-MM-DD.')
  .transform(mondayOf)

const briefQuery = z.strictObject({ weekStart: weekStart.optional() })
const listQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(52).default(12) })
const seenParams = z.strictObject({ weekStart })

/**
 * `GET /api/brief?weekStart=`: `{ brief }`, the Monday brief of a week (default the current one) as
 * a `BriefView`, or null (phase 3a design 8.4). The current week's is built when missing; a past
 * week's never is. Authentication runs before the query is parsed.
 */
export function briefRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const query = parse(briefQuery, req.query)
    res.json({
      brief: await briefView(deps, {
        userId: req.userId,
        ...(query.weekStart === undefined ? {} : { weekStart: query.weekStart }),
      }),
    })
  })

  return router
}

/**
 * `GET /api/briefs?limit=`: `{ briefs }`, the newest briefs, slim, for the history strip and Today's
 * line; `POST /api/briefs/:weekStart/seen` stamps the revisions the brief shows as seen (204).
 */
export function briefsRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const query = parse(listQuery, req.query)
    res.json({ briefs: await briefList(deps, { userId: req.userId, limit: query.limit }) })
  })

  router.post('/:weekStart/seen', async (req, res) => {
    const params = parse(seenParams, req.params)
    await markBriefSeen(deps, { userId: req.userId, weekStart: params.weekStart })
    res.status(204).end()
  })

  return router
}
