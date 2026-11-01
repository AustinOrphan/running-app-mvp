import { parseArgs } from 'node:util'
import { loadEnvFileIfPresent } from '../server/config.ts'
import { loadDatabaseUrl, sqliteFilePath } from '../server/dbPath.ts'
import { restoreDatabase } from '../server/services/restore.ts'
import type { Output } from './backup.ts'
import { isMainModule } from './isMain.ts'

const HELP = `Usage: npm run restore -- <backup file>

Replaces the database (DATABASE_URL, default file:./data/app.db) with a backup made by
npm run backup. Stop the server first: the restore asks the database for an exclusive lock, which
SQLite refuses while the server holds its connection open (initSqlite puts it in WAL mode), and
the restore then stops without changing anything.

In order: the backup is copied next to the database and checked with PRAGMA integrity_check; the
current database is copied to backups/pre-restore-<UTC timestamp>.db; the database's stale -wal
and -shm files are removed; the checked copy takes the database's place.
`

const processOutput: Output = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
}

/** Runs `npm run restore` with the given arguments and environment; returns the exit status. */
export async function restoreCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Output = processOutput,
): Promise<number> {
  let values
  let positionals
  try {
    ;({ values, positionals } = parseArgs({
      args: [...argv],
      options: { help: { type: 'boolean', short: 'h' } },
      allowPositionals: true,
    }))
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`)
    return 1
  }
  if (values.help) {
    io.stdout(HELP)
    return 0
  }
  const [file, ...extra] = positionals
  if (file === undefined || extra.length > 0) {
    io.stderr(`Name exactly one backup file.\n\n${HELP}`)
    return 1
  }

  const result = await restoreDatabase(file, sqliteFilePath(loadDatabaseUrl(env)))
  io.stdout(`Checked ${result.restored}: integrity_check ok.\n`)
  io.stdout(
    result.keptAs === null
      ? `There was no database at ${result.target}, so nothing was kept.\n`
      : `Kept the replaced database as ${result.keptAs}.\n`,
  )
  if (result.removed.length > 0) io.stdout(`Removed stale ${result.removed.join(', ')}.\n`)
  io.stdout(`Restored ${result.restored} to ${result.target}. Start the server again.\n`)
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    loadEnvFileIfPresent()
    process.exitCode = await restoreCommand(process.argv.slice(2), process.env)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
