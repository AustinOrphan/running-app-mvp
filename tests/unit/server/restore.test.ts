import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createBackup, integrityProblems } from '../../../server/services/backup.ts'
import { restoreDatabase } from '../../../server/services/restore.ts'

let dir: string
let target: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-restore-'))
  target = join(dir, 'app.db')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A WAL-mode database like the server's, holding `label` in a one-row table. */
function makeDatabase(file: string, label: string): void {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE marker (label TEXT NOT NULL)')
  db.prepare('INSERT INTO marker (label) VALUES (?)').run(label)
  db.close()
}

function labelOf(file: string): string {
  // Not read-only: a read-only connection leaves -wal and -shm files behind a WAL-mode database.
  const db = new Database(file)
  try {
    return (db.prepare('SELECT label FROM marker').get() as { label: string }).label
  } finally {
    db.close()
  }
}

/** A backup of a database that says `label`, made the way `npm run backup` makes it. */
async function backupOf(label: string): Promise<string> {
  const source = join(dir, `source-${label}.db`)
  makeDatabase(source, label)
  return (await createBackup(source, { kind: 'ordinary', now: new Date('2026-10-30T02:00:00Z') }))
    .path
}

const NOW = new Date('2026-11-01T09:15:00Z')

describe('restoreDatabase', () => {
  test('puts the backup in place and keeps the replaced database as pre-restore', async () => {
    makeDatabase(target, 'current')
    const backup = await backupOf('older')

    const result = await restoreDatabase(backup, target, { now: NOW })

    expect(labelOf(target)).toBe('older')
    expect(result.restored).toBe(backup)
    expect(result.target).toBe(target)
    expect(result.keptAs).toBe(join(dir, 'backups', 'pre-restore-20261101T091500Z.db'))
    expect(labelOf(result.keptAs ?? '')).toBe('current')
    // The backup itself is untouched, and nothing is left beside the database.
    expect(labelOf(backup)).toBe('older')
    expect(result.keptAsIs).toBe(false)
    expect(readdirSync(dir).filter((name) => name.startsWith('app.db'))).toEqual(['app.db'])
  })

  /** The server: a connection in WAL mode that stays open and idle after a read. */
  function openServer(): Database.Database {
    const server = new Database(target)
    server.pragma('journal_mode = WAL')
    server.prepare('SELECT label FROM marker').get()
    return server
  }

  function backdateSidecars(seconds: number): void {
    const then = new Date(Date.now() - seconds * 1000)
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(`${target}${suffix}`)) utimesSync(`${target}${suffix}`, then, then)
    }
  }

  test('refuses while another connection holds the database open, and changes nothing', async () => {
    makeDatabase(target, 'current')
    const backup = await backupOf('older')
    const server = openServer()
    // Older than the ten seconds the file check looks at, so the lock is what refuses.
    backdateSidecars(60)
    try {
      await expect(restoreDatabase(backup, target, { now: NOW })).rejects.toThrow(
        /is open in another process.*Stop the server/,
      )
      expect(existsSync(join(dir, 'app.db.restoring'))).toBe(false)
      expect(existsSync(join(dir, 'backups', 'pre-restore-20261101T091500Z.db'))).toBe(false)
      expect(existsSync(join(dir, 'backups', 'pre-restore-20261101T091500Z.db.raw'))).toBe(false)
    } finally {
      server.close()
    }
    expect(labelOf(target)).toBe('current')

    // Once the server has stopped, the same restore goes through.
    await restoreDatabase(backup, target, { now: NOW })
    expect(labelOf(target)).toBe('older')
  })

  test('refuses while the -wal file of a database was written in the last ten seconds', async () => {
    makeDatabase(target, 'current')
    const backup = await backupOf('older')
    const server = openServer()
    try {
      await expect(restoreDatabase(backup, target, { now: NOW })).rejects.toThrow(
        /last 10 seconds.*Stop the server/,
      )
    } finally {
      server.close()
    }
    expect(labelOf(target)).toBe('current')
  })

  test('refuses a file that fails integrity_check or is not a database', async () => {
    makeDatabase(target, 'current')
    const text = join(dir, 'not-a-database.db')
    writeFileSync(text, 'this is plain text, not a SQLite file, and it is long enough to be read')

    await expect(restoreDatabase(text, target, { now: NOW })).rejects.toThrow(/integrity_check/)
    expect(labelOf(target)).toBe('current')
    expect(readdirSync(dir).sort()).toEqual(['app.db', 'not-a-database.db'])
  })

  test('refuses a file that is missing, a directory, or the database itself', async () => {
    makeDatabase(target, 'current')
    await expect(restoreDatabase(join(dir, 'none.db'), target)).rejects.toThrow(/not a file/)
    await expect(restoreDatabase(dir, target)).rejects.toThrow(/not a file/)
    await expect(restoreDatabase(target, target)).rejects.toThrow(/the database itself/)
    expect(labelOf(target)).toBe('current')
  })

  test('refuses a file that has a write-ahead log of its own', async () => {
    makeDatabase(target, 'current')
    const backup = await backupOf('older')
    writeFileSync(`${backup}-wal`, 'frames that the file alone does not hold')

    await expect(restoreDatabase(backup, target, { now: NOW })).rejects.toThrow(/write-ahead log/)
    expect(labelOf(target)).toBe('current')
  })

  test('restores where no database exists, and removes stale -wal and -shm files of the target', async () => {
    const backup = await backupOf('older')
    mkdirSync(join(dir, 'fresh'))
    const fresh = join(dir, 'fresh', 'app.db')
    writeFileSync(`${fresh}-wal`, 'left behind by a database that is gone')
    writeFileSync(`${fresh}-shm`, 'left behind by a database that is gone')

    const result = await restoreDatabase(backup, fresh, { now: NOW })

    expect(result.keptAs).toBeNull()
    expect(result.removed).toEqual([`${fresh}-wal`, `${fresh}-shm`])
    expect(labelOf(fresh)).toBe('older')
    expect(readdirSync(join(dir, 'fresh'))).toEqual(['app.db'])
  })

  test('creates the folder of the database when it is missing', async () => {
    const backup = await backupOf('older')
    const nested = join(dir, 'new', 'place', 'app.db')
    await restoreDatabase(backup, nested)
    expect(labelOf(nested)).toBe('older')
  })

  test('keeps the mode of the database it replaces, not the mode of a read-only backup', async () => {
    makeDatabase(target, 'current')
    chmodSync(target, 0o640)
    const backup = await backupOf('older')
    chmodSync(backup, 0o444)

    await restoreDatabase(backup, target, { now: NOW })

    expect(statSync(target).mode & 0o777).toBe(0o640)
    expect(labelOf(target)).toBe('older')
  })

  test('with no database to replace, a read-only backup is restored writable by its owner', async () => {
    const backup = await backupOf('older')
    chmodSync(backup, 0o444)
    const fresh = join(dir, 'fresh.db')

    await restoreDatabase(backup, fresh)

    expect(statSync(fresh).mode & 0o200).toBe(0o200)
    expect(labelOf(fresh)).toBe('older')
  })
})

/**
 * A WAL-mode database with an index and a few pages of rows, written in one transaction (each
 * autocommit insert is a synced write, which makes a loaded runner slow). Page 2 is the root of
 * `marker`, page 3 of `filler` (an interior page once the rows spill), page 4 of the index.
 */
function makeBigDatabase(file: string): void {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE marker (label TEXT NOT NULL)')
  db.exec('CREATE TABLE filler (id INTEGER PRIMARY KEY, body TEXT NOT NULL)')
  db.exec('CREATE INDEX filler_body ON filler (body)')
  db.prepare('INSERT INTO marker (label) VALUES (?)').run('current')
  const insert = db.prepare('INSERT INTO filler (body) VALUES (?)')
  db.transaction(() => {
    for (let i = 0; i < 150; i += 1) insert.run(`row ${i} ${'x'.repeat(40)}`)
  })()
  db.close()
}

describe('restoreDatabase over a damaged database', () => {
  const damages: Array<{ name: string; damage: (file: string) => void; asIs: boolean }> = [
    {
      name: 'garbage',
      damage: (file) => writeFileSync(file, 'this is not a SQLite file. '.repeat(400)),
      asIs: true,
    },
    {
      name: 'a run of damaged pages',
      damage: (file) => {
        const bytes = readFileSync(file)
        bytes.fill(0xff, 2 * 4096, 3 * 4096)
        writeFileSync(file, bytes)
      },
      asIs: true,
    },
    {
      name: 'a truncated file',
      damage: (file) => truncateSync(file, Math.floor(statSync(file).size / 2)),
      asIs: true,
    },
    // SQLite opens a file of zero bytes as an empty database, so the ordinary copy works.
    { name: 'an empty file', damage: (file) => truncateSync(file, 0), asIs: false },
  ]

  for (const { name, damage, asIs } of damages) {
    test(`restores over ${name} after a stop, keeping the damaged file`, async () => {
      makeBigDatabase(target)
      damage(target)
      // The damage is real: SQLite finds a problem in it (a file of zero bytes is a sound empty one).
      if (asIs) expect(integrityProblems(target)).not.toEqual([])
      const damaged = readFileSync(target)
      const backup = await backupOf('older')

      const result = await restoreDatabase(backup, target, { now: NOW })

      expect(labelOf(target)).toBe('older')
      expect(result.keptAs).toBe(join(dir, 'backups', 'pre-restore-20261101T091500Z.db'))
      expect(result.keptAsIs).toBe(asIs)
      expect(existsSync(result.keptAs ?? '')).toBe(true)
      if (asIs) expect(readFileSync(result.keptAs ?? '').equals(damaged)).toBe(true)
    })
  }

  test('keeps the -wal and -shm files of a damaged database beside the copy', async () => {
    writeFileSync(target, 'this is not a SQLite file. '.repeat(400))
    writeFileSync(`${target}-wal`, 'frames the damaged file never merged')
    writeFileSync(`${target}-shm`, 'index of those frames')
    const longAgo = new Date(Date.now() - 60_000)
    for (const suffix of ['-wal', '-shm']) utimesSync(`${target}${suffix}`, longAgo, longAgo)
    const backup = await backupOf('older')

    const result = await restoreDatabase(backup, target, { now: NOW })

    const kept = result.keptAs ?? ''
    expect(readFileSync(`${kept}-wal`, 'utf8')).toBe('frames the damaged file never merged')
    expect(readFileSync(`${kept}-shm`, 'utf8')).toBe('index of those frames')
    expect(readdirSync(dir).filter((name) => name.startsWith('app.db'))).toEqual(['app.db'])
    expect(labelOf(target)).toBe('older')
  })

  test('does not wait for a -wal file stamped in the future (a clock set back since it was written)', async () => {
    writeFileSync(target, 'this is not a SQLite file. '.repeat(400))
    writeFileSync(`${target}-wal`, 'frames the damaged file never merged')
    const ahead = new Date(Date.now() + 3_600_000)
    utimesSync(`${target}-wal`, ahead, ahead)
    const backup = await backupOf('older')

    const result = await restoreDatabase(backup, target, { now: NOW })

    expect(labelOf(target)).toBe('older')
    expect(readFileSync(`${result.keptAs ?? ''}-wal`, 'utf8')).toBe(
      'frames the damaged file never merged',
    )
  })

  test('still counts a -wal file a few seconds ahead of the clock as recent', async () => {
    writeFileSync(target, 'this is not a SQLite file. '.repeat(400))
    writeFileSync(`${target}-wal`, 'written by a process whose clock runs a little fast')
    const ahead = new Date(Date.now() + 3_000)
    utimesSync(`${target}-wal`, ahead, ahead)
    const backup = await backupOf('older')

    await expect(restoreDatabase(backup, target, { now: NOW })).rejects.toThrow(/last 10 seconds/)
  })

  test('removes the first copy when it fails part way: no .raw file is left in backups/', async () => {
    makeDatabase(target, 'current')
    // A directory where the -wal file would be: the main file is copied, then the copy of the
    // -wal file fails. Back-dated, so that the file check does not refuse first.
    mkdirSync(`${target}-wal`)
    const longAgo = new Date(Date.now() - 60_000)
    utimesSync(`${target}-wal`, longAgo, longAgo)
    const before = readFileSync(target)
    const backup = await backupOf('older')

    await expect(restoreDatabase(backup, target, { now: NOW })).rejects.toThrow()

    expect(
      readdirSync(join(dir, 'backups')).filter((name) => name.includes('pre-restore')),
    ).toEqual([])
    expect(existsSync(`${target}.restoring`)).toBe(false)
    expect(readFileSync(target).equals(before)).toBe(true)
  })

  test('refuses a database it cannot open while its -wal file was written seconds ago', async () => {
    writeFileSync(target, 'this is not a SQLite file. '.repeat(400))
    writeFileSync(`${target}-wal`, 'written just now by a process that still runs')
    const backup = await backupOf('older')

    await expect(restoreDatabase(backup, target, { now: NOW })).rejects.toThrow(
      /last 10 seconds.*Stop the server/,
    )

    expect(readFileSync(target, 'utf8').startsWith('this is not a SQLite file')).toBe(true)
    expect(existsSync(join(dir, 'backups', 'pre-restore-20261101T091500Z.db'))).toBe(false)
    expect(existsSync(`${target}.restoring`)).toBe(false)
  })
})
