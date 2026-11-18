import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { resetToTemporaryPassword } from '../../server/auth/createUser.ts'
import { verifyPassword } from '../../server/auth/password.ts'
import { client, createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

// PW1: the server gate for an account on a temporary password, and `reset-password`.

const CURRENT = 'correct horse battery staple'
const NEXT = 'a brand new passphrase'
const SLOW = 30_000
const ROOT = resolve(import.meta.dirname, '../..')
const TSX = resolve(ROOT, 'node_modules/tsx/dist/cli.mjs')

const open: TestCtx[] = []

async function ctxFor(): Promise<TestCtx> {
  const ctx = await createTestCtx()
  open.push(ctx)
  return ctx
}

afterEach(async () => {
  for (const ctx of open) expectNoRefusedFetches(ctx)
  await Promise.all(open.splice(0).map((ctx) => ctx.close()))
})

function codeOf(response: { body: unknown }): unknown {
  return (response.body as { error?: { code?: unknown } }).error?.code
}

function cookieOf(response: { headers: Record<string, unknown> }): string {
  const header = response.headers['set-cookie'] as string[] | undefined
  const pair = header?.[0]?.split(';')[0]
  if (!pair) throw new Error('no session cookie was set')
  return pair
}

async function seedTemporary(ctx: TestCtx) {
  const user = await seedUser(ctx)
  await ctx.prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: true } })
  return user
}

describe('the change-password gate', () => {
  test(
    'refuses every route below requireAuth with a 403 and its own code',
    async () => {
      const ctx = await ctxFor()
      const user = await seedTemporary(ctx)
      const c = client(ctx, user)
      const date = '2026-03-18'

      const refused = [
        await c.get('/api/today'),
        await c.get('/api/settings'),
        await c.get('/api/research/params'),
        await c.get('/api/race/plan'),
        await c.get('/api/plan'),
        await c.put(`/api/checkins/${date}`).send({ sleepHours: 7 }),
        await c.post('/api/settings/browser-defaults').send({}),
        await c.get('/api/export?token=x'),
      ]
      for (const response of refused) {
        expect(response.status).toBe(403)
        expect(codeOf(response)).toBe('auth.password-change-required')
      }
    },
    SLOW,
  )

  test(
    'leaves the change-password flow and the error report open',
    async () => {
      const ctx = await ctxFor()
      const user = await seedTemporary(ctx)
      const c = client(ctx, user)

      const me = await c.get('/api/auth/me')
      expect(me.status).toBe(200)
      expect((me.body as { mustChangePassword: boolean }).mustChangePassword).toBe(true)
      expect((await c.get('/api/setup')).status).toBe(200)
      expect((await c.post('/api/auth/logout')).status).toBe(204)
      // The error report is not the gate's to refuse; its own checks answer.
      expect(codeOf(await c.post('/api/client-errors').send({}))).not.toBe(
        'auth.password-change-required',
      )
    },
    SLOW,
  )

  test(
    'the error-report exemption is exact: a longer path is gated',
    async () => {
      const ctx = await ctxFor()
      const user = await seedTemporary(ctx)
      const response = await client(ctx, user).post('/api/client-errors-x').send({})
      expect(response.status).toBe(403)
      expect(codeOf(response)).toBe('auth.password-change-required')
    },
    SLOW,
  )

  test(
    'an anonymous request is still a 401, not a 403',
    async () => {
      const ctx = await ctxFor()
      await seedTemporary(ctx)
      expect((await client(ctx).get('/api/today')).status).toBe(401)
    },
    SLOW,
  )

  test(
    'lifts once the password is changed, and the old cookie ends',
    async () => {
      const ctx = await ctxFor()
      const user = await seedTemporary(ctx)
      const change = await client(ctx, user)
        .put('/api/auth/password')
        .send({ currentPassword: CURRENT, newPassword: NEXT })
      expect(change.status).toBe(200)

      expect((await client(ctx, user).get('/api/settings')).status).toBe(401)
      const fresh = { ...user, cookie: cookieOf(change) }
      expect((await client(ctx, fresh).get('/api/settings')).status).toBe(200)
      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(row.mustChangePassword).toBe(false)
    },
    SLOW,
  )
})

describe('resetToTemporaryPassword', () => {
  test(
    'sets the flags, ends open sessions and the temporary password signs in',
    async () => {
      const ctx = await ctxFor()
      const user = await seedUser(ctx)
      const before = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      expect((await client(ctx, user).get('/api/settings')).status).toBe(200)

      const temporary = await resetToTemporaryPassword(ctx.prisma, 'Runner@Example.com')
      expect(temporary).not.toBeNull()
      const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
      expect(row.mustChangePassword).toBe(true)
      expect(row.sessionVersion).toBe(before.sessionVersion + 1)
      expect(await verifyPassword(temporary as string, row.passwordHash)).toBe(true)
      expect(await verifyPassword(CURRENT, row.passwordHash)).toBe(false)

      expect((await client(ctx, user).get('/api/auth/me')).status).toBe(401)
      const login = await client(ctx)
        .post('/api/auth/login')
        .send({ email: user.email, password: temporary })
      expect(login.status).toBe(200)
      const fresh = { ...user, cookie: cookieOf(login) }
      expect((await client(ctx, fresh).get('/api/settings')).status).toBe(403)
      expect((await client(ctx, fresh).get('/api/auth/me')).status).toBe(200)
    },
    SLOW,
  )

  test(
    'answers null for an unknown email',
    async () => {
      const ctx = await ctxFor()
      expect(await resetToTemporaryPassword(ctx.prisma, 'nobody@example.com')).toBeNull()
    },
    SLOW,
  )
})

describe('scripts/reset-password.ts', () => {
  function run(ctx: TestCtx, email: string | undefined) {
    return spawnSync(
      process.execPath,
      [TSX, resolve(ROOT, 'scripts/reset-password.ts'), ...(email ? [email] : [])],
      {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 60_000,
        env: {
          ...process.env,
          DATABASE_URL: ctx.config.databaseUrl,
          SESSION_SECRET: ctx.config.sessionSecret,
        },
      },
    )
  }

  test('prints the temporary password once on stdout and stores only its hash', async () => {
    const ctx = await ctxFor()
    const user = await seedUser(ctx)

    const result = run(ctx, user.email)
    expect(result.status).toBe(0)
    const lines = result.stdout.split('\n').filter((line) => line !== '')
    expect(lines).toHaveLength(1)
    const printed = lines[0] as string
    // The words go to stderr and do not repeat the password.
    expect(result.stderr).not.toContain(printed)

    const row = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(row.mustChangePassword).toBe(true)
    expect(row.sessionVersion).toBe(1)
    expect(row.passwordHash).not.toContain(printed)
    expect(await verifyPassword(printed, row.passwordHash)).toBe(true)
  }, 90_000)

  test('an unknown email prints no password and exits 1; no email prints the usage', async () => {
    const ctx = await ctxFor()
    const unknown = run(ctx, 'nobody@example.com')
    expect(unknown.status).toBe(1)
    expect(unknown.stdout).toBe('')
    expect(unknown.stderr).toContain('No account found')
    const none = run(ctx, undefined)
    expect(none.status).toBe(1)
    expect(none.stderr).toContain('Usage: npm run reset-password')
  }, 90_000)
})
