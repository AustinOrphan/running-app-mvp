import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  OWNED_MODEL_NAMES,
  UNOWNED_MODELS,
  deleteUser,
  planDeleteUser,
} from '../../server/auth/deleteUser.ts'
import { HttpError } from '../../server/errors.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'
import { seedEverything } from './exportFixture.ts'

const SLOW = 30_000

const open: TestCtx[] = []

afterEach(async () => {
  await Promise.all(open.splice(0).map((ctx) => ctx.close()))
})

const SCHEMA = readFileSync(join(import.meta.dirname, '../../prisma/schema.prisma'), 'utf8')

/** Every model of the schema, and whether it has a `userId` column, read from the schema text. */
function schemaModels(): Array<{ name: string; hasUserId: boolean }> {
  return [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({
    name: m[1]!,
    hasUserId: /^\s+userId\s/m.test(m[2]!),
  }))
}

interface Delegate {
  count(args?: { where?: object }): Promise<number>
}

/** Tables without a userId column, filtered through the parent that has one. */
const VIA_PARENT: Record<string, (userId: string) => object> = {
  ActivityStream: (userId) => ({ activity: { userId } }),
  ActivityTrack: (userId) => ({ activity: { userId } }),
  ActivityFile: (userId) => ({ activity: { userId } }),
  ActivityInsight: (userId) => ({ activity: { userId } }),
  PlanWeek: (userId) => ({ plan: { userId } }),
  PlanSession: (userId) => ({ plan: { userId } }),
  PlanRevision: (userId) => ({ plan: { userId } }),
}

function delegate(ctx: TestCtx, model: string): Delegate {
  const key = model.charAt(0).toLowerCase() + model.slice(1)
  return (ctx.prisma as unknown as Record<string, Delegate>)[key]!
}

/** Three runners with a row in every table: the owner (oldest), a tester and a bystander. */
async function seed(): Promise<{
  ctx: TestCtx
  owner: TestUser
  tester: TestUser
  other: TestUser
}> {
  const ctx = await createTestCtx()
  open.push(ctx)
  const owner = await seedUser(ctx, { email: 'owner@example.com' })
  const tester = await seedUser(ctx, { email: 'tester@example.com' })
  const other = await seedUser(ctx, { email: 'other@example.com' })
  const secret = ctx.config.sessionSecret
  await seedEverything(ctx.prisma, owner.id, 'owner', secret)
  await seedEverything(ctx.prisma, tester.id, 'tester', secret)
  await seedEverything(ctx.prisma, other.id, 'other', secret)
  return { ctx, owner, tester, other }
}

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError)
    return error as HttpError
  }
  throw new Error('expected a refusal')
}

async function totals(ctx: TestCtx): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const { name } of schemaModels()) result[name] = await delegate(ctx, name).count()
  return result
}

describe('deleteUser', () => {
  test('every model of the schema is reported or listed with a reason', () => {
    const names = schemaModels().map((m) => m.name)
    const covered = [...OWNED_MODEL_NAMES, ...Object.keys(UNOWNED_MODELS)]
    expect(covered.length).toBe(new Set(covered).size)
    expect([...covered].sort()).toEqual([...names].sort())
  })

  test(
    'a dry run counts the rows of that user only and deletes nothing',
    async () => {
      const { ctx, tester } = await seed()
      const before = await totals(ctx)
      const plan = await planDeleteUser(ctx.prisma, ' Tester@Example.com ')
      expect(plan.userId).toBe(tester.id)
      const byTable = Object.fromEntries(plan.counts.map((row) => [row.table, row.count]))
      for (const { name, hasUserId } of schemaModels()) {
        if (name in UNOWNED_MODELS) continue
        expect(byTable[name], name).toBeGreaterThan(0)
        const viaParent = VIA_PARENT[name]
        if (viaParent) {
          expect(byTable[name], name).toBe(
            await delegate(ctx, name).count({ where: viaParent(tester.id) }),
          )
          expect(byTable[name], name).toBeLessThan(before[name]!)
        }
        // Where a userId column exists the count is the user's own rows, not the table total.
        if (hasUserId) {
          expect(byTable[name], name).toBe(
            await delegate(ctx, name).count({ where: { userId: tester.id } }),
          )
          expect(byTable[name], name).toBeLessThan(before[name]!)
        }
      }
      expect(await totals(ctx)).toEqual(before)
    },
    SLOW,
  )

  test(
    'deleting removes every row of that user and none of another',
    async () => {
      const { ctx, owner, tester, other } = await seed()
      const before = await totals(ctx)
      const plan = await deleteUser(ctx.prisma, 'tester@example.com')
      expect(plan.userId).toBe(tester.id)

      const after = await totals(ctx)
      const reported = Object.fromEntries(plan.counts.map((row) => [row.table, row.count]))
      for (const { name, hasUserId } of schemaModels()) {
        if (name in UNOWNED_MODELS) {
          expect(after[name], name).toBe(before[name])
          continue
        }
        // The reported count is exactly what the delete removed.
        expect(reported[name], name).toBe(before[name]! - after[name]!)
        // The three seeds are alike, so two thirds of every table remain, children included.
        expect(after[name]! * 3, name).toBe(before[name]! * 2)
        if (hasUserId) {
          expect(await delegate(ctx, name).count({ where: { userId: tester.id } }), name).toBe(0)
          for (const kept of [owner, other]) {
            expect(
              await delegate(ctx, name).count({ where: { userId: kept.id } }),
              name,
            ).toBeGreaterThan(0)
          }
        }
      }
      expect(await ctx.prisma.user.findUnique({ where: { id: tester.id } })).toBeNull()
    },
    SLOW,
  )

  test(
    'the install owner and an unknown email are refused, and nothing is deleted',
    async () => {
      const { ctx } = await seed()
      const before = await totals(ctx)
      expect((await refusal(deleteUser(ctx.prisma, 'owner@example.com'))).status).toBe(409)
      expect((await refusal(planDeleteUser(ctx.prisma, 'owner@example.com'))).status).toBe(409)
      expect((await refusal(deleteUser(ctx.prisma, 'nobody@example.com'))).status).toBe(404)
      expect(await totals(ctx)).toEqual(before)
    },
    SLOW,
  )

  test(
    'a cookie of the deleted user gets 401 afterwards',
    async () => {
      const { ctx, tester, other } = await seed()
      expect((await client(ctx, tester).get('/api/settings')).status).toBe(200)
      await deleteUser(ctx.prisma, tester.email)
      expect((await client(ctx, tester).get('/api/settings')).status).toBe(401)
      expect((await client(ctx, other).get('/api/settings')).status).toBe(200)
    },
    SLOW,
  )
})
