// The migration chain. Every migration applies in order to an empty database; each migration with a
// fixture case also applies over the previous release's rows and must lose none of them; and the
// chain ends in the shape of prisma/schema.prisma (no drift).
//
// A new migration adds one entry to CASES, keyed by its name without the timestamp (the folder
// name is regenerated at rebase). `seed` writes rows with raw SQL in the schema as it stood before
// that migration, never through the Prisma client, which only knows the newest schema.
import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const MIGRATIONS_DIR = join(ROOT, 'prisma', 'migrations')
const SCHEMA_PATH = join(ROOT, 'prisma', 'schema.prisma')

type Row = Record<string, SQLOutputValue>

interface Migration {
  /** The folder name, timestamp included. */
  dir: string
  /** The folder name without its timestamp. */
  name: string
  sql: string
}

/** Every migration, oldest first: the order `prisma migrate deploy` applies them in. */
function loadMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((dir) => ({
      dir,
      name: dir.replace(/^\d+_/, ''),
      sql: readFileSync(join(MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8'),
    }))
}

const migrations = loadMigrations()

/** A fresh in-memory database with foreign keys on, as the Prisma client opens a file. */
function openDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON')
  return db
}

function applyAll(db: DatabaseSync, list: Migration[]): void {
  for (const migration of list) db.exec(migration.sql)
}

function insert(db: DatabaseSync, table: string, row: Record<string, SQLInputValue>): void {
  const columns = Object.keys(row)
  const names = columns.map((c) => `"${c}"`).join(', ')
  const marks = columns.map(() => '?').join(', ')
  db.prepare(`INSERT INTO "${table}" (${names}) VALUES (${marks})`).run(...Object.values(row))
}

function rowsOf(db: DatabaseSync, sql: string): Row[] {
  return db.prepare(sql).all()
}

function tableNames(db: DatabaseSync): string[] {
  return rowsOf(
    db,
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  ).map((r) => String(r.name))
}

type Snapshot = Map<string, Row[]>

function snapshot(db: DatabaseSync): Snapshot {
  return new Map(tableNames(db).map((table) => [table, rowsOf(db, `SELECT * FROM "${table}"`)]))
}

const keyOf = (row: Row, columns: string[]): string =>
  JSON.stringify(columns.map((c) => row[c] ?? null))

/**
 * Asserts that no row of `before` was lost: every table of the earlier schema still holds the same
 * rows, compared on the columns the earlier schema had (a migration may add columns).
 */
function expectNothingLost(before: Snapshot, db: DatabaseSync): void {
  const after = snapshot(db)
  for (const [table, rows] of before) {
    const kept = after.get(table)
    expect(kept, `table ${table} is gone`).toBeDefined()
    const columns = Object.keys(rows[0] ?? {})
    expect(kept?.map((r) => keyOf(r, columns)).sort(), `rows of ${table}`).toEqual(
      rows.map((r) => keyOf(r, columns)).sort(),
    )
  }
}

function expectConsistent(db: DatabaseSync): void {
  expect(rowsOf(db, 'PRAGMA foreign_key_check'), 'foreign key violations').toEqual([])
  expect(rowsOf(db, 'PRAGMA integrity_check').map((r) => r.integrity_check)).toEqual(['ok'])
}

/** The column lists of a table's indexes, unique or not. */
function indexes(db: DatabaseSync, table: string): Array<{ columns: string[]; unique: boolean }> {
  return rowsOf(db, `PRAGMA index_list("${table}")`).map((index) => ({
    unique: index.unique === 1,
    columns: rowsOf(db, `PRAGMA index_info("${String(index.name)}")`).map((c) => String(c.name)),
  }))
}

function expectIndex(db: DatabaseSync, table: string, columns: string[], unique: boolean): void {
  expect(indexes(db, table), `${table} (${columns.join(', ')})`).toContainEqual({
    columns,
    unique,
  })
}

// ---------------------------------------------------------------------------------------------
// Fixture cases
// ---------------------------------------------------------------------------------------------

interface FixtureCase {
  /** The migration under test, by its name without the timestamp. */
  migration: string
  /** Inserts the previous release's rows in the schema as it stood just before the migration. */
  seed(db: DatabaseSync): void
  /** Asserts the migrated database; `before` is the snapshot taken after `seed`. */
  verify(db: DatabaseSync, before: Snapshot): void
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [3, 4],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})
const STAMP = '2026-10-01 08:00:00'

/**
 * The previous release's sessions: two plans, rules with and without the trim rule, sessions linked
 * to activities and sessions not.
 */
function seedPlanSessions(db: DatabaseSync): void {
  insert(db, 'User', {
    id: 'u1',
    email: 'runner@example.com',
    passwordHash: 'not-a-real-hash',
    updatedAt: STAMP,
  })
  insert(db, 'Goal', {
    id: 'g1',
    userId: 'u1',
    name: 'Synthetic marathon',
    priority: 'A',
    targetDate: '2027-04-18',
    updatedAt: STAMP,
  })
  for (const [id, status] of [
    ['p-active', 'active'],
    ['p-old', 'archived'],
  ] as const) {
    insert(db, 'Plan', {
      id,
      userId: 'u1',
      goalId: 'g1',
      name: 'Synthetic plan',
      startDate: '2026-10-05',
      raceWeekStart: '2027-04-12',
      status,
      generatorVersion: 2,
      updatedAt: STAMP,
    })
  }
  for (const id of ['a1', 'a2', 'a3', 'a4']) {
    insert(db, 'Activity', {
      id,
      userId: 'u1',
      date: '2026-10-06',
      type: 'run',
      durationSec: 2700,
      distanceM: 8000,
      updatedAt: STAMP,
    })
  }

  // [id, plan, rules, status, activity, linkSource]
  const sessions: Array<[string, string, string[], string, string | null, string | null]> = [
    ['s01', 'p-active', [], 'completed', 'a1', 'auto'],
    ['s02', 'p-active', ['f-1', 'g-1'], 'completed', 'a2', 'owner'],
    ['s03', 'p-active', ['C8', 'design-4.3'], 'downgraded', null, null],
    ['s04', 'p-active', ['design-4.3'], 'completed', 'a3', 'auto'],
    ['s05', 'p-active', ['design-4.1', 'design-4.2'], 'planned', null, null],
    ['s06', 'p-active', ['design-4.30'], 'planned', null, null],
    ['s07', 'p-active', [], 'skipped', null, null],
    ['s08', 'p-active', ['n-4', 'J5', 'design-4.3', 'F1'], 'downgraded', null, null],
    ['s09', 'p-active', [], 'moved', null, null],
    ['s10', 'p-old', ['design-4.3'], 'downgraded', null, null],
    ['s11', 'p-old', [], 'completed', 'a4', 'auto'],
    ['s12', 'p-old', ['e-2'], 'planned', null, null],
  ]
  sessions.forEach(([id, planId, rules, status, activityId, linkSource], i) => {
    insert(db, 'PlanSession', {
      id,
      planId,
      weekStart: '2026-10-05',
      date: `2026-10-${String(5 + (i % 7)).padStart(2, '0')}`,
      order: i % 3,
      kind: i % 2 === 0 ? 'easy' : 'threshold',
      title: `Synthetic session ${id}`,
      durationMin: 30 + i,
      distanceM: i % 2 === 0 ? 6000 + i : null,
      gainM: null,
      structure: '[]',
      target: TARGET,
      purpose: 'Synthetic.',
      rules: JSON.stringify(rules),
      flags: '[]',
      status,
      activityId,
      linkSource,
      execution: activityId === null ? null : JSON.stringify({ completion: 'full' }),
      original: status === 'downgraded' ? JSON.stringify({ durationMin: 60 }) : null,
      updatedAt: STAMP,
    })
  })
  insert(db, 'PlanRevision', {
    id: 'r1',
    planId: 'p-active',
    reason: 'generate',
    summary: 'Synthetic revision.',
  })
}

function verifyPlanSessions(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  const seeded = before.get('PlanSession') ?? []
  const rows = rowsOf(db, 'SELECT * FROM "PlanSession" ORDER BY id')
  const rowOf = (id: string) => rows.find((r) => r.id === id)
  expect(rows.map((r) => r.id)).toEqual(seeded.map((r) => r.id).sort())

  // Every row got its own identifier, a uuid.
  const externalIds = rows.map((r) => String(r.externalId))
  expect(new Set(externalIds).size).toBe(rows.length)
  for (const externalId of externalIds) expect(externalId).toMatch(UUID_V4)

  // The trimmed flag follows the rules of each row and matches the rule id exactly.
  const trimmedIds = seeded
    .filter((r) => (JSON.parse(String(r.rules)) as string[]).includes('design-4.3'))
    .map((r) => String(r.id))
    .sort()
  expect(trimmedIds).toEqual(['s03', 's04', 's08', 's10'])
  expect(
    rows.filter((r) => r.trimmed === 1).map((r) => r.id),
    'rows backfilled as trimmed',
  ).toEqual(trimmedIds)
  expect(rows.filter((r) => r.trimmed === 0)).toHaveLength(seeded.length - trimmedIds.length)

  // Links to activities survive the redefine, and so do the foreign keys that keep them honest.
  const linked = seeded.filter((r) => r.activityId !== null)
  expect(linked.map((r) => r.id)).toEqual(['s01', 's02', 's04', 's11'])
  for (const row of linked) {
    expect(rowOf(String(row.id))?.activityId, `activity of ${String(row.id)}`).toBe(row.activityId)
  }
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "Activity"')).toEqual([{ n: 4 }])
  const keys = rowsOf(db, `PRAGMA foreign_key_list("PlanSession")`).map((k) => ({
    from: k.from,
    table: k.table,
    onDelete: k.on_delete,
  }))
  expect(keys).toContainEqual({ from: 'planId', table: 'Plan', onDelete: 'CASCADE' })
  expect(keys).toContainEqual({ from: 'activityId', table: 'Activity', onDelete: 'SET NULL' })
  expectIndex(db, 'PlanSession', ['activityId'], true)
  expectIndex(db, 'PlanSession', ['planId', 'date'], false)

  // The new indexes, and the unique pair (plan, externalId).
  expectIndex(db, 'PlanSession', ['planId', 'externalId'], true)
  expectIndex(db, 'PlanSession', ['planId', 'weekStart', 'trimmed'], false)
  expectIndex(db, 'PlanSession', ['planId', 'status', 'date'], false)
  expectIndex(db, 'PlanRevision', ['planId', 'reason'], false)
  expectIndex(db, 'Activity', ['duplicateOfId'], false)
  const first = String(rowOf('s01')?.externalId)
  expect(() =>
    db.prepare(`UPDATE "PlanSession" SET "externalId" = ? WHERE id = 's05'`).run(first),
  ).toThrow(/UNIQUE/)
  // The same identifier in another plan is allowed: the pair is what is unique.
  db.prepare(`UPDATE "PlanSession" SET "externalId" = ? WHERE id = 's11'`).run(first)

  // The set-null and the cascade still fire after the redefine.
  db.exec(`DELETE FROM "Activity" WHERE id = 'a2'`)
  expect(rowsOf(db, `SELECT "activityId" FROM "PlanSession" WHERE id = 's02'`)).toEqual([
    { activityId: null },
  ])
  db.exec(`DELETE FROM "Plan" WHERE id = 'p-old'`)
  expect(rowsOf(db, `SELECT count(*) AS n FROM "PlanSession" WHERE "planId" = 'p-old'`)).toEqual([
    { n: 0 },
  ])
}

/**
 * The previous release's sync state: two connections, an import batch and the activity it stored.
 * The sync log adds a table beside them and touches none.
 */
function seedSyncState(db: DatabaseSync): void {
  insert(db, 'User', {
    id: 'u1',
    email: 'runner@example.com',
    passwordHash: 'not-a-real-hash',
    updatedAt: STAMP,
  })
  insert(db, 'User', {
    id: 'u2',
    email: 'other@example.com',
    passwordHash: 'not-a-real-hash',
    updatedAt: STAMP,
  })
  for (const [id, userId, provider] of [
    ['i1', 'u1', 'garmin'],
    ['i2', 'u1', 'folder'],
    ['i3', 'u2', 'garmin'],
  ] as const) {
    insert(db, 'Integration', {
      id,
      userId,
      provider,
      status: 'connected',
      secret: 'v1.synthetic.synthetic.synthetic',
      config: '{}',
      lastSyncStatus: 'ok',
      updatedAt: STAMP,
    })
  }
  insert(db, 'ImportBatch', {
    id: 'b1',
    userId: 'u1',
    source: 'garmin',
    rowCount: 1,
    accepted: 1,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    errors: '[]',
  })
  insert(db, 'Activity', {
    id: 'a1',
    userId: 'u1',
    date: '2026-10-06',
    type: 'run',
    durationSec: 2700,
    distanceM: 8000,
    importBatchId: 'b1',
    updatedAt: STAMP,
  })
}

function verifySyncLog(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  // The new table starts empty: earlier releases kept no run history to carry over.
  expect(tableNames(db)).toContain('SyncRun')
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "SyncRun"')).toEqual([{ n: 0 }])
  expectIndex(db, 'SyncRun', ['userId', 'provider', 'startedAt'], false)

  // Only the identity, the channel, the trigger, the times and the status are required.
  const required = {
    userId: 'u1',
    provider: 'garmin',
    channel: 'pull',
    trigger: 'schedule',
    startedAt: STAMP,
    finishedAt: STAMP,
    status: 'ok',
  }
  insert(db, 'SyncRun', { id: 'r1', ...required, importBatchId: 'b1' })
  insert(db, 'SyncRun', { id: 'r2', ...required, userId: 'u2' })
  expect(rowsOf(db, `SELECT * FROM "SyncRun" WHERE id = 'r1'`)[0]).toMatchObject({
    accepted: 0,
    duplicate: 0,
    failed: 0,
    wellnessStatus: 'none',
    wellnessDays: null,
    wellnessTotal: null,
    message: null,
    failures: '[]',
    importBatchId: 'b1',
  })

  // A run belongs to its user; the batch id is a plain reference, so pruning batches is harmless.
  expect(() => {
    insert(db, 'SyncRun', { id: 'r3', ...required, userId: 'nobody' })
  }).toThrow(/FOREIGN KEY/)
  db.exec(`DELETE FROM "ImportBatch" WHERE id = 'b1'`)
  expect(rowsOf(db, `SELECT "importBatchId" FROM "SyncRun" WHERE id = 'r1'`)).toEqual([
    { importBatchId: 'b1' },
  ])
  db.exec(`DELETE FROM "User" WHERE id = 'u2'`)
  expect(rowsOf(db, 'SELECT id FROM "SyncRun" ORDER BY id')).toEqual([{ id: 'r1' }])
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "Integration"')).toEqual([{ n: 2 }])
}

const CASES: FixtureCase[] = [
  {
    migration: 'foundation_plan_session',
    seed: seedPlanSessions,
    verify: verifyPlanSessions,
  },
  {
    migration: 'foundation_sync_log',
    seed: seedSyncState,
    verify: verifySyncLog,
  },
]

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('migration chain', () => {
  test('the migrations folder holds migrations in a sortable order', () => {
    expect(migrations.length).toBeGreaterThan(0)
    for (const migration of migrations) expect(migration.dir).toMatch(/^\d{14}_[a-z0-9_]+$/)
    expect(new Set(migrations.map((m) => m.name)).size, 'duplicate migration names').toBe(
      migrations.length,
    )
  })

  test('every migration applies in order to an empty database and covers every model', () => {
    const db = openDatabase()
    applyAll(db, migrations)
    const models = [...readFileSync(SCHEMA_PATH, 'utf8').matchAll(/^model (\w+) \{/gm)].map(
      (m) => m[1]!,
    )
    expect(models.length).toBeGreaterThan(0)
    expect(tableNames(db)).toEqual(expect.arrayContaining(models))
    expectConsistent(db)
    db.close()
  })

  test('every fixture case names a migration that exists', () => {
    const names = migrations.map((m) => m.name)
    for (const fixture of CASES) expect(names, fixture.migration).toContain(fixture.migration)
  })

  describe.each(CASES)('$migration over the previous release', (fixture) => {
    test('nothing is lost', () => {
      const at = migrations.findIndex((m) => m.name === fixture.migration)
      expect(at, `no migration named ${fixture.migration}`).toBeGreaterThanOrEqual(0)
      const db = openDatabase()
      applyAll(db, migrations.slice(0, at))
      fixture.seed(db)
      expectConsistent(db)
      const before = snapshot(db)
      db.exec(migrations[at]!.sql)
      fixture.verify(db, before)
      db.close()
    })

    test('the migrations after it apply over the same rows', () => {
      const at = migrations.findIndex((m) => m.name === fixture.migration)
      expect(at, `no migration named ${fixture.migration}`).toBeGreaterThanOrEqual(0)
      const db = openDatabase()
      applyAll(db, migrations.slice(0, at))
      fixture.seed(db)
      applyAll(db, migrations.slice(at))
      expectConsistent(db)
      db.close()
    })
  })

  test('the migrations match prisma/schema.prisma', () => {
    // `--exit-code` makes a difference exit with 2; the diff itself is on stdout.
    const result = spawnSync(
      'npx',
      [
        'prisma',
        'migrate',
        'diff',
        '--from-migrations',
        'prisma/migrations',
        '--to-schema',
        'prisma/schema.prisma',
        '--exit-code',
      ],
      { cwd: ROOT, encoding: 'utf8' },
    )
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  }, 60_000)
})
