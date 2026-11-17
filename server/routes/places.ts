// Setting a place without typing coordinates (PL1, ADR 0024). Mounted under `requireAuth` and the
// 1 MB JSON parser (`app.ts`).
//
// POST /api/places/search       a town or postcode, as the typed text in the body (never in a URL,
//                               so it is not in a request log); the matches, at most 8
// GET  /api/places/usual-start  the most common 0.01-degree cell where the runner's runs start
import { Router } from 'express'
import { z } from 'zod'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { loadUsualStart, searchPlaces } from '../services/places.ts'

const searchBody = z.strictObject({ query: z.string().trim().min(2).max(80) })

export function placesRouter(deps: Deps): Router {
  const router = Router()

  router.post('/search', async (req, res) => {
    const { query } = parse(searchBody, req.body)
    const places = await searchPlaces(deps, query)
    res.set('Cache-Control', 'no-store')
    res.json({ places })
  })

  router.get('/usual-start', async (req, res) => {
    const start = await loadUsualStart(deps.prisma, req.userId, req.runnerDay.today)
    res.set('Cache-Control', 'no-store')
    res.json({ start })
  })

  return router
}
