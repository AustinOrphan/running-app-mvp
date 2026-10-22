import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import { predictRace } from '../../shared/engine/index.ts'
import type { PredictionView } from '../../shared/types.ts'
import type { Deps } from '../app.ts'
import { notFound, parse } from '../errors.ts'
import { toPredictionLogEntry } from '../serialize.ts'
import { gatherEngineInput } from '../services/engineInput.ts'

const LOG_LIMIT = 50
const query = z.object({ goalId: z.string().min(1) })

/** GET /api/predictions?goalId: the latest prediction and its log. */
export function predictionsRouter(deps: Deps): Router {
  const { prisma } = deps
  const router = Router()

  router.get('/', async (req, res) => {
    const { goalId } = parse(query, req.query)
    const goal = await prisma.goal.findFirst({ where: { id: goalId, userId: req.userId } })
    if (!goal) throw notFound('Goal not found.')
    const log = await prisma.predictionLog.findMany({
      where: { userId: req.userId, goalId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LOG_LIMIT,
    })
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
