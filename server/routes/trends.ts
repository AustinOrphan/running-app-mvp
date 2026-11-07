import { Router } from 'express'
import { z } from 'zod'
import { addDays, mondayOf, todayIso, weekStartsBetween } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import { seriesByDate, weeklyBands, weeklySleep, weightWeeks } from '../../shared/domain/trends.ts'
import type { TrendsView, TrendWeightWeek } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { loadWeightSeries, loadWellnessSeries } from '../serialize.ts'
import { loadAthleteContext, memoByVersion } from '../services/athleteState.ts'

/** The view takes no parameters; an unknown one is a mistake worth a 400, not a silent ignore. */
const query = z.strictObject({})

/** The name of the memoised recovery series; the key adds the user, the day and the data version. */
export const TRENDS_RECOVERY_MEMO = 'trends.recovery'

/** The name of the memoised weight series; it exists only for a runner who turned weight on. */
export const TRENDS_WEIGHT_MEMO = 'trends.weight'

/** Weeks the page can show: 24 months. */
export const TRENDS_WEEKS = 104

/** What the weight part of the response holds: nothing, a series, or the reason there is none. */
type WeightPart = { weight?: TrendWeightWeek[]; weightGate?: 'reds' }

/**
 * The response of `GET /api/trends`, assembled in one place. The weight keys are spread in only when
 * `weight` carries one of them, so a runner who has not turned weight on gets no weight key at all.
 */
function buildTrendsView(
  asOf: string,
  recovery: TrendsView['recovery'],
  weight: WeightPart,
): TrendsView {
  return { asOf, recovery, ...weight }
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
    const last = mondayOf(today)
    const weekStarts = weekStartsBetween(addDays(last, -7 * (TRENDS_WEEKS - 1)), last)
    const account = await deps.prisma.user.findUnique({
      where: { id: userId },
      select: { showBodyWeight: true },
    })
    const context = await loadAthleteContext(deps, { userId, today })
    const cyclic = context.profile.sex === 'female'
    const recovery = await memoByVersion(
      deps,
      { userId, name: TRENDS_RECOVERY_MEMO, today },
      async (): Promise<TrendsView['recovery']> => {
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
          cycleBaseline: cyclic,
        }
      },
    )
    // Weight is a display choice (ADR 0019): off, the route never selects
    // `weightKg` and the payload carries no weight; at
    // `j5.redsHoldFlags` open flags, only the reason is sent. Neither gate restricts the data path.
    let weight: WeightPart = {}
    if (account?.showBodyWeight === true) {
      weight =
        context.screeningFlags >= P.j5.redsHoldFlags.value
          ? { weightGate: 'reds' }
          : {
              weight: await memoByVersion(
                deps,
                { userId, name: TRENDS_WEIGHT_MEMO, today },
                async () =>
                  weightWeeks(
                    await loadWeightSeries(deps.prisma, userId, {
                      from: weekStarts[0]!,
                      to: today,
                    }),
                    weekStarts,
                  ),
              ),
            }
    }
    res.json(buildTrendsView(today, recovery, weight))
  })

  return router
}
