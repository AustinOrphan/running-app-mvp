// Stub from the training-engine scaffold; Task E10 implements it.
import { Router } from 'express'
import type { Deps } from '../app.ts'

/** GET /api/today: a `TodayView` with readiness advice, heat note and unrated activities. */
export function todayRouter(deps: Deps): Router {
  void deps
  return Router()
}
