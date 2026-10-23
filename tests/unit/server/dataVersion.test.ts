import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest'
import * as dataVersionModule from '../../../server/dataVersion.ts'
import {
  dataVersionKey,
  onDataVersionChange,
  openTransactions,
} from '../../../server/dataVersion.ts'
import { createPrisma, initSqlite, type PrismaClient } from '../../../server/db.ts'

let dir: string
let dbUrl: string
const opened: PrismaClient[] = []

/** A client on the shared test file; a second call opens a second connection to the same file. */
async function open(url = dbUrl): Promise<PrismaClient> {
  const prisma = createPrisma(url)
  await initSqlite(prisma)
  opened.push(prisma)
  return prisma
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rl-dataversion-'))
  const file = join(dir, 'test.db')
  copyFileSync(inject('templateDbPath'), file)
  dbUrl = `file:${file}`
})

afterEach(async () => {
  await Promise.all(opened.splice(0).map((prisma) => prisma.$disconnect()))
  rmSync(dir, { recursive: true, force: true })
})

async function counter(prisma: PrismaClient): Promise<number> {
  return (await dataVersionKey(prisma)).n
}

/** How much `action` moved the counter. */
async function bumps(prisma: PrismaClient, action: () => Promise<unknown>): Promise<number> {
  const before = await counter(prisma)
  await action()
  return (await counter(prisma)) - before
}

async function seedUser(prisma: PrismaClient, email = 'runner@example.com') {
  return prisma.user.create({ data: { email, passwordHash: 'x' } })
}

function activityRow(userId: string, date = '2026-01-01') {
  return { userId, date, type: 'run', durationSec: 1800 }
}

function batchRow(userId: string) {
  return {
    userId,
    source: 'csv',
    rowCount: 1,
    accepted: 1,
    skippedDuplicate: 0,
    skippedInvalid: 0,
    errors: '[]',
  }
}

describe('writes to a state model bump the counter', () => {
  test.each([
    [
      'create',
      async (p: PrismaClient, userId: string) => p.activity.create({ data: activityRow(userId) }),
    ],
    [
      'createMany',
      async (p: PrismaClient, userId: string) =>
        p.activity.createMany({ data: [activityRow(userId), activityRow(userId, '2026-01-02')] }),
    ],
    [
      'createManyAndReturn',
      async (p: PrismaClient, userId: string) =>
        p.activity.createManyAndReturn({ data: [activityRow(userId)] }),
    ],
  ])('%s', async (_name, write) => {
    const prisma = await open()
    const user = await seedUser(prisma)
    expect(await bumps(prisma, () => write(prisma, user.id))).toBe(1)
  })

  test.each([
    [
      'update',
      async (p: PrismaClient, id: string) =>
        p.activity.update({ where: { id }, data: { notes: 'easy' } }),
    ],
    [
      'updateMany',
      async (p: PrismaClient, id: string) =>
        p.activity.updateMany({ where: { id }, data: { notes: 'easy' } }),
    ],
    [
      'updateManyAndReturn',
      async (p: PrismaClient, id: string) =>
        p.activity.updateManyAndReturn({ where: { id }, data: { notes: 'easy' } }),
    ],
    [
      'upsert (update branch)',
      async (p: PrismaClient, id: string) =>
        p.activity.upsert({
          where: { id },
          create: activityRow('unused'),
          update: { notes: 'easy' },
        }),
    ],
    ['delete', async (p: PrismaClient, id: string) => p.activity.delete({ where: { id } })],
    ['deleteMany', async (p: PrismaClient, id: string) => p.activity.deleteMany({ where: { id } })],
  ])('%s', async (_name, write) => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const activity = await prisma.activity.create({ data: activityRow(user.id) })
    expect(await bumps(prisma, () => write(prisma, activity.id))).toBe(1)
  })

  test('upsert (create branch)', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const write = () =>
      prisma.activity.upsert({
        where: { id: 'missing' },
        create: activityRow(user.id),
        update: {},
      })
    expect(await bumps(prisma, write)).toBe(1)
  })

  test('a write that throws still bumps', async () => {
    const prisma = await open()
    await seedUser(prisma)
    const duplicate = () => seedUser(prisma)
    expect(await bumps(prisma, () => duplicate().catch(() => undefined))).toBe(1)
    await expect(duplicate()).rejects.toThrow()
  })

  test('a write rejected before it reaches the database still bumps', async () => {
    const prisma = await open()
    const invalid = () =>
      prisma.activity.create({ data: { userId: 'u', date: 'd' } as never }).catch(() => undefined)
    expect(await bumps(prisma, invalid)).toBe(1)
  })
})

describe('what does not bump', () => {
  test('reads', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const activity = await prisma.activity.create({ data: activityRow(user.id) })
    const reads = async () => {
      await prisma.activity.findMany()
      await prisma.activity.findFirst()
      await prisma.activity.findUnique({ where: { id: activity.id } })
      await prisma.activity.findUniqueOrThrow({ where: { id: activity.id } })
      await prisma.activity.count()
      await prisma.activity.aggregate({ _sum: { durationSec: true } })
      await prisma.activity.groupBy({ by: ['type'], _count: true })
      await prisma.$queryRawUnsafe('SELECT 1')
    }
    expect(await bumps(prisma, reads)).toBe(0)
  })

  test('writes to a non-state model', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const writes = async () => {
      const file = await prisma.importedFile.create({
        data: { userId: user.id, sha256: 'a', channel: 'upload', outcome: 'imported' },
      })
      await prisma.importedFile.update({ where: { id: file.id }, data: { outcome: 'duplicate' } })
      await prisma.importedFile.deleteMany()
      const integration = await prisma.integration.create({
        data: {
          userId: user.id,
          provider: 'strava',
          status: 'connected',
          secret: 's',
          config: '{}',
        },
      })
      // An atomic `{ set }` on a scalar is not a nested relation write.
      await prisma.integration.update({
        where: { id: integration.id },
        data: { lastError: { set: 'x' } },
      })
      await prisma.importBatch.create({ data: batchRow(user.id) })
    }
    expect(await bumps(prisma, writes)).toBe(0)
  })

  test('a non-state write that throws', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const data = { userId: user.id, sha256: 'a', channel: 'upload', outcome: 'imported' }
    await prisma.importedFile.create({ data })
    const duplicate = () => prisma.importedFile.create({ data }).catch(() => undefined)
    expect(await bumps(prisma, duplicate)).toBe(0)
  })
})

describe('nested writes', () => {
  test('a non-state parent that creates state children', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const write = () =>
      prisma.importBatch.create({
        data: { ...batchRow(user.id), activities: { create: [activityRow(user.id)] } },
      })
    expect(await bumps(prisma, write)).toBe(1)
    expect(await prisma.activity.count()).toBe(1)
  })

  test('a non-state parent that updates, upserts or deletes state children', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const batch = await prisma.importBatch.create({
      data: { ...batchRow(user.id), activities: { create: [activityRow(user.id)] } },
    })
    const touch = (data: object) => () =>
      prisma.importBatch.update({ where: { id: batch.id }, data })
    expect(
      await bumps(prisma, touch({ activities: { updateMany: { where: {}, data: { rpe: 3 } } } })),
    ).toBe(1)
    expect(await bumps(prisma, touch({ activities: { deleteMany: {} } }))).toBe(1)
    expect(
      await bumps(prisma, () =>
        prisma.importBatch.upsert({
          where: { id: batch.id },
          create: batchRow(user.id),
          update: { activities: { create: [activityRow(user.id)] } },
        }),
      ),
    ).toBe(1)
  })

  test('a non-state parent that connects existing state children', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const batch = await prisma.importBatch.create({ data: batchRow(user.id) })
    const activity = await prisma.activity.create({ data: activityRow(user.id) })
    const connect = () =>
      prisma.importBatch.update({
        where: { id: batch.id },
        data: { activities: { connect: [{ id: activity.id }] } },
      })
    expect(await bumps(prisma, connect)).toBe(1)
  })

  test('a state parent with a non-state child', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const write = () =>
      prisma.activity.create({
        data: { ...activityRow(user.id), stream: { create: { sampleSec: 1, data: '{}' } } },
      })
    expect(await bumps(prisma, write)).toBe(1)
  })
})

describe('transactions', () => {
  test('an interactive transaction counts as open while it runs and bumps once more at the end', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    expect(openTransactions(prisma)).toBe(0)

    const before = await counter(prisma)
    const result = await prisma.$transaction(async (tx) => {
      expect(openTransactions(prisma)).toBe(1)
      await tx.activity.create({ data: activityRow(user.id) })
      // The statement inside the transaction already moved the counter.
      expect(await counter(prisma)).toBe(before + 1)
      return 'done'
    })

    expect(result).toBe('done')
    expect(openTransactions(prisma)).toBe(0)
    expect(await counter(prisma)).toBe(before + 2)
  })

  test('a transaction that only reads still bumps once when it ends', async () => {
    const prisma = await open()
    await seedUser(prisma)
    expect(await bumps(prisma, () => prisma.$transaction(async (tx) => tx.activity.count()))).toBe(
      1,
    )
  })

  test('a rolled-back transaction bumps at the end and leaves nothing behind', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const before = await counter(prisma)

    await expect(
      prisma.$transaction(async (tx) => {
        await tx.activity.create({ data: activityRow(user.id) })
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')

    expect(openTransactions(prisma)).toBe(0)
    expect(await counter(prisma)).toBe(before + 2)
    expect(await prisma.activity.count()).toBe(0)
  })

  test('a transaction with a nested write through a transaction client bumps', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const write = () =>
      prisma.$transaction(async (tx) => {
        await tx.importBatch.create({
          data: { ...batchRow(user.id), activities: { create: [activityRow(user.id)] } },
        })
      })
    // One for the nested write, one for the end of the transaction.
    expect(await bumps(prisma, write)).toBe(2)
  })

  test('a batch transaction bumps for each state write and once at the end', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const write = () =>
      prisma.$transaction([
        prisma.activity.create({ data: activityRow(user.id) }),
        prisma.activity.create({ data: activityRow(user.id, '2026-01-02') }),
      ])
    const before = await counter(prisma)
    const rows = await write()
    expect(rows).toHaveLength(2)
    expect(openTransactions(prisma)).toBe(0)
    expect(await counter(prisma)).toBe(before + 3)
  })

  test('a batch transaction that fails bumps and closes', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const before = await counter(prisma)
    await expect(
      prisma.$transaction([
        prisma.activity.create({ data: activityRow(user.id) }),
        prisma.user.create({ data: { email: 'runner@example.com', passwordHash: 'x' } }),
      ]),
    ).rejects.toThrow()
    expect(openTransactions(prisma)).toBe(0)
    expect(await counter(prisma)).toBeGreaterThan(before)
    expect(await prisma.activity.count()).toBe(0)
  })

  test('transaction options pass through and concurrent transactions leave no open count', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    const run = (date: string) =>
      prisma.$transaction(
        async (tx) => {
          await tx.activity.create({ data: activityRow(user.id, date) })
          return date
        },
        { maxWait: 5000, timeout: 5000 },
      )
    const done = await Promise.all([run('2026-01-01'), run('2026-01-02')])
    expect(done).toEqual(['2026-01-01', '2026-01-02'])
    expect(openTransactions(prisma)).toBe(0)
  })

  // Spike (E3-1): do reads on the root client share the better-sqlite3 handle with an open
  // interactive transaction? They do, so a root read inside a transaction sees its uncommitted
  // rows, which is why a snapshot built while `openTransactions > 0` must not be stored. If a
  // Prisma or adapter upgrade makes this fail, revisit the rule in ADR 0009 before relaxing it.
  test('spike: a root read during an open transaction sees its uncommitted write', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    let seenInside = -1
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.activity.create({ data: activityRow(user.id) })
        seenInside = await prisma.activity.count()
        throw new Error('rolled back')
      }),
    ).rejects.toThrow('rolled back')
    expect(seenInside).toBe(1)
    expect(await prisma.activity.count()).toBe(0)
  })
})

describe('dataVersionKey', () => {
  test('returns a numeric external even though the pragma comes back as a BigInt', async () => {
    const prisma = await open()
    const raw = await prisma.$queryRawUnsafe<{ data_version: unknown }[]>('PRAGMA data_version')
    expect(typeof raw[0]?.data_version).toBe('bigint')

    const key = await dataVersionKey(prisma)
    expect(typeof key.external).toBe('number')
    expect(Number.isInteger(key.external)).toBe(true)
    expect(typeof key.n).toBe('number')
    expect(key.key).toMatch(/^[0-9a-f]{8}\.\d+\.\d+$/)
    expect(key.key.endsWith(`.${key.n}.${key.external}`)).toBe(true)
    expect(() => JSON.stringify(key)).not.toThrow()
  })

  test('stays the same while nothing is written and changes with an in-process write', async () => {
    const prisma = await open()
    const first = await dataVersionKey(prisma)
    expect(await dataVersionKey(prisma)).toEqual(first)

    await seedUser(prisma)
    const second = await dataVersionKey(prisma)
    expect(second.n).toBe(first.n + 1)
    // SQLite does not change the pragma for commits made on the same connection.
    expect(second.external).toBe(first.external)
    expect(second.key).not.toBe(first.key)
  })

  test('a write through a second client on the same file changes external, not n', async () => {
    const first = await open()
    const second = await open()
    const before = await dataVersionKey(first)

    await seedUser(second)

    const after = await dataVersionKey(first)
    expect(after.external).not.toBe(before.external)
    expect(after.n).toBe(before.n)
    expect(after.key).not.toBe(before.key)
  })

  test('two clients keep independent counters', async () => {
    const first = await open()
    const second = await open()
    const secondBefore = await counter(second)

    await seedUser(first)
    await seedUser(first, 'other@example.com')

    expect(await counter(first)).toBe(2)
    expect(await counter(second)).toBe(secondBefore)
    expect((await dataVersionKey(first)).key.split('.')[0]).toMatch(/^[0-9a-f]{8}$/)
  })

  test('rejects a client that createPrisma did not make', async () => {
    await expect(dataVersionKey({} as PrismaClient)).rejects.toThrow(/createPrisma/)
    expect(() => openTransactions({} as PrismaClient)).toThrow(/createPrisma/)
  })
})

describe('onDataVersionChange', () => {
  test('fires after each state write, with the new counter value', async () => {
    const prisma = await open()
    const seen: number[] = []
    onDataVersionChange(prisma, (n) => {
      seen.push(n)
    })

    const user = await seedUser(prisma)
    expect(seen).toEqual([1])
    expect(await counter(prisma)).toBe(1)

    await prisma.activity.create({ data: activityRow(user.id) })
    expect(seen).toEqual([1, 2])
  })

  test('does not fire for reads or non-state writes, and fires at the end of a transaction', async () => {
    const prisma = await open()
    const user = await seedUser(prisma)
    let calls = 0
    onDataVersionChange(prisma, () => {
      calls++
    })

    await prisma.activity.count()
    await prisma.importBatch.create({ data: batchRow(user.id) })
    expect(calls).toBe(0)

    await prisma.$transaction(async (tx) => tx.activity.count())
    expect(calls).toBe(1)
  })

  test('stops after unsubscribe, and a throwing listener does not fail the write', async () => {
    const prisma = await open()
    let calls = 0
    const stop = onDataVersionChange(prisma, () => {
      calls++
    })
    onDataVersionChange(prisma, () => {
      throw new Error('listener bug')
    })

    await expect(seedUser(prisma)).resolves.toMatchObject({ email: 'runner@example.com' })
    expect(calls).toBe(1)
    stop()
    await seedUser(prisma, 'other@example.com')
    expect(calls).toBe(1)
  })

  test('another client does not trigger the listener', async () => {
    const first = await open()
    const second = await open()
    let calls = 0
    onDataVersionChange(first, () => {
      calls++
    })
    await seedUser(second)
    expect(calls).toBe(0)
  })
})

describe('module surface', () => {
  test('exposes no function that bumps or invalidates the counter', () => {
    const names = Object.keys(dataVersionModule)
    expect(names.filter((name) => /bump|increment|invalidate|touch|mark/i.test(name))).toEqual([])
    expect(names).toEqual(
      expect.arrayContaining(['dataVersionKey', 'onDataVersionChange', 'STATE_MODELS']),
    )
  })
})
