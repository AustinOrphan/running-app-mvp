// Stub from the training-engine scaffold; Task E10 implements it.
import { Router } from 'express'
import type { Deps } from '../app.ts'

/** GET /api/predictions?goalId: the latest prediction and its log. */
export function predictionsRouter(deps: Deps): Router {
  void deps
  return Router()
}
