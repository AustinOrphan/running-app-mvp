import { Router } from 'express'
import type { Deps } from '../app.ts'
import { issueCalendarToken, revokeCalendarToken } from '../services/calendar.ts'

/**
 * Delivery to the runner's devices (phase 3a design 6.4). This router holds the private calendar
 * feed's link; the feed itself is `GET /api/calendar/:token/plan.ics` (`routes/calendar.ts`),
 * which has to sit before authentication.
 */
export function wristRouter(deps: Deps): Router {
  const router = Router()

  // Creates the link, or replaces it, which ends the old one at once. The token is in this answer
  // and nowhere else: the server keeps its hash.
  router.post('/calendar/token', async (req, res) => {
    const issued = await issueCalendarToken(deps, req.userId)
    res.set('Cache-Control', 'no-store').json(issued)
  })

  // Turns the link off.
  router.delete('/calendar/token', async (req, res) => {
    await revokeCalendarToken(deps, req.userId)
    res.status(204).end()
  })

  return router
}
