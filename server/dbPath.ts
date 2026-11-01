import { isAbsolute, resolve } from 'node:path'

/**
 * Where the SQLite file is. This module imports nothing of Prisma, so the command-line scripts that
 * only need the file (`scripts/backup.ts`, `scripts/restore.ts`, and through them `npm run
 * db:migrate`) run on a clone where `prisma generate` has not run yet. The test
 * `scriptImports.test.ts` fails when the imports of either script reach the generated client.
 */

export const DEFAULT_DATABASE_URL = 'file:./data/app.db'

/**
 * `DATABASE_URL` alone, with the same default and the same rule that an empty value counts as
 * unset as `loadConfig`. The backup and restore scripts read only this variable, so they need no
 * `SESSION_SECRET`.
 */
export function loadDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const value = env.DATABASE_URL
  return value === undefined || value === '' ? DEFAULT_DATABASE_URL : value
}

/**
 * A relative `file:` URL resolves against `prisma/` under the working directory, as it did under
 * Prisma 6, so the CLI and the client open the same file. Keep this in step with prisma.config.ts.
 */
export function resolveSqliteUrl(url: string): string {
  const path = url.replace(/^file:/, '').split('?')[0] ?? ''
  if (!url.startsWith('file:') || isAbsolute(path)) return url
  return `file:${resolve(process.cwd(), 'prisma', path)}`
}

/**
 * The absolute path of the SQLite file that a `file:` URL names, resolved as the client resolves it
 * (see `resolveSqliteUrl`). The backup and restore scripts use it to find the file and its folder.
 */
export function sqliteFilePath(databaseUrl: string): string {
  if (!databaseUrl.startsWith('file:')) {
    throw new Error(`DATABASE_URL must be a file: URL for a SQLite database, not ${databaseUrl}.`)
  }
  return (
    resolveSqliteUrl(databaseUrl)
      .replace(/^file:/, '')
      .split('?')[0] ?? ''
  )
}
