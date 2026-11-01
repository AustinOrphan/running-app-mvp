import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { backupCommand } from '../../../scripts/backup.ts'
import { restoreCommand } from '../../../scripts/restore.ts'

let dir: string
let databaseFile: string
let env: NodeJS.ProcessEnv

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-scripts-'))
  databaseFile = join(dir, 'app.db')
  env = { DATABASE_URL: `file:${databaseFile}` }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function makeDatabase(label = 'current'): void {
  const db = new Database(databaseFile)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE marker (label TEXT NOT NULL)')
  db.prepare('INSERT INTO marker (label) VALUES (?)').run(label)
  db.close()
}

/** Runs a command and returns its exit status with what it printed. */
async function run(
  command: typeof backupCommand,
  argv: string[],
): Promise<{ status: number; out: string; err: string }> {
  let out = ''
  let err = ''
  const status = await command(argv, env, {
    stdout: (text) => (out += text),
    stderr: (text) => (err += text),
  })
  return { status, out, err }
}

const backups = (): string[] => readdirSync(join(dir, 'backups')).sort()

describe('npm run backup', () => {
  test('writes app-<timestamp>.db next to the database and prints its path and size', async () => {
    makeDatabase()
    const { status, out } = await run(backupCommand, [])
    expect(status).toBe(0)
    const [name] = backups()
    expect(name).toMatch(/^app-\d{8}T\d{6}Z\.db$/)
    expect(out).toContain(join(dir, 'backups', name ?? ''))
    expect(out).toMatch(/Size: .+ \(\d+ bytes\)/)
    expect(out).toContain('integrity_check: ok')
  })

  test('--before-migrate names the file pre-migrate-<timestamp>.db and prunes nothing', async () => {
    makeDatabase()
    mkdirSync(join(dir, 'backups'))
    for (const stamp of ['20260101T020000Z', '20260102T020000Z', '20260103T020000Z']) {
      writeFileSync(join(dir, 'backups', `app-${stamp}.db`), 'x')
    }
    // The test's database has no migrations table, so a migration counts as pending.
    const { status } = await run(backupCommand, ['--before-migrate'])
    expect(status).toBe(0)
    expect(backups().filter((name) => name.startsWith('pre-migrate-'))).toHaveLength(1)
    expect(backups().filter((name) => name.startsWith('app-'))).toHaveLength(3)
  })

  test('--before-migrate copies nothing when there is no database yet', async () => {
    const { status, out } = await run(backupCommand, ['--before-migrate'])
    expect(status).toBe(0)
    expect(out).toContain('nothing to copy')
    expect(readdirSync(dir)).toEqual([])
  })

  test('--before-migrate copies nothing when every migration is applied', async () => {
    makeDatabase()
    const db = new Database(databaseFile)
    db.exec(
      'CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, finished_at DATETIME, rolled_back_at DATETIME)',
    )
    const insert = db.prepare(
      "INSERT INTO _prisma_migrations (migration_name, finished_at) VALUES (?, '2026-10-01 00:00:00')",
    )
    for (const entry of readdirSync('prisma/migrations', { withFileTypes: true })) {
      if (entry.isDirectory()) insert.run(entry.name)
    }
    db.close()

    const { status, out } = await run(backupCommand, ['--before-migrate'])
    expect(status).toBe(0)
    expect(out).toContain('No migration is pending')
    expect(readdirSync(dir).includes('backups')).toBe(false)
  })

  test('--before-migrate makes no copy while a failed migration is recorded, however often it runs', async () => {
    makeDatabase()
    const db = new Database(databaseFile)
    db.exec(
      'CREATE TABLE _prisma_migrations (migration_name TEXT NOT NULL, finished_at DATETIME, rolled_back_at DATETIME)',
    )
    const insert = db.prepare(
      'INSERT INTO _prisma_migrations (migration_name, finished_at) VALUES (?, ?)',
    )
    const folders = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
    const failed = folders[folders.length - 1] ?? ''
    for (const name of folders) insert.run(name, name === failed ? null : '2026-10-01 00:00:00')
    db.close()

    // The restart loop: every start asks again, and none writes a copy of the half-migrated schema.
    for (let start = 0; start < 3; start += 1) {
      const { status, out } = await run(backupCommand, ['--before-migrate'])
      expect(status).toBe(0)
      expect(out).toContain(`A failed migration is recorded (${failed})`)
      expect(out).toContain('no copy is made')
    }
    expect(readdirSync(dir).includes('backups')).toBe(false)
  })

  test('a plain backup of a missing database fails', async () => {
    const { status, err } = await run(backupCommand, [])
    expect(status).toBe(1)
    expect(err).toContain('No database at')
  })

  test('--keep n prunes the older app-*.db files down to n, and leaves the others', async () => {
    makeDatabase()
    mkdirSync(join(dir, 'backups'))
    const old = ['20260101T020000Z', '20260102T020000Z', '20260103T020000Z', '20260104T020000Z']
    for (const stamp of old) writeFileSync(join(dir, 'backups', `app-${stamp}.db`), 'x')
    writeFileSync(join(dir, 'backups', 'pre-migrate-20260101T020000Z.db'), 'x')

    const { status, out } = await run(backupCommand, ['--keep', '2'])

    expect(status).toBe(0)
    expect(out).toContain('Pruned 3:')
    const left = backups()
    expect(left).toHaveLength(3)
    expect(left).toContain('pre-migrate-20260101T020000Z.db')
    // The new copy (today) and the newest old one.
    expect(left).toContain('app-20260104T020000Z.db')
  })

  test('without --keep, the default rule keeps one copy a day', async () => {
    makeDatabase()
    mkdirSync(join(dir, 'backups'))
    // Two copies on one past day: the rule keeps the newest of the day, so the older one goes.
    writeFileSync(join(dir, 'backups', 'app-20260101T020000Z.db'), 'x')
    writeFileSync(join(dir, 'backups', 'app-20260101T030000Z.db'), 'x')
    const { out } = await run(backupCommand, [])
    expect(out).toContain('Pruned 1: app-20260101T020000Z.db')
    expect(backups().filter((name) => name.startsWith('app-'))).toHaveLength(2)
  })

  test('never prunes the copy it just wrote, whatever its stamp (a clock set back)', async () => {
    makeDatabase()
    mkdirSync(join(dir, 'backups'))
    // Seven days and four more weeks, all later than today: the rule fills up without the new copy.
    const later = ['0105', '0106', '0107', '0114', '0121', '0128', '0204'].map(
      (day) => `app-2099${day}T020000Z.db`,
    )
    for (const name of later) writeFileSync(join(dir, 'backups', name), 'x')

    const { status, out } = await run(backupCommand, [])

    expect(status).toBe(0)
    expect(out).not.toContain('Pruned')
    expect(backups().filter((name) => name.startsWith('app-'))).toHaveLength(later.length + 1)
    const written = /Backup written: (.+)\n/.exec(out)?.[1] ?? ''
    expect(readdirSync(join(dir, 'backups'))).toContain(written.split('/').pop())

    const keep = await run(backupCommand, ['--keep', '2'])
    expect(keep.status).toBe(0)
    expect(backups().filter((name) => name.startsWith('app-'))).toHaveLength(3)
  })

  test('rejects a bad --keep, --keep with --before-migrate, and an unknown flag', async () => {
    makeDatabase()
    expect((await run(backupCommand, ['--keep', '0'])).status).toBe(1)
    expect((await run(backupCommand, ['--keep', 'many'])).status).toBe(1)
    expect((await run(backupCommand, ['--keep', '3', '--before-migrate'])).status).toBe(1)
    expect((await run(backupCommand, ['--nope'])).status).toBe(1)
    expect(readdirSync(dir)).toEqual(['app.db'])
  })

  test('--help states the retention rule', async () => {
    const { status, out } = await run(backupCommand, ['--help'])
    expect(status).toBe(0)
    expect(out).toContain('7 most recent days')
    expect(out).toContain('4 most recent ISO weeks')
    expect(out).toContain('--keep <n>')
    expect(out).toContain('--before-migrate')
  })
})

describe('npm run restore', () => {
  test('restores a backup, keeps the replaced database, and says what it did', async () => {
    makeDatabase('older')
    expect((await run(backupCommand, [])).status).toBe(0)
    const [name] = backups()
    const db = new Database(databaseFile)
    db.prepare('UPDATE marker SET label = ?').run('newer')
    db.close()

    const { status, out } = await run(restoreCommand, [join(dir, 'backups', name ?? '')])

    expect(status).toBe(0)
    expect(out).toContain('integrity_check ok')
    expect(out).toMatch(/Kept the replaced database as .*pre-restore-\d{8}T\d{6}Z\.db/)
    expect(out).toContain('Start the server again.')
    const check = new Database(databaseFile)
    expect((check.prepare('SELECT label FROM marker').get() as { label: string }).label).toBe(
      'older',
    )
    check.close()
  })

  test('says when the replaced database could not be read and was kept as it was', async () => {
    makeDatabase('older')
    expect((await run(backupCommand, [])).status).toBe(0)
    const [name] = backups()
    writeFileSync(databaseFile, 'not a database. '.repeat(500))

    const { status, out } = await run(restoreCommand, [join(dir, 'backups', name ?? '')])

    expect(status).toBe(0)
    expect(out).toMatch(
      /could not be read, so it was kept as it was, byte for byte, as .*pre-restore-/,
    )
    const check = new Database(databaseFile)
    expect((check.prepare('SELECT label FROM marker').get() as { label: string }).label).toBe(
      'older',
    )
    check.close()
  })

  test('needs exactly one file', async () => {
    expect((await run(restoreCommand, [])).status).toBe(1)
    expect((await run(restoreCommand, ['a.db', 'b.db'])).status).toBe(1)
  })

  test('--help says how the running server is detected', async () => {
    const { status, out } = await run(restoreCommand, ['--help'])
    expect(status).toBe(0)
    expect(out).toContain('exclusive lock')
    expect(out).toContain('WAL')
  })
})
