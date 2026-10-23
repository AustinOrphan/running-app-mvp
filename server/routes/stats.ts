import { Router } from 'express'
import { z } from 'zod'
import { statsOf } from '../../shared/domain/stats.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { loadActivityCores } from '../serialize.ts'
import { memoByVersion } from '../services/athleteState.ts'

/** The view takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const query = z.strictObject({})

/** The name of the memoised statistics; the key adds the user and the data version. */
export const STATS_MEMO = 'stats'

/**
 * GET /api/stats: monthly and yearly totals, fastest efforts and longest runs over the whole
 * history. They are computed from six columns per activity and memoised by data version, so a
 * second request with no write between reads no activity (ADR 0009). The history is not bounded by
 * the engine's window: the page shows lifetime figures.
 */
export function statsRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    parse(query, req.query)
    const { userId } = req
    res.json(
      await memoByVersion(deps, { userId, name: STATS_MEMO }, async () =>
        statsOf(await loadActivityCores(deps.prisma, userId)),
      ),
    )
  })

  return router
}
