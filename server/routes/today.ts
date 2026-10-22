import { Router } from 'express'
import { todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { todayView } from '../services/planEngine.ts'

/** GET /api/today: a `TodayView` with readiness advice, heat note and unrated activities. */
export function todayRouter(deps: Deps): Router {
  const router = Router()
  router.get('/', async (req, res) => {
    res.json(await todayView(deps, { userId: req.userId, today: todayIso() }))
  })
  return router
}
