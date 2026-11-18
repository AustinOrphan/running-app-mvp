import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { loadDatabaseUrl, sqliteFilePath } from '../../../server/dbPath.ts'
import {
  backupDirectory,
  backupName,
  backupStamp,
  createBackup,
  DEFAULT_RETENTION,
  deletedAccountRetention,
  hasPendingMigrations,
  KEEP_PRE_MIGRATE_DAYS,
  KEEP_PRE_MIGRATE_MIN,
  OFF_HOST_SNAPSHOT_DAYS,
  prunePreMigrateBackups,
  prunePreRestoreBackups,
  migrationStatus,
  integrityProblems,
  listOrdinaryBackups,
  parseBackupStamp,
  pruneBackups,
  selectPruned,
  type BackupFile,
} from '../../../server/services/backup.ts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-backup-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A WAL-mode database like the server's, with `rows` rows in one table. */
function makeDatabase(file: string, rows = 5): void {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  const insert = db.prepare('INSERT INTO note (body) VALUES (?)')
  // One transaction: every autocommit insert is a synced write, which a loaded runner makes slow.
  db.transaction(() => {
    for (let i = 0; i < rows; i += 1) insert.run(`row ${i}`)
  })()
  db.close()
}

function countRows(file: string): number {
  const db = new Database(file)
  try {
    return (db.prepare('SELECT count(*) AS n FROM note').get() as { n: number }).n
  } finally {
    db.close()
  }
}

const AT = new Date('2026-11-01T02:00:00Z')

describe('names', () => {
  test('a stamp is the UTC time in digits, and parses back', () => {
    expect(backupStamp(AT)).toBe('20261101T020000Z')
    expect(backupStamp(new Date('2026-12-31T23:59:59.999Z'))).toBe('20261231T235959Z')
    expect(parseBackupStamp('20261101T020000Z')).toEqual(AT)
    expect(parseBackupStamp('20261301T020000Z')).toBeNull()
    expect(parseBackupStamp('not-a-stamp')).toBeNull()
  })

  test('each kind has its own prefix', () => {
    expect(backupName('ordinary', AT)).toBe('app-20261101T020000Z.db')
    expect(backupName('pre-migrate', AT)).toBe('pre-migrate-20261101T020000Z.db')
    expect(backupName('pre-restore', AT)).toBe('pre-restore-20261101T020000Z.db')
  })

  test('the folder is backups/ beside the database file', () => {
    expect(backupDirectory('/data/app.db')).toBe('/data/backups')
  })
})

describe('database location', () => {
  test('DATABASE_URL has the default of the server, and an empty value counts as unset', () => {
    expect(loadDatabaseUrl({})).toBe('file:./data/app.db')
    expect(loadDatabaseUrl({ DATABASE_URL: '' })).toBe('file:./data/app.db')
    expect(loadDatabaseUrl({ DATABASE_URL: 'file:/data/app.db' })).toBe('file:/data/app.db')
  })

  test('a relative path resolves against prisma/, as the client does; a query string is dropped', () => {
    expect(sqliteFilePath('file:/data/app.db')).toBe('/data/app.db')
    expect(sqliteFilePath('file:/data/app.db?connection_limit=1')).toBe('/data/app.db')
    expect(sqliteFilePath('file:./data/app.db')).toBe(resolve(process.cwd(), 'prisma/data/app.db'))
  })

  test('a URL that is not a file: URL is refused', () => {
    expect(() => sqliteFilePath('postgres://localhost/app')).toThrow(/file: URL/)
  })
})

describe('integrityProblems', () => {
  test('is empty for a sound database', () => {
    const file = join(dir, 'a.db')
    makeDatabase(file)
    expect(integrityProblems(file)).toEqual([])
  })

  test('reports a file that is not a database', () => {
    const file = join(dir, 'text.db')
    writeFileSync(file, 'this is not a SQLite file, only text that is long enough to be read')
    expect(integrityProblems(file)).not.toEqual([])
  })
})

describe('createBackup', () => {
  test('copies a database that a connection still has open, and checks the copy', async () => {
    const file = join(dir, 'app.db')
    makeDatabase(file, 20)
    // The server's connection: open, in WAL mode, with a write the main file may not hold yet.
    const live = new Database(file)
    live.pragma('journal_mode = WAL')
    live.exec("INSERT INTO note (body) VALUES ('written while open')")
    try {
      const result = await createBackup(file, { kind: 'ordinary', now: AT })
      expect(result.path).toBe(join(dir, 'backups', 'app-20261101T020000Z.db'))
      expect(result.bytes).toBeGreaterThan(0)
      expect(integrityProblems(result.path)).toEqual([])
      expect(countRows(result.path)).toBe(21)
    } finally {
      live.close()
    }
  })

  test('leaves only the finished copy: no partial file and no -wal or -shm beside it', async () => {
    const file = join(dir, 'app.db')
    makeDatabase(file)
    await createBackup(file, { kind: 'ordinary', now: AT })
    expect(readdirSync(join(dir, 'backups'))).toEqual(['app-20261101T020000Z.db'])
  })

  test('names a copy before a migration or a restore after its kind', async () => {
    const file = join(dir, 'app.db')
    makeDatabase(file)
    const migrate = await createBackup(file, { kind: 'pre-migrate', now: AT })
    const restore = await createBackup(file, { kind: 'pre-restore', now: AT })
    expect(migrate.path.endsWith('pre-migrate-20261101T020000Z.db')).toBe(true)
    expect(restore.path.endsWith('pre-restore-20261101T020000Z.db')).toBe(true)
  })

  test('fails on a missing database without creating one', async () => {
    const file = join(dir, 'missing.db')
    await expect(createBackup(file, { kind: 'ordinary', now: AT })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual([])
  })

  test('removes a copy of a damaged database and throws, so no file looks like a backup', async () => {
    const file = join(dir, 'app.db')
    const db = new Database(file)
    db.exec('CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
    db.exec('CREATE INDEX note_body ON note (body)')
    const insert = db.prepare('INSERT INTO note (body) VALUES (?)')
    // A few pages are enough, written in one transaction: 3000 autocommit inserts took two seconds
    // here, and over five on a loaded CI runner, all of it in the synced writes of the build.
    db.transaction(() => {
      for (let i = 0; i < 150; i += 1) insert.run(`row ${i} ${'x'.repeat(40)}`)
    })()
    db.close()
    // Page 3 is the root of the index, the page after the table's root: overwrite all of it.
    const bytes = readFileSync(file)
    bytes.fill(0xff, 2 * 4096, 3 * 4096)
    writeFileSync(file, bytes)
    expect(integrityProblems(file)).not.toEqual([])

    await expect(createBackup(file, { kind: 'ordinary', now: AT })).rejects.toThrow()
    expect(readdirSync(join(dir, 'backups'))).toEqual([])
  })
})

function file(stamp: string): BackupFile {
  const at = parseBackupStamp(stamp)
  if (at === null) throw new Error(`bad stamp ${stamp}`)
  return { name: `app-${stamp}.db`, at }
}

/** One file per day from 2026-10-01 to 2026-10-31 at 02:00 UTC, and a later one on the 31st. */
function october(): BackupFile[] {
  const files: BackupFile[] = []
  for (let day = 1; day <= 31; day += 1) {
    files.push(file(`202610${String(day).padStart(2, '0')}T020000Z`))
  }
  files.push(file('20261031T030000Z'))
  return files
}

const names = (files: readonly BackupFile[]): string[] => files.map((f) => f.name)

describe('selectPruned', () => {
  test('the default rule keeps the newest of each of 7 days and of 4 ISO weeks', () => {
    const files = october()
    const pruned = new Set(names(selectPruned(files)))
    const kept = names(files).filter((name) => !pruned.has(name))
    expect(kept.sort()).toEqual(
      [
        // The last 7 days: the 31st keeps only its newest copy.
        'app-20261031T030000Z.db',
        'app-20261030T020000Z.db',
        'app-20261029T020000Z.db',
        'app-20261028T020000Z.db',
        'app-20261027T020000Z.db',
        'app-20261026T020000Z.db',
        'app-20261025T020000Z.db',
        // Sundays closing the weeks of Monday 10-19, 10-12 and 10-05 (the 25th is also a day above).
        'app-20261018T020000Z.db',
        'app-20261011T020000Z.db',
      ].sort(),
    )
    expect(pruned.size).toBe(files.length - 9)
  })

  test('a week is Monday to Sunday: a Sunday night and the next Monday morning are different weeks', () => {
    const files = [
      // The last 7 days, one copy each.
      file('20261031T020000Z'),
      file('20261030T020000Z'),
      file('20261029T020000Z'),
      file('20261028T020000Z'),
      file('20261027T020000Z'),
      file('20261026T020000Z'),
      file('20261025T020000Z'),
      // Older, in pairs: a Monday morning and the Sunday night that closes the same week
      // (2026-10-19 and 2026-10-12 and 2026-10-05 are Mondays), and one more week back.
      file('20261019T010000Z'),
      file('20261018T230000Z'),
      file('20261012T010000Z'),
      file('20261011T230000Z'),
      file('20261005T010000Z'),
      file('20261004T230000Z'),
    ]
    // The weeks of Monday 10-26 and 10-19 are served by the daily copies of the 31st and the 25th.
    // The Sunday copies of the 18th and the 11th close the weeks of 10-12 and 10-05 and stay; the
    // Monday copies of those weeks are older than them and go, and the fifth week is out.
    expect(names(selectPruned(files))).toEqual([
      'app-20261019T010000Z.db',
      'app-20261012T010000Z.db',
      'app-20261005T010000Z.db',
      'app-20261004T230000Z.db',
    ])
  })

  test('counts days and weeks that have a backup, so a long gap keeps the last ones', () => {
    const files = [file('20260301T020000Z'), file('20260302T020000Z'), file('20260303T020000Z')]
    expect(selectPruned(files, DEFAULT_RETENTION)).toEqual([])
  })

  test('keeps the newest n with { newest: n }, and never fewer than one', () => {
    const files = october().slice(0, 6)
    expect(names(selectPruned(files, { newest: 2 }))).toEqual([
      'app-20261004T020000Z.db',
      'app-20261003T020000Z.db',
      'app-20261002T020000Z.db',
      'app-20261001T020000Z.db',
    ])
    expect(selectPruned(files, { newest: 0 })).toHaveLength(5)
  })

  test('never lists the protected file, even when the rule would drop it (a clock set back)', () => {
    // Seven days newer than the copy just written, over four weeks: the rule fills up without it.
    const newer = [
      '20990105T020000Z',
      '20990106T020000Z',
      '20990107T020000Z',
      '20990114T020000Z',
      '20990121T020000Z',
      '20990128T020000Z',
      '20990204T020000Z',
    ].map(file)
    const written = file('20261101T020000Z')
    expect(names(selectPruned([...newer, written]))).toEqual([written.name])
    expect(names(selectPruned([...newer, written], DEFAULT_RETENTION, written.name))).toEqual([])
    expect(names(selectPruned([...newer, written], { newest: 3 }, written.name))).toHaveLength(
      newer.length - 3,
    )
  })

  test('prunes nothing from an empty list', () => {
    expect(selectPruned([])).toEqual([])
  })
})

describe('pruneBackups', () => {
  test('removes only ordinary backups the rule drops; other files stay', () => {
    const backups = join(dir, 'backups')
    mkdirSync(backups)
    for (const f of october()) writeFileSync(join(backups, f.name), 'x')
    const others = [
      'pre-migrate-20260101T000000Z.db',
      'pre-restore-20260101T000000Z.db',
      'app-20260101T000000Z.db.partial',
      'app-notastamp.db',
      'notes.txt',
    ]
    for (const name of others) writeFileSync(join(backups, name), 'x')

    const removed = pruneBackups(backups)

    expect(removed).toHaveLength(23)
    const left = readdirSync(backups)
    expect(left).toHaveLength(9 + others.length)
    for (const name of others) expect(left).toContain(name)
    expect(left).toContain('app-20261031T030000Z.db')
    expect(left).not.toContain('app-20261031T020000Z.db')
  })

  test('with { newest: n } keeps the newest n', () => {
    const backups = join(dir, 'backups')
    mkdirSync(backups)
    for (const f of october().slice(0, 5)) writeFileSync(join(backups, f.name), 'x')
    pruneBackups(backups, { newest: 2 })
    expect(readdirSync(backups).sort()).toEqual([
      'app-20261004T020000Z.db',
      'app-20261005T020000Z.db',
    ])
  })

  test('a folder that does not exist has nothing to prune', () => {
    expect(pruneBackups(join(dir, 'none'))).toEqual([])
    expect(listOrdinaryBackups(join(dir, 'none'))).toEqual([])
  })
})

describe('prunePreMigrateBackups', () => {
  const NOW = new Date('2026-11-17T12:00:00Z')
  const stamp = (name: string): string => `pre-migrate-${name}.db`

  function seed(names: string[]): string {
    const backups = join(dir, 'backups')
    mkdirSync(backups)
    for (const name of names) writeFileSync(join(backups, name), 'x')
    return backups
  }

  test('removes copies older than 30 days and keeps the newest 3 and the recent ones', () => {
    const backups = seed([
      stamp('20260101T000000Z'),
      stamp('20260201T000000Z'),
      stamp('20260301T000000Z'),
      stamp('20261001T000000Z'),
      stamp('20261110T000000Z'),
      stamp('20261116T000000Z'),
    ])
    const { removed, failed } = prunePreMigrateBackups(backups, NOW)
    expect(failed).toEqual([])
    expect(removed).toEqual([
      stamp('20260301T000000Z'),
      stamp('20260201T000000Z'),
      stamp('20260101T000000Z'),
    ])
    expect(readdirSync(backups).sort()).toEqual([
      stamp('20261001T000000Z'),
      stamp('20261110T000000Z'),
      stamp('20261116T000000Z'),
    ])
  })

  test('keeps the newest 3 whatever their age', () => {
    const backups = seed([
      stamp('20250101T000000Z'),
      stamp('20250201T000000Z'),
      stamp('20250301T000000Z'),
      stamp('20250401T000000Z'),
    ])
    expect(prunePreMigrateBackups(backups, NOW).removed).toEqual([stamp('20250101T000000Z')])
    expect(readdirSync(backups)).toHaveLength(3)
  })

  test('a copy exactly 30 days old stays; one a second older goes when not in the newest 3', () => {
    const backups = seed([
      stamp('20261018T120000Z'),
      stamp('20261018T115959Z'),
      stamp('20261117T000000Z'),
      stamp('20261116T000000Z'),
      stamp('20261115T000000Z'),
    ])
    expect(prunePreMigrateBackups(backups, NOW).removed).toEqual([stamp('20261018T115959Z')])
    expect(readdirSync(backups)).toContain(stamp('20261018T120000Z'))
  })

  test('leaves other files, the live database and its folder neighbours untouched', () => {
    const live = join(dir, 'app.db')
    writeFileSync(live, 'live')
    const others = [
      'app-20250101T000000Z.db',
      'pre-restore-20250101T000000Z.db',
      'pre-migrate-20250101T000000Z.db.partial',
      'pre-migrate-notastamp.db',
      'notes.txt',
    ]
    const backups = seed([
      ...others,
      stamp('20250101T000000Z'),
      stamp('20250102T000000Z'),
      stamp('20250103T000000Z'),
      stamp('20250104T000000Z'),
    ])
    prunePreMigrateBackups(backups, NOW)
    const left = readdirSync(backups)
    for (const name of others) expect(left).toContain(name)
    expect(left).not.toContain(stamp('20250101T000000Z'))
    expect(readFileSync(live, 'utf8')).toBe('live')
  })

  test('is idempotent and a missing folder has nothing to prune', () => {
    const backups = seed([stamp('20250101T000000Z'), stamp('20250102T000000Z')])
    const nothing = { removed: [], failed: [] }
    expect(prunePreMigrateBackups(backups, NOW)).toEqual(nothing)
    expect(prunePreMigrateBackups(join(dir, 'none'), NOW)).toEqual(nothing)
  })

  test('goes on past a file it cannot remove and names it', () => {
    const backups = seed([
      stamp('20250102T000000Z'),
      stamp('20250103T000000Z'),
      stamp('20250104T000000Z'),
      stamp('20250105T000000Z'),
    ])
    // A directory with a matching name cannot be unlinked.
    rmSync(join(backups, stamp('20250101T000000Z')), { force: true })
    mkdirSync(join(backups, stamp('20250101T000000Z')))
    writeFileSync(join(backups, stamp('20250101T000000Z'), 'inner'), 'x')
    const result = prunePreMigrateBackups(backups, NOW)
    expect(result.failed).toEqual([stamp('20250101T000000Z')])
    expect(result.removed).toEqual([stamp('20250102T000000Z')])
  })

  test('the constants are 30 days and 3 copies', () => {
    expect(KEEP_PRE_MIGRATE_DAYS).toBe(30)
    expect(KEEP_PRE_MIGRATE_MIN).toBe(3)
  })
})

describe('prunePreRestoreBackups', () => {
  const NOW = new Date('2026-11-17T12:00:00Z')
  const stamp = (name: string): string => `pre-restore-${name}.db`

  function seed(names: string[]): string {
    const backups = join(dir, 'backups')
    mkdirSync(backups)
    for (const name of names) writeFileSync(join(backups, name), 'x')
    return backups
  }

  test('removes copies older than 30 days and keeps the newest 3 and the recent ones', () => {
    const backups = seed([
      stamp('20260101T000000Z'),
      stamp('20260201T000000Z'),
      stamp('20260301T000000Z'),
      stamp('20261001T000000Z'),
      stamp('20261110T000000Z'),
      stamp('20261116T000000Z'),
    ])
    const { removed, failed } = prunePreRestoreBackups(backups, NOW)
    expect(failed).toEqual([])
    expect(removed).toEqual([
      stamp('20260301T000000Z'),
      stamp('20260201T000000Z'),
      stamp('20260101T000000Z'),
    ])
    expect(readdirSync(backups).sort()).toEqual([
      stamp('20261001T000000Z'),
      stamp('20261110T000000Z'),
      stamp('20261116T000000Z'),
    ])
  })

  test('keeps the newest 3 whatever their age', () => {
    const backups = seed([
      stamp('20250101T000000Z'),
      stamp('20250201T000000Z'),
      stamp('20250301T000000Z'),
      stamp('20250401T000000Z'),
    ])
    expect(prunePreRestoreBackups(backups, NOW).removed).toEqual([stamp('20250101T000000Z')])
    expect(readdirSync(backups)).toHaveLength(3)
  })

  test('leaves other files, the other kinds and the live database untouched', () => {
    const live = join(dir, 'app.db')
    writeFileSync(live, 'live')
    writeFileSync(`${live}-wal`, 'wal')
    writeFileSync(`${live}-shm`, 'shm')
    const others = [
      'app-20250101T000000Z.db',
      'pre-migrate-20250101T000000Z.db',
      'pre-restore-20250101T000000Z.db.raw',
      'pre-restore-20250101T000000Z.db.partial',
      'pre-restore-notastamp.db',
      'xpre-restore-20250101T000000Z.db',
      'notes.txt',
    ]
    const backups = seed([
      ...others,
      stamp('20250101T000000Z'),
      stamp('20250102T000000Z'),
      stamp('20250103T000000Z'),
      stamp('20250104T000000Z'),
    ])
    prunePreRestoreBackups(backups, NOW)
    const left = readdirSync(backups)
    for (const name of others) expect(left).toContain(name)
    expect(left).not.toContain(stamp('20250101T000000Z'))
    expect(readFileSync(live, 'utf8')).toBe('live')
    expect(readFileSync(`${live}-wal`, 'utf8')).toBe('wal')
    expect(readFileSync(`${live}-shm`, 'utf8')).toBe('shm')
  })

  test('takes the -wal and -shm files of a removed copy with it, and no others', () => {
    const backups = seed([
      stamp('20250101T000000Z'),
      `${stamp('20250101T000000Z')}-wal`,
      `${stamp('20250101T000000Z')}-shm`,
      stamp('20250102T000000Z'),
      `${stamp('20250102T000000Z')}-wal`,
      stamp('20250103T000000Z'),
      stamp('20250104T000000Z'),
    ])
    prunePreRestoreBackups(backups, NOW)
    expect(readdirSync(backups).sort()).toEqual([
      stamp('20250102T000000Z'),
      `${stamp('20250102T000000Z')}-wal`,
      stamp('20250103T000000Z'),
      stamp('20250104T000000Z'),
    ])
  })

  test('goes on past a file it cannot remove and names it; a missing folder is nothing', () => {
    const backups = seed([
      stamp('20250102T000000Z'),
      stamp('20250103T000000Z'),
      stamp('20250104T000000Z'),
      stamp('20250105T000000Z'),
    ])
    rmSync(join(backups, stamp('20250101T000000Z')), { force: true })
    mkdirSync(join(backups, stamp('20250101T000000Z')))
    writeFileSync(join(backups, stamp('20250101T000000Z'), 'inner'), 'x')
    const result = prunePreRestoreBackups(backups, NOW)
    expect(result.failed).toEqual([stamp('20250101T000000Z')])
    expect(result.removed).toEqual([stamp('20250102T000000Z')])
    expect(prunePreRestoreBackups(join(dir, 'none'), NOW)).toEqual({ removed: [], failed: [] })
  })
})

describe('deletedAccountRetention', () => {
  test('is 35 days locally and 31 off-host, so 35 days at most', () => {
    expect(deletedAccountRetention()).toEqual({ localDays: 35, offHostDays: 31, longestDays: 35 })
  })

  test('the README states the figure, the constants and the geocoding line', () => {
    const readme = readFileSync(resolve('README.md'), 'utf8')
    const { longestDays } = deletedAccountRetention()
    expect(readme).toContain(`from every copy the server keeps within ${longestDays} days`)
    expect(readme).toContain(`The ${longestDays} days is \`deletedAccountRetention().longestDays\``)
    expect(readme).toContain(`keep ${OFF_HOST_SNAPSHOT_DAYS} daily snapshots`)
    expect(readme).toContain(`remove the copies older than ${KEEP_PRE_MIGRATE_DAYS} days`)
    expect(readme).toContain(`keep the newest ${KEEP_PRE_MIGRATE_MIN}`)
    expect(readme).toContain(
      `There are two\n> exceptions: the newest ${KEEP_PRE_MIGRATE_MIN} pre-update copies and the newest ${KEEP_PRE_MIGRATE_MIN} pre-restore copies`,
    )
    expect(readme).toContain(
      'stay until\n> later ones push them out; the operator deletes them on request.',
    )
    expect(readme).toContain(
      'applied by the daily job, after each\npre-migrate copy and after each restore',
    )
    expect(readme).toContain("Open-Meteo's geocoding service; nothing else goes with it")
  })
})

describe('hasPendingMigrations and migrationStatus', () => {
  function migrationsFolder(...names: string[]): string {
    const folder = join(dir, 'migrations')
    mkdirSync(folder, { recursive: true })
    for (const name of names) mkdirSync(join(folder, name))
    writeFileSync(join(folder, 'migration_lock.toml'), 'provider = "sqlite"\n')
    return folder
  }

  /** Rows as Prisma writes them: finished, started and not finished (failed), or rolled back. */
  type Row = { name: string; state: 'finished' | 'failed' | 'rolled-back' }

  function databaseWith(...rows: Row[]): string {
    const file = join(dir, 'app.db')
    const db = new Database(file)
    db.exec(
      'CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, finished_at DATETIME, rolled_back_at DATETIME)',
    )
    const insert = db.prepare(
      'INSERT INTO _prisma_migrations (migration_name, finished_at, rolled_back_at) VALUES (?, ?, ?)',
    )
    const at = '2026-10-01 00:00:00'
    for (const row of rows) {
      insert.run(
        row.name,
        row.state === 'finished' ? at : null,
        row.state === 'rolled-back' ? at : null,
      )
    }
    db.close()
    return file
  }

  test('is false when every folder is applied', () => {
    const folder = migrationsFolder('001_init', '002_more')
    const file = databaseWith(
      { name: '001_init', state: 'finished' },
      { name: '002_more', state: 'finished' },
    )
    expect(hasPendingMigrations(file, folder)).toBe(false)
    expect(migrationStatus(file, folder)).toEqual({ pending: false, failed: [] })
  })

  test('is true when a folder is not applied', () => {
    const folder = migrationsFolder('001_init', '002_more')
    const file = databaseWith({ name: '001_init', state: 'finished' })
    expect(hasPendingMigrations(file, folder)).toBe(true)
    expect(migrationStatus(file, folder).failed).toEqual([])
  })

  test('is false while a failed migration is recorded: migrate refuses, and a copy would replace the one from before the first attempt', () => {
    const folder = migrationsFolder('001_init', '002_more')
    const file = databaseWith(
      { name: '001_init', state: 'finished' },
      { name: '002_more', state: 'failed' },
    )
    expect(hasPendingMigrations(file, folder)).toBe(false)
    expect(migrationStatus(file, folder)).toEqual({ pending: false, failed: ['002_more'] })
  })

  test('is true for the folder that a rolled-back row names: migrate runs it again', () => {
    const folder = migrationsFolder('001_init', '002_more')
    const file = databaseWith(
      { name: '001_init', state: 'finished' },
      { name: '002_more', state: 'rolled-back' },
    )
    expect(hasPendingMigrations(file, folder)).toBe(true)
    expect(migrationStatus(file, folder)).toEqual({ pending: true, failed: [] })
  })

  test('is true when it cannot be told: no migrations table, or no migrations folder', () => {
    const folder = migrationsFolder('001_init')
    const file = join(dir, 'plain.db')
    makeDatabase(file)
    expect(hasPendingMigrations(file, folder)).toBe(true)
    expect(
      hasPendingMigrations(
        databaseWith({ name: '001_init', state: 'finished' }),
        join(dir, 'no-such-folder'),
      ),
    ).toBe(true)
  })
})
