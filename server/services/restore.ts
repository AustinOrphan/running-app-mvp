import { copyFileSync, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { createBackup, integrityProblems } from './backup.ts'

/**
 * Replaces the database file with a backup (`npm run restore`). It runs while the server is
 * stopped, never inside it.
 */

export interface RestoreResult {
  /** The backup that was restored. */
  restored: string
  /** The database file that now holds it. */
  target: string
  /** The `pre-restore-<stamp>.db` copy of the database that was replaced; null when none existed. */
  keptAs: string | null
  /** The stale `-wal` and `-shm` files of the target that were removed. */
  removed: string[]
}

const SIDECARS = ['-wal', '-shm']

/**
 * Throws when another process has `file` open. `initSqlite` puts the server's connection in WAL
 * mode, and a WAL-mode connection stays open for as long as the server runs, holding the file's
 * shared locks. Asking for an exclusive lock is refused (`SQLITE_BUSY`) while any such connection
 * exists, even an idle one, and granted once the server has stopped, including after a crash that
 * left `-wal` and `-shm` files behind; SQLite then replays the log into the main file as it opens.
 */
function assertNotInUse(file: string): void {
  let db: Database.Database | undefined
  try {
    db = new Database(file, { fileMustExist: true, timeout: 0 })
    db.pragma('locking_mode = EXCLUSIVE')
    db.exec('BEGIN EXCLUSIVE; COMMIT')
  } catch (error) {
    if (error instanceof Database.SqliteError && error.code.startsWith('SQLITE_BUSY')) {
      const wal = existsSync(`${file}-wal`) ? ' (its -wal file exists)' : ''
      throw new Error(
        `${file} is open in another process${wal}, most likely the server. Stop the server, then restore.`,
      )
    }
    throw error
  } finally {
    db?.close()
  }
}

function removeIfPresent(file: string): boolean {
  try {
    unlinkSync(file)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/**
 * Puts `backupFile` in place of `databaseFile`, in this order. The backup is copied next to the
 * database and checked there with `integrity_check` (the backup itself is only read). The current
 * database, if any, must not be open elsewhere (`assertNotInUse`); it is then copied aside as
 * `pre-restore-<stamp>.db` in its `backups/` folder with the online backup, so a log left by a crash
 * is included. The target's stale `-wal` and `-shm` files are removed, because a log from the old
 * database must never be replayed into the new one, and the checked copy is renamed over the target.
 * Every refusal comes before the database file is replaced, and a failure removes the staged copy.
 */
export async function restoreDatabase(
  backupFile: string,
  databaseFile: string,
  opts: { now?: Date } = {},
): Promise<RestoreResult> {
  const source = resolve(backupFile)
  const target = resolve(databaseFile)
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`${source} is not a file.`)
  }
  const targetExists = existsSync(target)
  if (targetExists) {
    const a = statSync(source)
    const b = statSync(target)
    if (a.dev === b.dev && a.ino === b.ino) {
      throw new Error(`${source} is the database itself; name a backup file.`)
    }
  }
  const log = `${source}-wal`
  if (existsSync(log) && statSync(log).size > 0) {
    throw new Error(
      `${source} has an unmerged write-ahead log (${log}), so the file alone is not the whole ` +
        'database. Restore a file made by `npm run backup`.',
    )
  }

  mkdirSync(dirname(target), { recursive: true })
  const staged = `${target}.restoring`
  copyFileSync(source, staged)
  try {
    const problems = integrityProblems(staged)
    if (problems.length > 0) {
      throw new Error(`${source} failed integrity_check: ${problems.slice(0, 3).join('; ')}`)
    }
    let keptAs: string | null = null
    if (targetExists) {
      assertNotInUse(target)
      keptAs = (await createBackup(target, { kind: 'pre-restore', now: opts.now })).path
    }
    const removed: string[] = []
    for (const suffix of SIDECARS) {
      if (removeIfPresent(`${target}${suffix}`)) removed.push(`${target}${suffix}`)
    }
    renameSync(staged, target)
    return { restored: source, target, keptAs, removed }
  } catch (error) {
    removeIfPresent(staged)
    throw error
  }
}
