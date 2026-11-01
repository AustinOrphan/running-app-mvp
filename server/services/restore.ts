import {
  chmodSync,
  chownSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  type Stats,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { backupDirectory, backupName, createBackup, integrityProblems } from './backup.ts'

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
  /**
   * True when `keptAs` is a byte-for-byte copy (with the `-wal` and `-shm` files beside it) because
   * SQLite could not make a consistent one: the database that was replaced was damaged.
   */
  keptAsIs: boolean
  /** The stale `-wal` and `-shm` files of the target that were removed. */
  removed: string[]
}

const SIDECARS = ['-wal', '-shm']

/**
 * A `-wal` or `-shm` file written within this long means a process may still have the database
 * open. It is the only check there is for a database that SQLite cannot open, where the lock check
 * below has nothing to ask, and it comes first for every database because SQLite deletes the two
 * files when it closes the last connection to a database it can open.
 */
const QUIET_MS = 10_000

/**
 * Refuses when the `-wal` or `-shm` file of `file` was written within ten seconds of now. A server
 * that has stopped writes nothing, so this only catches one that is still running; stopping it
 * first stays the rule. The distance is absolute: a file stamped far in the future (the clock was
 * set back since it was written) is as stale as one stamped long ago, not busy until the clock
 * catches up, while a stamp a few seconds ahead (a skew between clocks) still counts as recent.
 */
function assertQuiet(file: string): void {
  for (const suffix of SIDECARS) {
    const sibling = `${file}${suffix}`
    if (existsSync(sibling) && Math.abs(Date.now() - statSync(sibling).mtimeMs) < QUIET_MS) {
      throw new Error(
        `${file} may be open in another process, most likely the server: ${sibling} was written ` +
          `in the last ${QUIET_MS / 1000} seconds. Stop the server, wait a few seconds, then restore.`,
      )
    }
  }
}

/**
 * Throws when another process has `file` open, and says whether SQLite could read it at all.
 * `initSqlite` puts the server's connection in WAL mode, and a WAL-mode connection stays open for
 * as long as the server runs, holding the file's shared locks. Asking for an exclusive lock is
 * refused (`SQLITE_BUSY`) while any such connection exists, even an idle one, and granted once the
 * server has stopped, including after a crash that left `-wal` and `-shm` files behind; SQLite then
 * replays the log into the main file as it opens. A file that is garbage or damaged fails to open
 * or to read its schema for another reason, and is reported `unreadable`.
 */
function probeLock(file: string): 'free' | 'unreadable' {
  let db: Database.Database | undefined
  try {
    db = new Database(file, { fileMustExist: true, timeout: 0 })
    db.pragma('locking_mode = EXCLUSIVE')
    db.exec('BEGIN EXCLUSIVE')
    // The lock alone never reads the file; reading the schema is what finds garbage.
    db.prepare('SELECT count(*) FROM sqlite_master').get()
    db.exec('COMMIT')
    return 'free'
  } catch (error) {
    if (error instanceof Database.SqliteError) {
      if (error.code.startsWith('SQLITE_BUSY')) {
        const wal = existsSync(`${file}-wal`) ? ' (its -wal file exists)' : ''
        throw new Error(
          `${file} is open in another process${wal}, most likely the server. Stop the server, then restore.`,
        )
      }
      return 'unreadable'
    }
    throw error
  } finally {
    db?.close()
  }
}

/** Copies `from` and the `-wal` and `-shm` files beside it, where they exist, to `to` and beside it. */
function copyWithSidecars(from: string, to: string): void {
  copyFileSync(from, to)
  for (const suffix of SIDECARS) {
    if (existsSync(`${from}${suffix}`)) copyFileSync(`${from}${suffix}`, `${to}${suffix}`)
  }
}

function removeWithSidecars(file: string): void {
  for (const suffix of ['', ...SIDECARS]) removeIfPresent(`${file}${suffix}`)
}

function renameWithSidecars(from: string, to: string): void {
  renameSync(from, to)
  for (const suffix of SIDECARS) {
    if (existsSync(`${from}${suffix}`)) renameSync(`${from}${suffix}`, `${to}${suffix}`)
    else removeIfPresent(`${to}${suffix}`)
  }
}

/**
 * Keeps the database that is about to be replaced as `pre-restore-<stamp>.db` in its `backups/`
 * folder, and says whether the copy is byte for byte. The files are first copied as they are, with
 * their `-wal` and `-shm` files, before SQLite opens them: opening a database replays and deletes
 * the log, which is right for a sound database and would lose it for a damaged one. A database that
 * SQLite can read is then copied again with the online backup (a log left by a crash is included,
 * and the copy is checked), and the first copy is dropped. A damaged one, which SQLite cannot copy
 * consistently, keeps the first copy under the final name. Throws, and keeps nothing (a first copy
 * that failed part way is removed too), when the database is open in another process or a copy
 * fails.
 */
async function keepAside(
  target: string,
  now: Date | undefined,
): Promise<{ path: string; asIs: boolean }> {
  const dir = backupDirectory(target)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, backupName('pre-restore', now ?? new Date()))
  const raw = `${path}.raw`
  try {
    copyWithSidecars(target, raw)
    if (probeLock(target) === 'free') {
      try {
        const copy = await createBackup(target, { kind: 'pre-restore', now })
        removeWithSidecars(raw)
        return { path: copy.path, asIs: false }
      } catch {
        // The online backup failed, or its copy failed integrity_check: the database is damaged.
        // The first copy becomes the pre-restore file; it was made by plain file copies, which
        // throw too when the cause was the disk or permissions.
      }
    }
    renameWithSidecars(raw, path)
    return { path, asIs: true }
  } catch (error) {
    removeWithSidecars(raw)
    throw error
  }
}

/**
 * The restored file takes the mode and owner of the file it replaces, where the process may set
 * them: a read-only backup, or a restore run as root, must not leave a database that the server
 * (its own user) cannot write. With nothing to replace, the owner can read and write it.
 */
function carryOver(staged: string, replaced: Stats | undefined, fromBackup: Stats): void {
  if (replaced === undefined) {
    chmodSync(staged, (fromBackup.mode | 0o600) & 0o777)
    return
  }
  chmodSync(staged, replaced.mode & 0o7777)
  try {
    chownSync(staged, replaced.uid, replaced.gid)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error
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
 * database, if any, must not be open elsewhere (`assertQuiet`, then the lock in `keepAside`); it is
 * then kept as `pre-restore-<stamp>.db`, byte for byte when it is damaged, so that a damaged
 * database can be restored over. The target's stale `-wal` and `-shm` files are removed, because a
 * log from the old database must never be replayed into the new one, and the checked copy, with
 * the mode and owner of the file it replaces, is renamed over the target. Every refusal comes
 * before the database file is replaced, and a failure removes the staged copy.
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
  const sourceStat = statSync(source)
  const replaced = existsSync(target) ? statSync(target) : undefined
  if (
    replaced !== undefined &&
    sourceStat.dev === replaced.dev &&
    sourceStat.ino === replaced.ino
  ) {
    throw new Error(`${source} is the database itself; name a backup file.`)
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
    let keptAsIs = false
    if (replaced !== undefined) {
      assertQuiet(target)
      const kept = await keepAside(target, opts.now)
      keptAs = kept.path
      keptAsIs = kept.asIs
    }
    const removed: string[] = []
    for (const suffix of SIDECARS) {
      if (removeIfPresent(`${target}${suffix}`)) removed.push(`${target}${suffix}`)
    }
    carryOver(staged, replaced, sourceStat)
    renameSync(staged, target)
    return { restored: source, target, keptAs, keptAsIs, removed }
  } catch (error) {
    removeIfPresent(staged)
    throw error
  }
}
