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
import { goalsRouter } from './routes/goals.ts'
import { healthRouter } from './routes/health.ts'
import { importsRouter } from './routes/imports.ts'
import { planRouter } from './routes/plan.ts'
import { reviewsRouter } from './routes/reviews.ts'
import { settingsRouter } from './routes/settings.ts'
import { weeksRouter } from './routes/weeks.ts'
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

  // Imports carry the whole CSV file as JSON text. The general parser below skips bodies that an
  // earlier parser already read.
  app.use('/api/imports', express.json({ limit: '10mb' }))
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use('/api', sameOriginGuard())

  app.use('/api', healthRouter(deps))
  app.use('/api', authRouter(deps))
  app.use('/api', requireAuth(deps))
  app.use('/api/settings', settingsRouter(deps))
  app.use('/api/activities', activitiesRouter(deps))
  app.use('/api/imports', importsRouter(deps))
  app.use('/api/goals', goalsRouter(deps))
  app.use('/api/plan', planRouter(deps))
  app.use('/api/reviews', reviewsRouter(deps))
  app.use('/api/weeks', weeksRouter(deps))

  app.use(apiNotFound)
  mountStatic(app)
  app.use(errorHandler(logger))

  return app
}
