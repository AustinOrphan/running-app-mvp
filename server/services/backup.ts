import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { mondayOf } from '../../shared/dates.ts'

/**
 * Copies of the SQLite file, made with SQLite's online backup so they are consistent while the
 * server writes. They sit in `backups/` next to the database file, named after the UTC time they
 * were made. A copy is checked with `PRAGMA integrity_check` before it gets its final name, so a
 * file named like a backup is a backup that passed.
 *
 * Three kinds exist. `ordinary` copies (`app-<stamp>.db`) come from the daily job and from
 * `npm run backup`, and are the only ones the retention rule prunes. `pre-migrate` copies are made
 * before `prisma migrate deploy`, and `pre-restore` copies by `npm run restore`; neither is ever
 * pruned automatically.
 */

export type BackupKind = 'ordinary' | 'pre-migrate' | 'pre-restore'

const PREFIX: Record<BackupKind, string> = {
  ordinary: 'app',
  'pre-migrate': 'pre-migrate',
  'pre-restore': 'pre-restore',
}
const ORDINARY_NAME = /^app-(\d{8}T\d{6}Z)\.db$/

/** Days and ISO weeks that the default rule keeps a backup for (the newest of each). */
export const KEEP_DAYS = 7
export const KEEP_WEEKS = 4

export type Retention = { newest: number } | { days: number; weeks: number }

/** The default rule: the newest backup of each of the last 7 days and of the last 4 ISO weeks. */
export const DEFAULT_RETENTION: Retention = { days: KEEP_DAYS, weeks: KEEP_WEEKS }

export interface BackupFile {
  name: string
  /** The UTC time in the name. */
  at: Date
}

export interface BackupResult {
  path: string
  bytes: number
}

/** The folder of the copies: `backups/` beside the database file. */
export function backupDirectory(databaseFile: string): string {
  return join(dirname(databaseFile), 'backups')
}

/** `20261101T020000Z`: the UTC time in digits, so that names sort in time order. */
export function backupStamp(at: Date): string {
  return at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
}

/** The time in a stamp made by `backupStamp`, or null when the digits are not a real time. */
export function parseBackupStamp(stamp: string): Date | null {
  const iso = stamp.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? null : at
}

export function backupName(kind: BackupKind, at: Date): string {
  return `${PREFIX[kind]}-${backupStamp(at)}.db`
}

/** What `PRAGMA integrity_check` reports on `file`; empty when it says `ok`. */
export function integrityProblems(file: string): string[] {
  let db: Database.Database | undefined
  try {
    db = new Database(file, { fileMustExist: true })
    const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>
    const messages = rows.map((row) => row.integrity_check)
    return messages.length === 1 && messages[0] === 'ok' ? [] : messages
  } catch (error) {
    // A file that is not a database, or is damaged beyond opening, is a finding, not a crash.
    if (error instanceof Database.SqliteError) return [error.message]
    throw error
  } finally {
    db?.close()
  }
}

export interface MigrationStatus {
  /** Whether `prisma migrate deploy` has a migration to apply (always false while one has failed). */
  pending: boolean
  /** Migrations that `_prisma_migrations` records as started and neither finished nor rolled back. */
  failed: string[]
}

/**
 * What `prisma migrate deploy` would find in `databaseFile`. A folder in `migrationsDir` that
 * `_prisma_migrations` does not list as finished (a rolled-back row counts as not finished) is
 * pending. A row that was started and neither finished nor rolled back is a failed migration:
 * `migrate deploy` refuses with P3009 until it is resolved, so nothing is pending in the sense of
 * "a migration is about to run", and the database holds a half-applied schema that no new copy
 * should replace in `backups/` (the copy from before the first attempt is the one to keep). When
 * the state cannot be read (no folder, no table) a migration counts as pending, because a copy that
 * was not needed costs a file and one that was needed and skipped costs the data.
 */
export function migrationStatus(databaseFile: string, migrationsDir: string): MigrationStatus {
  let db: Database.Database | undefined
  try {
    const folders = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    db = new Database(databaseFile, { fileMustExist: true })
    const rows = db
      .prepare('SELECT migration_name AS name, finished_at, rolled_back_at FROM _prisma_migrations')
      .all() as Array<{ name: string; finished_at: unknown; rolled_back_at: unknown }>
    const failed = rows
      .filter((row) => row.finished_at === null && row.rolled_back_at === null)
      .map((row) => row.name)
    const applied = new Set(
      rows
        .filter((row) => row.finished_at !== null && row.rolled_back_at === null)
        .map((row) => row.name),
    )
    return { pending: failed.length === 0 && folders.some((name) => !applied.has(name)), failed }
  } catch {
    return { pending: true, failed: [] }
  } finally {
    db?.close()
  }
}

/** Whether a copy is due before `prisma migrate deploy`: see `migrationStatus`. */
export function hasPendingMigrations(databaseFile: string, migrationsDir: string): boolean {
  return migrationStatus(databaseFile, migrationsDir).pending
}

function discard(file: string): void {
  try {
    unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/**
 * Copies `databaseFile` into its `backups/` folder as a file of `kind` and returns its path and
 * size. The copy is written under a `.partial` name, checked, and renamed only when
 * `integrity_check` says `ok`; otherwise it is removed and this throws, so a failed backup leaves
 * no file that looks like one. The source is opened as an ordinary connection (a read-only one
 * would leave `-wal` and `-shm` files behind when the server is stopped), and only read.
 */
export async function createBackup(
  databaseFile: string,
  opts: { kind: BackupKind; now?: Date },
): Promise<BackupResult> {
  const dir = backupDirectory(databaseFile)
  const path = join(dir, backupName(opts.kind, opts.now ?? new Date()))
  const partial = `${path}.partial`

  // Opening first means a missing database fails before any folder is made for it.
  const source = new Database(databaseFile, { fileMustExist: true })
  try {
    mkdirSync(dir, { recursive: true })
    await source.backup(partial)
  } catch (error) {
    discard(partial)
    throw error
  } finally {
    source.close()
  }

  const problems = integrityProblems(partial)
  if (problems.length > 0) {
    discard(partial)
    throw new Error(
      `The copy of ${databaseFile} failed integrity_check and was removed: ${problems
        .slice(0, 3)
        .join('; ')}`,
    )
  }
  renameSync(partial, path)
  return { path, bytes: statSync(path).size }
}

function newestFirst(a: BackupFile, b: BackupFile): number {
  return b.at.getTime() - a.at.getTime() || (a.name < b.name ? 1 : -1)
}

/** The `app-<stamp>.db` files in `dir`, newest first. Other files are not backups of this kind. */
export function listOrdinaryBackups(dir: string): BackupFile[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: BackupFile[] = []
  for (const name of names) {
    const stamp = ORDINARY_NAME.exec(name)?.[1]
    const at = stamp === undefined ? null : parseBackupStamp(stamp)
    if (at !== null) files.push({ name, at })
  }
  return files.sort(newestFirst)
}

/**
 * Adds to `kept` the newest file of each of the `limit` most recent buckets that hold a file. The
 * buckets are counted among days (or weeks) that have a backup, not on the calendar, so a server
 * that was off for a fortnight keeps its last backups instead of pruning them all.
 */
function keepNewestPerBucket(
  files: readonly BackupFile[],
  bucketOf: (at: Date) => string,
  limit: number,
  kept: Set<string>,
): void {
  const seen = new Set<string>()
  for (const file of files) {
    const bucket = bucketOf(file.at)
    if (seen.has(bucket)) continue
    if (seen.size === limit) break
    seen.add(bucket)
    kept.add(file.name)
  }
}

const utcDay = (at: Date): string => at.toISOString().slice(0, 10)
/** The Monday of the UTC week: one key per ISO week. */
const utcWeek = (at: Date): string => mondayOf(utcDay(at))

/**
 * The backups that `retention` does not keep, newest first. `{ newest: n }` keeps the newest n;
 * the default rule keeps the newest backup of each of the 7 most recent days (UTC) that have one,
 * and the newest of each of the 4 most recent ISO weeks that have one. The newest backup is always
 * kept, and so is `protectedName` when given.
 */
export function selectPruned(
  files: readonly BackupFile[],
  retention: Retention = DEFAULT_RETENTION,
  protectedName?: string,
): BackupFile[] {
  const sorted = [...files].sort(newestFirst)
  const kept = new Set<string>()
  if ('newest' in retention) {
    for (const file of sorted.slice(0, Math.max(1, retention.newest))) kept.add(file.name)
  } else {
    keepNewestPerBucket(sorted, utcDay, retention.days, kept)
    keepNewestPerBucket(sorted, utcWeek, retention.weeks, kept)
  }
  if (protectedName !== undefined) kept.add(protectedName)
  return sorted.filter((file) => !kept.has(file.name))
}

/**
 * Removes the ordinary backups in `dir` that `retention` does not keep; returns their names. The
 * file named `protectedName` stays whatever its stamp: the backup just written must not be pruned
 * by the run that reports it, as it would be after the clock was set back.
 */
export function pruneBackups(
  dir: string,
  retention: Retention = DEFAULT_RETENTION,
  protectedName?: string,
): string[] {
  const pruned = selectPruned(listOrdinaryBackups(dir), retention, protectedName)
  for (const file of pruned) discard(join(dir, file.name))
  return pruned.map((file) => file.name)
}

/** The rule in words, for the help text and the README. */
export const RETENTION_RULE =
  `the newest backup of each of the ${KEEP_DAYS} most recent days (UTC) that have one, and the ` +
  `newest of each of the ${KEEP_WEEKS} most recent ISO weeks that have one`
