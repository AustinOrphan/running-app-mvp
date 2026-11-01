import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { loadDatabaseUrl } from '../../../server/config.ts'
import { sqliteFilePath } from '../../../server/db.ts'
import {
  backupDirectory,
  backupName,
  backupStamp,
  createBackup,
  DEFAULT_RETENTION,
  hasPendingMigrations,
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
  for (let i = 0; i < rows; i += 1) insert.run(`row ${i}`)
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
    for (let i = 0; i < 3000; i += 1) insert.run(`row ${i} ${'x'.repeat(40)}`)
    db.close()
    // Overwrite the middle of the file, where index and table pages are.
    const bytes = readFileSync(file)
    bytes.fill(0xff, Math.floor(bytes.length / 2), Math.floor(bytes.length / 2) + 4096)
    writeFileSync(file, bytes)

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

describe('hasPendingMigrations', () => {
  function migrationsFolder(...names: string[]): string {
    const folder = join(dir, 'migrations')
    mkdirSync(folder, { recursive: true })
    for (const name of names) mkdirSync(join(folder, name))
    writeFileSync(join(folder, 'migration_lock.toml'), 'provider = "sqlite"\n')
    return folder
  }

  function databaseWithApplied(...applied: Array<{ name: string; finished: boolean }>): string {
    const file = join(dir, 'app.db')
    const db = new Database(file)
    db.exec(
      'CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, finished_at DATETIME, rolled_back_at DATETIME)',
    )
    const insert = db.prepare(
      'INSERT INTO _prisma_migrations (migration_name, finished_at) VALUES (?, ?)',
    )
    for (const row of applied) insert.run(row.name, row.finished ? '2026-10-01 00:00:00' : null)
    db.close()
    return file
  }

  test('is false when every folder is applied', () => {
    const folder = migrationsFolder('001_init', '002_more')
    const file = databaseWithApplied(
      { name: '001_init', finished: true },
      { name: '002_more', finished: true },
    )
    expect(hasPendingMigrations(file, folder)).toBe(false)
  })

  test('is true when a folder is not applied, or its run did not finish', () => {
    const folder = migrationsFolder('001_init', '002_more')
    expect(
      hasPendingMigrations(databaseWithApplied({ name: '001_init', finished: true }), folder),
    ).toBe(true)
  })

  test('is true for a migration that started and did not finish', () => {
    const folder = migrationsFolder('001_init')
    expect(
      hasPendingMigrations(databaseWithApplied({ name: '001_init', finished: false }), folder),
    ).toBe(true)
  })

  test('is true when it cannot be told: no migrations table, or no migrations folder', () => {
    const folder = migrationsFolder('001_init')
    const file = join(dir, 'plain.db')
    makeDatabase(file)
    expect(hasPendingMigrations(file, folder)).toBe(true)
    expect(
      hasPendingMigrations(
        databaseWithApplied({ name: '001_init', finished: true }),
        join(dir, 'no-such-folder'),
      ),
    ).toBe(true)
  })
})
