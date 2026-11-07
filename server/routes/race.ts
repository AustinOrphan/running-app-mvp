// The race API (rule H14, ADR 0018): the plan of the runner's current goal, derived on read.
// Mounted under `requireAuth` (`app.ts`), so an anonymous request is a 401 before any query is
// parsed. The plan is a private read: the tag follows the data version and the day, the answer is
// private and varies by cookie. Zod parses the query (an unknown parameter is a 400).
import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { dataVersionKey } from '../dataVersion.ts'
import { parse } from '../errors.ts'
import { athleteKey } from '../services/athleteState.ts'
import { loadRacePlan } from '../services/racePlan.ts'

/** The plan takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const noQuery = z.strictObject({})

/** The validator of one plan: the data version and the day, as the state view's. */
function etag(key: string): string {
  return `W/"race.${key}"`
}

/**
 * GET /api/race/plan: `{ plan, reason }`. The plan reads no forecast (the race climate is a cached
 * normal), so the tag needs the data version and the day only, and a request that sends the current
 * tag is answered 304 before the plan is built.
 */
export function raceRouter(deps: Deps): Router {
  const router = Router()

  router.get('/plan', async (req, res) => {
    parse(noQuery, req.query)
    const today = todayIso()
    res.vary('Cookie')
    res.set('Cache-Control', 'private, no-cache')
    res.set('ETag', etag(athleteKey(await dataVersionKey(deps.prisma), today)))
    if (req.fresh) {
      res.status(304).end()
      return
    }
    res.json(await loadRacePlan(deps, { userId: req.userId, today }))
  })

  return router
}
