import { Router } from 'express'
import type { Logger } from 'pino'
import { z } from 'zod'
import { parse } from '../errors.ts'

/** The largest body the route reads. */
export const CLIENT_ERROR_BODY_LIMIT = '16kb'

/**
 * One render-time error the page caught. Every field is bounded, so the body stays inside the 16 KB
 * parser; a field the browser did not have is an empty string.
 */
export const clientErrorSchema = z.strictObject({
  message: z.string().max(2000),
  stack: z.string().max(6000),
  componentStack: z.string().max(4000),
  /** The route's path, without the query. */
  path: z.string().max(300),
  /** The build id the service worker uses, or `unknown` where there is no worker. */
  buildId: z.string().max(64),
  userAgent: z.string().max(300),
  /** The reference the page showed the runner (ER1), a client-made id; same alphabet as a request id. */
  ref: z
    .string()
    .regex(/^[\w.-]{1,64}$/)
    .optional(),
})

/** The one fixed log message of a reported client error. */
export const CLIENT_ERROR_LOG_MESSAGE = 'client error'

/**
 * `POST /api/client-errors`: a page reports an error its boundary caught (E1), so the next blank
 * screen leaves a trace. Mounted below `requireAuth` with its own 16 KB parser and limiter. The
 * server logs the fields once at warn level and stores nothing; only the schema's fields reach the
 * log, never a header or the rest of the request.
 */
export function clientErrorsRouter(logger: Logger): Router {
  const router = Router()
  router.post('/', (req, res) => {
    const report = parse(clientErrorSchema, req.body)
    logger.warn(
      {
        // An id only, as in every other log line that names a runner; never the email.
        userId: req.userId,
        ...(report.ref === undefined ? {} : { ref: report.ref }),
        message: report.message,
        stack: report.stack,
        componentStack: report.componentStack,
        path: report.path,
        buildId: report.buildId,
        userAgent: report.userAgent,
      },
      CLIENT_ERROR_LOG_MESSAGE,
    )
    res.status(204).end()
  })
  return router
}
