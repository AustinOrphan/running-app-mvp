import { Router } from 'express'
import type { Deps } from '../app.ts'
import { notFound } from '../errors.ts'
import { getForecastView } from '../services/weatherCache.ts'

export function weatherRouter(deps: Deps): Router {
  const router = Router()

  // The one request path that may wait on Open-Meteo, because the runner asked for the forecast:
  // a filled cell answers at once (and refreshes in the background when stale), an empty one
  // waits for a single fetch of at most five seconds.
  router.get('/forecast', async (req, res) => {
    const forecast = await getForecastView(deps, req.userId)
    if (!forecast) throw notFound('Set a home location in the profile to see a forecast.')
    res.json(forecast)
  })

  return router
}
