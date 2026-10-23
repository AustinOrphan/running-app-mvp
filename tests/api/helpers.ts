import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '../../server/db.ts'
import bcrypt from 'bcryptjs'
import type { Express } from 'express'
import request from 'supertest'
import type { Test } from 'supertest'
import { inject } from 'vitest'
import type { ActivityListItem, ActivityListPage, Units } from '../../shared/types.ts'
import { createApp, type Deps } from '../../server/app.ts'
import { signSession } from '../../server/auth/session.ts'
import type { Config } from '../../server/config.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'
import { settleWeatherCache } from '../../server/services/weatherCache.ts'

/**
 * The app's deps plus the express app. `fetch` is the injected network client that the routes and
 * the services read at each call: it starts as `noNetwork()`, so a call no test planned fails
 * loudly instead of reaching the network; a test sets `ctx.fetch = fakeFetch({...})`.
 */
export interface TestCtx extends Deps {
  app: Express
  prisma: PrismaClient
  config: Config
  close(): Promise<void>
}

/** A `fetch` that rejects every call and names the URL, so a test never reaches the network. */
export function noNetwork(): typeof fetch {
  return (input) => {
    const url = input instanceof Request ? input.url : String(input)
    return Promise.reject(new Error(`A test reached the network (${url}); set ctx.fetch.`))
  }
}

export interface TestUser {
  id: string
  email: string
  cookie: string
}

/** An app wired to its own SQLite file, copied from the migrated template. */
export async function createTestCtx(
  overrides: Partial<Config> = {},
  appOpts: { globalLimit?: number } = {},
): Promise<TestCtx> {
  const dir = mkdtempSync(join(tmpdir(), 'rl-api-'))
  const dbPath = join(dir, 'test.db')
  copyFileSync(inject('templateDbPath'), dbPath)

  const config: Config = {
    databaseUrl: `file:${dbPath}`,
    sessionSecret: 'test-only-session-secret-0123456789abcdef',
    port: 0,
    nodeEnv: 'test',
    allowRegistration: false,
    logLevel: 'silent',
    ...overrides,
  }
  const prisma = createPrisma(config.databaseUrl)
  await initSqlite(prisma)
  // The app keeps this object, so a later `ctx.fetch = ...` reaches the routes too.
  const deps: Deps = { prisma, config, fetch: noNetwork() }
  const app = createApp(deps, appOpts)

  return Object.assign(deps, {
    app,
    async close() {
      await settleWeatherCache()
      await prisma.$disconnect()
      rmSync(dir, { recursive: true, force: true })
    },
  })
}

/** Inserts a user directly (bcrypt cost 4 keeps tests fast) and returns a ready session cookie. */
export async function seedUser(
  ctx: TestCtx,
  opts: { email?: string; units?: Units; password?: string } = {},
): Promise<TestUser> {
  const email = opts.email ?? 'runner@example.com'
  const passwordHash = await bcrypt.hash(opts.password ?? 'correct horse battery staple', 4)
  const user = await ctx.prisma.user.create({
    data: { email, passwordHash, units: opts.units ?? 'mi' },
  })
  return {
    id: user.id,
    email,
    cookie: `rl_session=${signSession(user.id, ctx.config.sessionSecret)}`,
  }
}

/** Same-origin supertest calls with the session cookie preset. */
export function client(ctx: TestCtx, user?: TestUser) {
  function prepare(test: Test): Test {
    test.set('Host', 'app.test').set('Origin', 'http://app.test')
    if (user) test.set('Cookie', user.cookie)
    return test
  }
  const agent = request(ctx.app)
  return {
    get: (url: string) => prepare(agent.get(url)),
    post: (url: string) => prepare(agent.post(url)),
    put: (url: string) => prepare(agent.put(url)),
    delete: (url: string) => prepare(agent.delete(url)),
  }
}

/**
 * The rows `GET /api/activities` answers with, newest first. `query` is the query string without
 * the `?`; it names filters and, if needed, one page (`limit`, `offset`). The envelope (`total`,
 * `nextOffset`) is for tests that read the response themselves.
 */
export async function listActivities(
  ctx: TestCtx,
  user: TestUser,
  query = '',
): Promise<ActivityListItem[]> {
  const res = await client(ctx, user).get(`/api/activities${query === '' ? '' : `?${query}`}`)
  if (res.status !== 200) {
    throw new Error(`GET /api/activities?${query} answered ${String(res.status)}`)
  }
  return (res.body as ActivityListPage).items
}
