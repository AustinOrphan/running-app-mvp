import { randomUUID } from 'node:crypto'
import type { PrismaClient } from './db.ts'
import cookieParser from 'cookie-parser'
import express, { type Express } from 'express'
import helmet from 'helmet'
import { pinoHttp } from 'pino-http'
import { createGlobalLimiter } from './auth/rateLimit.ts'
import { authRouter } from './auth/routes.ts'
import { requireAuth, sameOriginGuard } from './auth/middleware.ts'
import type { Config } from './config.ts'
import { apiNotFound, errorHandler } from './errors.ts'
import { createLogger } from './logger.ts'
import { activitiesRouter } from './routes/activities.ts'
import { calendarRouter, redactedRequest } from './routes/calendar.ts'
import { checkinsRouter } from './routes/checkins.ts'
import { explainRouter } from './routes/explain.ts'
import { fuelRouter } from './routes/fuel.ts'
import { goalsRouter } from './routes/goals.ts'
import { healthRouter } from './routes/health.ts'
import { importsRouter } from './routes/imports.ts'
import { ingestRouter } from './routes/ingest.ts'
import { integrationsRouter } from './routes/integrations.ts'
import { jobsRouter } from './routes/jobs.ts'
import { planRouter } from './routes/plan.ts'
import { predictionsRouter } from './routes/predictions.ts'
import { profileRouter } from './routes/profile.ts'
import { researchRouter } from './routes/research.ts'
import { reviewsRouter } from './routes/reviews.ts'
import { screeningsRouter } from './routes/screenings.ts'
import { settingsRouter } from './routes/settings.ts'
import { stateRouter } from './routes/state.ts'
import { statsRouter } from './routes/stats.ts'
import { todayRouter } from './routes/today.ts'
import { weatherRouter } from './routes/weather.ts'
import { weeksRouter } from './routes/weeks.ts'
import { wellnessRouter } from './routes/wellness.ts'
import { wristRouter } from './routes/wrist.ts'
import { zonesRouter } from './routes/zones.ts'
import { mountStatic } from './static.ts'

export interface Deps {
  prisma: PrismaClient
  config: Config
  /**
   * The network client of work that is not a scheduled job (the weather cache, a manual sync). Left
   * out in production, where the global `fetch` is looked up at each call; tests set it, read at
   * each call too, so that none reaches the network and none stubs the global.
   */
  fetch?: typeof fetch
}

const REQUEST_ID = /^[\w.-]{1,64}$/

/** `globalLimit` overrides the per-IP request budget per 15 minutes; tests use it. */
export function createApp(deps: Deps, opts: { globalLimit?: number } = {}): Express {
  const logger = createLogger(deps.config)
  const app = express()

  app.disable('x-powered-by')
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          // Plain-HTTP self-hosting is supported, so the policy must not force HTTPS upgrades.
          upgradeInsecureRequests: null,
        },
      },
    }),
  )
  app.use(
    pinoHttp({
      logger,
      // The private calendar feed carries its token in the path; the log names the route instead.
      serializers: { req: redactedRequest },
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id']
        const id =
          typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID()
        res.setHeader('X-Request-Id', id)
        return id
      },
    }),
  )

  // Before the routers and static serving, so API calls and the index fallback share one budget.
  app.use(createGlobalLimiter({ max: opts.globalLimit }))

  // Request pipeline (phase 3a design 4.8): no JSON body is read before the caller is known. The
  // only parsers ahead of authentication are the 16 KB one on sign-in and setup, and the 16 MB one
  // that the ingest router starts after it has checked the push token. Every other parser sits
  // below `requireAuth`, so an anonymous request is refused with 401 before a byte is buffered.
  app.use(cookieParser())

  // Phone automations send neither an Origin header nor a cookie; the router checks a bearer
  // token itself, so it sits before the same-origin guard and the session check.
  app.use('/api/ingest', ingestRouter(deps))

  // The private calendar feed is opened by a calendar app, which sends no cookie, no Origin and no
  // body; the router checks its own token and reads nothing from the request but the path.
  app.use('/api/calendar', calendarRouter(deps))

  app.use('/api', sameOriginGuard())

  app.use(['/api/setup', '/api/auth'], express.json({ limit: '16kb' }))
  app.use('/api', healthRouter(deps))
  app.use('/api', authRouter(deps))
  app.use('/api', requireAuth(deps))

  // File imports and client-parsed exports carry up to 16 MB of JSON. CSV imports carry the whole
  // file as text. The parsers run in order and each skips a body that an earlier one already read,
  // so the general 1 MB parser only sees every other route.
  app.use(['/api/imports/files', '/api/imports/parsed'], express.json({ limit: '16mb' }))
  app.use('/api/imports', express.json({ limit: '10mb' }))
  app.use('/api', express.json({ limit: '1mb' }))

  app.use('/api/settings', settingsRouter(deps))
  app.use('/api/state', stateRouter(deps))
  app.use('/api/stats', statsRouter(deps))
  app.use('/api/explain', explainRouter(deps))
  app.use('/api/fuel', fuelRouter(deps))
  app.use('/api/activities', activitiesRouter(deps))
  app.use('/api/imports', importsRouter(deps))
  app.use('/api/goals', goalsRouter(deps))
  app.use('/api/plan', planRouter(deps))
  app.use('/api/reviews', reviewsRouter(deps))
  app.use('/api/weeks', weeksRouter(deps))
  app.use('/api/profile', profileRouter(deps))
  app.use('/api/wellness', wellnessRouter(deps))
  app.use('/api/integrations', integrationsRouter(deps))
  app.use('/api/wrist', wristRouter(deps))
  app.use('/api/jobs', jobsRouter(deps))
  app.use('/api/weather', weatherRouter(deps))
  app.use('/api/today', todayRouter(deps))
  app.use('/api/checkins', checkinsRouter(deps))
  app.use('/api/zones', zonesRouter(deps))
  app.use('/api/predictions', predictionsRouter(deps))
  app.use('/api/screenings', screeningsRouter(deps))
  app.use('/api/research', researchRouter(deps))

  app.use(apiNotFound)
  mountStatic(app)
  app.use(errorHandler(logger))

  return app
}
