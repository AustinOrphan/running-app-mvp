import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest'
import { createPrisma, initSqlite, type PrismaClient } from '../../../server/db.ts'
import {
  clearPasses,
  clearUserData,
  parseSchemaModels,
  schemaModels,
  userDataModels,
} from '../../schemaModels.ts'

/**
 * `resetData()` in tests/e2e/helpers.ts empties every table that holds a user's rows. The list
 * comes from the schema, so a model added later is cleared too; these tests fail if one is not.
 */

let dir: string
let prisma: PrismaClient

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rl-resetdata-'))
  const file = join(dir, 'test.db')
  copyFileSync(inject('templateDbPath'), file)
  prisma = createPrisma(`file:${file}`)
  await initSqlite(prisma)
})

afterEach(async () => {
  await prisma.$disconnect()
  rmSync(dir, { recursive: true, force: true })
})

type Row = Record<string, unknown>

async function rows(sql: string): Promise<Row[]> {
  return prisma.$queryRawUnsafe<Row[]>(sql)
}

async function tableNames(): Promise<string[]> {
  const found = await rows(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_prisma%' ESCAPE '\\'`,
  )
  return found.map((row) => String(row.name)).sort()
}

async function count(table: string): Promise<number> {
  const found = await rows(`SELECT COUNT(*) AS c FROM "${table}"`)
  return Number(found[0]?.c)
}

/** A table's parents (foreign keys to other tables), read from the database itself. */
async function foreignKeys(table: string) {
  const found = await rows(`PRAGMA foreign_key_list("${table}")`)
  return found.map((row) => ({
    from: String(row.from),
    parent: String(row.table),
    to: String(row.to),
  }))
}

/** One row in every table, whatever the schema holds, with foreign keys pointing at real rows. */
async function seedOneRowPerTable(): Promise<void> {
  const tables = await tableNames()
  const parentsOf = new Map<string, string[]>()
  for (const table of tables) {
    const parents = (await foreignKeys(table)).map((key) => key.parent).filter((p) => p !== table)
    parentsOf.set(table, parents)
  }
  const seeded = new Set<string>()
  while (seeded.size < tables.length) {
    const next = tables.find(
      (table) =>
        !seeded.has(table) && (parentsOf.get(table) ?? []).every((parent) => seeded.has(parent)),
    )
    if (!next) throw new Error('Foreign-key cycle between tables; extend the seeding helper.')
    await seedRow(next)
    seeded.add(next)
  }
}

async function seedRow(table: string): Promise<void> {
  const columns = await rows(`PRAGMA table_info("${table}")`)
  const keys = await foreignKeys(table)
  const names: string[] = []
  const values: string[] = []
  for (const column of columns) {
    const name = String(column.name)
    const required = Number(column.notnull) === 1 || Number(column.pk) > 0
    if (!required || column.dflt_value !== null) continue
    const key = keys.find((candidate) => candidate.from === name)
    const type = String(column.type).toUpperCase()
    names.push(`"${name}"`)
    if (key) values.push(`(SELECT "${key.to}" FROM "${key.parent}" LIMIT 1)`)
    else if (type === 'BLOB') values.push("x'00'")
    else if (type === 'TEXT') values.push(`'seed'`)
    else values.push('0')
  }
  const sql =
    names.length === 0
      ? `INSERT INTO "${table}" DEFAULT VALUES`
      : `INSERT INTO "${table}" (${names.join(', ')}) VALUES (${values.join(', ')})`
  await prisma.$executeRawUnsafe(sql)
}

describe('which models resetData clears', () => {
  test('every model with a userId column except User, as the database itself reports them', async () => {
    const expected: string[] = []
    for (const table of await tableNames()) {
      const columns = await rows(`PRAGMA table_info("${table}")`)
      if (columns.some((column) => column.name === 'userId') && table !== 'User') {
        expected.push(table)
      }
    }
    expect(expected.length).toBeGreaterThan(5)
    expect(
      userDataModels(schemaModels())
        .map((model) => model.name)
        .sort(),
    ).toEqual(expected)
  })

  test('the foreign-key passes cover each of those models exactly once', () => {
    const wanted = userDataModels(schemaModels()).map((model) => model.name)
    const planned = clearPasses(userDataModels(schemaModels())).flatMap((pass) =>
      pass.map((model) => model.name),
    )
    expect(planned.sort()).toEqual([...wanted].sort())
  })
})

describe('clearPasses', () => {
  const schema = [
    'model Parent {',
    '  id String @id',
    '  userId String',
    '}',
    'model Child {',
    '  id String @id',
    '  userId String',
    '  parentId String',
    '  parent Parent @relation(fields: [parentId], references: [id], onDelete: Restrict)',
    '}',
    'model Grandchild {',
    '  id String @id',
    '  userId String',
    '  childId String',
    '  child Child @relation(fields: [childId], references: [id])',
    '  twin Grandchild? @relation("Twin", fields: [id], references: [id])',
    '}',
    'model User {',
    '  id String @id',
    '}',
  ].join('\n')

  test('clears a model after every model that holds a foreign key to it', () => {
    const models = userDataModels(parseSchemaModels(schema))
    expect(clearPasses(models).map((pass) => pass.map((model) => model.name))).toEqual([
      ['Grandchild'],
      ['Child'],
      ['Parent'],
    ])
  })

  test('a model that refers to itself does not block its own delete', () => {
    const models = parseSchemaModels(
      [
        'model Node {',
        '  id String @id',
        '  userId String',
        '  nextId String?',
        '  next Node? @relation("Next", fields: [nextId], references: [id])',
        '}',
      ].join('\n'),
    )
    expect(clearPasses(models).map((pass) => pass.map((model) => model.name))).toEqual([['Node']])
  })

  test('throws on a cycle between two models', () => {
    const models = parseSchemaModels(
      [
        'model A {',
        '  id String @id',
        '  userId String',
        '  bId String',
        '  b B @relation("AB", fields: [bId], references: [id])',
        '}',
        'model B {',
        '  id String @id',
        '  userId String',
        '  aId String',
        '  a A @relation("BA", fields: [aId], references: [id])',
        '}',
      ].join('\n'),
    )
    expect(() => clearPasses(models)).toThrow(/cycle/i)
  })
})

describe('clearUserData', () => {
  test('empties every table that holds a user, children included, and keeps the account', async () => {
    await seedOneRowPerTable()
    const tables = await tableNames()
    // The helper must have seeded every table, or an empty table would pass for the wrong reason.
    for (const table of tables) expect(await count(table), `${table} was not seeded`).toBe(1)

    await clearUserData(prisma)

    const left: string[] = []
    for (const table of tables) {
      if (table === 'User') continue
      if ((await count(table)) !== 0) left.push(table)
    }
    expect(left, 'tables resetData left rows in').toEqual([])
    expect(await count('User')).toBe(1)
  })
})
