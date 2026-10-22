import { Router } from 'express'
import type { Deps } from '../app.ts'

/**
 * Task 7 fills in the credential flow. `GET /setup` exists from the start because the web app's
 * auth gate needs it to choose between the setup and login pages.
 */
export function authRouter(deps: Deps): Router {
  const router = Router()

  router.get('/setup', async (_req, res, next) => {
    try {
      const users = await deps.prisma.user.count()
      res.json({ needsSetup: users === 0 })
    } catch (error) {
      next(error)
    }
  })

  return router
}
