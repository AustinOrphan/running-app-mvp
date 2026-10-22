// Stub from the training-engine scaffold; Task E10 implements it.
import { Router } from 'express'
import type { Deps } from '../app.ts'

/** GET /api/zones, GET /api/zones/proposals, POST /api/zones/proposals/:id/accept|decline. */
export function zonesRouter(deps: Deps): Router {
  void deps
  return Router()
}
