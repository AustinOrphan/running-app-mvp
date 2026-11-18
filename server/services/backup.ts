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
 * `npm run backup`, and are pruned by the retention rule. `pre-migrate` copies are made before
 * `prisma migrate deploy` and `pre-restore` copies, made by `npm run restore`, are pruned by one
 * shared rule (`prunePreMigrateBackups`, `prunePreRestoreBackups`): older than `KEEP_PRE_MIGRATE_DAYS`
 * goes, except the newest `KEEP_PRE_MIGRATE_MIN` of the kind (owner decisions 2026-11-17 and
 * 2026-11-18).
 */

export type BackupKind = 'ordinary' | 'pre-migrate' | 'pre-restore'

const PREFIX: Record<BackupKind, string> = {
  ordinary: 'app',
  'pre-migrate': 'pre-migrate',
  'pre-restore': 'pre-restore',
}
const ORDINARY_NAME = /^app-(\d{8}T\d{6}Z)\.db$/
const PRE_MIGRATE_NAME = /^pre-migrate-(\d{8}T\d{6}Z)\.db$/
const PRE_RESTORE_NAME = /^pre-restore-(\d{8}T\d{6}Z)\.db$/
/** A copy of a damaged database is kept with its `-wal` and `-shm` files beside it. */
const SIDECAR_SUFFIXES = ['-wal', '-shm']

/**
 * Days and ISO weeks that the default rule keeps a backup for (the newest of each). Three weeks,
 * not four, so that a deleted account leaves every copy within 30 days: Strava API Policy 7.4
 * asks for deletion within 30 days of a revocation or a request (SC1, ADR 0025).
 */
export const KEEP_DAYS = 7
export const KEEP_WEEKS = 3

/**
 * A pre-update (`pre-migrate`) copy is removed once it is older than this, unless it is one of the
 * newest `KEEP_PRE_MIGRATE_MIN`, which stay whatever their age (owner decision 2026-11-17).
 * `pre-restore` copies follow the same two numbers, counted per kind (owner decision 2026-11-18):
 * both kinds are a safety copy of the whole database taken before a change the operator runs, so one
 * rule is the simplest true statement for the data notice, and nothing about a restore needs a
 * different window. The names keep `PRE_MIGRATE` because the rule began there.
 */
export const KEEP_PRE_MIGRATE_DAYS = 30
export const KEEP_PRE_MIGRATE_MIN = 3

/**
 * Days that the off-host job keeps a daily snapshot of the newest `app-*.db` (29 daily snapshots;
 * 30 under decision D1 until SC1, which needs `1 + 29` to stay within 30 days). A requirement on a
 * job outside this repository, stated in the README.
 */
export const OFF_HOST_SNAPSHOT_DAYS = 29

const DAY_MS = 86_400_000

/**
 * The longest time, in days, that a deleted account can stay in the copies while every job runs
 * on its schedule. The figure behind the tester data notice (README, "Data notice").
 *
 * - `localDays`: an ordinary copy is the newest of one of `KEEP_WEEKS` ISO weeks at most, so it goes
 *   within `KEEP_WEEKS` weeks and the part of the week it was made in: `KEEP_WEEKS + 1` weeks.
 *   A pre-update copy goes after `KEEP_PRE_MIGRATE_DAYS`, so the ordinary bound is the longer one.
 * - `offHostDays`: the off-host job reads only the newest `app-*.db`, which stops holding the
 *   account at the next daily copy (one day), and its snapshot lives `OFF_HOST_SNAPSHOT_DAYS`.
 *
 * A `pre-restore` copy goes after the same `KEEP_PRE_MIGRATE_DAYS`, so `localDays` is unchanged.
 *
 * Not counted: the newest `KEEP_PRE_MIGRATE_MIN` copies of each of the pre-update and pre-restore
 * kinds, which stay until later ones push them out; copies made by hand;
 * `npm run backup -- --keep`.
 */
export function deletedAccountRetention(): {
  localDays: number
  offHostDays: number
  longestDays: number
} {
  const localDays = Math.max((KEEP_WEEKS + 1) * 7, KEEP_PRE_MIGRATE_DAYS)
  const offHostDays = 1 + OFF_HOST_SNAPSHOT_DAYS
  return { localDays, offHostDays, longestDays: Math.max(localDays, offHostDays) }
}

export type Retention = { newest: number } | { days: number; weeks: number }

/** The default rule: the newest backup of each of the last 7 days and of the last 3 ISO weeks. */
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

/** The `pre-migrate-<stamp>.db` or `pre-restore-<stamp>.db` files in `dir`, newest first. */
function listSafetyCopies(dir: string, pattern: RegExp): BackupFile[] {
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: BackupFile[] = []
  for (const name of names) {
    const stamp = pattern.exec(name)?.[1]
    const at = stamp === undefined ? null : parseBackupStamp(stamp)
    if (at !== null) files.push({ name, at })
  }
  return files.sort(newestFirst)
}

/**
 * Removes the copies of one safety kind in `dir` that are older than `KEEP_PRE_MIGRATE_DAYS` at
 * `now`, except the newest `KEEP_PRE_MIGRATE_MIN` whatever their age. Idempotent. It lists only
 * names of the kind's anchored pattern inside `dir`, so the live database, the other kinds and every
 * other file stay. A removed copy takes its `-wal` and `-shm` files with it (a damaged database is
 * kept with them), and nothing else is ever unlinked. Housekeeping must never block an update or a
 * restore: a file that cannot be removed is skipped, and the result names the files removed and the
 * ones that failed.
 */
function pruneSafetyCopies(
  dir: string,
  pattern: RegExp,
  now: Date,
): { removed: string[]; failed: string[] } {
  const cutoff = now.getTime() - KEEP_PRE_MIGRATE_DAYS * DAY_MS
  const candidates = listSafetyCopies(dir, pattern)
    .slice(KEEP_PRE_MIGRATE_MIN)
    .filter((file) => file.at.getTime() < cutoff)
  const removed: string[] = []
  const failed: string[] = []
  for (const file of candidates) {
    try {
      // The sidecars first and the `.db` last: only `*.db` is listed, so a failure part way keeps
      // the copy listed and the next run retries it, instead of orphaning a sidecar.
      for (const suffix of SIDECAR_SUFFIXES) discard(join(dir, `${file.name}${suffix}`))
      discard(join(dir, file.name))
      removed.push(file.name)
    } catch {
      failed.push(file.name)
    }
  }
  return { removed, failed }
}

/** Prunes the `pre-migrate` copies in `dir` by the safety-copy rule. */
export function prunePreMigrateBackups(
  dir: string,
  now: Date = new Date(),
): { removed: string[]; failed: string[] } {
  return pruneSafetyCopies(dir, PRE_MIGRATE_NAME, now)
}

/**
 * Prunes the `pre-restore` copies in `dir` by the same rule. A restore calls it after it has made
 * its copy: that copy is the newest of its kind, so the newest-`KEEP_PRE_MIGRATE_MIN` floor keeps
 * it, and it is the rollback for that restore.
 */
export function prunePreRestoreBackups(
  dir: string,
  now: Date = new Date(),
): { removed: string[]; failed: string[] } {
  return pruneSafetyCopies(dir, PRE_RESTORE_NAME, now)
}

/** The rule in words, for the help text and the README. */
export const RETENTION_RULE =
  `the newest backup of each of the ${KEEP_DAYS} most recent days (UTC) that have one, and the ` +
  `newest of each of the ${KEEP_WEEKS} most recent ISO weeks that have one`
