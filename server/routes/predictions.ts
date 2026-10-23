import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import { predictRace } from '../../shared/engine/index.ts'
import type { PredictionView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { notFound, parse } from '../errors.ts'
import { toPredictionLogEntry } from '../serialize.ts'
import { gatherEngineInput } from '../services/engineInput.ts'
import { newestPerWeek } from '../services/predictionLog.ts'
import { loadTrackRecord } from '../services/trackRecord.ts'

const LOG_LIMIT = 50
const query = z.object({ goalId: z.string().min(1) })
/** The record takes no parameters; an unknown one is a mistake worth a 400. */
const recordQuery = z.strictObject({})

/**
 * GET /api/predictions?goalId: the latest prediction and its log, one entry per week.
 * GET /api/predictions/record: the track record, every recorded race scored against its predictions.
 */
export function predictionsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/record', async (req, res) => {
    parse(recordQuery, req.query)
    res.json(await loadTrackRecord(deps, req.userId))
  })

  router.get('/', async (req, res) => {
    const { goalId } = parse(query, req.query)
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId: req.userId } })
    if (!goal) throw notFound('Goal not found.')
    // A goal logs about one row a week, but weeks from before the weekly log hold several: all of
    // the goal's rows load, and each week collapses to its newest row before the page is cut.
    const rows = await prisma.predictionLog.findMany({ where: { userId: req.userId, goalId } })
    const log = newestPerWeek(rows).slice(0, LOG_LIMIT)
    // A goal without a distance has nothing to predict.
    const prediction =
      goal.distanceM === null
        ? null
        : predictRace(
            await gatherEngineInput(deps, { userId: req.userId, goalId, today: todayIso() }),
          )
    const body: PredictionView = { prediction, log: log.map(toPredictionLogEntry) }
    res.json(body)
  })

  return router
}
