// D10 step 5 (ADR 0022): a runner's day is the calendar date in the zone saved on the profile.
// Nothing is mocked: two runners are stored in zones 25 hours apart and every read below answers
// each one its own day, whatever zone the process has (the suite is also run by hand under both).
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, isoDateInZone, mondayOf } from '../../shared/dates.ts'
import type {
  BriefView,
  JobsView,
  PlanWithSessions,
  StateView,
  TodayView,
} from '../../shared/types.ts'
import { usersDueForWeeklyUpdate } from '../../server/jobs/weeklyUpdate.ts'
import { runnerDays, serverTimeZone } from '../../server/runnerDay.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import { seedHistory, seedRunner } from './wristFixtures.ts'

const EAST = 'Pacific/Kiritimati'
const WEST = 'Pacific/Pago_Pago'

// Sunday 8 March 2026, 15:00 UTC: Pacific/Kiritimati (+14) reads Monday 9 March 05:00, past the
// Monday 03:00 slot; Pacific/Pago_Pago (-11) reads Sunday 8 March 04:00. The process zone is
// neither, on a host in any zone but those two, and the cases do not depend on it.
const NOW = new Date(Date.UTC(2026, 2, 8, 15, 0))
const EARLIER = new Date(Date.UTC(2026, 2, 2, 15, 0))
const EAST_DAY = '2026-03-09'
const WEST_DAY = '2026-03-08'

vi.useFakeTimers({ toFake: ['Date'] })

let ctx: TestCtx
let counter = 0

beforeAll(async () => {
  vi.setSystemTime(NOW)
  ctx = await createTestCtx()
})

afterEach(() => {
  vi.setSystemTime(NOW)
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

async function setZone(userId: string, timezone: string): Promise<void> {
  await ctx.prisma.athleteProfile.upsert({
    where: { userId },
    create: { userId, timezone, hrMax: 190, hrMaxSource: 'measured', hrRest: 50 },
    update: { timezone },
  })
}

/** A runner with a zone, twelve weeks of history in that zone's days and an active plan. */
async function plannedRunner(zone: string, today: string): Promise<TestUser> {
  counter += 1
  const user = await seedUser(ctx, { email: `far${String(counter)}@example.com`, units: 'km' })
  await setZone(user.id, zone)
  await seedHistory(ctx, user.id, today)
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(today, 7 * 14 + 5),
      distanceM: 21_097,
      goalType: 'finish',
    },
  })
  const generated = await client(ctx, user).post('/api/plan/generate').send({ goalId: goal.id })
  expect(generated.status, JSON.stringify(generated.body)).toBe(201)
  return user
}

describe('two runners in zones 25 hours apart', () => {
  let east: TestUser
  let west: TestUser

  beforeAll(async () => {
    east = await plannedRunner(EAST, EAST_DAY)
    west = await plannedRunner(WEST, WEST_DAY)
  })

  test('Today answers each runner its own date and zone, and its own tag', async () => {
    const e = await client(ctx, east).get('/api/today')
    const w = await client(ctx, west).get('/api/today')
    expect(e.status).toBe(200)
    expect(w.status).toBe(200)
    expect([(e.body as TodayView).tz, (e.body as TodayView).date]).toEqual([EAST, EAST_DAY])
    expect([(w.body as TodayView).tz, (w.body as TodayView).date]).toEqual([WEST, WEST_DAY])
    const tag = e.headers.etag as string
    expect(w.headers.etag).not.toBe(tag)
    expect((await client(ctx, east).get('/api/today').set('If-None-Match', tag)).status).toBe(304)
  })

  test("the state picture is for the runner's own day, and its tag follows it", async () => {
    const e = await client(ctx, east).get('/api/state')
    const w = await client(ctx, west).get('/api/state')
    expect((e.body as StateView).asOf).toBe(EAST_DAY)
    expect((w.body as StateView).asOf).toBe(WEST_DAY)
    expect(w.headers.etag).not.toBe(e.headers.etag)
    const other = await client(ctx, west)
      .get('/api/state')
      .set('If-None-Match', e.headers.etag as string)
    expect(other.status).toBe(200)
  })

  test("a plan generated now starts in the runner's own week", async () => {
    const e = (await client(ctx, east).get('/api/plan')).body as PlanWithSessions
    const w = (await client(ctx, west).get('/api/plan')).body as PlanWithSessions
    expect(e.weeks[0]?.weekStart).toBe(mondayOf(EAST_DAY))
    expect(w.weeks[0]?.weekStart).toBe(mondayOf(WEST_DAY))
    expect(mondayOf(EAST_DAY)).not.toBe(mondayOf(WEST_DAY))
  })

  test("the brief is for the runner's own week", async () => {
    const e = (await client(ctx, east).get('/api/brief')).body as { brief: BriefView | null }
    const w = (await client(ctx, west).get('/api/brief')).body as { brief: BriefView | null }
    expect(e.brief?.weekStart).toBe(mondayOf(EAST_DAY))
    expect(w.brief?.weekStart).toBe(mondayOf(WEST_DAY))
  })

  test('a runner with the stored UTC, and one with no profile row, follow the server zone', async () => {
    counter += 1
    const utc = await seedUser(ctx, { email: `utc${String(counter)}@example.com` })
    await setZone(utc.id, 'UTC')
    counter += 1
    const none = await seedUser(ctx, { email: `none${String(counter)}@example.com` })
    const server = serverTimeZone()
    for (const user of [utc, none]) {
      const view = (await client(ctx, user).get('/api/today')).body as TodayView
      expect(view.tz).toBe(server)
      expect(view.date).toBe(isoDateInZone(NOW, server))
    }
  })

  test('the session user carries the runner zone and the server zone', async () => {
    const me = (await client(ctx, east).get('/api/auth/me')).body as {
      tz: string
      serverTz: string
    }
    expect(me.tz).toBe(EAST)
    expect(me.serverTz).toBe(serverTimeZone())
  })

  test('saving a zone on the profile moves the next read to the new day', async () => {
    counter += 1
    const user = await seedUser(ctx, { email: `move${String(counter)}@example.com` })
    const before = (await client(ctx, user).get('/api/today')).body as TodayView
    expect(before.tz).toBe(serverTimeZone())
    const body = { timezone: EAST }
    const put = await client(ctx, user).put('/api/profile').send(body)
    expect(put.status, JSON.stringify(put.body)).toBe(200)
    const after = await client(ctx, user).get('/api/today')
    expect((after.body as TodayView).tz).toBe(EAST)
    expect((after.body as TodayView).date).toBe(EAST_DAY)
    expect(after.headers.etag).not.toBe((await client(ctx, east).get('/api/today')).headers.etag)
  })
})

describe("the weekly update follows each runner's clock", () => {
  test('is due for the runner past Monday 03:00 and not for the one still on Sunday', async () => {
    vi.setSystemTime(EARLIER)
    counter += 1
    const e = await seedRunner(ctx, `jobe${String(counter)}@example.com`, '2026-03-02')
    counter += 1
    const w = await seedRunner(ctx, `jobw${String(counter)}@example.com`, '2026-03-02')
    await setZone(e.u.id, EAST)
    await setZone(w.u.id, WEST)
    vi.setSystemTime(NOW)

    const due = async (user: TestUser) =>
      ((await client(ctx, user).get('/api/jobs')).body as JobsView).weeklyUpdate.due
    expect(await due(e.u)).toBe(true)
    expect(await due(w.u)).toBe(false)

    // The job reads the stored zones itself, with no day handed in.
    const owed = await usersDueForWeeklyUpdate(ctx.prisma, NOW)
    expect(owed).toContain(e.u.id)
    expect(owed).not.toContain(w.u.id)

    const days = await runnerDays(ctx.prisma, NOW, [e.u.id, w.u.id])
    expect(days.get(e.u.id)?.today).toBe(EAST_DAY)
    expect(days.get(w.u.id)?.today).toBe(WEST_DAY)
  })
})
