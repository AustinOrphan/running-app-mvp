// Critical speed from the stretches of training runs (rule A6): the snapshot reads the stored 10 s
// streams of the runs in the window, so a runner with long runs and no race still gets a fit, which
// says it comes from training. Nothing is stored for it.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { loadMyPaces } from '../../server/services/myPaces.ts'
import { loadAthleteContext } from '../../server/services/athleteState.ts'
import { addDays } from '../../shared/dates.ts'
import { createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

const TODAY = '2026-11-08'

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

const deps = () => ({ prisma: ctx.prisma })

/** A flat 10 s stream of `blocks` ([seconds, m/s]) in order. */
function streamOf(blocks: Array<[number, number]>) {
  const t: number[] = []
  const d: number[] = []
  let dist = 0
  let sec = 0
  for (const [seconds, speed] of blocks) {
    for (let i = 0; i < seconds / 10; i++) {
      t.push(sec)
      d.push(dist)
      sec += 10
      dist += speed * 10
    }
  }
  t.push(sec)
  d.push(dist)
  return { t, d, hr: null, alt: t.map(() => 0), cad: null, pwr: null }
}

/**
 * A long run that holds three fast stretches of different lengths, so the fit has efforts in three
 * bands: 2 min at 4.5 m/s, 6 min at 4.0 m/s and 20 min at 3.5 m/s, with easy running between.
 */
const LONG_RUN = [
  [1200, 2.8],
  [120, 4.5],
  [600, 2.8],
  [360, 4],
  [600, 2.8],
  [1200, 3.5],
  [1200, 2.8],
] as Array<[number, number]>

async function seedLongRun(daysAgo: number, withStream = true, type = 'run') {
  const stream = streamOf(LONG_RUN)
  const activity = await ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: addDays(TODAY, -daysAgo),
      type,
      durationSec: stream.t[stream.t.length - 1]!,
      movingSec: stream.t[stream.t.length - 1]!,
      distanceM: Math.round(stream.d[stream.d.length - 1]!),
      gapDistanceM: Math.round(stream.d[stream.d.length - 1]!),
      elevationGainM: 10,
    },
  })
  if (withStream) {
    await ctx.prisma.activityStream.create({
      data: { activityId: activity.id, sampleSec: 10, data: JSON.stringify(stream) },
    })
  }
  return activity
}

describe('critical speed from training', () => {
  test('a long run with a stream gives a fit that says it is from training, with no race', async () => {
    await seedLongRun(10)
    const { state } = await loadAthleteContext(deps(), { userId: user.id, today: TODAY })
    expect(state.fitness.races).toEqual([])
    expect(state.fitness.csMps).toBeGreaterThan(2.5)
    expect(state.fitness.csMps).toBeLessThan(4)
    expect(state.fitness.csEfforts).toBeGreaterThanOrEqual(3)
    expect(state.fitness.csTrainingSince).toBe(addDays(TODAY, -89))
  })

  test('My paces gives the events a range with the training basis, and offers the test', async () => {
    await seedLongRun(10)
    const view = await loadMyPaces(deps(), { userId: user.id, today: TODAY })
    expect(view.test).toMatchObject({ done: true, fromTraining: true })
    const marathon = view.events.find((row) => row.key === 'marathon')
    expect(marathon?.time).not.toBeNull()
    expect(marathon?.basis.cs?.since).toBe(addDays(TODAY, -89))
    expect(marathon!.time!.highSec).toBeGreaterThan(marathon!.time!.lowSec)
  })

  test('the same run without a stream, or outside the window, gives no fit', async () => {
    await seedLongRun(10, false)
    await seedLongRun(120)
    const { state } = await loadAthleteContext(deps(), { userId: user.id, today: TODAY })
    expect(state.fitness).toMatchObject({ csMps: null, csEfforts: 0 })
    expect(state.fitness.csTrainingSince ?? null).toBeNull()
  })
})
