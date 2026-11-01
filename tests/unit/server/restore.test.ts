import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createBackup } from '../../../server/services/backup.ts'
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
    expect(readdirSync(dir).filter((name) => name.startsWith('app.db'))).toEqual(['app.db'])
  })

  test('refuses while another connection holds the database open, and changes nothing', async () => {
    makeDatabase(target, 'current')
    const backup = await backupOf('older')
    // The server: a connection in WAL mode that stays open, idle.
    const server = new Database(target)
    server.pragma('journal_mode = WAL')
    try {
      await expect(restoreDatabase(backup, target, { now: NOW })).rejects.toThrow(
        /open in another process.*Stop the server/,
      )
      expect(existsSync(join(dir, 'app.db.restoring'))).toBe(false)
      expect(existsSync(join(dir, 'backups', 'pre-restore-20261101T091500Z.db'))).toBe(false)
    } finally {
      server.close()
    }
    expect(labelOf(target)).toBe('current')

    // Once the server has stopped, the same restore goes through.
    await restoreDatabase(backup, target, { now: NOW })
    expect(labelOf(target)).toBe('older')
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
})
