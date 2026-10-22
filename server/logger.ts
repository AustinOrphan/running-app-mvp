import { pino, type Logger } from 'pino'
import type { Config } from './config.ts'

export function createLogger(config: Pick<Config, 'logLevel' | 'nodeEnv'>): Logger {
  return pino({
    level: config.nodeEnv === 'test' ? 'silent' : config.logLevel,
    redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
  })
}
