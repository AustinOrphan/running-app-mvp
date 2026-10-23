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
 * The previous release's weeks and sessions, in the schema after the PlanSession redefine: weeks
 * with no flag, a recovery flag, a post-race flag and a taper flag, holding sessions of every
 * quality kind, of other kinds and of none.
 */
function seedPlanWeeks(db: DatabaseSync): void {
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
  for (const id of ['p1', 'p2']) {
    insert(db, 'Plan', {
      id,
      userId: 'u1',
      goalId: 'g1',
      name: 'Synthetic plan',
      startDate: '2026-10-05',
      raceWeekStart: '2027-04-12',
      status: id === 'p1' ? 'active' : 'archived',
      generatorVersion: 2,
      updatedAt: STAMP,
    })
  }

  // [plan, weekStart, flags]
  const weeks: Array<[string, string, string[]]> = [
    ['p1', '2026-10-05', []],
    ['p1', '2026-10-12', ['recovery', 'strength']],
    ['p1', '2026-10-19', ['post-race']],
    ['p1', '2026-10-26', ['taper']],
    ['p2', '2026-10-05', ['recovery']],
  ]
  weeks.forEach(([planId, weekStart, flags], i) => {
    insert(db, 'PlanWeek', {
      id: `w${i + 1}`,
      planId,
      weekStart,
      index: i,
      phase: 'base',
      baselineRunMin: 120,
      targetRunMin: 130,
      longRunMin: 60,
      runDays: 4,
      strengthSessions: 1,
      flags: JSON.stringify(flags),
      updatedAt: STAMP,
    })
  })

  // [plan, weekStart, kinds]: the first week holds all five quality kinds, the others few or none.
  const sessions: Array<[string, string, string[]]> = [
    ['p1', '2026-10-05', ['threshold', 'intervals', 'hills', 'race-pace', 'long-fast-finish']],
    ['p1', '2026-10-05', ['easy', 'long', 'strength']],
    ['p1', '2026-10-12', ['easy', 'long']],
    ['p1', '2026-10-26', ['threshold', 'easy']],
    ['p2', '2026-10-05', ['easy']],
  ]
  let n = 0
  for (const [planId, weekStart, kinds] of sessions) {
    for (const kind of kinds) {
      n += 1
      insert(db, 'PlanSession', {
        id: `s${n}`,
        planId,
        externalId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
        weekStart,
        date: weekStart,
        order: 0,
        kind,
        title: `Synthetic session ${n}`,
        durationMin: 40,
        target: TARGET,
        purpose: 'Synthetic.',
        updatedAt: STAMP,
      })
    }
  }
}

function verifyPlanWeeks(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  // The count is the stored sessions of the quality kinds, and the flag follows the stored flags
  // (a post-race week is a recovery week that carries no 'recovery' flag).
  expect(
    rowsOf(db, 'SELECT id, qualitySessions, isRecovery FROM "PlanWeek" ORDER BY id'),
    'backfilled weeks',
  ).toEqual([
    { id: 'w1', qualitySessions: 5, isRecovery: 0 },
    { id: 'w2', qualitySessions: 0, isRecovery: 1 },
    { id: 'w3', qualitySessions: 0, isRecovery: 1 },
    { id: 'w4', qualitySessions: 1, isRecovery: 0 },
    { id: 'w5', qualitySessions: 0, isRecovery: 1 },
  ])

  // A week written without the two columns takes their defaults.
  insert(db, 'PlanWeek', {
    id: 'w6',
    planId: 'p1',
    weekStart: '2026-11-02',
    index: 5,
    phase: 'base',
    baselineRunMin: 120,
    targetRunMin: 130,
    longRunMin: 60,
    runDays: 4,
    strengthSessions: 1,
    updatedAt: STAMP,
  })
  expect(rowsOf(db, `SELECT qualitySessions, isRecovery FROM "PlanWeek" WHERE id = 'w6'`)).toEqual([
    { qualitySessions: 0, isRecovery: 0 },
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

/**
 * The previous release's accounts: two runners, each with a connected intervals.icu integration,
 * one with an activity. The wrist-delivery tables must leave all of it alone.
 */
function seedWristDelivery(db: DatabaseSync): void {
  for (const id of ['u1', 'u2']) {
    insert(db, 'User', {
      id,
      email: `${id}@example.com`,
      passwordHash: 'not-a-real-hash',
      updatedAt: STAMP,
    })
    insert(db, 'Integration', {
      id: `i-${id}`,
      userId: id,
      provider: 'intervals',
      status: 'connected',
      secret: 'v1.not.a.real.secret',
      config: JSON.stringify({ athleteId: 'i1001' }),
      updatedAt: STAMP,
    })
  }
  insert(db, 'Activity', {
    id: 'a1',
    userId: 'u1',
    date: '2026-10-06',
    type: 'run',
    durationSec: 2700,
    distanceM: 8000,
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

function verifyWristDelivery(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  // Both tables are new and empty; no existing row is given a delivery channel.
  for (const table of ['DeliveryChannel', 'WristPublication']) {
    expect(rowsOf(db, `SELECT count(*) AS n FROM "${table}"`), table).toEqual([{ n: 0 }])
  }
  expectIndex(db, 'DeliveryChannel', ['userId', 'channel'], true)
  expectIndex(db, 'DeliveryChannel', ['tokenHash'], true)
  expectIndex(db, 'WristPublication', ['userId', 'channel', 'externalId'], true)
  expectIndex(db, 'WristPublication', ['userId', 'channel', 'date'], false)
  const keys = (table: string) =>
    rowsOf(db, `PRAGMA foreign_key_list("${table}")`).map((k) => ({
      from: k.from,
      table: k.table,
      onDelete: k.on_delete,
    }))
  expect(keys('DeliveryChannel')).toEqual([{ from: 'userId', table: 'User', onDelete: 'CASCADE' }])
  // Publications join PlanSession by externalId and have no foreign key to it.
  expect(keys('WristPublication')).toEqual([{ from: 'userId', table: 'User', onDelete: 'CASCADE' }])

  // The defaults: publishing is off until the runner turns it on.
  insert(db, 'DeliveryChannel', { id: 'c1', userId: 'u1', channel: 'intervals', updatedAt: STAMP })
  expect(rowsOf(db, `SELECT enabled, garminLinked, tokenHash FROM "DeliveryChannel"`)).toEqual([
    { enabled: 0, garminLinked: 0, tokenHash: null },
  ])
  insert(db, 'WristPublication', {
    id: 'w1',
    userId: 'u1',
    channel: 'intervals',
    externalId: 'rl-abc123-ext1',
    date: '2026-10-12',
    kind: 'easy',
    title: 'Easy run, 45 min',
    state: 'pending',
    desiredHash: 'h1',
    updatedAt: STAMP,
  })
  expect(
    rowsOf(db, `SELECT variant, warnings, attempts, remoteId FROM "WristPublication"`),
  ).toEqual([{ variant: 'planned', warnings: '[]', attempts: 0, remoteId: null }])

  // One row per user and channel; one publication per session identity; the feed token hash is
  // unique, and rows without a token do not collide.
  expect(() =>
    insert(db, 'DeliveryChannel', {
      id: 'c1b',
      userId: 'u1',
      channel: 'intervals',
      updatedAt: STAMP,
    }),
  ).toThrow(/UNIQUE/)
  insert(db, 'DeliveryChannel', {
    id: 'c2',
    userId: 'u1',
    channel: 'calendar',
    tokenHash: 'a'.repeat(64),
    updatedAt: STAMP,
  })
  expect(() =>
    insert(db, 'DeliveryChannel', {
      id: 'c3',
      userId: 'u2',
      channel: 'calendar',
      tokenHash: 'a'.repeat(64),
      updatedAt: STAMP,
    }),
  ).toThrow(/UNIQUE/)
  insert(db, 'DeliveryChannel', { id: 'c4', userId: 'u2', channel: 'intervals', updatedAt: STAMP })
  insert(db, 'DeliveryChannel', { id: 'c5', userId: 'u2', channel: 'calendar', updatedAt: STAMP })
  expect(() =>
    insert(db, 'WristPublication', {
      id: 'w1b',
      userId: 'u1',
      channel: 'intervals',
      externalId: 'rl-abc123-ext1',
      date: '2026-10-13',
      kind: 'easy',
      title: 'Easy run, 45 min',
      state: 'pending',
      desiredHash: 'h2',
      updatedAt: STAMP,
    }),
  ).toThrow(/UNIQUE/)

  // Deleting a runner deletes the runner's delivery rows and nobody else's.
  db.exec(`DELETE FROM "User" WHERE id = 'u1'`)
  expect(rowsOf(db, `SELECT id FROM "DeliveryChannel" ORDER BY id`)).toEqual([
    { id: 'c4' },
    { id: 'c5' },
  ])
  expect(rowsOf(db, `SELECT count(*) AS n FROM "WristPublication"`)).toEqual([{ n: 0 }])
  expect(rowsOf(db, `SELECT id FROM "Integration"`)).toEqual([{ id: 'i-u2' }])
}

/** A previous-release prediction row; `createdAt` is whatever storage type the case wants. */
function predictionRow(
  id: string,
  inputs: string,
  createdAt: string | number,
): Record<string, SQLInputValue> {
  return {
    id,
    userId: 'u1',
    goalId: 'g1',
    createdAt,
    method: 'synthetic',
    predictedSec: 12_000,
    lowSec: 11_500,
    highSec: 12_600,
    inputs,
  }
}

const withToday = (today: string) => JSON.stringify({ today, conditions: [], rules: ['l-1'] })

/**
 * The previous release's prediction log: one row per generate or re-plan, with the day in
 * "inputs". The first four rows are the design's: a Wednesday and a Sunday `inputs.today`, then a
 * text and an integer "createdAt" with no day in "inputs". The rest exercise the fallback. 19
 * October 2026 is a Monday.
 */
function seedPredictionLog(db: DatabaseSync): void {
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
  insert(db, 'Activity', {
    id: 'a1',
    userId: 'u1',
    date: '2026-10-06',
    type: 'run',
    durationSec: 2700,
    distanceM: 8000,
    updatedAt: STAMP,
  })
  // A Wednesday and a Sunday of one week; "createdAt" disagrees, so "inputs" is what decides.
  const iso = (day: string, time: string) => `${day}T${time}.000+00:00`
  insert(
    db,
    'PredictionLog',
    predictionRow('wed', withToday('2026-10-21'), iso('2026-10-23', '06:00:00')),
  )
  insert(
    db,
    'PredictionLog',
    predictionRow('sun', withToday('2026-10-25'), iso('2026-10-26', '01:00:00')),
  )
  // No day in "inputs": the UTC day of "createdAt", as SQL text and as milliseconds since the epoch.
  insert(db, 'PredictionLog', predictionRow('text', '{}', '2026-10-22 08:30:00'))
  insert(db, 'PredictionLog', predictionRow('int', '{}', Date.UTC(2026, 9, 26, 5)))
  // The driver's ISO text late on a Sunday; "inputs" that are not JSON; a day that is a number.
  insert(db, 'PredictionLog', predictionRow('late', '{}', iso('2026-10-25', '23:30:00')))
  insert(db, 'PredictionLog', predictionRow('junk', 'not json', iso('2026-10-27', '09:00:00')))
  insert(db, 'PredictionLog', predictionRow('number', '{"today":5}', Date.UTC(2026, 10, 1, 12)))
}

function verifyRaceResults(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  // Every row is kept, the several of one week included: the log collapses on read.
  const rows = rowsOf(db, 'SELECT * FROM "PredictionLog" ORDER BY id')
  expect(rows.map((r) => r.id)).toEqual(['int', 'junk', 'late', 'number', 'sun', 'text', 'wed'])
  expect(Object.fromEntries(rows.map((r) => [r.id, [r.loggedOn, r.weekStart]]))).toEqual({
    wed: ['2026-10-21', '2026-10-19'],
    sun: ['2026-10-25', '2026-10-19'],
    text: ['2026-10-22', '2026-10-19'],
    int: ['2026-10-26', '2026-10-26'],
    late: ['2026-10-25', '2026-10-19'],
    junk: ['2026-10-27', '2026-10-26'],
    number: ['2026-11-01', '2026-10-26'],
  })

  // No database default: both columns are required, so a writer that forgets one fails loudly.
  const columns = rowsOf(db, 'PRAGMA table_info("PredictionLog")')
  for (const name of ['weekStart', 'loggedOn']) {
    expect(
      columns.find((c) => c.name === name),
      name,
    ).toMatchObject({
      notnull: 1,
      dflt_value: null,
    })
  }
  expect(() => {
    insert(db, 'PredictionLog', {
      id: 'x',
      userId: 'u1',
      goalId: 'g1',
      method: 'synthetic',
      predictedSec: 1,
      lowSec: 1,
      highSec: 1,
    })
  }).toThrow(/NOT NULL/)
  expectIndex(db, 'PredictionLog', ['userId', 'goalId', 'createdAt'], false)
  expectIndex(db, 'PredictionLog', ['userId', 'goalId', 'weekStart'], false)
  const keys = rowsOf(db, `PRAGMA foreign_key_list("PredictionLog")`).map((k) => ({
    from: k.from,
    table: k.table,
    onDelete: k.on_delete,
  }))
  expect(keys).toContainEqual({ from: 'userId', table: 'User', onDelete: 'CASCADE' })
  expect(keys).toContainEqual({ from: 'goalId', table: 'Goal', onDelete: 'CASCADE' })

  // The result table starts empty; its goal and its activity are each unique.
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "RaceResult"')).toEqual([{ n: 0 }])
  expectIndex(db, 'RaceResult', ['goalId'], true)
  expectIndex(db, 'RaceResult', ['activityId'], true)
  const required = {
    userId: 'u1',
    goalId: 'g1',
    date: '2027-04-18',
    distanceM: 42_195,
    outcome: 'finished',
    timeSec: 12_000,
    updatedAt: STAMP,
  }
  insert(db, 'RaceResult', { id: 'r1', ...required, activityId: 'a1' })
  expect(rowsOf(db, `SELECT * FROM "RaceResult" WHERE id = 'r1'`)[0]).toMatchObject({
    gainM: null,
    note: null,
  })
  insert(db, 'Goal', {
    id: 'g2',
    userId: 'u1',
    name: 'Another synthetic race',
    priority: 'B',
    targetDate: '2027-06-01',
    updatedAt: STAMP,
  })
  expect(() => {
    insert(db, 'RaceResult', { id: 'r2', ...required })
  }).toThrow(/UNIQUE/)
  expect(() => {
    insert(db, 'RaceResult', { id: 'r2', ...required, goalId: 'g2', activityId: 'a1' })
  }).toThrow(/UNIQUE/)

  // Deleting the activity keeps the result; deleting the goal takes the result and its predictions.
  db.exec(`DELETE FROM "Activity" WHERE id = 'a1'`)
  expect(rowsOf(db, `SELECT "activityId" FROM "RaceResult" WHERE id = 'r1'`)).toEqual([
    { activityId: null },
  ])
  db.exec(`DELETE FROM "Goal" WHERE id = 'g1'`)
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "RaceResult"')).toEqual([{ n: 0 }])
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "PredictionLog"')).toEqual([{ n: 0 }])
}

/** The previous release's revisions: one of each reason, in two plans, with distinct timestamps. */
function seedRevisions(db: DatabaseSync): void {
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
  for (const id of ['p-active', 'p-old']) {
    insert(db, 'Plan', {
      id,
      userId: 'u1',
      goalId: 'g1',
      name: 'Synthetic plan',
      startDate: '2026-10-05',
      raceWeekStart: '2027-04-12',
      status: id === 'p-active' ? 'active' : 'archived',
      generatorVersion: 2,
      updatedAt: STAMP,
    })
  }
  const changes = JSON.stringify([
    { weekStart: '2026-10-12', field: 'targetRunMin', from: 300, to: 280, rules: ['J5'] },
  ])
  // [id, plan, reason, createdAt]
  const revisions: Array<[string, string, string, string]> = [
    ['r01', 'p-active', 'generate', '2026-10-05 08:00:00'],
    ['r02', 'p-active', 'weekly', '2026-10-12 03:00:00'],
    ['r03', 'p-active', 'review', '2026-10-13 09:30:00'],
    ['r04', 'p-active', 'owner', '2026-10-14 18:45:00'],
    ['r05', 'p-active', 'break', '2026-10-19 03:00:00'],
    ['r06', 'p-old', 'weekly', '2026-09-28 03:00:00'],
    ['r07', 'p-old', 'generate', '2026-09-21 08:00:00'],
  ]
  for (const [id, planId, reason, createdAt] of revisions) {
    insert(db, 'PlanRevision', {
      id,
      planId,
      reason,
      summary: `Synthetic ${reason} revision.`,
      changes: reason === 'generate' ? '[]' : changes,
      createdAt,
    })
  }
}

function verifyRevisionModel(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  const seeded = before.get('PlanRevision') ?? []
  expect(seeded).toHaveLength(7)
  const rows = rowsOf(db, 'SELECT * FROM "PlanRevision" ORDER BY id')
  expect(rows.map((r) => r.id)).toEqual(seeded.map((r) => r.id).sort())

  // The scheduler's revisions (weekly and break) are automatic; nothing else is.
  expect(
    rows.filter((r) => r.auto === 1).map((r) => r.id),
    'rows backfilled as automatic',
  ).toEqual(['r02', 'r05', 'r06'])
  expect(rows.filter((r) => r.auto === 0).map((r) => r.id)).toEqual(['r01', 'r03', 'r04', 'r07'])

  // Every old revision counts as seen when it was written, so none reads as new.
  for (const row of rows) expect(row.seenAt, `seenAt of ${String(row.id)}`).toBe(row.createdAt)

  // Old rows have no diff, no undo payload and no link to an undo or a rest window.
  for (const row of rows) {
    expect(row, String(row.id)).toMatchObject({
      decision: null,
      diff: null,
      undo: null,
      undoneAt: null,
      undoneById: null,
      undoOf: null,
      disruptionId: null,
    })
  }

  // New rows default to a manual, unseen revision.
  db.exec(
    `INSERT INTO "PlanRevision" ("id", "planId", "reason", "summary") VALUES ('r08', 'p-active', 'owner', 'New.')`,
  )
  expect(rowsOf(db, `SELECT auto, seenAt FROM "PlanRevision" WHERE id = 'r08'`)).toEqual([
    { auto: 0, seenAt: null },
  ])

  // Both indexes survive the redefine, and the cascade from the plan still fires.
  expectIndex(db, 'PlanRevision', ['planId', 'createdAt'], false)
  expectIndex(db, 'PlanRevision', ['planId', 'reason'], false)
  const keys = rowsOf(db, `PRAGMA foreign_key_list("PlanRevision")`).map((k) => ({
    from: k.from,
    table: k.table,
    onDelete: k.on_delete,
  }))
  expect(keys).toEqual([{ from: 'planId', table: 'Plan', onDelete: 'CASCADE' }])
  db.exec(`DELETE FROM "Plan" WHERE id = 'p-old'`)
  expect(rowsOf(db, `SELECT count(*) AS n FROM "PlanRevision" WHERE "planId" = 'p-old'`)).toEqual([
    { n: 0 },
  ])
}

/**
 * The previous release's places: a profile with a home location, a goal with a race location and
 * an activity with weather, which are what the caches are keyed on and what they replace. The
 * weather cache adds two tables beside them and touches none.
 */
function seedPlaces(db: DatabaseSync): void {
  insert(db, 'User', {
    id: 'u1',
    email: 'runner@example.com',
    passwordHash: 'not-a-real-hash',
    updatedAt: STAMP,
  })
  insert(db, 'AthleteProfile', {
    userId: 'u1',
    homeLat: 20.5,
    homeLng: -30.12,
    updatedAt: STAMP,
  })
  insert(db, 'Goal', {
    id: 'g1',
    userId: 'u1',
    name: 'Synthetic marathon',
    priority: 'A',
    targetDate: '2027-04-18',
    raceLat: 40.12,
    raceLng: -105.23,
    updatedAt: STAMP,
  })
  insert(db, 'Activity', {
    id: 'a1',
    userId: 'u1',
    date: '2026-10-06',
    type: 'run',
    durationSec: 2700,
    distanceM: 8000,
    tempC: 11.5,
    weatherSource: 'open-meteo',
    updatedAt: STAMP,
  })
}

function verifyWeatherCache(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  // Both tables start empty: the old in-memory caches left nothing to carry over.
  for (const table of ['ForecastCache', 'ClimateCache']) {
    expect(tableNames(db)).toContain(table)
    expect(rowsOf(db, `SELECT count(*) AS n FROM "${table}"`)).toEqual([{ n: 0 }])
  }
  expectIndex(db, 'ForecastCache', ['latE1', 'lngE1'], true)
  expectIndex(db, 'ClimateCache', ['latE2', 'lngE2', 'monthDay', 'startHour', 'windowHours'], true)

  // A forecast cell is integer tenths of a degree; only the cell is required.
  insert(db, 'ForecastCache', { id: 'f1', latE1: 205, lngE1: -301 })
  insert(db, 'ForecastCache', { id: 'f2', latE1: 205, lngE1: -300 })
  expect(rowsOf(db, `SELECT * FROM "ForecastCache" WHERE id = 'f1'`)[0]).toMatchObject({
    hours: '[]',
    fetchedAt: null,
    failedAt: null,
    lastError: null,
  })
  expect(() => {
    insert(db, 'ForecastCache', { id: 'f3', latE1: 205, lngE1: -301 })
  }).toThrow(/UNIQUE/)

  // A race climate is one row per cell, month and day, start hour and window length.
  const cell = { latE2: 4012, lngE2: -10523, monthDay: '04-18', startHour: 8, windowHours: 4 }
  insert(db, 'ClimateCache', { id: 'c1', ...cell })
  insert(db, 'ClimateCache', { id: 'c2', ...cell, windowHours: 5 })
  insert(db, 'ClimateCache', { id: 'c3', ...cell, monthDay: '04-19', wbgtC: 17.4, complete: 1 })
  expect(rowsOf(db, `SELECT * FROM "ClimateCache" WHERE id = 'c1'`)[0]).toMatchObject({
    wbgtC: null,
    samples: 0,
    yearsRead: 0,
    complete: 0,
    fetchedAt: null,
    failedAt: null,
    lastError: null,
  })
  expect(() => {
    insert(db, 'ClimateCache', { id: 'c4', ...cell })
  }).toThrow(/UNIQUE/)

  // The caches hold places, not people: removing the user takes nothing from them.
  db.exec(`DELETE FROM "User" WHERE id = 'u1'`)
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "ForecastCache"')).toEqual([{ n: 2 }])
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "ClimateCache"')).toEqual([{ n: 3 }])
}

/**
 * The previous release's runs: two accounts, each with activities (one with a stream). The run
 * insights add one table keyed by activity and touch none of these rows.
 */
function seedRuns(db: DatabaseSync): void {
  for (const id of ['u1', 'u2']) {
    insert(db, 'User', {
      id,
      email: `${id}@example.com`,
      passwordHash: 'not-a-real-hash',
      updatedAt: STAMP,
    })
  }
  const runs: Array<[string, string]> = [
    ['a1', 'u1'],
    ['a2', 'u1'],
    ['a3', 'u2'],
  ]
  for (const [id, userId] of runs) {
    insert(db, 'Activity', {
      id,
      userId,
      date: '2026-10-06',
      type: 'run',
      durationSec: 2700,
      distanceM: 8000,
      updatedAt: STAMP,
    })
  }
  insert(db, 'ActivityStream', { activityId: 'a1', sampleSec: 10, data: '{}' })
}

function verifyActivityInsight(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  // The table starts empty: an insight is computed on the first read of a run.
  expect(tableNames(db)).toContain('ActivityInsight')
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "ActivityInsight"')).toEqual([{ n: 0 }])
  expect(
    rowsOf(db, 'PRAGMA table_info("ActivityInsight")').map((c) => [
      c.name,
      c.type,
      c.notnull,
      c.pk,
    ]),
  ).toEqual([
    ['activityId', 'TEXT', 1, 1],
    ['version', 'INTEGER', 1, 0],
    ['facts', 'TEXT', 1, 0],
    ['computedAt', 'DATETIME', 1, 0],
  ])

  // One insight per activity: the activity id is the key.
  const insight = { version: 1, facts: '{"basis":"none","items":[]}', computedAt: STAMP }
  insert(db, 'ActivityInsight', { activityId: 'a1', ...insight })
  insert(db, 'ActivityInsight', { activityId: 'a2', ...insight })
  insert(db, 'ActivityInsight', { activityId: 'a3', ...insight })
  expect(() => {
    insert(db, 'ActivityInsight', { activityId: 'a1', ...insight })
  }).toThrow(/UNIQUE/)
  // An insight needs its activity.
  expect(() => {
    insert(db, 'ActivityInsight', { activityId: 'nobody', ...insight })
  }).toThrow(/FOREIGN KEY/)
  const keys = rowsOf(db, `PRAGMA foreign_key_list("ActivityInsight")`).map((k) => ({
    from: k.from,
    table: k.table,
    onDelete: k.on_delete,
  }))
  expect(keys).toEqual([{ from: 'activityId', table: 'Activity', onDelete: 'CASCADE' }])

  // Deleting a run deletes its insight and no other; deleting an account takes its runs' insights.
  db.exec(`DELETE FROM "Activity" WHERE id = 'a2'`)
  expect(rowsOf(db, 'SELECT "activityId" FROM "ActivityInsight" ORDER BY "activityId"')).toEqual([
    { activityId: 'a1' },
    { activityId: 'a3' },
  ])
  db.exec(`DELETE FROM "User" WHERE id = 'u1'`)
  expect(rowsOf(db, 'SELECT "activityId" FROM "ActivityInsight"')).toEqual([{ activityId: 'a3' }])
  expectConsistent(db)
}

/**
 * The previous release's runs: two users, each with a long run and a strength session. The fuel
 * tables are new, so nothing exists to carry over; the case checks that the runs survive, that the
 * tables start empty, and that each new table ties to its owner as the schema says.
 */
function seedFuelRuns(db: DatabaseSync): void {
  for (const [id, email] of [
    ['u1', 'runner@example.com'],
    ['u2', 'other@example.com'],
  ] as const) {
    insert(db, 'User', { id, email, passwordHash: 'not-a-real-hash', updatedAt: STAMP })
  }
  // [id, user, type, date, duration]
  const activities: Array<[string, string, string, string, number]> = [
    ['a1', 'u1', 'run', '2026-10-03', 3 * 3600],
    ['a2', 'u1', 'strength', '2026-10-04', 2400],
    ['a3', 'u2', 'run', '2026-10-03', 7500],
  ]
  for (const [id, userId, type, date, durationSec] of activities) {
    insert(db, 'Activity', { id, userId, type, date, durationSec, updatedAt: STAMP })
  }
}

function verifyFuelLab(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  for (const table of ['FuelProduct', 'FuelLog', 'FuelSettings']) {
    expect(tableNames(db)).toContain(table)
    expect(rowsOf(db, `SELECT count(*) AS n FROM "${table}"`)).toEqual([{ n: 0 }])
  }
  expectIndex(db, 'FuelProduct', ['userId', 'archived'], false)
  expectIndex(db, 'FuelLog', ['activityId'], true)
  expectIndex(db, 'FuelLog', ['userId'], false)

  // A product needs a name, a kind, a serving and its carbohydrate; the rest has defaults. Names are
  // not unique in the table: the service keeps live names apart, because an archived product frees
  // its name.
  const product = {
    userId: 'u1',
    name: 'Synthetic gel',
    kind: 'gel',
    servingLabel: '1 gel',
    carbsG: 25,
  }
  insert(db, 'FuelProduct', { id: 'p1', ...product, updatedAt: STAMP })
  insert(db, 'FuelProduct', { id: 'p2', ...product, archived: 1, updatedAt: STAMP })
  expect(rowsOf(db, `SELECT * FROM "FuelProduct" WHERE id = 'p1'`)[0]).toMatchObject({
    sodiumMg: null,
    kcal: null,
    multiCarb: 0,
    archived: 0,
  })

  // One log per activity. Its answers are optional columns (a skipped run has none), and the
  // runner's "it was hot" is null until chosen.
  insert(db, 'FuelLog', { id: 'l1', userId: 'u1', activityId: 'a1', gut: 1, updatedAt: STAMP })
  expect(rowsOf(db, `SELECT * FROM "FuelLog" WHERE id = 'l1'`)[0]).toMatchObject({
    skipped: 0,
    items: '[]',
    fluidMl: null,
    sodiumMg: null,
    nausea: null,
    hotOverride: null,
    notes: null,
  })
  insert(db, 'FuelLog', { id: 'l2', userId: 'u1', activityId: 'a2', skipped: 1, updatedAt: STAMP })
  expect(rowsOf(db, `SELECT gut FROM "FuelLog" WHERE id = 'l2'`)).toEqual([{ gut: null }])
  expect(() => {
    insert(db, 'FuelLog', { id: 'l3', userId: 'u1', activityId: 'a1', updatedAt: STAMP })
  }).toThrow(/UNIQUE/)
  expect(() => {
    insert(db, 'FuelLog', { id: 'l4', userId: 'u1', activityId: 'missing', updatedAt: STAMP })
  }).toThrow(/FOREIGN KEY/)

  // One settings row per user, with the switches off and the gut-training block on.
  insert(db, 'FuelSettings', { userId: 'u1', updatedAt: STAMP })
  expect(rowsOf(db, `SELECT * FROM "FuelSettings" WHERE "userId" = 'u1'`)[0]).toMatchObject({
    optIn90: 0,
    optInAdvanced: 0,
    giDisease: 0,
    gutBlock: 1,
  })
  expect(() => {
    insert(db, 'FuelSettings', { userId: 'u1', updatedAt: STAMP })
  }).toThrow(/UNIQUE/)

  // A log goes with its run, and everything goes with the runner.
  db.exec(`DELETE FROM "Activity" WHERE id = 'a1'`)
  expect(rowsOf(db, `SELECT id FROM "FuelLog" ORDER BY id`)).toEqual([{ id: 'l2' }])
  db.exec(`DELETE FROM "User" WHERE id = 'u1'`)
  for (const table of ['FuelProduct', 'FuelLog', 'FuelSettings']) {
    expect(rowsOf(db, `SELECT count(*) AS n FROM "${table}"`), table).toEqual([{ n: 0 }])
  }
  expect(rowsOf(db, `SELECT id FROM "Activity" ORDER BY id`)).toEqual([{ id: 'a3' }])
}

/**
 * The previous release's plans: two users, one with a plan and revisions that name no window (the
 * `disruptionId` column has existed since the revision model). The window table is new, so nothing
 * carries over; the case checks that the plan rows survive, that the table starts empty, what a
 * row defaults to, how the index and the cascade are set, and that a revision can name a window
 * (no foreign key) whether or not the window exists.
 */
function seedPlansForWindows(db: DatabaseSync): void {
  for (const [id, email] of [
    ['u1', 'runner@example.com'],
    ['u2', 'other@example.com'],
  ] as const) {
    insert(db, 'User', { id, email, passwordHash: 'not-a-real-hash', updatedAt: STAMP })
  }
  insert(db, 'Goal', {
    id: 'g1',
    userId: 'u1',
    name: 'Synthetic half',
    priority: 'A',
    targetDate: '2026-12-05',
    updatedAt: STAMP,
  })
  insert(db, 'Plan', {
    id: 'p1',
    userId: 'u1',
    goalId: 'g1',
    name: 'Synthetic plan',
    startDate: '2026-10-19',
    raceWeekStart: '2026-11-30',
    status: 'active',
    generatorVersion: 2,
    updatedAt: STAMP,
  })
  insert(db, 'PlanRevision', {
    id: 'r1',
    planId: 'p1',
    reason: 'weekly',
    summary: 'Synthetic weekly revision.',
    createdAt: '2026-10-19 03:00:00',
  })
}

function verifyDisruptions(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  expect(tableNames(db)).toContain('Disruption')
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "Disruption"')).toEqual([{ n: 0 }])
  expectIndex(db, 'Disruption', ['userId', 'status', 'endDate'], false)

  // A window needs its reason, mode and two days; the rest has defaults.
  const window = {
    userId: 'u1',
    reason: 'illness-above-neck',
    mode: 'rest',
    startDate: '2026-10-19',
    endDate: '2026-10-21',
  }
  insert(db, 'Disruption', { id: 'w1', ...window, updatedAt: STAMP })
  expect(rowsOf(db, `SELECT * FROM "Disruption" WHERE id = 'w1'`)[0]).toMatchObject({
    maxRunMin: null,
    area: null,
    pain: null,
    gaitChange: 0,
    note: null,
    status: 'active',
  })
  insert(db, 'Disruption', {
    id: 'w2',
    ...window,
    userId: 'u2',
    reason: 'niggle',
    mode: 'limited',
    maxRunMin: 30,
    area: 'calf',
    pain: 3,
    gaitChange: 1,
    status: 'undone',
    updatedAt: STAMP,
  })
  expect(() => {
    insert(db, 'Disruption', { id: 'w3', ...window, userId: 'missing', updatedAt: STAMP })
  }).toThrow(/FOREIGN KEY/)
  const keys = rowsOf(db, `PRAGMA foreign_key_list("Disruption")`).map((k) => ({
    from: k.from,
    table: k.table,
    onDelete: k.on_delete,
  }))
  expect(keys).toEqual([{ from: 'userId', table: 'User', onDelete: 'CASCADE' }])

  // A revision names a window by id and no key: the window is not required to exist, and removing
  // one leaves the revision that names it.
  db.exec(`UPDATE "PlanRevision" SET "disruptionId" = 'w1' WHERE id = 'r1'`)
  db.exec(`DELETE FROM "Disruption" WHERE id = 'w1'`)
  expect(rowsOf(db, `SELECT "disruptionId" FROM "PlanRevision" WHERE id = 'r1'`)).toEqual([
    { disruptionId: 'w1' },
  ])

  // Windows go with the runner; the plan of the other runner stays.
  db.exec(`DELETE FROM "User" WHERE id = 'u2'`)
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "Disruption"')).toEqual([{ n: 0 }])
  expect(rowsOf(db, `SELECT id FROM "Plan"`)).toEqual([{ id: 'p1' }])
}

/**
 * The brief table is new, so nothing carries over from the previous release's plans and weekly
 * revisions (the rows the rest-window case seeds). The case checks that those rows survive, that
 * the table starts empty, what a row defaults to, that a runner has one brief a week and a
 * revision at most one brief, and how the two keys behave: the brief goes with its runner, and
 * outlives its revision with the link cleared.
 */
function verifyWeeklyBrief(db: DatabaseSync, before: Snapshot): void {
  expectNothingLost(before, db)
  expectConsistent(db)

  expect(tableNames(db)).toContain('WeeklyBrief')
  expect(rowsOf(db, 'SELECT count(*) AS n FROM "WeeklyBrief"')).toEqual([{ n: 0 }])
  // no seen column: a brief is seen when its revision is (`PlanRevision.seenAt`)
  expect(
    rowsOf(db, `PRAGMA table_info("WeeklyBrief")`)
      .map((column) => String(column.name))
      .sort(),
  ).toEqual([
    'facts',
    'generatedAt',
    'id',
    'planId',
    'provisional',
    'revisionId',
    'userId',
    'version',
    'weekStart',
  ])
  expectIndex(db, 'WeeklyBrief', ['userId', 'weekStart'], true)
  expectIndex(db, 'WeeklyBrief', ['revisionId'], true)

  // A brief needs its runner, week, version and facts; the rest has defaults.
  const brief = { userId: 'u1', weekStart: '2026-10-19', version: 1, facts: '{}' }
  insert(db, 'WeeklyBrief', { id: 'b1', ...brief })
  const row = rowsOf(db, `SELECT * FROM "WeeklyBrief" WHERE id = 'b1'`)[0]
  expect(row).toMatchObject({ planId: null, revisionId: null, provisional: 0 })
  expect(row?.generatedAt, 'generatedAt defaults to now').not.toBeNull()
  expect(() => {
    insert(db, 'WeeklyBrief', { id: 'b2', ...brief })
  }, 'a second brief for the same week').toThrow(/UNIQUE/)
  expect(() => {
    insert(db, 'WeeklyBrief', { id: 'b3', ...brief, userId: 'missing', weekStart: '2026-10-26' })
  }).toThrow(/FOREIGN KEY/)

  // A revision is described by one brief at most.
  db.exec(`UPDATE "WeeklyBrief" SET "revisionId" = 'r1', "planId" = 'p1' WHERE id = 'b1'`)
  expect(() => {
    insert(db, 'WeeklyBrief', { id: 'b4', ...brief, weekStart: '2026-10-26', revisionId: 'r1' })
  }, 'a second brief for the same revision').toThrow(/UNIQUE/)
  insert(db, 'WeeklyBrief', { id: 'b5', ...brief, userId: 'u2', provisional: 1 })

  const keys = rowsOf(db, `PRAGMA foreign_key_list("WeeklyBrief")`)
    .map((k) => ({ from: k.from, table: k.table, onDelete: k.on_delete }))
    .sort((a, b) => String(a.from).localeCompare(String(b.from)))
  expect(keys).toEqual([
    { from: 'revisionId', table: 'PlanRevision', onDelete: 'SET NULL' },
    { from: 'userId', table: 'User', onDelete: 'CASCADE' },
  ])

  // The brief outlives its revision: the plan goes, the revision goes with it, the brief stays and
  // keeps its plan id as a plain value.
  db.exec(`DELETE FROM "Plan" WHERE id = 'p1'`)
  expect(rowsOf(db, `SELECT count(*) AS n FROM "PlanRevision" WHERE id = 'r1'`)).toEqual([{ n: 0 }])
  expect(rowsOf(db, `SELECT "planId", "revisionId" FROM "WeeklyBrief" WHERE id = 'b1'`)).toEqual([
    { planId: 'p1', revisionId: null },
  ])

  // Briefs go with the runner.
  db.exec(`DELETE FROM "User" WHERE id = 'u1'`)
  expect(rowsOf(db, `SELECT id FROM "WeeklyBrief" ORDER BY id`)).toEqual([{ id: 'b5' }])
}

const CASES: FixtureCase[] = [
  {
    migration: 'foundation_plan_session',
    seed: seedPlanSessions,
    verify: verifyPlanSessions,
  },
  {
    migration: 'plan_week_quality_sessions',
    seed: seedPlanWeeks,
    verify: verifyPlanWeeks,
  },
  {
    migration: 'foundation_sync_log',
    seed: seedSyncState,
    verify: verifySyncLog,
  },
  {
    migration: 'wrist_delivery',
    seed: seedWristDelivery,
    verify: verifyWristDelivery,
  },
  {
    migration: 'race_results',
    seed: seedPredictionLog,
    verify: verifyRaceResults,
  },
  {
    migration: 'revision_model',
    seed: seedRevisions,
    verify: verifyRevisionModel,
  },
  {
    migration: 'foundation_weather_cache',
    seed: seedPlaces,
    verify: verifyWeatherCache,
  },
  {
    migration: 'activity_insight',
    seed: seedRuns,
    verify: verifyActivityInsight,
  },
  {
    migration: 'fuel_lab',
    seed: seedFuelRuns,
    verify: verifyFuelLab,
  },
  {
    migration: 'disruptions',
    seed: seedPlansForWindows,
    verify: verifyDisruptions,
  },
  {
    migration: 'weekly_brief',
    seed: seedPlansForWindows,
    verify: verifyWeeklyBrief,
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
