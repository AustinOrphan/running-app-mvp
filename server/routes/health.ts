import { Router } from 'express'
import type { Deps } from '../app.ts'

export function healthRouter(_deps: Deps): Router {
  const router = Router()
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })
  return router
}
