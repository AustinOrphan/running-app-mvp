import { isAbsolute, resolve } from 'node:path'
import { defineConfig } from 'prisma/config'

// Prisma 7 does not read .env; a missing file is fine (CI and Docker set the variable).
try {
  process.loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

/**
 * A relative `file:` URL resolves against `prisma/`, as it did under Prisma 6. Keep this in step
 * with `resolveSqliteUrl` in server/dbPath.ts. It is repeated here because the Docker image runs the
 * CLI without the server sources.
 */
function resolveSqliteUrl(url: string): string {
  const path = url.replace(/^file:/, '').split('?')[0] ?? ''
  if (!url.startsWith('file:') || isAbsolute(path)) return url
  return `file:${resolve(process.cwd(), 'prisma', path)}`
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: resolveSqliteUrl(process.env.DATABASE_URL ?? 'file:./data/app.db') },
})
