import { Router } from 'express'
import { z } from 'zod'
import { addDays, todayIso } from '../../shared/dates.ts'
import {
  hrWindows,
  longRunReadings,
  runHistoryDays,
  type TrendsRunsView,
} from '../../shared/domain/trendsRuns.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { loadRunSeries } from '../serialize.ts'
import { memoByVersion } from '../services/athleteState.ts'

/** The view takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const query = z.strictObject({})

/** The name of the memoised run panels; the key adds the user, the day and the data version. */
export const TRENDS_RUNS_MEMO = 'trends.runs'

/**
 * GET /api/trends/runs: the two run-based panels of the Trends page (rules T1 and A11, ADR 0019).
 * `longRuns` are the flat runs of the last 104 weeks with a stored drift reading; `hrWindows` are the
 * heart-rate line of eight-week windows ending every four weeks, `fitHrModel` per window. One
 * column-limited read of the runs (`loadRunSeries`), memoised by data version and day; a warm
 * request reads nothing. The read ignores the snapshot on purpose: it reaches back past the
 * 365 days the snapshot holds. Nothing here writes, fetches or reaches the engine's decisions.
 */
export function trendsRunsRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    parse(query, req.query)
    const { userId } = req
    const today = todayIso()
    const view = await memoByVersion(
      deps,
      { userId, name: TRENDS_RUNS_MEMO, today },
      async (): Promise<TrendsRunsView> => {
        const runs = await loadRunSeries(deps.prisma, userId, {
          from: addDays(today, -runHistoryDays()),
          to: today,
        })
        return { asOf: today, longRuns: longRunReadings(runs), hrWindows: hrWindows(runs, today) }
      },
    )
    res.json(view)
  })

  return router
}
