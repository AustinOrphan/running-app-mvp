import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { runStrengthPairJob } from '../../server/jobs/scheduler.ts'
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
  await ctx.prisma.syncRun.deleteMany({ where: { provider: 'strength-pair' } })
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

const runs = () =>
  ctx.prisma.syncRun.findMany({
    where: { userId: user.id, channel: 'job', provider: 'strength-pair' },
    orderBy: { startedAt: 'asc' },
  })

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

describe('runStrengthPairJob', () => {
  test('a flagging tick records one strength-pair run with accepted 1', async () => {
    const { logged, device } = await seedUnpaired()
    await runStrengthPairJob(deps())
    const [run, ...rest] = await runs()
    expect(rest).toEqual([])
    expect(run).toMatchObject({ status: 'ok', trigger: 'schedule', accepted: 1, failed: 0 })
    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id: logged.id } })).toMatchObject(
      { duplicateStatus: 'possible', duplicateOfId: device.id },
    )
  })

  test('an idle tick stores the first idle run when none exists, then nothing', async () => {
    await runStrengthPairJob(deps())
    const [first, ...rest] = await runs()
    expect(rest).toEqual([])
    expect(first).toMatchObject({ status: 'ok', accepted: 0 })
    await runStrengthPairJob(deps())
    expect(await runs()).toHaveLength(1)
  })

  test('a second tick after a flagging one is idle and stores nothing', async () => {
    await seedUnpaired()
    await runStrengthPairJob(deps())
    await runStrengthPairJob(deps())
    expect(await runs()).toHaveLength(1)
  })

  test('a failure is recorded as an error run and the job returns', async () => {
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
    await runStrengthPairJob({ prisma: broken, config: ctx.config })
    const [run] = await runs()
    expect(run).toMatchObject({ status: 'error' })
  })
})
