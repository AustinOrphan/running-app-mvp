import { Router } from 'express'
import { allParams, PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import type { ResearchParams } from '../../shared/types.ts'
import type { Deps } from '../app.ts'

/** GET /api/research/params: the parameter registry, for the why drawer. */
export function researchRouter(deps: Deps): Router {
  void deps
  const router = Router()
  router.get('/params', (_req, res) => {
    const body: ResearchParams = { version: PARAMS_VERSION, params: allParams() }
    res.json(body)
  })
  return router
}
