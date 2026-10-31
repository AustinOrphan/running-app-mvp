import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { markDuplicates } from '../../server/services/duplicates.ts'
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
  await ctx.prisma.activity.deleteMany()
})

const T0 = '2026-03-02T07:00:00Z'

function at(secondsAfter: number): string {
  return new Date(Date.parse(T0) + secondsAfter * 1000).toISOString()
}

let seq = 0

async function seed(
  source: string,
  over: {
    startUtc?: string | null
    distanceM?: number | null
    date?: string
    status?: string
    type?: string
    durationSec?: number
  } = {},
) {
  seq += 1
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: over.date ?? '2026-03-02',
      type: over.type ?? 'run',
      durationSec: over.durationSec ?? 1800,
      distanceM: over.distanceM === undefined ? 5000 : over.distanceM,
      source,
      providerKey: source === 'manual' ? null : `${source}:${seq}`,
      startUtc: over.startUtc === undefined ? null : over.startUtc,
      ...(over.status ? { duplicateStatus: over.status } : {}),
    },
  })
}

async function reload(id: string) {
  return ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
}

describe('markDuplicates across sources', () => {
  test('file then strava at the same start: strava is the confirmed duplicate', async () => {
    const file = await seed('file', { startUtc: T0 })
    const strava = await seed('strava', { startUtc: at(30), distanceM: 5040 })
    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(1)
    expect(await reload(strava.id)).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: file.id,
    })
    expect(await reload(file.id)).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })
  })

  test('strava then file: the existing strava row is demoted', async () => {
    const strava = await seed('strava', { startUtc: T0 })
    const file = await seed('file', { startUtc: at(60) })
    expect(await markDuplicates(ctx.prisma, user.id, [file.id])).toBe(1)
    expect(await reload(strava.id)).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: file.id,
    })
    expect(await reload(file.id)).toMatchObject({ duplicateStatus: 'none' })
  })

  test('a richer row demotes the original and re-points its duplicates', async () => {
    const manual = await seed('manual', { distanceM: 5020 })
    const strava = await seed('strava', { startUtc: T0 })
    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(1)
    expect(await reload(manual.id)).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: strava.id,
    })

    const file = await seed('file', { startUtc: at(10) })
    expect(await markDuplicates(ctx.prisma, user.id, [file.id])).toBe(1)
    expect(await reload(strava.id)).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: file.id,
    })
    expect(await reload(manual.id)).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: file.id,
    })
  })

  test('manual against intervals is only possible', async () => {
    const intervals = await seed('intervals', { startUtc: T0 })
    const manual = await seed('manual', { distanceM: 5030 })
    await markDuplicates(ctx.prisma, user.id, [manual.id])
    expect(await reload(manual.id)).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: intervals.id,
    })
  })

  test('121 s apart is no match, even on the same day with the same distance', async () => {
    const file = await seed('file', { startUtc: T0 })
    const strava = await seed('strava', { startUtc: at(121) })
    expect(await markDuplicates(ctx.prisma, user.id, [file.id, strava.id])).toBe(0)
    expect((await reload(strava.id)).duplicateStatus).toBe('none')
  })

  test('distance 5.1% apart is no match', async () => {
    const file = await seed('file', { startUtc: T0, distanceM: 5000 })
    const strava = await seed('strava', { startUtc: T0, distanceM: 5270 })
    expect(await markDuplicates(ctx.prisma, user.id, [file.id, strava.id])).toBe(0)
    expect((await reload(strava.id)).duplicateStatus).toBe('none')
  })

  test('dismissed rows stay dismissed on re-sync of either side', async () => {
    const file = await seed('file', { startUtc: T0 })
    const strava = await seed('strava', { startUtc: T0, status: 'dismissed' })
    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(0)
    expect(await markDuplicates(ctx.prisma, user.id, [file.id])).toBe(0)
    expect(await reload(strava.id)).toMatchObject({ duplicateStatus: 'dismissed' })
    expect(await reload(file.id)).toMatchObject({ duplicateStatus: 'none' })
  })

  test('a possible flag upgrades to confirmed when the pair matches on start', async () => {
    const file = await seed('file', { startUtc: T0 })
    const strava = await seed('strava', { startUtc: T0 })
    await ctx.prisma.activity.update({
      where: { id: strava.id },
      data: { duplicateStatus: 'possible', duplicateOfId: file.id },
    })
    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(0)
    expect(await reload(strava.id)).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: file.id,
    })
  })

  test('one arrival that matches two unflagged rows demotes both', async () => {
    const strava = await seed('strava', { startUtc: T0 })
    const intervals = await seed('intervals', { startUtc: at(100) })
    const file = await seed('file', { startUtc: at(50) })
    expect(await markDuplicates(ctx.prisma, user.id, [file.id])).toBe(2)
    expect((await reload(strava.id)).duplicateOfId).toBe(file.id)
    expect((await reload(intervals.id)).duplicateOfId).toBe(file.id)
  })

  test('a start match is found when the other row has the next local date', async () => {
    const file = await seed('file', { startUtc: T0, date: '2026-03-02' })
    const strava = await seed('strava', { startUtc: at(20), date: '2026-03-03' })
    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(1)
    expect((await reload(strava.id)).duplicateOfId).toBe(file.id)
  })
})

describe('markDuplicates for strength sessions', () => {
  const session = (over: Parameters<typeof seed>[1] = {}) =>
    ({ type: 'strength', distanceM: null, durationSec: 2400, ...over }) as const

  test('a manual session and an import of the same day and length are a possible duplicate', async () => {
    const manual = await seed('manual', session())
    const file = await seed('file', session({ startUtc: T0, durationSec: 2500 }))
    expect(await markDuplicates(ctx.prisma, user.id, [file.id])).toBe(1)
    expect(await reload(manual.id)).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: file.id,
    })
    expect(await reload(file.id)).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })
  })

  test('two imports that start within two minutes are one session, confirmed', async () => {
    const file = await seed('file', session({ startUtc: T0 }))
    const strava = await seed('strava', session({ startUtc: at(90), durationSec: 3000 }))
    expect(await markDuplicates(ctx.prisma, user.id, [strava.id])).toBe(1)
    expect(await reload(strava.id)).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: file.id,
    })
  })

  test('two imports that start three minutes apart are two sessions', async () => {
    const file = await seed('file', session({ startUtc: T0 }))
    const strava = await seed('strava', session({ startUtc: at(180) }))
    expect(await markDuplicates(ctx.prisma, user.id, [file.id, strava.id])).toBe(0)
    expect((await reload(strava.id)).duplicateStatus).toBe('none')
  })

  test('a session over 5% longer or on another day is not the same session', async () => {
    const manual = await seed('manual', session())
    const longer = await seed('file', session({ durationSec: 2530 }))
    const nextDay = await seed('strava', session({ date: '2026-03-03' }))
    expect(await markDuplicates(ctx.prisma, user.id, [longer.id, nextDay.id])).toBe(0)
    expect((await reload(manual.id)).duplicateStatus).toBe('none')
  })

  test('two sessions of one source on a day, one hand-entered and one not, stay two', async () => {
    const morning = await seed('manual', session())
    const evening = await seed('manual', session())
    expect(await markDuplicates(ctx.prisma, user.id, [morning.id, evening.id])).toBe(0)
  })

  test('a run and a strength session of the same day and length never pair, in either order', async () => {
    // An import of one kind arrives with a hand-entered row of the other on the same day.
    const run = await seed('file', { startUtc: T0, durationSec: 2400 })
    const manualStrength = await seed('manual', session())
    expect(await markDuplicates(ctx.prisma, user.id, [run.id, manualStrength.id])).toBe(0)

    const strength = await seed('strava', session({ date: '2026-03-04', startUtc: at(172_800) }))
    const manualRun = await seed('manual', { date: '2026-03-04', durationSec: 2400 })
    expect(await markDuplicates(ctx.prisma, user.id, [strength.id, manualRun.id])).toBe(0)

    for (const row of [run, manualStrength, strength, manualRun]) {
      expect(await reload(row.id), row.id).toMatchObject({
        duplicateStatus: 'none',
        duplicateOfId: null,
      })
    }
  })

  test('cross-training is still compared with nothing', async () => {
    const a = await seed('file', { type: 'cross', startUtc: T0, distanceM: null })
    const b = await seed('strava', { type: 'cross', startUtc: T0, distanceM: null })
    expect(await markDuplicates(ctx.prisma, user.id, [a.id, b.id])).toBe(0)
  })
})
