import { createApp } from './app.ts'
import { loadConfig, loadEnvFileIfPresent } from './config.ts'
import { createPrisma, initSqlite } from './db.ts'
import { createLogger } from './logger.ts'

loadEnvFileIfPresent()
const config = loadConfig(process.env)
const logger = createLogger(config)
const prisma = createPrisma(config.databaseUrl)
await initSqlite(prisma)

const app = createApp({ prisma, config })
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info({ port: config.port }, 'server listening')
})

let stopping = false
function shutdown(signal: string): void {
  if (stopping) return
  stopping = true
  logger.info({ signal }, 'shutting down')
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0))
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
