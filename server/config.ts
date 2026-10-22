import { z } from 'zod'

export interface Config {
  databaseUrl: string
  sessionSecret: string
  port: number
  nodeEnv: 'development' | 'test' | 'production'
  allowRegistration: boolean
  logLevel: string
}

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default('file:./data/app.db'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  PORT: z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().int().min(1).max(65535))
    .default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ALLOW_REGISTRATION: z
    .enum(['true', 'false'], { error: "must be 'true' or 'false'" })
    .default('false')
    .transform((value) => value === 'true'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
})

/** Reads and validates the six supported variables. An empty value counts as unset. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const raw: Record<string, string | undefined> = {}
  for (const key of Object.keys(envSchema.shape)) {
    const value = env[key]
    raw[key] = value === undefined || value === '' ? undefined : value
  }
  const result = envSchema.safeParse(raw)
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid configuration. ${problems}`)
  }
  const parsed = result.data
  return {
    databaseUrl: parsed.DATABASE_URL,
    sessionSecret: parsed.SESSION_SECRET,
    port: parsed.PORT,
    nodeEnv: parsed.NODE_ENV,
    allowRegistration: parsed.ALLOW_REGISTRATION,
    logLevel: parsed.LOG_LEVEL,
  }
}

/** Loads `.env` from the working directory into `process.env`; a missing file is fine. */
export function loadEnvFileIfPresent(): void {
  try {
    process.loadEnvFile('.env')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}
