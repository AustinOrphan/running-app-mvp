import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { workoutExternalId } from '../../shared/domain/sessionIdentity.ts'
import { userTagOf } from '../../server/crypto.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import {
  DELIVERY_VERSION,
  contentHash,
  contentHashes,
  isPublishDue,
  isPublishing,
  publishChangeKey,
  publishForUser,
  type PublishOptions,
} from '../../server/services/publish.ts'
import { settleBackground } from '../../server/services/sync.ts'
import { forecastCellOf, settleWeatherCache } from '../../server/services/weatherCache.ts'
import type {
  DisruptionResult,
  PlanWithSessions,
  SessionWorkoutView,
  TodayView,
} from '../../shared/types.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'
import {
  API_KEY,
  connectIntervals,
  enablePublishing,
  fakeIntervals,
  place,
  seedHistory,
  seedRunner,
  type FakeIntervals,
} from './wristFixtures.ts'

// The publisher (design 6.8, task E1-5) against a stateful stand-in for intervals.icu. Plans are
// hand-made so each test controls exactly what is planned; only Date is faked.
const NOW = new Date(2026, 9, 21, 12) // a Wednesday at noon
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOW)

const today = todayIso()
const tomorrow = addDays(today, 1)
const MIN = 60_000

let ctx: TestCtx
let fake: FakeIntervals

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  vi.setSystemTime(NOW)
  fake = fakeIntervals()
  await ctx.prisma.user.deleteMany()
})

afterEach(async () => {
  await settleBackground()
  await settleWeatherCache()
  await ctx.prisma.forecastCache.deleteMany()
  expectNoRefusedFetches(ctx)
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** A connected runner with publishing on and an empty plan. */
async function runner(email: string, garminLinked = false) {
  const seeded = await seedRunner(ctx, email, today)
  await connectIntervals(ctx, seeded.u.id)
  await enablePublishing(ctx, seeded.u.id, garminLinked)
  return seeded
}

function publish(u: TestUser, over: Partial<PublishOptions> = {}) {
  return publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'schedule', ...over })
}

const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MIN)

const rowsOf = (u: TestUser) =>
  ctx.prisma.wristPublication.findMany({
    where: { userId: u.id },
    orderBy: [{ date: 'asc' }, { externalId: 'asc' }],
  })

const runsOf = (u: TestUser) =>
  ctx.prisma.syncRun.findMany({
    where: { userId: u.id, channel: 'publish' },
    orderBy: { startedAt: 'asc' },
  })

/** The calls that changed something on intervals.icu, as "METHOD path". */
const writes = (): string[] =>
  fake.calls
    .filter((call) => call.method !== 'GET')
    .map((call) => `${call.method} ${call.path.split('?')[0]}`)

/**
 * A refresh of the home forecast, as the weather job writes it: `ForecastCache` is not state, so
 * the row is written directly and nothing else changes.
 */
async function fillForecast(userId: string): Promise<void> {
  const profile = await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId } })
  const cell = forecastCellOf(profile.homeLat!, profile.homeLng!)
  await ctx.prisma.forecastCache.upsert({
    where: { latE1_lngE1: cell },
    create: { ...cell, hours: '[]', fetchedAt: new Date() },
    update: { fetchedAt: new Date() },
  })
}

const dayOf = (event: { start_date_local: string }): string => event.start_date_local.slice(0, 10)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

// ---------------------------------------------------------------------------------------------
// The eight steps
// ---------------------------------------------------------------------------------------------

describe('publishForUser', () => {
  test('publishes today to +13 and nothing before or after', async () => {
    const { u, planId } = await runner('horizon@example.com')
    await place(ctx, planId, [
      { date: addDays(today, -1), kind: 'easy' },
      { date: today, kind: 'easy' },
      { date: addDays(today, 13), kind: 'long', minutes: 90 },
      { date: addDays(today, 14), kind: 'easy' },
    ])

    const result = await publish(u)

    expect(result).toEqual({
      ran: true,
      status: 'ok',
      sent: 2,
      unchanged: 0,
      withdrawn: 0,
      failed: 0,
    })
    expect(fake.byDate().map(dayOf)).toEqual([today, addDays(today, 13)])
    expect(fake.made('POST', 'events/bulk')).toHaveLength(1)
    expect((await rowsOf(u)).map((row) => [row.date, row.state])).toEqual([
      [today, 'sent'],
      [addDays(today, 13), 'sent'],
    ])
  })

  test('writes nothing when the content is unchanged, and stores no row for an idle tick', async () => {
    const { u, planId } = await runner('unchanged@example.com')
    await place(ctx, planId, [
      { date: tomorrow, kind: 'easy' },
      { date: addDays(today, 2), kind: 'long', minutes: 90 },
    ])
    await publish(u)
    const stored = await rowsOf(u)

    fake.forget()
    // The clock is frozen, so a rewrite in the same instant would keep `updatedAt`; one minute on
    // makes any write to a row move it.
    vi.setSystemTime(at(1))
    const again = await publish(u)

    expect(again).toMatchObject({ ran: true, status: 'ok', sent: 0, unchanged: 2, withdrawn: 0 })
    expect(writes()).toEqual([])
    // the database is not written either
    expect((await rowsOf(u)).map((row) => row.updatedAt)).toEqual(
      stored.map((row) => row.updatedAt),
    )
    // the first run said something; the idle one is not stored (the job wakes every two minutes)
    expect(await runsOf(u)).toHaveLength(1)
    // a run the runner asked for is always stored
    await publish(u, { trigger: 'manual' })
    expect(await runsOf(u)).toHaveLength(2)
  })

  test('an owner move is a PUT on the same event, never a delete and a create', async () => {
    const { u, planId } = await runner('move@example.com')
    const [session] = await place(ctx, planId, [{ date: addDays(today, 2), kind: 'easy' }])
    await publish(u)
    const [event] = fake.byDate()

    const moved = addDays(today, 4)
    await ctx.prisma.planSession.update({
      where: { id: session!.id },
      data: { date: moved, weekStart: mondayOf(moved) },
    })
    fake.forget()
    const result = await publish(u)

    expect(result).toMatchObject({ sent: 1, withdrawn: 0, unchanged: 0 })
    expect(writes()).toEqual([`PUT /athlete/i1001/events/${String(event!.id)}`])
    expect(fake.events.size).toBe(1)
    expect(dayOf(fake.events.get(event!.id)!)).toBe(moved)
    expect(await rowsOf(u)).toMatchObject([
      { externalId: session!.externalId, remoteId: String(event!.id), date: moved, state: 'sent' },
    ])
  })

  test('the remote id is rl-<userTag>-<externalId> and is derived from nothing else', async () => {
    const { u, planId } = await runner('identity@example.com')
    const [first, second] = await place(ctx, planId, [
      { date: tomorrow, kind: 'easy', minutes: 30 },
      { date: tomorrow, kind: 'easy', minutes: 30 },
    ])
    await publish(u)

    const ids = fake.byDate().map((event) => event.external_id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.sort()).toEqual(
      [first!.externalId, second!.externalId]
        .map((externalId) => workoutExternalId(externalId, userTagOf(u.id)))
        .sort(),
    )
    expect(userTagOf(u.id)).toMatch(/^[0-9a-f]{6}$/)
    for (const id of ids) {
      expect(id).not.toContain(tomorrow)
      expect(id).not.toMatch(/easy/)
    }
    // a move does not change it
    await ctx.prisma.planSession.update({
      where: { id: first!.id },
      data: { date: addDays(today, 3), weekStart: mondayOf(addDays(today, 3)) },
    })
    await publish(u)
    expect(fake.byDate().map((event) => event.external_id)).toContain(
      workoutExternalId(first!.externalId, userTagOf(u.id)),
    )
    expect(fake.events.size).toBe(2)
  })

  test('a skipped session is withdrawn; a done one is left alone', async () => {
    const { u, planId } = await runner('skip@example.com')
    const [skipped, done, kept] = await place(ctx, planId, [
      { date: addDays(today, 1), kind: 'easy' },
      { date: addDays(today, 2), kind: 'easy' },
      { date: addDays(today, 3), kind: 'easy' },
    ])
    await publish(u)
    expect(fake.events.size).toBe(3)

    await ctx.prisma.planSession.update({ where: { id: skipped!.id }, data: { status: 'skipped' } })
    await ctx.prisma.planSession.update({ where: { id: done!.id }, data: { status: 'completed' } })
    fake.forget()
    const result = await publish(u)

    expect(result).toMatchObject({ withdrawn: 1, unchanged: 1, sent: 0 })
    expect(fake.byDate().map(dayOf)).toEqual([addDays(today, 2), addDays(today, 3)])
    const states = Object.fromEntries((await rowsOf(u)).map((row) => [row.externalId, row.state]))
    expect(states).toEqual({
      [skipped!.externalId]: 'withdrawn',
      [done!.externalId]: 'sent',
      [kept!.externalId]: 'sent',
    })
    // the skipped one went in one bulk delete, by event id
    expect(writes()).toEqual(['PUT /athlete/i1001/events/bulk-delete'])
  })

  test('a rest advice withdraws today, not tomorrow; the eased version replaces the planned one', async () => {
    const { u, planId } = await runner('advice@example.com')
    await place(ctx, planId, [
      { date: today, kind: 'threshold', minutes: 60 },
      { date: tomorrow, kind: 'easy' },
    ])
    await publish(u)
    const [todays, tomorrows] = fake.byDate()
    expect(todays!.description).not.toContain('Eased for today')

    // pain of 6: the hard session is eased, on the same event
    expect((await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 6 })).status).toBe(
      200,
    )
    fake.forget()
    await publish(u)
    expect(writes()).toEqual([`PUT /athlete/i1001/events/${String(todays!.id)}`])
    expect(fake.events.get(todays!.id)!.description).toContain('Eased for today')
    // the reason is never named
    expect(fake.events.get(todays!.id)!.description).not.toMatch(/pain|readiness/i)
    expect((await rowsOf(u)).find((row) => row.date === today)).toMatchObject({
      variant: 'eased',
      state: 'sent',
    })

    // a focal bone pain: no running until it has been assessed; the event comes off
    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 7, painFocalBone: true })
    fake.forget()
    const result = await publish(u)
    expect(result).toMatchObject({ withdrawn: 1, unchanged: 1 })
    expect(fake.byDate().map((event) => event.id)).toEqual([tomorrows!.id])
    expect((await rowsOf(u)).find((row) => row.date === today)?.state).toBe('withdrawn')
  })

  test('creates the new event before it withdraws the old one', async () => {
    const { u, planId } = await runner('order@example.com')
    const day = addDays(today, 3)
    const [old] = await place(ctx, planId, [{ date: day, kind: 'easy' }])
    await publish(u)

    // a re-plan changed the day's kind: the old identity goes, a new one arrives
    await ctx.prisma.planSession.delete({ where: { id: old!.id } })
    const [fresh] = await place(ctx, planId, [{ date: day, kind: 'long', minutes: 90 }])
    fake.forget()
    await publish(u)

    expect(writes()).toEqual([
      'POST /athlete/i1001/events/bulk',
      'PUT /athlete/i1001/events/bulk-delete',
    ])
    expect(fake.byDate().map((event) => event.external_id)).toEqual([
      workoutExternalId(fresh!.externalId, userTagOf(u.id)),
    ])
  })

  test('keeps the old event while its replacement has not arrived', async () => {
    const { u, planId } = await runner('replacement@example.com')
    const day = addDays(today, 3)
    const [old] = await place(ctx, planId, [{ date: day, kind: 'easy' }])
    await publish(u)
    await ctx.prisma.planSession.delete({ where: { id: old!.id } })
    const [fresh] = await place(ctx, planId, [{ date: day, kind: 'long', minutes: 90 }])

    fake.hooks.create = () => json({ error: 'Too many steps' }, 422)
    fake.forget()
    const refused = await publish(u)
    expect(refused).toMatchObject({ status: 'error', sent: 0, withdrawn: 0, failed: 1 })
    // no day without a session
    expect(fake.events.size).toBe(1)
    expect(writes()).toEqual(['POST /athlete/i1001/events/bulk'])
    const states = Object.fromEntries((await rowsOf(u)).map((row) => [row.externalId, row.state]))
    expect(states).toEqual({ [old!.externalId]: 'sent', [fresh!.externalId]: 'failed' })

    // the retry succeeds, and the old one goes after it
    delete fake.hooks.create
    vi.setSystemTime(at(3))
    fake.forget()
    const again = await publish(u)
    expect(again).toMatchObject({ status: 'ok', sent: 1, withdrawn: 1 })
    expect(writes()).toEqual([
      'POST /athlete/i1001/events/bulk',
      'PUT /athlete/i1001/events/bulk-delete',
    ])
    expect(fake.events.size).toBe(1)
  })

  test('an event the runner deleted is not recreated until the content changes', async () => {
    const { u, planId } = await runner('owner-removed@example.com')
    const [session] = await place(ctx, planId, [{ date: addDays(today, 2), kind: 'easy' }])
    await publish(u)
    fake.events.clear() // deleted by hand in intervals.icu

    fake.forget()
    const seen = await publish(u)
    expect(seen).toMatchObject({ status: 'ok', sent: 0, withdrawn: 0 })
    expect(writes()).toEqual([])
    expect((await rowsOf(u))[0]).toMatchObject({ state: 'owner-removed' })

    // later runs leave it alone
    await publish(u)
    expect(writes()).toEqual([])
    expect(fake.events.size).toBe(0)

    // a move changes the content, so it comes back, as a new event
    const moved = addDays(today, 5)
    await ctx.prisma.planSession.update({
      where: { id: session!.id },
      data: { date: moved, weekStart: mondayOf(moved) },
    })
    await publish(u)
    expect(writes()).toEqual(['POST /athlete/i1001/events/bulk'])
    expect(fake.byDate().map(dayOf)).toEqual([moved])
    expect((await rowsOf(u))[0]).toMatchObject({ state: 'sent', date: moved })
  })

  test('a bump of the delivery version does not bring back an event the runner deleted', async () => {
    const { u, planId } = await runner('owner-removed-bump@example.com')
    const date = addDays(today, 2)
    const [session] = await place(ctx, planId, [{ date, kind: 'easy' }])
    await publish(u)
    const [event] = fake.byDate()
    const content = { date, name: event!.name, description: event!.description }
    fake.events.clear() // deleted by hand in intervals.icu
    await publish(u)
    expect((await rowsOf(u))[0]).toMatchObject({
      state: 'owner-removed',
      sentHash: contentHash(content),
    })

    // The row as the release before the bump stored it: the same content under version 1.
    const stored = contentHashes(content).at(-1)!
    expect(DELIVERY_VERSION).toBeGreaterThan(1)
    expect(stored).not.toBe(contentHash(content))
    await ctx.prisma.wristPublication.updateMany({
      where: { userId: u.id },
      data: { sentHash: stored, desiredHash: stored },
    })
    fake.forget()
    const seen = await publish(u)
    expect(seen).toMatchObject({ status: 'ok', sent: 0, withdrawn: 0 })
    expect(writes()).toEqual([])
    expect(fake.events.size).toBe(0)
    expect((await rowsOf(u))[0]).toMatchObject({ state: 'owner-removed', sentHash: stored })

    // a change of the content still brings it back
    const moved = addDays(today, 5)
    await ctx.prisma.planSession.update({
      where: { id: session!.id },
      data: { date: moved, weekStart: mondayOf(moved) },
    })
    await publish(u)
    expect(writes()).toEqual(['POST /athlete/i1001/events/bulk'])
    expect(fake.byDate().map(dayOf)).toEqual([moved])
    expect((await rowsOf(u))[0]).toMatchObject({ state: 'sent', date: moved })
  })

  test('a 404 on the update of an event the list could not show is an owner removal too', async () => {
    const { u, planId } = await runner('put-404@example.com')
    const [session] = await place(ctx, planId, [{ date: today, kind: 'easy' }])
    // a publication of yesterday's date (the session was moved to today since), whose event is gone
    await ctx.prisma.wristPublication.create({
      data: {
        userId: u.id,
        channel: 'intervals',
        externalId: session!.externalId,
        date: addDays(today, -1),
        kind: 'easy',
        title: 'Easy run, 1 h',
        remoteId: '9999',
        state: 'sent',
        desiredHash: 'old',
        sentHash: 'old',
        sentAt: at(-60 * 24),
      },
    })

    await publish(u)

    expect(writes()).toEqual(['PUT /athlete/i1001/events/9999'])
    expect(fake.events.size).toBe(0)
    expect((await rowsOf(u))[0]).toMatchObject({ state: 'owner-removed', date: today })
  })

  test('adopts an event that carries the session id when its publication is gone', async () => {
    const { u, planId } = await runner('adopt@example.com')
    await place(ctx, planId, [{ date: addDays(today, 2), kind: 'easy' }])
    await publish(u)
    const [event] = fake.byDate()
    await ctx.prisma.wristPublication.deleteMany()

    fake.forget()
    await publish(u)

    expect(writes()).toEqual([`PUT /athlete/i1001/events/${String(event!.id)}`])
    expect(fake.events.size).toBe(1)
    expect((await rowsOf(u))[0]).toMatchObject({ remoteId: String(event!.id), state: 'sent' })
  })

  test('sessions restored the way an undo restores them reach the next run as an upsert', async () => {
    const { u, planId } = await runner('undo@example.com')
    const [session] = await place(ctx, planId, [{ date: addDays(today, 2), kind: 'easy' }])
    await publish(u)
    const key = await publishChangeKey(ctx, u.id, today)

    // a re-plan deleted the row, and the run took the event off
    await ctx.prisma.planSession.delete({ where: { id: session!.id } })
    expect(await publishChangeKey(ctx, u.id, today)).not.toBe(key)
    await publish(u)
    expect(fake.events.size).toBe(0)
    expect((await rowsOf(u))[0]?.state).toBe('withdrawn')

    // the undo writes the row back directly, with its own id and externalId
    const restored = await ctx.prisma.planSession.create({ data: session! })
    expect(restored.externalId).toBe(session!.externalId)
    fake.forget()
    const result = await publish(u)

    expect(result).toMatchObject({ status: 'ok', sent: 1, withdrawn: 0 })
    expect(writes()).toEqual(['POST /athlete/i1001/events/bulk'])
    expect(fake.events.size).toBe(1)
    expect((await rowsOf(u))[0]).toMatchObject({ state: 'sent', externalId: session!.externalId })
  })

  test('leaves a withdrawal to the next run when the plan changed while this one read it', async () => {
    const { u, planId } = await runner('defer@example.com')
    const [skipped, other] = await place(ctx, planId, [
      { date: addDays(today, 2), kind: 'easy' },
      { date: addDays(today, 3), kind: 'easy' },
    ])
    await publish(u)
    const keyBefore = (
      await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
    ).dataKey
    await ctx.prisma.planSession.update({ where: { id: skipped!.id }, data: { status: 'skipped' } })
    // a write lands while the run is talking to intervals.icu
    fake.hooks.list = async () => {
      await ctx.prisma.planSession.update({
        where: { id: other!.id },
        data: { purpose: 'Edited.' },
      })
      return undefined
    }

    const result = await publish(u)

    expect(result).toMatchObject({ status: 'ok', withdrawn: 0 })
    expect(fake.events.size).toBe(2)
    // the key was left behind, so the next tick runs and decides on a plan that has settled
    const channel = await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
    expect(channel.dataKey).toBe(keyBefore)
    expect(await isPublishDue(ctx, channel, NOW)).toBe(true)
    delete fake.hooks.list
    expect(await publish(u)).toMatchObject({ status: 'ok', withdrawn: 1 })
    expect(fake.events.size).toBe(1)
  })

  test('publishes run sessions only', async () => {
    const { u, planId } = await runner('kinds@example.com')
    const kinds = ['easy', 'strength', 'mobility', 'rest', 'cross', 'race', 'hike', 'long'] as const
    await place(
      ctx,
      planId,
      kinds.map((kind, i) => ({ date: addDays(today, i + 1), kind })),
    )

    await publish(u)

    expect(fake.byDate().map(dayOf)).toEqual([
      addDays(today, 1),
      addDays(today, 7),
      addDays(today, 8),
    ])
    expect((await rowsOf(u)).map((row) => row.kind)).toEqual(['easy', 'hike', 'long'])
  })

  test('one run per user at a time', async () => {
    const { u, planId } = await runner('flight@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    fake.hooks.list = async () => {
      await held
      return undefined
    }

    const first = publish(u)
    await vi.waitFor(() => {
      expect(isPublishing(u.id)).toBe(true)
    })
    expect(await publish(u)).toMatchObject({ ran: false })

    release()
    expect(await first).toMatchObject({ ran: true, sent: 1 })
    expect(isPublishing(u.id)).toBe(false)
    expect(fake.made('POST', 'events/bulk')).toHaveLength(1)
    expect(await runsOf(u)).toHaveLength(1)
  })

  test('a removal intervals.icu refuses after a send leaves the run partial and is tried again', async () => {
    const { u, planId } = await runner('partial@example.com')
    const [old] = await place(ctx, planId, [{ date: addDays(today, 2), kind: 'easy' }])
    await publish(u)
    const keyBefore = (
      await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
    ).dataKey
    await ctx.prisma.planSession.update({ where: { id: old!.id }, data: { status: 'skipped' } })
    await place(ctx, planId, [{ date: addDays(today, 3), kind: 'long', minutes: 90 }])
    fake.hooks.remove = () => json({}, 502)

    const result = await publish(u)

    expect(result).toMatchObject({ status: 'partial', sent: 1, withdrawn: 0 })
    expect(fake.events.size).toBe(2)
    expect((await rowsOf(u)).map((row) => row.state).sort()).toEqual(['sent', 'sent'])
    const channel = await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
    // the key was left behind, so the next tick finds the work still due
    expect(channel).toMatchObject({ pausedUntil: at(5), dataKey: keyBefore })

    delete fake.hooks.remove
    vi.setSystemTime(at(6))
    expect(await publish(u)).toMatchObject({ status: 'ok', withdrawn: 1 })
    expect(fake.events.size).toBe(1)
  })

  test('leaves a past day and a connection that is off alone', async () => {
    const { u, planId } = await runner('past@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await ctx.prisma.wristPublication.create({
      data: {
        userId: u.id,
        channel: 'intervals',
        externalId: 'gone-with-the-plan',
        date: addDays(today, -3),
        kind: 'easy',
        title: 'Easy run, 1 h',
        remoteId: '4242',
        state: 'sent',
        desiredHash: 'h',
        sentHash: 'h',
      },
    })
    await publish(u)
    expect(writes()).toEqual(['POST /athlete/i1001/events/bulk'])

    await ctx.prisma.deliveryChannel.updateMany({ data: { enabled: false } })
    fake.forget()
    expect(await publish(u)).toMatchObject({ ran: false })
    expect(fake.calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------------------------

describe('the change key', () => {
  test('a run leaves the data version unchanged', async () => {
    const { u, planId } = await runner('version@example.com')
    await place(ctx, planId, [
      { date: today, kind: 'easy' },
      { date: tomorrow, kind: 'long', minutes: 90 },
    ])
    const before = await dataVersionKey(ctx.prisma)
    const keyBefore = await publishChangeKey(ctx, u.id, today)

    await publish(u)
    await publish(u, { trigger: 'manual' })

    expect(await dataVersionKey(ctx.prisma)).toEqual(before)
    expect(await publishChangeKey(ctx, u.id, today)).toBe(keyBefore)
    // the run did write
    expect(await rowsOf(u)).toHaveLength(2)
  })

  test('follows a state write and the day, and the forecast stamp is part of it', async () => {
    const { u, planId } = await runner('key@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    const base = await publishChangeKey(ctx, u.id, today)
    expect(await publishChangeKey(ctx, u.id, today)).toBe(base)
    // midnight
    expect(await publishChangeKey(ctx, u.id, tomorrow)).not.toBe(base)
    // a state write
    await ctx.prisma.planSession.updateMany({ data: { purpose: 'Edited.' } })
    const written = await publishChangeKey(ctx, u.id, today)
    expect(written).not.toBe(base)

    // a forecast refresh writes no state and moves the key all the same
    await ctx.prisma.athleteProfile.update({
      where: { userId: u.id },
      data: { homeLat: 40.1, homeLng: -105.2 },
    })
    const homed = await publishChangeKey(ctx, u.id, today)
    const version = await dataVersionKey(ctx.prisma)
    await fillForecast(u.id)
    expect(await dataVersionKey(ctx.prisma)).toEqual(version)
    const filled = await publishChangeKey(ctx, u.id, today)
    expect(filled).not.toBe(homed)

    // a later refresh of the same cell moves it again
    vi.setSystemTime(at(90))
    await fillForecast(u.id)
    expect(await publishChangeKey(ctx, u.id, today)).not.toBe(filled)
  })

  test('the content hash covers the delivery version, the day and the text', () => {
    const parts = { date: '2026-10-22', name: 'Easy run, 45 min', description: '- Run 45m' }
    const hash = contentHash(parts)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // the same content under every version up to this one, the current first
    const all = contentHashes(parts)
    expect(all).toHaveLength(DELIVERY_VERSION)
    expect(all[0]).toBe(hash)
    expect(new Set(all).size).toBe(DELIVERY_VERSION)
    expect(contentHashes({ ...parts, date: '2026-10-23' }).some((h) => all.includes(h))).toBe(false)
    expect(contentHash(parts)).toBe(hash)
    expect(contentHash({ ...parts, date: '2026-10-23' })).not.toBe(hash)
    expect(contentHash({ ...parts, name: 'Long run, 45 min' })).not.toBe(hash)
    expect(contentHash({ ...parts, description: '- Run 46m' })).not.toBe(hash)
    expect(DELIVERY_VERSION).toBeGreaterThanOrEqual(1)
  })

  test('a threshold pace set in intervals.icu republishes the pace targets', async () => {
    const { u, planId } = await runner('reference@example.com')
    await seedHistory(ctx, u.id, today)
    await place(ctx, planId, [{ date: tomorrow, kind: 'intervals', minutes: 60 }])
    fake.settings = [{ types: ['Run'], max_hr: 190 }]
    await publish(u)
    const [event] = fake.byDate()
    expect(event!.description).not.toMatch(/% Pace/)
    expect((await rowsOf(u))[0]?.warnings).toContain('no-threshold-pace')

    // the figure is set, and the incomplete reference is read again at the next backstop run
    fake.settings = [{ types: ['Run'], max_hr: 190, threshold_pace: 3.8 }]
    vi.setSystemTime(at(31))
    fake.forget()
    const result = await publish(u)
    expect(result).toMatchObject({ sent: 1 })
    expect(writes()).toEqual([`PUT /athlete/i1001/events/${String(event!.id)}`])
    expect(fake.events.get(event!.id)!.description).toMatch(/% Pace/)
    expect((await rowsOf(u))[0]?.warnings).not.toContain('no-threshold-pace')
  })
})

// ---------------------------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------------------------

describe('retry rules', () => {
  test('a network error retries at min(2^attempts, 60) minutes, without a cap', async () => {
    const { u, planId } = await runner('network@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    let posts = 0
    fake.hooks.create = () => {
      posts += 1
      throw new Error('socket closed')
    }

    expect(await publish(u)).toMatchObject({ status: 'error', failed: 1 })
    expect((await rowsOf(u))[0]).toMatchObject({
      state: 'failed',
      failCode: 'network',
      attempts: 1,
      nextAttemptAt: at(2),
    })

    // not yet due: no call
    vi.setSystemTime(at(1))
    await publish(u)
    expect(posts).toBe(1)

    // due: fails again and doubles
    vi.setSystemTime(at(2))
    await publish(u)
    expect(posts).toBe(2)
    expect((await rowsOf(u))[0]).toMatchObject({ attempts: 2, nextAttemptAt: at(2 + 4) })

    // the cap is an hour, and attempts keep counting
    await ctx.prisma.wristPublication.updateMany({ data: { attempts: 9, nextAttemptAt: at(6) } })
    vi.setSystemTime(at(6))
    await publish(u)
    expect((await rowsOf(u))[0]).toMatchObject({ attempts: 10, nextAttemptAt: at(6 + 60) })

    // it goes through when intervals.icu is back
    delete fake.hooks.create
    vi.setSystemTime(at(70))
    expect(await publish(u)).toMatchObject({ status: 'ok', sent: 1 })
    expect((await rowsOf(u))[0]).toMatchObject({
      state: 'sent',
      failCode: null,
      failMessage: null,
      attempts: 0,
      nextAttemptAt: null,
    })
  })

  test('a rejected workout is tried three times, then waits for new content or "Send again"', async () => {
    const { u, planId } = await runner('rejected@example.com')
    const [session] = await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    let posts = 0
    fake.hooks.create = () => {
      posts += 1
      return json({ error: 'Unreadable steps' }, 422)
    }

    await publish(u)
    expect((await rowsOf(u))[0]).toMatchObject({
      state: 'failed',
      failCode: 'rejected',
      failMessage: 'intervals.icu did not accept the workout: Unreadable steps',
      attempts: 1,
      nextAttemptAt: at(2),
    })
    vi.setSystemTime(at(2))
    await publish(u)
    expect((await rowsOf(u))[0]).toMatchObject({ attempts: 2, nextAttemptAt: at(2 + 4) })
    vi.setSystemTime(at(6))
    await publish(u)
    expect(posts).toBe(3)
    expect((await rowsOf(u))[0]).toMatchObject({ attempts: 3, nextAttemptAt: null })

    // it waits
    vi.setSystemTime(at(600))
    await publish(u)
    expect(posts).toBe(3)

    // new content is tried at once
    const moved = addDays(today, 3)
    await ctx.prisma.planSession.update({
      where: { id: session!.id },
      data: { date: moved, weekStart: mondayOf(moved) },
    })
    await publish(u)
    expect(posts).toBe(4)
    expect((await rowsOf(u))[0]).toMatchObject({ attempts: 1, date: moved })
  })

  test('a rate limit pauses the channel for the time intervals.icu gave, and keeps what was done', async () => {
    const { u, planId } = await runner('rate-limit@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    let posts = 0
    fake.hooks.create = () => {
      posts += 1
      return json({}, 429, { 'retry-after': '120' })
    }

    const result = await publish(u)

    expect(result).toMatchObject({ ran: true, status: 'paused', sent: 0, failed: 1 })
    const channel = await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
    expect(channel.pausedUntil).toEqual(at(2))
    expect((await rowsOf(u))[0]).toMatchObject({
      state: 'failed',
      failCode: 'rate-limit',
      failMessage: 'intervals.icu asked the app to wait.',
      nextAttemptAt: at(2),
    })
    const [run] = await runsOf(u)
    expect(run).toMatchObject({ status: 'paused', failed: 1 })

    // nothing is sent while it is paused
    vi.setSystemTime(at(1))
    expect(await publish(u)).toMatchObject({ ran: false })
    expect(posts).toBe(1)

    delete fake.hooks.create
    vi.setSystemTime(at(2.1))
    expect(await publish(u)).toMatchObject({ status: 'ok', sent: 1 })
    expect(
      (await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })).pausedUntil,
    ).toBeNull()
  })

  test('a rate limit in the middle keeps the events already made', async () => {
    const { u, planId } = await runner('rate-limit-mid@example.com')
    const [a, b] = await place(ctx, planId, [
      { date: addDays(today, 1), kind: 'easy' },
      { date: addDays(today, 2), kind: 'easy' },
    ])
    await publish(u)
    const [first, second] = fake.byDate()

    // both moves are updates in place; intervals.icu refuses the second
    const move = (id: string, to: string) =>
      ctx.prisma.planSession.update({ where: { id }, data: { date: to, weekStart: mondayOf(to) } })
    await move(a!.id, addDays(today, 5))
    await move(b!.id, addDays(today, 6))
    let puts = 0
    fake.hooks.update = () => {
      puts += 1
      return puts === 2 ? json({}, 429, { 'retry-after': '60' }) : undefined
    }
    fake.forget()
    const result = await publish(u)

    expect(result).toMatchObject({ status: 'paused', sent: 1, failed: 1, withdrawn: 0 })
    expect(dayOf(fake.events.get(first!.id)!)).toBe(addDays(today, 5))
    expect(dayOf(fake.events.get(second!.id)!)).toBe(addDays(today, 2))
    const byExt = Object.fromEntries((await rowsOf(u)).map((row) => [row.externalId, row]))
    expect(byExt[a!.externalId]).toMatchObject({ state: 'sent', date: addDays(today, 5) })
    expect(byExt[b!.externalId]).toMatchObject({
      state: 'failed',
      failCode: 'rate-limit',
      remoteId: String(second!.id),
      // intervals.icu asked for a minute; the formula of the first attempt is two
      nextAttemptAt: at(2),
    })
    expect(
      (await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })).pausedUntil,
    ).toEqual(at(1))
    // nothing was withdrawn after the pause, and nothing is lost: the next run finishes it
    delete fake.hooks.update
    vi.setSystemTime(at(2.1))
    expect(await publish(u)).toMatchObject({ status: 'ok', sent: 1 })
    expect(dayOf(fake.events.get(second!.id)!)).toBe(addDays(today, 6))
    expect(fake.events.size).toBe(2)
  })

  test('a rejected key stops the channel and marks the integration; a reconnect resumes it', async () => {
    const { u, planId } = await runner('auth@example.com')
    await place(ctx, planId, [
      { date: addDays(today, 1), kind: 'easy' },
      { date: addDays(today, 2), kind: 'long', minutes: 90 },
    ])
    fake.hooks.create = () => json({}, 401)

    const result = await publish(u)

    expect(result).toMatchObject({ status: 'error', sent: 0, failed: 2 })
    expect(
      (await ctx.prisma.integration.findFirstOrThrow({ where: { userId: u.id } })).status,
    ).toBe('needs_auth')
    expect(await rowsOf(u)).toMatchObject([
      { state: 'failed', failCode: 'auth', nextAttemptAt: null },
      { state: 'failed', failCode: 'auth', nextAttemptAt: null },
    ])
    const [run] = await runsOf(u)
    expect(run).toMatchObject({ status: 'error' })
    expect(run!.message).toBe(
      'intervals.icu did not accept the API key. Reconnect it on the Integrations page.',
    )

    // nothing runs while the key is refused
    fake.forget()
    expect(await publish(u)).toMatchObject({ ran: false })
    expect(fake.calls).toEqual([])

    // the runner reconnects: the sessions that waited for it go out
    delete fake.hooks.create
    await ctx.prisma.integration.updateMany({ data: { status: 'connected' } })
    expect(await publish(u)).toMatchObject({ status: 'ok', sent: 2 })
  })

  test('a run that cannot list the calendar writes nothing and waits five minutes', async () => {
    const { u, planId } = await runner('list-down@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    fake.hooks.list = () => json({}, 502)

    const result = await publish(u)

    expect(result).toMatchObject({ ran: true, status: 'error', sent: 0 })
    expect(writes()).toEqual([])
    const channel = await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
    expect(channel.pausedUntil).toEqual(at(5))
    expect(channel.dataKey).toBeNull()
    expect((await runsOf(u))[0]).toMatchObject({
      status: 'error',
      message: 'intervals.icu answered HTTP 502.',
    })
  })

  test('an outage stores its first error run, and not each scheduled retry of it', async () => {
    const { u, planId } = await runner('outage@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    fake.hooks.list = () => json({}, 502)

    // ten ticks, five minutes apart: each one retries, and only the first is stored
    for (let tick = 0; tick < 10; tick += 1) {
      expect(await publish(u, { now: at(5 * tick) })).toMatchObject({ ran: true, status: 'error' })
    }
    expect(fake.made('GET', 'events')).toHaveLength(10)
    const channel = await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } })
    expect(channel.pausedUntil).toEqual(at(50))
    expect(await runsOf(u)).toMatchObject([
      { status: 'error', message: 'intervals.icu answered HTTP 502.' },
    ])

    // another failure is news, and so is a run the runner asked for
    fake.hooks.list = () => json({}, 503)
    await publish(u, { now: at(50) })
    await publish(u, { now: at(55) })
    expect((await runsOf(u)).map((run) => run.message)).toEqual([
      'intervals.icu answered HTTP 502.',
      'intervals.icu answered HTTP 503.',
    ])
    await publish(u, { now: at(60), trigger: 'manual' })
    expect(await runsOf(u)).toHaveLength(3)

    // a recovery is stored, so a failure after it is stored again
    delete fake.hooks.list
    expect(await publish(u, { now: at(65) })).toMatchObject({ status: 'ok', sent: 1 })
    fake.hooks.list = () => json({}, 503)
    await ctx.prisma.deliveryChannel.updateMany({
      where: { userId: u.id },
      data: { dataKey: null },
    })
    await publish(u, { now: at(95) })
    expect((await runsOf(u)).map((run) => run.status)).toEqual([
      'error',
      'error',
      'error',
      'ok',
      'error',
    ])
  })

  test('shows a device error until push_errors clears', async () => {
    const { u, planId } = await runner('device@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await publish(u)
    const [event] = fake.byDate()
    event!.push_errors = ['Garmin Connect refused the workout: too many steps']

    await publish(u)
    expect((await rowsOf(u))[0]).toMatchObject({
      state: 'sent',
      deviceMessage: 'Garmin Connect refused the workout: too many steps',
    })

    event!.push_errors = []
    await publish(u)
    expect((await rowsOf(u))[0]?.deviceMessage).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The sync log, and secrets
// ---------------------------------------------------------------------------------------------

describe('the run record', () => {
  test('each run that does something writes one publish run with its counts', async () => {
    const { u, planId } = await runner('record@example.com')
    await place(ctx, planId, [
      { date: addDays(today, 1), kind: 'easy' },
      { date: addDays(today, 2), kind: 'easy' },
    ])
    await publish(u)
    await ctx.prisma.planSession.updateMany({
      where: { date: addDays(today, 2) },
      data: { status: 'skipped' },
    })
    await publish(u)

    expect(
      (await runsOf(u)).map((run) => [
        run.provider,
        run.status,
        run.accepted,
        run.duplicate,
        run.failed,
      ]),
    ).toEqual([
      ['intervals', 'ok', 2, 0, 0],
      ['intervals', 'ok', 0, 1, 0],
    ])
    // no job row: the publish run is the one record
    expect(await ctx.prisma.syncRun.count({ where: { userId: u.id, channel: 'job' } })).toBe(0)
  })

  test('the key reaches no row, no run and no message', async () => {
    const { u, planId } = await runner('secret@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    fake.hooks.create = (req) =>
      json(
        { error: `Bad request for ${req.headers.get('authorization') ?? ''} and ${API_KEY}` },
        422,
      )

    await publish(u)

    const stored = JSON.stringify({
      rows: await rowsOf(u),
      runs: await ctx.prisma.syncRun.findMany({ where: { userId: u.id } }),
      channel: await ctx.prisma.deliveryChannel.findMany({ where: { userId: u.id } }),
      integration: (await ctx.prisma.integration.findMany({ where: { userId: u.id } })).map(
        (row) => row.lastError,
      ),
    })
    expect(stored).not.toContain(API_KEY)
    expect(stored).not.toContain(Buffer.from(`API_KEY:${API_KEY}`).toString('base64'))
    expect((await rowsOf(u))[0]?.failMessage).toContain('Bad request')
  })
})

// ---------------------------------------------------------------------------------------------
// Rest windows (design 9.4 and 9.6, task E5-8)
// ---------------------------------------------------------------------------------------------

describe('a rest window', () => {
  /**
   * A runner whose plan the engine generated (the window routes re-plan it), with publishing on.
   * The plan has runs from today on, so a window over the coming days holds some of them.
   */
  async function generated(email: string) {
    const u = await seedUser(ctx, { email, units: 'km' })
    await ctx.prisma.athleteProfile.create({
      data: { userId: u.id, hrMax: 190, hrMaxSource: 'measured', hrRest: 50, timezone: 'UTC' },
    })
    await seedHistory(ctx, u.id, today)
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Synthetic half',
        priority: 'A',
        targetDate: addDays(today, 7 * 5 + 5),
        distanceM: 21_097,
        goalType: 'finish',
      },
    })
    const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    await connectIntervals(ctx, u.id)
    await enablePublishing(ctx, u.id)
    return { u, plan: res.body as PlanWithSessions }
  }

  /** What is on intervals.icu, by identity: the event's own id changes when it is made again. */
  const onCalendar = (): Array<[string | null, string, string, string]> =>
    fake
      .byDate()
      .map((e): [string | null, string, string, string] => [
        e.external_id,
        dayOf(e),
        e.name,
        e.description,
      ])

  /** An illness window over the three days after tomorrow's. */
  const window = () => ({
    reason: 'illness-above-neck',
    mode: 'rest',
    startDate: tomorrow,
    endDate: addDays(tomorrow, 2),
  })

  test('withdraws the days it holds on the next publish, and its undo sends them again', async () => {
    const { u } = await generated('window-publish@example.com')
    await publish(u)
    const before = onCalendar()
    // the window must hold something the publisher had sent
    const held = before.filter(([, day]) => day >= tomorrow && day <= addDays(tomorrow, 2))
    expect(held.length).toBeGreaterThan(0)

    const created = await client(ctx, u).post('/api/plan/disruptions').send(window())
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const { revision } = created.body as DisruptionResult

    fake.forget()
    const withdrawn = await publish(u)
    expect(withdrawn.withdrawn).toBeGreaterThan(0)
    expect(withdrawn.status).toBe('ok')
    // nothing runs on a day inside the window, and today's run is still on the calendar
    expect(
      onCalendar().filter(([, day]) => day >= tomorrow && day <= addDays(tomorrow, 2)),
    ).toEqual([])
    expect(onCalendar().some(([, day]) => day === today)).toBe(
      before.some(([, day]) => day === today),
    )
    const rows = await rowsOf(u)
    for (const [externalId] of held) {
      expect(
        rows.find((row) => externalId?.endsWith(row.externalId))?.state,
        String(externalId),
      ).toBe('withdrawn')
    }

    const undone = await client(ctx, u).post(`/api/plan/revisions/${revision.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)

    fake.forget()
    const again = await publish(u)
    expect(again.sent).toBeGreaterThan(0)
    expect(again.status).toBe('ok')
    // the calendar holds what it held before the window, with the identities the plan kept
    expect(onCalendar()).toEqual(before)
    const back = await rowsOf(u)
    for (const [externalId] of held) {
      expect(
        back.find((row) => externalId?.endsWith(row.externalId))?.state,
        String(externalId),
      ).toBe('sent')
    }
  })

  test('Today, the session sheet and the publish set agree on a day the window holds', async () => {
    const { u } = await generated('window-agree@example.com')
    await publish(u)
    // the first day of the window on which the plan had a run, in the two days Today can look ahead
    const lookAhead = addDays(today, 2)
    const run = fake.byDate().find((event) => dayOf(event) >= tomorrow && dayOf(event) <= lookAhead)
    expect(run, 'the plan has a run on one of the first days of the window').toBeDefined()
    const day = dayOf(run!)

    const created = await client(ctx, u).post('/api/plan/disruptions').send(window())
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    await publish(u)

    // a rest day on Today, with the window in effect
    const view = (await client(ctx, u).get(`/api/today?date=${day}`)).body as TodayView
    expect(view.coach.hero?.session.kind).toBe('rest')
    expect(view.coach.hero?.session.flags).toContain('rest-window')
    expect(view.coach.disruptions.map((w) => w.phase)).toEqual(['resting'])

    // not a run in the session sheet: no workout file
    const sheet = await client(ctx, u).get(
      `/api/plan/sessions/${view.coach.hero!.session.id}/workout`,
    )
    expect(sheet.status, JSON.stringify(sheet.body)).toBe(200)
    expect((sheet.body as SessionWorkoutView).file).toMatchObject({
      available: false,
      reason: 'not-a-run',
    })

    // and nothing on the calendar, where the run was a moment ago
    expect(onCalendar().filter(([, eventDay]) => eventDay === day)).toEqual([])
    expect(fake.events.has(run!.id)).toBe(false)
  })
})
