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
import { checkinsRouter } from './routes/checkins.ts'
import { explainRouter } from './routes/explain.ts'
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
import { todayRouter } from './routes/today.ts'
import { weatherRouter } from './routes/weather.ts'
import { weeksRouter } from './routes/weeks.ts'
import { wellnessRouter } from './routes/wellness.ts'
import { zonesRouter } from './routes/zones.ts'
import { mountStatic } from './static.ts'

export interface Deps {
  prisma: PrismaClient
  config: Config
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

  // File imports, client-parsed exports and phone pushes carry up to 16 MB of JSON. CSV imports
  // carry the whole file as text. The parsers run in order and each skips a body that an earlier
  // one already read, so the general 1 MB parser below only sees every other route.
  app.use(
    ['/api/imports/files', '/api/imports/parsed', '/api/ingest'],
    express.json({ limit: '16mb' }),
  )
  app.use('/api/imports', express.json({ limit: '10mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())

  // Phone automations send neither an Origin header nor a cookie; the router checks a bearer
  // token itself, so it sits before the same-origin guard and the session check.
  app.use('/api/ingest', ingestRouter(deps))

  app.use('/api', sameOriginGuard())

  app.use('/api', healthRouter(deps))
  app.use('/api', authRouter(deps))
  app.use('/api', requireAuth(deps))
  app.use('/api/settings', settingsRouter(deps))
  app.use('/api/state', stateRouter(deps))
  app.use('/api/explain', explainRouter(deps))
  app.use('/api/activities', activitiesRouter(deps))
  app.use('/api/imports', importsRouter(deps))
  app.use('/api/goals', goalsRouter(deps))
  app.use('/api/plan', planRouter(deps))
  app.use('/api/reviews', reviewsRouter(deps))
  app.use('/api/weeks', weeksRouter(deps))
  app.use('/api/profile', profileRouter(deps))
  app.use('/api/wellness', wellnessRouter(deps))
  app.use('/api/integrations', integrationsRouter(deps))
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
