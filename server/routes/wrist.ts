import { Router } from 'express'
import { z } from 'zod'
import { addDays, isIsoDate, todayIso } from '../../shared/dates.ts'
import type { Deps } from '../app.ts'
import { parse, validationError } from '../errors.ts'
import { issueCalendarToken, revokeCalendarToken } from '../services/calendar.ts'
import {
  PUBLISH_HORIZON_DAYS,
  requestPublish,
  setPublishing,
  statusRangeIssue,
  wristStatus,
} from '../services/publish.ts'

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date.')
  .refine(isIsoDate, 'Use a real date.')

const statusQuery = z.strictObject({ from: date.optional(), to: date.optional() })

const intervalsBody = z.strictObject({
  enabled: z.boolean(),
  garminLinked: z.boolean(),
  removeSent: z.boolean().optional(),
})

const publishBody = z.strictObject({ sessionId: z.string().min(1).optional() })

/**
 * The delivery of planned sessions to the watch (phase 3a design 6.4): the status of the next days,
 * the settings of the intervals.icu publisher and "Send again". Mounted under `requireAuth` and the
 * 1 MB JSON parser, so no body is read for a caller that is not signed in. The FIT downloads are in
 * the plan router. The private calendar feed itself is `GET /api/calendar/:token/plan.ics`
 * (`routes/calendar.ts`), which has to sit before authentication; this router holds the link's
 * token routes.
 */
export function wristRouter(deps: Deps): Router {
  const router = Router()

  router.get('/status', async (req, res) => {
    const query = parse(statusQuery, req.query)
    const today = todayIso()
    const from = query.from ?? today
    const to = query.to ?? addDays(from, PUBLISH_HORIZON_DAYS - 1)
    const issue = statusRangeIssue(from, to)
    if (issue !== null) throw validationError(issue, [{ path: 'to', message: issue }])
    // A cached "On your watch" would be false: the answer says what the app knows now.
    res.set('Cache-Control', 'no-store')
    res.json(await wristStatus(deps, req.userId, { from, to }))
  })

  router.put('/intervals', async (req, res) => {
    const body = parse(intervalsBody, req.body)
    res.json(
      await setPublishing(deps, req.userId, {
        enabled: body.enabled,
        garminLinked: body.garminLinked,
        removeSent: body.removeSent === true,
      }),
    )
  })

  router.post('/publish', async (req, res) => {
    const body = parse(publishBody, req.body ?? {})
    res
      .status(202)
      .json(
        await requestPublish(deps, req.userId, body.sessionId ? { sessionId: body.sessionId } : {}),
      )
  })

  // Creates the calendar link, or replaces it, which ends the old one at once. The token is in this
  // answer and nowhere else: the server keeps its hash.
  router.post('/calendar/token', async (req, res) => {
    const issued = await issueCalendarToken(deps, req.userId)
    res.set('Cache-Control', 'no-store').json(issued)
  })

  // Turns the calendar link off.
  router.delete('/calendar/token', async (req, res) => {
    await revokeCalendarToken(deps, req.userId)
    res.status(204).end()
  })

  return router
}
