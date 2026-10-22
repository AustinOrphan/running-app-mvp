import { Router } from 'express'
import type { Deps } from '../app.ts'
import { notFound } from '../errors.ts'
import { getForecast } from '../services/weather.ts'

export function weatherRouter(deps: Deps): Router {
  const router = Router()

  router.get('/forecast', async (req, res) => {
    // `fetch` is resolved per call so that a test can replace the global.
    const forecast = await getForecast(deps, req.userId, (input, init) => fetch(input, init))
    if (!forecast) throw notFound('Set a home location in the profile to see a forecast.')
    res.json(forecast)
  })

  return router
}
