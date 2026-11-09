// The runner's one OpenStreetMap download for trail and road shares (M1d). Mounted under
// `requireAuth` and the 1 MB JSON parser (`app.ts`), so an anonymous request is a 401 before a byte
// is read and a cross-site write is refused by the same-origin guard in front of it.
//
// GET    /api/map-area   the downloaded area, or null; `busy` while a download runs
// POST   /api/map-area   downloads the area (the only request to OpenStreetMap; the box is all it sends)
// DELETE /api/map-area   removes the ways and the area and clears the shares of every run
import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { downloadMapArea, loadMapArea, removeMapArea } from '../services/mapArea.ts'

/** No field is read; the body, when there is one, must be empty. */
const emptyBody = z.strictObject({})

export function mapAreaRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    res.json(await loadMapArea(deps.prisma, req.userId))
  })

  router.post('/', async (req, res) => {
    parse(emptyBody, req.body ?? {})
    res.set('Cache-Control', 'no-store')
    res.json(await downloadMapArea(deps, req.userId))
  })

  router.delete('/', async (req, res) => {
    await removeMapArea(deps.prisma, req.userId)
    res.set('Cache-Control', 'no-store')
    res.json(await loadMapArea(deps.prisma, req.userId))
  })

  return router
}
