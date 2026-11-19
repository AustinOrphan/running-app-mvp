import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { drainUser, runStartPass, type StartPassChunk } from '../../server/services/startPass.ts'
import {
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let user: TestUser
let other: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
  other = await seedUser(ctx, { email: 'start-pass-other@example.com' })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'test-pass' } })
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })
const chunk = (filled: number, remaining: number, unreadable: string[] = []): StartPassChunk => ({
  filled,
  unreadable,
  remaining,
})
const runsOf = (userId: string) =>
  ctx.prisma.syncRun.findMany({
    where: { userId, provider: 'test-pass' },
    orderBy: { startedAt: 'asc' },
  })

describe('drainUser', () => {
  test('calls the chunk until nothing remains and adds the counts up', async () => {
    const results = [chunk(20, 45), chunk(20, 25, ['a']), chunk(20, 5), chunk(5, 0, ['b'])]
    const fn = vi.fn(() => Promise.resolve(results.shift()!))
    expect(await drainUser(fn)).toEqual({ filled: 65, unreadable: ['a', 'b'] })
    expect(fn).toHaveBeenCalledTimes(4)
  })

  test('stops at a chunk that wrote nothing, even with rows remaining', async () => {
    const fn = vi.fn(() => Promise.resolve(chunk(0, 3)))
    expect(await drainUser(fn)).toEqual({ filled: 0, unreadable: [] })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('stops between chunks once stopped() is true, and not before the first check', async () => {
    let calls = 0
    const fn = vi.fn(() => {
      calls += 1
      return Promise.resolve(chunk(20, 100))
    })
    expect((await drainUser(fn, { stopped: () => calls >= 2 })).filled).toBe(40)
    const never = vi.fn(() => Promise.resolve(chunk(1, 1)))
    await drainUser(never, { stopped: () => true })
    expect(never).not.toHaveBeenCalled()
  })

  test('yields to the event loop between chunks', async () => {
    const order: string[] = []
    const results = [chunk(1, 2), chunk(1, 1), chunk(1, 0)]
    const drained = drainUser(() => {
      order.push('chunk')
      return Promise.resolve(results.shift()!)
    })
    setImmediate(() => order.push('immediate'))
    await drained
    expect(order).toEqual(['chunk', 'immediate', 'chunk', 'chunk'])
  })
})

describe('runStartPass', () => {
  test('records one catchup run per user that did something, a partial one for unreadable rows', async () => {
    await runStartPass(deps(), 'test-pass', (userId) => {
      const results = userId === user.id ? [chunk(3, 0, ['x'])] : [chunk(2, 0)]
      return () => Promise.resolve(results.shift()!)
    })
    expect(await runsOf(user.id)).toEqual([
      expect.objectContaining({ trigger: 'catchup', status: 'partial', accepted: 3, failed: 1 }),
    ])
    expect(await runsOf(other.id)).toEqual([
      expect.objectContaining({ trigger: 'catchup', status: 'ok', accepted: 2, failed: 0 }),
    ])
  })

  test('an idle pass stores nothing once the newest run ended ok, and ok after a partial one', async () => {
    const idle = () => Promise.resolve(chunk(0, 0))
    await runStartPass(deps(), 'test-pass', () => idle)
    // The first run ever is stored, so the log shows the pass ran.
    expect(await runsOf(user.id)).toHaveLength(1)
    await runStartPass(deps(), 'test-pass', () => idle)
    expect(await runsOf(user.id)).toHaveLength(1)

    await ctx.prisma.syncRun.deleteMany({ where: { provider: 'test-pass' } })
    await runStartPass(deps(), 'test-pass', () => () => Promise.resolve(chunk(1, 0, ['x'])))
    await runStartPass(deps(), 'test-pass', () => idle)
    const runs = await runsOf(user.id)
    expect(runs.map((run) => run.status)).toEqual(['partial', 'ok'])
  })

  test('one user throwing records an error run and the next user still runs', async () => {
    await runStartPass(deps(), 'test-pass', (userId) =>
      userId === user.id
        ? () => Promise.reject(new Error('boom'))
        : () => Promise.resolve(chunk(4, 0)),
    )
    expect(await runsOf(user.id)).toEqual([expect.objectContaining({ status: 'error' })])
    expect(await runsOf(other.id)).toEqual([expect.objectContaining({ accepted: 4 })])
  })

  test('writes exactly one info line, with counts only, when something happened', async () => {
    const info = vi.fn()
    const warn = vi.fn()
    const log = { info, warn } as never
    await runStartPass(
      deps(),
      'test-pass',
      (userId) => () =>
        userId === user.id
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(chunk(4, 0, ['r'])),
      { log },
    )
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith(
      { job: 'test-pass', users: 2, filled: 4, failed: 1, errors: 1 },
      'start pass done',
    )
  })

  test('writes no line when nothing happened', async () => {
    const info = vi.fn()
    await runStartPass(deps(), 'test-pass', () => () => Promise.resolve(chunk(0, 0)), {
      log: { info, warn: vi.fn() } as never,
    })
    expect(info).not.toHaveBeenCalled()
  })

  test('does not start the next user once stopped', async () => {
    const fn = vi.fn(() => Promise.resolve(chunk(1, 0)))
    await runStartPass(deps(), 'test-pass', () => fn, { stopped: () => true })
    expect(fn).not.toHaveBeenCalled()
  })
})
