import { Router } from 'express'
import { z } from 'zod'
import { todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { parse } from '../errors.ts'
import { assertViewable, todayKey, todayView } from '../services/today.ts'

/** `date` is checked against the day by `assertViewable`; an unknown parameter is a 400. */
const todayQuery = z.strictObject({ date: z.string().optional() })

/** The validator of the payload: one per data version, day, viewed date and forecast. */
function etag(key: string): string {
  return `W/"${key}"`
}

/**
 * GET /api/today: one `TodayView` with the whole `coach` payload. `?date=` takes today or one of
 * the next two days (a day ahead is a read-only preview). The tag is composed from the data
 * version, the day, the viewed date and the forecast stamp (`todayKey`), so a request that sends
 * the current tag is answered 304 before the snapshot is read or anything is built. Authentication
 * has run before this handler; the query is parsed after it.
 */
export function todayRouter(deps: Deps): Router {
  const router = Router()

  router.get('/', async (req, res) => {
    const today = todayIso()
    const { date = today } = parse(todayQuery, req.query)
    assertViewable(date, today)
    // The tag is the same for every user of one data version; the cookie tells users apart, so a
    // browser must not offer one user's tag to another.
    res.vary('Cookie')
    res.set('Cache-Control', 'private, no-cache')
    res.set('ETag', etag(await todayKey(deps, { userId: req.userId, today, date })))
    if (req.fresh) {
      res.status(304).end()
      return
    }
    // The tag was read first, so the body is never older than it; if a write landed in between,
    // the next request finds a newer tag and gets the new body.
    res.json(await todayView(deps, { userId: req.userId, today, date }))
  })

  return router
}
