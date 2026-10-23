import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { dataVersionKey } from '../dataVersion.ts'
import { parse } from '../errors.ts'
import { athleteKey, loadAthleteContext, stateView } from '../services/athleteState.ts'

/** The view takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const query = z.strictObject({})

/** The validator of a cached picture: one per data version, day and parameter version. */
function etag(key: string): string {
  return `W/"${key}"`
}

/**
 * GET /api/state: the athlete snapshot as a `StateView` (ADR 0009). The tag follows the data
 * version, so a request that sends the current tag is answered 304 before anything is built or
 * serialised, and a write by this process or another changes the tag.
 */
export function stateRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    parse(query, req.query)
    const today = todayIso()
    // The tag is the same for every user of one data version; the cookie tells users apart, so a
    // browser must not offer one user's tag to another.
    res.vary('Cookie')
    res.set('Cache-Control', 'private, no-cache')
    res.set('ETag', etag(athleteKey(await dataVersionKey(deps.prisma), today)))
    if (req.fresh) {
      res.status(304).end()
      return
    }
    const context = await loadAthleteContext(deps, { userId: req.userId, today })
    // The body is the picture that was built, which may be older than the tag read above if a write
    // landed in between; its own key says so, and the next request then finds a newer tag.
    res.set('ETag', etag(context.key))
    res.json(await stateView(context))
  })

  return router
}
