import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { STATE_MODELS } from '../../../server/dataVersion.ts'

/**
 * The write hook (`server/dataVersion.ts`) sees Prisma model operations only. A raw SQL write to
 * a state table would change what the athlete snapshot reads without raising the data version, so
 * no file under `server/` or `scripts/` may do one (ADR 0009). Reads and writes to non-state
 * tables are fine.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCANNED = ['server', 'scripts']

const RAW_API = /\$(?:execute|query)Raw(?:Unsafe)?\b/
const WRITE_VERB =
  '(?:INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO|REPLACE\\s+INTO|UPDATE(?:\\s+OR\\s+\\w+)?|DELETE\\s+FROM)'

/**
 * Raw write statements that name a state table in a file that calls a raw Prisma method. The SQL
 * may sit in a constant away from the call, so the whole file is searched. SQLite table names are
 * case-insensitive, so the match is too.
 */
export function rawStateWrites(source: string, stateModels: readonly string[]): string[] {
  if (!RAW_API.test(source)) return []
  const statement = new RegExp(
    `\\b${WRITE_VERB}\\s+["\`'\\[]?(${stateModels.join('|')})["\`'\\]]?(?!\\w)`,
    'gi',
  )
  return [...source.matchAll(statement)].map((match) =>
    match[0].replace(/["`'[\]]/g, '').replace(/\s+/g, ' '),
  )
}

function typescriptFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, encoding: 'utf8' })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => join(dir, path))
}

describe('no raw SQL writes to a state table', () => {
  test('nothing under server/ or scripts/ writes a state table with raw SQL', () => {
    const files = SCANNED.flatMap(typescriptFiles)
    expect(files.length).toBeGreaterThan(20)
    const offences = files.flatMap((file) =>
      rawStateWrites(readFileSync(join(ROOT, file), 'utf8'), STATE_MODELS).map(
        (found) => `${relative('', file)}: ${found}`,
      ),
    )
    expect(offences).toEqual([])
  })

  test('catches a tagged template, an unsafe call, an upsert-style insert and a returning insert', () => {
    const state = ['Activity', 'Plan', 'WellnessDay']
    expect(
      rawStateWrites(
        'await prisma.$executeRaw`DELETE FROM "Activity" WHERE userId = ${id}`',
        state,
      ),
    ).toEqual(['DELETE FROM Activity'])
    expect(
      rawStateWrites(`await prisma.$executeRawUnsafe("update plan set name = 'x'")`, state),
    ).toEqual(['update plan'])
    expect(
      rawStateWrites(
        'prisma.$executeRawUnsafe(`INSERT OR REPLACE INTO Activity (id) VALUES (1)`)',
        state,
      ),
    ).toEqual(['INSERT OR REPLACE INTO Activity'])
    expect(
      rawStateWrites(
        "prisma.$queryRawUnsafe('INSERT INTO [WellnessDay] (id) VALUES (1) RETURNING id')",
        state,
      ),
    ).toEqual(['INSERT INTO WellnessDay'])
  })

  test('catches SQL kept in a constant away from the call', () => {
    const source = [
      "const CLEAR = 'DELETE FROM Activity'",
      'export const run = (p) => p.$executeRawUnsafe(CLEAR)',
    ].join('\n')
    expect(rawStateWrites(source, ['Activity'])).toEqual(['DELETE FROM Activity'])
  })

  test('lets reads, pragmas, non-state tables and files without a raw call through', () => {
    const state = ['Activity', 'Plan']
    expect(rawStateWrites('prisma.$queryRawUnsafe("PRAGMA data_version")', state)).toEqual([])
    expect(rawStateWrites('prisma.$queryRaw`SELECT * FROM "Activity"`', state)).toEqual([])
    // A name that only starts like a state model.
    expect(rawStateWrites('prisma.$executeRaw`DELETE FROM "ActivityStream"`', state)).toEqual([])
    expect(rawStateWrites('prisma.$executeRaw`UPDATE "Integration" SET a = 1`', state)).toEqual([])
    // No raw Prisma method in the file: a comment or a string is not a write.
    expect(rawStateWrites('// DELETE FROM Activity runs through deleteMany', state)).toEqual([])
  })
})
