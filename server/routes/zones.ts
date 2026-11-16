import { Router } from 'express'
import type { Deps } from '../app.ts'
import { currentZones } from '../services/engineInput.ts'
import { decideZoneProposal, listZoneProposals } from '../services/planEngine.ts'

/** GET /api/zones, GET /api/zones/proposals, POST /api/zones/proposals/:id/accept|decline. */
export function zonesRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    res.json(await currentZones(deps, { userId: req.userId, today: req.runnerDay.today }))
  })

  router.get('/proposals', async (req, res) => {
    res.json(await listZoneProposals(deps, { userId: req.userId, today: req.runnerDay.today }))
  })

  // Accepting answers with the new zone set; declining has nothing to return.
  router.post('/proposals/:id/accept', async (req, res) => {
    const { today } = req.runnerDay
    await decideZoneProposal(deps, {
      userId: req.userId,
      today,
      id: req.params.id,
      decision: 'accept',
    })
    res.json(await currentZones(deps, { userId: req.userId, today }))
  })

  router.post('/proposals/:id/decline', async (req, res) => {
    await decideZoneProposal(deps, {
      userId: req.userId,
      today: req.runnerDay.today,
      id: req.params.id,
      decision: 'decline',
    })
    res.status(204).end()
  })

  return router
}
