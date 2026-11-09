// Today's `heat.heatDays` (rule I8, task HT1): whether the page says what counts as a heat day.
// A yes only when the race is expected warm (the cached race-day climate), the block's window is
// open and fewer than `i8.blockDays` heat days are counted since it opened.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { heatBlockWindow } from '../../shared/engine/heat.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { TodayView } from '../../shared/types.ts'
import { climateKeyFor } from '../../server/services/weatherCache.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

let ctx: TestCtx
let users = 0

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(async () => {
  expectNoRefusedFetches(ctx)
  await ctx.prisma.climateCache.deleteMany()
})

afterAll(async () => {
  await ctx.close()
})

const today = todayIso()

function newUser(): Promise<TestUser> {
  users += 1
  return seedUser(ctx, { email: `heatdays${String(users)}@example.com` })
}

/** A marathon `daysAhead` days out whose cached race-day climate is `wbgtC`. */
async function newGoal(user: TestUser, daysAhead: number, wbgtC: number | null) {
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic marathon',
      priority: 'A',
      isActive: true,
      targetDate: addDays(today, daysAhead),
      distanceM: 42_195,
      gainM: 100,
      lossM: 100,
      surface: 'road',
      goalType: 'finish',
      startTime: '08:00',
      raceLat: 40.01,
      raceLng: -105.27,
    },
  })
  if (wbgtC !== null) {
    const key = climateKeyFor(goal, { lat: null, lng: null, use: false })
    if (key === null) throw new Error('the goal has no place')
    await ctx.prisma.climateCache.create({
      data: { ...key, wbgtC, samples: 10, yearsRead: 3, complete: true },
    })
  }
  return goal
}

/** A run the runner marked, as the rating write leaves it. */
async function markedRun(user: TestUser, date: string, heatExposure: string | null) {
  await ctx.prisma.activity.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      date,
      type: 'run',
      durationSec: 2400,
      distanceM: 6000,
      rpe: 3,
      tempC: 12,
      heatExposure,
    },
  })
}

async function heatOf(user: TestUser): Promise<TodayView['heat']> {
  const res = await client(ctx, user).get('/api/today')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return (res.body as TodayView).heat
}

describe('GET /api/today: heat.heatDays', () => {
  const warm = P.i8.triggerWbgtC.value + 4

  test('is a yes for a warm race inside the block window with few heat days', async () => {
    const user = await newUser()
    await newGoal(user, 8, warm)
    expect((await heatOf(user)).heatDays).toBe(true)
  })

  test('is a no without a goal, for a cool race, with no cached climate, or outside the window', async () => {
    const none = await newUser()
    expect((await heatOf(none)).heatDays).toBe(false)

    const cool = await newUser()
    await newGoal(cool, 8, P.i8.triggerWbgtC.value - 3)
    expect((await heatOf(cool)).heatDays).toBe(false)

    const unknown = await newUser()
    await newGoal(unknown, 8, null)
    expect((await heatOf(unknown)).heatDays).toBe(false)

    const far = await newUser()
    await newGoal(far, 120, warm)
    expect((await heatOf(far)).heatDays).toBe(false)

    const raceDay = await newUser()
    await newGoal(raceDay, 0, warm)
    expect((await heatOf(raceDay)).heatDays).toBe(false)
  })

  test('counts marked runs toward the block and stops when it has the days it asks', async () => {
    const user = await newUser()
    // A race three days out: the window opened at least eleven days ago.
    const goal = await newGoal(user, 3, warm)
    const from = heatBlockWindow(goal.targetDate).from
    const need = P.i8.blockDays.value
    const days = Array.from({ length: need }, (_, i) => addDays(from, i))
    expect(days.every((d) => d <= today)).toBe(true)
    for (const date of days.slice(0, need - 1)) await markedRun(user, date, 'passive')
    expect((await heatOf(user)).heatDays).toBe(true)
    // a second run on a counted day is the same day
    await markedRun(user, days[0]!, 'warm-room')
    expect((await heatOf(user)).heatDays).toBe(true)
    // the last day of the block ends the suggestion
    await markedRun(user, days[need - 1]!, 'warm-room')
    expect((await heatOf(user)).heatDays).toBe(false)
  })

  test('says nothing during an open disruption window, and again once it is over', async () => {
    const user = await newUser()
    await newGoal(user, 8, warm)
    expect((await heatOf(user)).heatDays).toBe(true)
    const window = await ctx.prisma.disruption.create({
      data: {
        userId: user.id,
        reason: 'illness-below-neck',
        mode: 'rest',
        startDate: addDays(today, -1),
        endDate: addDays(today, 2),
      },
    })
    expect((await heatOf(user)).heatDays).toBe(false)
    await ctx.prisma.disruption.update({ where: { id: window.id }, data: { status: 'undone' } })
    expect((await heatOf(user)).heatDays).toBe(true)
  })

  test('an unmarked run in mild weather is no heat day', async () => {
    const user = await newUser()
    const goal = await newGoal(user, 3, warm)
    const from = heatBlockWindow(goal.targetDate).from
    for (let i = 0; i < P.i8.blockDays.value; i += 1) await markedRun(user, addDays(from, i), null)
    expect((await heatOf(user)).heatDays).toBe(true)
  })
})
