import { createApp } from './app.ts'
import { loadConfig, loadEnvFileIfPresent } from './config.ts'
import { createPrisma, initSqlite } from './db.ts'
import { startScheduler } from './jobs/scheduler.ts'
import { createLogger } from './logger.ts'

loadEnvFileIfPresent()
const config = loadConfig(process.env)
const logger = createLogger(config)
const prisma = createPrisma(config.databaseUrl)
await initSqlite(prisma)

const deps = { prisma, config }
const app = createApp(deps)
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port }, 'server listening')
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
