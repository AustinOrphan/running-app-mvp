import { afterEach, describe, expect, test } from 'vitest'
import { createUser, generateTemporaryPassword } from '../../server/auth/createUser.ts'
import { passwordSchema, verifyPassword } from '../../server/auth/password.ts'
import { HttpError } from '../../server/errors.ts'
import { client, createTestCtx, type TestCtx } from './helpers.ts'

const SLOW = 30_000

const open: TestCtx[] = []

async function ctxFor(): Promise<TestCtx> {
  const ctx = await createTestCtx()
  open.push(ctx)
  return ctx
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((ctx) => ctx.close()))
})

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError)
    return error as HttpError
  }
  throw new Error('expected a refusal')
}

describe('createUser', () => {
  test('generated passwords meet the password schema and differ every time', () => {
    const first = generateTemporaryPassword()
    expect(passwordSchema.safeParse(first).success).toBe(true)
    expect(first.length).toBeGreaterThanOrEqual(24)
    expect(generateTemporaryPassword()).not.toBe(first)
  })

  test(
    'creates the account with a hashed temporary password that signs in, and the flags set',
    async () => {
      const ctx = await ctxFor()
      const created = await createUser(ctx.prisma, {
        email: '  Friend@Example.com ',
        displayName: ' Friend ',
        units: 'km',
        timezone: 'Europe/London',
      })
      expect(created.email).toBe('friend@example.com')
      expect(passwordSchema.safeParse(created.temporaryPassword).success).toBe(true)

      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: created.id } })
      expect(row.passwordHash).not.toContain(created.temporaryPassword)
      expect(await verifyPassword(created.temporaryPassword, row.passwordHash)).toBe(true)
      expect(row.mustChangePassword).toBe(true)
      expect(row.displayName).toBe('Friend')
      // km given: the weight unit follows, and the browser decides neither
      expect([row.units, row.weightUnit]).toEqual(['km', 'kg'])
      expect([row.unitsFromBrowser, row.zoneFromBrowser]).toEqual([false, false])
      const profile = await ctx.prisma.athleteProfile.findUniqueOrThrow({
        where: { userId: created.id },
      })
      expect(profile.timezone).toBe('Europe/London')

      const login = await client(ctx)
        .post('/api/auth/login')
        .send({ email: 'friend@example.com', password: created.temporaryPassword })
      expect(login.status).toBe(200)
    },
    SLOW,
  )

  test('an explicit weight unit wins over the one that follows the units', async () => {
    const ctx = await ctxFor()
    const created = await createUser(ctx.prisma, {
      email: 'a@example.com',
      units: 'km',
      weightUnit: 'lb',
    })
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: created.id } })
    expect([row.units, row.weightUnit]).toEqual(['km', 'lb'])
  })

  test('a weight unit alone decides the distance units', async () => {
    const ctx = await ctxFor()
    const created = await createUser(ctx.prisma, { email: 'a@example.com', weightUnit: 'kg' })
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: created.id } })
    expect([row.units, row.weightUnit, row.unitsFromBrowser]).toEqual(['km', 'kg', false])
  })

  test('with no units or zone given, the browser is left to set them', async () => {
    const ctx = await ctxFor()
    const created = await createUser(ctx.prisma, { email: 'a@example.com' })
    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: created.id } })
    expect([row.unitsFromBrowser, row.zoneFromBrowser]).toEqual([true, true])
    expect(await ctx.prisma.athleteProfile.count({ where: { userId: created.id } })).toBe(0)
  })

  test('refuses an email that exists, whatever its case', async () => {
    const ctx = await ctxFor()
    await createUser(ctx.prisma, { email: 'a@example.com' })
    const error = await refusal(createUser(ctx.prisma, { email: 'A@Example.com' }))
    expect(error.status).toBe(409)
    expect(await ctx.prisma.user.count()).toBe(1)
  })

  test.each([
    ['a bad zone', { email: 'a@example.com', timezone: 'Mars/Olympus' }],
    ['bad units', { email: 'a@example.com', units: 'yd' }],
    ['a bad weight unit', { email: 'a@example.com', weightUnit: 'st' }],
    ['a bad email', { email: 'not-an-email' }],
  ])('refuses %s and creates nothing', async (_name, input) => {
    const ctx = await ctxFor()
    const error = await refusal(createUser(ctx.prisma, input as Parameters<typeof createUser>[1]))
    expect(error.status).toBe(400)
    expect(await ctx.prisma.user.count()).toBe(0)
  })
})
