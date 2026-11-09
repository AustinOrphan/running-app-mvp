import { Router } from 'express'
import { z } from 'zod'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import {
  LINE_WEEKS,
  loadRuns,
  type LoadZones,
  type TrendsLoadView,
} from '../../shared/domain/trendsLoad.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { loadLoadSeries } from '../serialize.ts'
import { loadAthleteContext, memoByVersion } from '../services/athleteState.ts'
import { TRENDS_WEEKS } from './trends.ts'

/** The view takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const query = z.strictObject({})

/** The name of the memoised load panels; the key adds the user, the day and the data version. */
export const TRENDS_LOAD_MEMO = 'trends.load'

/**
 * GET /api/trends/load: the climbing and intensity panels of the Trends page (rule A12, ADR 0019).
 * One row per run of the last 104 weeks (and the three before them, for the 4-week line): the gain,
 * and the seconds below, between and above the two heart-rate limits of the zones as they stand
 * today, or null where the run has no usable heart rate. One column-limited read of the runs
 * (`loadLoadSeries`), memoised by data version and day; a warm request reads nothing. The zones come
 * from the snapshot, the one place they are built. Nothing here writes, fetches or reaches the
 * engine's decisions.
 */
export function trendsLoadRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    parse(query, req.query)
    const { userId } = req
    const today = todayIso()
    const view = await memoByVersion(
      deps,
      { userId, name: TRENDS_LOAD_MEMO, today },
      async (): Promise<TrendsLoadView> => {
        const context = await loadAthleteContext(deps, { userId, today })
        // The same two limits the zone table shows as the heart rate of Zone 2 and Zone 3.
        const hr = context.zones.hr
        const zones: LoadZones | null = hr === null ? null : { lt1Hr: hr.z2[0], lt2Hr: hr.z3[0] }
        const rows = await loadLoadSeries(deps.prisma, userId, {
          from: addDays(mondayOf(today), -7 * (TRENDS_WEEKS - 1 + LINE_WEEKS - 1)),
          to: today,
        })
        return { asOf: today, zones, runs: loadRuns(rows, zones) }
      },
    )
    res.json(view)
  })

  return router
}
