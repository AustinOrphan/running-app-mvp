import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { pairLoggedStrengthAtStart } from '../../server/services/duplicates.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

let ctx: TestCtx
let user: TestUser

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.strengthLog.deleteMany()
  await ctx.prisma.activity.deleteMany()
  await ctx.prisma.syncRun.deleteMany()
})

const makeLog = () => ({ info: vi.fn(), warn: vi.fn() })

/** An app log (manual, no start, holds a log) and a watch export of the same day, 13% apart. */
async function seedUnpaired() {
  const logged = await ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: '2026-03-02',
      type: 'strength',
      durationSec: 2400,
      source: 'manual',
    },
  })
  await ctx.prisma.strengthLog.create({
    data: {
      id: '00000000-0000-4000-8000-000000000501',
      userId: user.id,
      activityId: logged.id,
      prescribed: '{}',
    },
  })
  const device = await ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: '2026-03-02',
      type: 'strength',
      durationSec: 2754,
      source: 'intervals',
      providerKey: 'intervals:501',
      startUtc: '2026-03-02T07:00:00Z',
    },
  })
  return { logged, device }
}

describe('pairLoggedStrengthAtStart', () => {
  test('flags an old unpaired log once, logs the count only and records no run', async () => {
    const { logged, device } = await seedUnpaired()
    const log = makeLog()
    expect(await pairLoggedStrengthAtStart(ctx.prisma, log)).toBe(1)
    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id: logged.id } })).toMatchObject(
      { duplicateStatus: 'possible', duplicateOfId: device.id },
    )
    expect(log.info).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith({ flagged: 1 }, expect.any(String))
    expect(log.warn).not.toHaveBeenCalled()
    expect(await ctx.prisma.syncRun.count()).toBe(0)
  })

  test('a second start pass does nothing and says nothing', async () => {
    await seedUnpaired()
    await pairLoggedStrengthAtStart(ctx.prisma, makeLog())
    const log = makeLog()
    expect(await pairLoggedStrengthAtStart(ctx.prisma, log)).toBe(0)
    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
    expect(await ctx.prisma.syncRun.count()).toBe(0)
  })

  test('never touches a possible, confirmed or dismissed row', async () => {
    const { logged } = await seedUnpaired()
    for (const status of ['possible', 'confirmed', 'dismissed']) {
      await ctx.prisma.activity.update({
        where: { id: logged.id },
        data: { duplicateStatus: status, duplicateOfId: null },
      })
      const log = makeLog()
      expect(await pairLoggedStrengthAtStart(ctx.prisma, log), status).toBe(0)
      expect(log.info).not.toHaveBeenCalled()
      expect(
        await ctx.prisma.activity.findUniqueOrThrow({ where: { id: logged.id } }),
      ).toMatchObject({ duplicateStatus: status, duplicateOfId: null })
    }
  })

  test('one user failing does not skip the next user', async () => {
    const first = await seedUnpaired()
    const other = await seedUser(ctx, { email: 'second@example.com' })
    const logged = await ctx.prisma.activity.create({
      data: {
        userId: other.id,
        date: '2026-03-02',
        type: 'strength',
        durationSec: 2400,
        source: 'manual',
      },
    })
    await ctx.prisma.strengthLog.create({
      data: {
        id: '00000000-0000-4000-8000-000000000502',
        userId: other.id,
        activityId: logged.id,
        prescribed: '{}',
      },
    })
    const device = await ctx.prisma.activity.create({
      data: {
        userId: other.id,
        date: '2026-03-02',
        type: 'strength',
        durationSec: 2754,
        source: 'intervals',
        providerKey: 'intervals:502',
        startUtc: '2026-03-02T07:00:00Z',
      },
    })
    const failing = new Proxy(ctx.prisma, {
      get(target, prop, receiver) {
        if (prop === 'activity') {
          const real = target.activity
          return new Proxy(real, {
            get(t, p, r) {
              if (p === 'findMany') {
                return (args: { where?: { userId?: string } }) => {
                  if (args.where?.userId === user.id) throw new Error('boom')
                  return (real.findMany as (a: unknown) => unknown)(args)
                }
              }
              return Reflect.get(t, p, r) as unknown
            },
          })
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    const log = makeLog()
    expect(await pairLoggedStrengthAtStart(failing, log)).toBe(1)
    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: user.id }),
      expect.any(String),
    )
    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id: logged.id } })).toMatchObject(
      { duplicateStatus: 'possible', duplicateOfId: device.id },
    )
    expect(
      await ctx.prisma.activity.findUniqueOrThrow({ where: { id: first.logged.id } }),
    ).toMatchObject({ duplicateStatus: 'none' })
  })

  test('a throwing pass logs a warning and does not throw', async () => {
    const broken = new Proxy(ctx.prisma, {
      get(target, prop, receiver) {
        if (prop === 'activity') {
          return {
            findMany: () => {
              throw new Error('boom')
            },
          }
        }
        return Reflect.get(target, prop, receiver) as unknown
      },
    })
    const log = makeLog()
    await expect(pairLoggedStrengthAtStart(broken, log)).resolves.toBe(0)
    expect(log.warn).toHaveBeenCalledTimes(await ctx.prisma.user.count())
    expect(log.info).not.toHaveBeenCalled()
  })
})
