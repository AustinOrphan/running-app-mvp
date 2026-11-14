import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import type { TrendsDurabilityView } from '../../shared/domain/durabilityByHour.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { memoByVersion } from '../services/athleteState.ts'
import { loadDurability } from '../services/trendsDurability.ts'

/** The view takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const query = z.strictObject({})

/** The name of the memoised read-out; the key adds the user, the day and the data version. */
export const TRENDS_DURABILITY_MEMO = 'trends.durability'

/**
 * GET /api/trends/durability: the hour-by-hour read-out of the long runs (rule T1, DR1, ADR 0019).
 * Memoised by data version and day, like `GET /api/trends/runs`; a warm request reads nothing. The
 * read ignores the snapshot on purpose (it reaches back 104 weeks and reads stored streams). Nothing
 * here writes, fetches or reaches the engine's decisions.
 */
export function trendsDurabilityRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    parse(query, req.query)
    const { userId } = req
    const today = todayIso()
    const view = await memoByVersion(
      deps,
      { userId, name: TRENDS_DURABILITY_MEMO, today },
      (): Promise<TrendsDurabilityView> => loadDurability(deps.prisma, userId, today),
    )
    res.json(view)
  })

  return router
}
