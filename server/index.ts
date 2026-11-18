import { createApp } from './app.ts'
import { loadConfig, loadEnvFileIfPresent } from './config.ts'
import { createPrisma, initSqlite } from './db.ts'
import { startScheduler } from './jobs/scheduler.ts'
import { createLogger } from './logger.ts'
import { installProcessErrorHandlers } from './processErrors.ts'
import { describeZoneCutover, setUnknownZoneReporter, zoneCutoverReport } from './runnerDay.ts'
import { logListening } from './version.ts'

loadEnvFileIfPresent()
const config = loadConfig(process.env)
const logger = createLogger(config)
installProcessErrorHandlers(logger)
const prisma = createPrisma(config.databaseUrl)
await initSqlite(prisma)

// A stored zone this server's ICU rejects reads as not chosen; the runner's id is logged once.
setUnknownZoneReporter((userId) =>
  logger.warn({ userId }, 'stored zone unknown to the server; the server zone applies'),
)

// D10: read-only. Says whose day follows a zone other than the server's and who has none chosen.
try {
  logger.info(describeZoneCutover(await zoneCutoverReport(prisma)))
} catch (error) {
  logger.warn({ err: error }, 'D10 zone report failed')
}

const deps = { prisma, config }
const app = createApp(deps)
// Express 5 hands a bind error (such as EADDRINUSE) to this callback instead of throwing it.
const server = app.listen(config.port, '0.0.0.0', (error?: Error) => {
  if (error) throw error
  logListening(logger, config.port)
})

// Background pulls, folder scans and weather backfill; only the real server runs them.
const stopScheduler = startScheduler(deps, { fetch: (input, init) => fetch(input, init) })

let stopping = false
function shutdown(signal: string): void {
  if (stopping) return
  stopping = true
  logger.info({ signal }, 'shutting down')
  stopScheduler()
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
