import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadEnvFileIfPresent } from '../server/config.ts'
import { loadDatabaseUrl, sqliteFilePath } from '../server/dbPath.ts'
import {
  backupDirectory,
  createBackup,
  migrationStatus,
  pruneBackups,
  RETENTION_RULE,
  type Retention,
} from '../server/services/backup.ts'
import { isMainModule } from './isMain.ts'

const HELP = `Usage: npm run backup -- [--keep <n>]
       npm run backup -- --before-migrate

Copies the database (DATABASE_URL, default file:./data/app.db) with SQLite's online backup, which
is safe while the server runs, and checks the copy with PRAGMA integrity_check. A copy that fails
the check is removed and the exit status is 1. The copy goes to backups/ in the folder of the
database file.

  (no flag)         app-<UTC timestamp>.db, then the older app-*.db files are pruned.
                    Default rule: ${RETENTION_RULE}.
  --keep <n>        Prune to the newest n app-*.db files instead of the default rule.
  --before-migrate  pre-migrate-<UTC timestamp>.db, with no pruning, and only when a folder in
                    prisma/migrations (relative to the working directory) is not yet applied to the
                    database. With no database file, none pending, or a failed migration recorded
                    (the migrate command refuses until it is resolved), nothing is copied and
                    the exit status is 0.

Only app-*.db files are pruned; pre-migrate and pre-restore copies stay until deleted by hand.
`

export interface Output {
  stdout(text: string): void
  stderr(text: string): void
}

const processOutput: Output = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
}

function formatSize(bytes: number): string {
  const units = ['KiB', 'MiB', 'GiB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    if (value < 1024) break
    value /= 1024
    unit = next
  }
  return `${unit === 'B' ? value : value.toFixed(1)} ${unit} (${bytes} bytes)`
}

/** Runs `npm run backup` with the given arguments and environment; returns the exit status. */
export async function backupCommand(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  io: Output = processOutput,
): Promise<number> {
  let values
  try {
    ;({ values } = parseArgs({
      args: [...argv],
      options: {
        'before-migrate': { type: 'boolean' },
        keep: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: false,
    }))
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`)
    return 1
  }
  if (values.help) {
    io.stdout(HELP)
    return 0
  }

  const beforeMigrate = values['before-migrate'] === true
  let retention: Retention | undefined
  if (values.keep !== undefined) {
    if (beforeMigrate) {
      io.stderr('--keep applies to ordinary backups; --before-migrate prunes nothing.\n')
      return 1
    }
    if (!/^[1-9]\d*$/.test(values.keep)) {
      io.stderr('--keep takes a whole number of at least 1.\n')
      return 1
    }
    retention = { newest: Number(values.keep) }
  }

  const databaseFile = sqliteFilePath(loadDatabaseUrl(env))
  if (!existsSync(databaseFile)) {
    if (beforeMigrate) {
      io.stdout(`No database at ${databaseFile}; nothing to copy before the migration.\n`)
      return 0
    }
    io.stderr(`No database at ${databaseFile}.\n`)
    return 1
  }

  if (beforeMigrate) {
    const migrations = migrationStatus(databaseFile, resolve('prisma', 'migrations'))
    if (migrations.failed.length > 0) {
      io.stdout(
        `A failed migration is recorded (${migrations.failed.join(', ')}); the migrate command ` +
          'will refuse until it is resolved, so no copy is made. Keep the pre-migrate copy from ' +
          'before the first attempt.\n',
      )
      return 0
    }
    if (!migrations.pending) {
      io.stdout('No migration is pending; no copy made before the migration.\n')
      return 0
    }
  }

  const copy = await createBackup(databaseFile, {
    kind: beforeMigrate ? 'pre-migrate' : 'ordinary',
  })
  io.stdout(`Backup written: ${copy.path}\nSize: ${formatSize(copy.bytes)}\nintegrity_check: ok\n`)
  if (!beforeMigrate) {
    const pruned = pruneBackups(backupDirectory(databaseFile), retention, basename(copy.path))
    if (pruned.length > 0) io.stdout(`Pruned ${pruned.length}: ${pruned.join(', ')}\n`)
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  try {
    loadEnvFileIfPresent()
    process.exitCode = await backupCommand(process.argv.slice(2), process.env)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
