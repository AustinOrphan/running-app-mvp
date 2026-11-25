// GET /api/plan-inputs (rule T2): the counts of the data the plan reads for the signed-in runner,
// derived on read from the athlete snapshot and stored nowhere. Mounted under `requireAuth`
// (`app.ts`). The tag follows the data version, the day and the climate failure stamp (the race heat
// notice reads `ClimateFailure`, which is not state), so a request that sends the current tag is
// answered 304 before anything is built.
import { Router } from 'express'
import type { Deps } from '../app.ts'
import { dataVersionKey } from '../dataVersion.ts'
import { athleteKey } from '../services/athleteState.ts'
import { loadPlanInputs } from '../services/planInputs.ts'
import { climateFailureStamp } from '../services/weatherCache.ts'

export function planInputsRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const { today } = req.runnerDay
    res.vary('Cookie')
    res.set('Cache-Control', 'private, no-cache')
    const climateStamp = await climateFailureStamp(deps.prisma)
    const key = `${athleteKey(await dataVersionKey(deps.prisma), today)}~${climateStamp}`
    res.set('ETag', `W/"plan-inputs.${key}"`)
    if (req.fresh) {
      res.status(304).end()
      return
    }
    res.json(await loadPlanInputs(deps, { userId: req.userId, today, climateStamp }))
  })

  return router
}
