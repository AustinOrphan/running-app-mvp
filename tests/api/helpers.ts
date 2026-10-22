import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '../../server/db.ts'
import bcrypt from 'bcryptjs'
import type { Express } from 'express'
import request from 'supertest'
import type { Test } from 'supertest'
import { inject } from 'vitest'
import type { Units } from '../../shared/types.ts'
import { createApp } from '../../server/app.ts'
import { signSession } from '../../server/auth/session.ts'
import type { Config } from '../../server/config.ts'
import { createPrisma, initSqlite } from '../../server/db.ts'

export interface TestCtx {
  app: Express
  prisma: PrismaClient
  config: Config
  close(): Promise<void>
}

export interface TestUser {
  id: string
  email: string
  cookie: string
}

/** An app wired to its own SQLite file, copied from the migrated template. */
export async function createTestCtx(overrides: Partial<Config> = {}): Promise<TestCtx> {
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
  const app = createApp({ prisma, config })

  return {
    app,
    prisma,
    config,
    async close() {
      await prisma.$disconnect()
      rmSync(dir, { recursive: true, force: true })
    },
  }
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
