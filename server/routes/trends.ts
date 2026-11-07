import { Router } from 'express'
import { z } from 'zod'
import { addDays, mondayOf, todayIso, weekStartsBetween } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import { seriesByDate, weeklyBands, weeklySleep } from '../../shared/domain/trends.ts'
import type { TrendsView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { loadWellnessSeries } from '../serialize.ts'
import { loadAthleteContext, memoByVersion } from '../services/athleteState.ts'

/** The view takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const query = z.strictObject({})

/** The name of the memoised recovery series; the key adds the user, the day and the data version. */
export const TRENDS_RECOVERY_MEMO = 'trends.recovery'

/** Weeks the page can show: 24 months. */
export const TRENDS_WEEKS = 104

/**
 * The response of `GET /api/trends`, assembled in one place. The recovery series are the whole of
 * it today; anything else the page may one day carry is added here and nowhere else.
 */
function buildTrendsView(asOf: string, recovery: TrendsView['recovery']): TrendsView {
  return { asOf, recovery }
}

/**
 * GET /api/trends: weekly recovery readings (heart-rate variability, resting heart rate and sleep)
 * for the last 24 months, with the runner's recent range for the first two (rule T1, ADR 0019).
 * Running weeks are `GET /api/weeks`. The read order is: the snapshot (for the profile the cycle
 * baseline needs), then the memo `trends.recovery`, which reads four wellness columns on a miss
 * and nothing on a warm request. Nothing here writes, fetches or reaches the engine.
 */
export function trendsRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    parse(query, req.query)
    const { userId } = req
    const today = todayIso()
    const context = await loadAthleteContext(deps, { userId, today })
    const cyclic = context.profile.sex === 'female'
    const recovery = await memoByVersion(
      deps,
      { userId, name: TRENDS_RECOVERY_MEMO, today },
      async (): Promise<TrendsView['recovery']> => {
        const last = mondayOf(today)
        const weekStarts = weekStartsBetween(addDays(last, -7 * (TRENDS_WEEKS - 1)), last)
        // The baseline of a week reaches back the longer of the two lookbacks before its Monday.
        const lookback = Math.max(P.j4.lookbackDays.value, P.j4.cycleBaselineDays.value)
        const rows = await loadWellnessSeries(deps.prisma, userId, {
          from: addDays(weekStarts[0]!, -lookback),
          to: today,
        })
        const byDate = seriesByDate(rows)
        return {
          hrv: weeklyBands(byDate, weekStarts, 'hrv', cyclic),
          restingHr: weeklyBands(byDate, weekStarts, 'resting-hr', cyclic),
          sleep: weeklySleep(byDate, weekStarts),
        }
      },
    )
    res.json(buildTrendsView(today, recovery))
  })

  return router
}
