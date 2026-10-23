import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { lintText } from '../../shared/copy/lint.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import type { TodayView, WristSettings, WristStatus } from '../../shared/types.ts'
import {
  REMOVE_TIMEOUT_MS,
  prepareDisconnect,
  publishForUser,
  setPublishing,
} from '../../server/services/publish.ts'
import { settleBackground } from '../../server/services/sync.ts'
import { settleWeatherCache } from '../../server/services/weatherCache.ts'
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
  seedRunner,
  type FakeIntervals,
} from './wristFixtures.ts'

// The wrist routes (design 6.4, task E1-5): the status, the settings, "Send again" and the
// disconnect of intervals.icu, against a stateful stand-in for it.
const NOW = new Date(2026, 9, 21, 12) // a Wednesday at noon
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOW)

// Every log line the server writes in this file, so a test can prove the key never reached one.
const logged = vi.hoisted(() => ({ lines: [] as string[] }))
vi.mock('../../server/logger.ts', async () => {
  const { pino } = await import('pino')
  return {
    createLogger: () =>
      pino(
        {
          level: 'debug',
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        },
        {
          write: (chunk: string) => {
            logged.lines.push(chunk)
          },
        },
      ),
  }
})

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
  logged.lines.length = 0
  await ctx.prisma.user.deleteMany()
})

afterEach(async () => {
  await settleBackground()
  await settleWeatherCache()
  expectNoRefusedFetches(ctx)
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

async function runner(
  email: string,
  opts: { connected?: boolean; enabled?: boolean; garminLinked?: boolean } = {},
) {
  const seeded = await seedRunner(ctx, email, today)
  if (opts.connected !== false) await connectIntervals(ctx, seeded.u.id)
  if (opts.enabled !== false && opts.connected !== false) {
    await enablePublishing(ctx, seeded.u.id, opts.garminLinked ?? false)
  }
  return seeded
}

/** Routes read `ctx.fetch` at each call; the afterEach puts the network guard back. */
function online(): void {
  ctx.fetch = fake.fetch
}

const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * MIN)

const rowsOf = (u: TestUser) =>
  ctx.prisma.wristPublication.findMany({
    where: { userId: u.id },
    orderBy: [{ date: 'asc' }, { externalId: 'asc' }],
  })

const writes = (): string[] =>
  fake.calls
    .filter((call) => call.method !== 'GET')
    .map((call) => `${call.method} ${call.path.split('?')[0]}`)

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

async function status(u: TestUser, query = ''): Promise<WristStatus> {
  const res = await client(ctx, u).get(`/api/wrist/status${query}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as WristStatus
}

/** The runner has published once: one event per session on intervals.icu, a row each. */
async function sentOnce(u: TestUser): Promise<void> {
  const result = await publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'manual' })
  expect(result.status).toBe('ok')
}

// ---------------------------------------------------------------------------------------------
// Authentication comes first
// ---------------------------------------------------------------------------------------------

describe('authentication', () => {
  test('every wrist route answers 401 before any body is read', async () => {
    const anonymous = client(ctx)
    expect((await anonymous.get('/api/wrist/status')).status).toBe(401)
    // a body that is not JSON would be a 400 if a parser ran first
    const put = await anonymous
      .put('/api/wrist/intervals')
      .set('Content-Type', 'application/json')
      .send('{"enabled":')
    expect(put.status).toBe(401)
    const post = await anonymous
      .post('/api/wrist/publish')
      .set('Content-Type', 'application/json')
      .send('{"sessionId":')
    expect(post.status).toBe(401)
    expect((await anonymous.delete('/api/integrations/intervals?removeSent=true')).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------------
// GET /api/wrist/status
// ---------------------------------------------------------------------------------------------

describe('GET /api/wrist/status', () => {
  test('lists the sessions of today to +13 joined by externalId, with a not-sent item while publishing is on', async () => {
    const { u, planId } = await runner('status@example.com')
    const [first, second] = await place(ctx, planId, [
      { date: today, kind: 'easy' },
      { date: addDays(today, 2), kind: 'long', minutes: 90 },
    ])
    await sentOnce(u)
    // planned after the run: no publication yet
    const [third] = await place(ctx, planId, [{ date: addDays(today, 5), kind: 'easy' }])

    const res = await client(ctx, u).get('/api/wrist/status')
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const body = res.body as WristStatus
    expect(body).toMatchObject({
      from: today,
      to: addDays(today, 13),
      connection: 'connected',
      settings: { enabled: true, garminLinked: false, running: false },
    })
    expect(
      body.items.map((item) => [item.externalId, item.sessionId, item.date, item.status]),
    ).toEqual([
      [first!.externalId, first!.id, today, 'sent'],
      [second!.externalId, second!.id, addDays(today, 2), 'sent'],
      [third!.externalId, third!.id, addDays(today, 5), 'not-sent'],
    ])
    expect(body.items[0]).toMatchObject({
      title: 'Easy run, 1 h',
      variant: 'planned',
      failCode: null,
      deviceMessage: null,
      warnings: [],
    })
    expect(JSON.stringify(body)).not.toContain(API_KEY)
  })

  test('lists nothing as not sent while publishing is off, and takes a range', async () => {
    const { u, planId } = await runner('status-off@example.com', { enabled: false })
    const [todays] = await place(ctx, planId, [
      { date: today, kind: 'easy' },
      { date: addDays(today, 20), kind: 'easy' },
    ])
    expect((await status(u)).items).toEqual([])
    expect((await status(u)).settings).toMatchObject({ enabled: false })

    // a published row outside the default range shows when asked for
    await ctx.prisma.deliveryChannel.create({
      data: { userId: u.id, channel: 'intervals', enabled: true },
    })
    await ctx.prisma.wristPublication.create({
      data: {
        userId: u.id,
        channel: 'intervals',
        externalId: 'x1',
        date: addDays(today, -5),
        kind: 'easy',
        title: 'Easy run, 30 min',
        remoteId: '77',
        state: 'sent',
        desiredHash: 'h',
        sentHash: 'h',
        sentAt: at(-60),
      },
    })
    expect((await status(u)).items.map((item) => item.externalId)).toEqual([todays!.externalId])
    const asked = await status(u, `?from=${addDays(today, -6)}&to=${today}`)
    expect(asked).toMatchObject({ from: addDays(today, -6), to: today })
    expect(asked.items.map((item) => [item.externalId, item.status])).toEqual([
      ['x1', 'sent'],
      [todays!.externalId, 'not-sent'],
    ])
  })

  test('refuses a range that is malformed, backwards or longer than 60 days', async () => {
    const { u } = await runner('status-range@example.com')
    const get = (query: string) => client(ctx, u).get(`/api/wrist/status${query}`)
    for (const query of [
      '?from=2026-13-40',
      '?from=yesterday',
      `?from=${today}&to=${addDays(today, -1)}`,
      `?from=${today}&to=${addDays(today, 60)}`,
      '?unknown=1',
    ]) {
      const res = await get(query)
      expect(res.status, query).toBe(400)
      expect(res.body).toMatchObject({ error: { code: 'validation' } })
    }
    // 60 days inclusive is fine
    expect((await get(`?from=${today}&to=${addDays(today, 59)}`)).status).toBe(200)
  })

  test('says "on your watch" only with the tick, no device message and 15 minutes', async () => {
    const { u, planId } = await runner('on-watch@example.com', { garminLinked: true })
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)

    // just sent: sent
    expect((await status(u)).items[0]?.status).toBe('sent')
    // 14 minutes later: still sent
    vi.setSystemTime(at(14))
    expect((await status(u)).items[0]?.status).toBe('sent')
    // 15 minutes later: on the watch
    vi.setSystemTime(at(15))
    expect((await status(u)).items[0]?.status).toBe('on-watch')

    // a device message takes it back: it is not on the watch, and the reason is shown
    await ctx.prisma.wristPublication.updateMany({
      data: { deviceMessage: 'Garmin Connect could not take the workout.' },
    })
    const refused = (await status(u)).items[0]
    expect(refused).toMatchObject({
      status: 'not-delivered',
      deviceMessage: 'Garmin Connect could not take the workout.',
    })

    // without the tick it never says so
    await ctx.prisma.wristPublication.updateMany({ data: { deviceMessage: null } })
    await ctx.prisma.deliveryChannel.updateMany({ data: { garminLinked: false } })
    vi.setSystemTime(at(600))
    expect((await status(u)).items[0]?.status).toBe('sent')
  })

  test('maps every stored state to a status', async () => {
    const { u, planId } = await runner('states@example.com')
    const sessions = await place(
      ctx,
      planId,
      Array.from({ length: 5 }, (_, i) => ({ date: addDays(today, i + 1), kind: 'easy' as const })),
    )
    const rowFor = (i: number, extra: Record<string, unknown>) =>
      ctx.prisma.wristPublication.create({
        data: {
          userId: u.id,
          channel: 'intervals',
          externalId: sessions[i]!.externalId,
          date: sessions[i]!.date,
          kind: 'easy',
          title: 'Easy run, 1 h',
          desiredHash: 'h',
          ...(extra as { state: string }),
        },
      })
    await rowFor(0, { state: 'pending' })
    await rowFor(1, {
      state: 'failed',
      failCode: 'network',
      nextAttemptAt: at(4),
      failMessage: 'x',
    })
    await rowFor(2, {
      state: 'failed',
      failCode: 'rejected',
      nextAttemptAt: null,
      failMessage: 'x',
    })
    await rowFor(3, { state: 'owner-removed', sentHash: 'h' })
    await rowFor(4, { state: 'withdrawn' })

    const body = await status(u)
    expect(body.items.map((item) => item.status)).toEqual([
      'waiting',
      'waiting',
      'not-delivered',
      'removed',
      'withdrawn',
    ])
    expect(body.items[1]).toMatchObject({ failCode: 'network', retryAt: at(4).toISOString() })
    expect(body.items[2]).toMatchObject({ failCode: 'rejected', retryAt: null })
  })

  test('shows a session that moved but was not sent at its new day yet as waiting', async () => {
    const { u, planId } = await runner('moved-status@example.com')
    const [session] = await place(ctx, planId, [{ date: addDays(today, 2), kind: 'easy' }])
    await sentOnce(u)
    const moved = addDays(today, 4)
    await ctx.prisma.planSession.update({ where: { id: session!.id }, data: { date: moved } })

    const [item] = (await status(u)).items
    expect(item).toMatchObject({ date: moved, sessionId: session!.id, status: 'waiting' })
  })
})

// ---------------------------------------------------------------------------------------------
// PUT /api/wrist/intervals
// ---------------------------------------------------------------------------------------------

describe('PUT /api/wrist/intervals', () => {
  const put = (u: TestUser, body: unknown) =>
    client(ctx, u)
      .put('/api/wrist/intervals')
      .send(body as object)

  test('validates the body with Zod', async () => {
    const { u } = await runner('put-validate@example.com', { enabled: false })
    for (const body of [
      {},
      { enabled: true },
      { enabled: 'yes', garminLinked: false },
      { enabled: true, garminLinked: false, extra: 1 },
      { enabled: false, garminLinked: false, removeSent: 'yes' },
    ]) {
      const res = await put(u, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body).toMatchObject({ error: { code: 'validation' } })
    }
    expect((await put(u, { enabled: true, garminLinked: false, extra: 1 })).body).toMatchObject({
      error: { details: { issues: expect.any(Array) as unknown } },
    })
  })

  test('needs a connected integration: 409 with what to do', async () => {
    const none = await runner('put-none@example.com', { connected: false })
    const missing = await put(none.u, { enabled: true, garminLinked: false })
    expect(missing.status).toBe(409)
    expect(missing.body).toMatchObject({
      error: {
        code: 'conflict',
        message: 'Connect intervals.icu first.',
        details: { requires: 'connect-intervals' },
      },
    })

    const stale = await runner('put-stale@example.com', { connected: false })
    await connectIntervals(ctx, stale.u.id, 'needs_auth')
    const reconnect = await put(stale.u, { enabled: true, garminLinked: false })
    expect(reconnect.status).toBe(409)
    expect(reconnect.body).toMatchObject({
      error: {
        message: 'Reconnect intervals.icu first.',
        details: { requires: 'reconnect-intervals' },
      },
    })
    // nothing was switched on
    expect(await ctx.prisma.deliveryChannel.count({ where: { userId: stale.u.id } })).toBe(0)
  })

  test('enabling saves the choices and starts a tracked run', async () => {
    const { u, planId } = await runner('put-enable@example.com', { enabled: false })
    await place(ctx, planId, [
      { date: tomorrow, kind: 'easy' },
      { date: addDays(today, 3), kind: 'long', minutes: 90 },
    ])
    online()

    const res = await put(u, { enabled: true, garminLinked: true })
    expect(res.status).toBe(200)
    expect(res.body as WristSettings).toMatchObject({ enabled: true, garminLinked: true })
    await settleBackground()

    expect(fake.events.size).toBe(2)
    expect(
      await ctx.prisma.syncRun.findMany({ where: { userId: u.id, channel: 'publish' } }),
    ).toMatchObject([{ trigger: 'manual', status: 'ok', accepted: 2 }])
    expect(await rowsOf(u)).toMatchObject([{ state: 'sent' }, { state: 'sent' }])
    // turning the tick off later starts no run of its own
    fake.forget()
    expect((await put(u, { enabled: true, garminLinked: false })).body).toMatchObject({
      enabled: true,
      garminLinked: false,
    })
    await settleBackground()
    expect(fake.calls).toEqual([])
  })

  test('is off by default: a connected runner publishes nothing until it is switched on', async () => {
    const { u, planId } = await runner('put-default@example.com', { enabled: false })
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    expect(await ctx.prisma.deliveryChannel.count({ where: { userId: u.id } })).toBe(0)
    expect(await publishForUser(ctx, u.id, { fetch: fake.fetch })).toMatchObject({ ran: false })
    expect((await status(u)).settings).toMatchObject({ enabled: false, garminLinked: false })
    expect(fake.calls).toEqual([])
  })

  test('disabling without removeSent leaves the events and keeps their ids for later', async () => {
    const { u, planId } = await runner('put-disable@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    const [event] = fake.byDate()
    online()
    fake.forget()

    const res = await put(u, { enabled: false, garminLinked: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ enabled: false, garminLinked: true })
    expect(fake.calls).toEqual([])
    expect(fake.events.size).toBe(1)
    expect(await rowsOf(u)).toMatchObject([{ state: 'withdrawn', remoteId: String(event!.id) }])

    // turning it on again adopts the event that is still there
    await put(u, { enabled: true, garminLinked: true })
    await settleBackground()
    expect(fake.events.size).toBe(1)
    expect(writes()).toEqual([])
    expect(await rowsOf(u)).toMatchObject([{ state: 'sent', remoteId: String(event!.id) }])
  })

  test('disabling with removeSent takes the sent sessions off intervals.icu', async () => {
    const { u, planId } = await runner('put-remove@example.com')
    await place(ctx, planId, [
      { date: tomorrow, kind: 'easy' },
      { date: addDays(today, 4), kind: 'easy' },
    ])
    await sentOnce(u)
    expect(fake.events.size).toBe(2)
    online()
    fake.forget()

    const res = await put(u, { enabled: false, garminLinked: false, removeSent: true })

    expect(res.status).toBe(200)
    expect(fake.events.size).toBe(0)
    expect(writes()).toEqual(['PUT /athlete/i1001/events/bulk-delete'])
    expect(await rowsOf(u)).toMatchObject([{ state: 'withdrawn' }, { state: 'withdrawn' }])
    expect(res.body).toMatchObject({ enabled: false })
  })

  test('a removal that does not go through answers 409 remove-failed and keeps publishing on', async () => {
    const { u, planId } = await runner('put-remove-fail@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    fake.hooks.remove = () => json({ error: `Gateway timeout for ${API_KEY}` }, 504)
    online()

    const res = await put(u, { enabled: false, garminLinked: false, removeSent: true })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      error: {
        code: 'conflict',
        message: expect.stringContaining('could not be removed') as unknown,
        details: { code: 'remove-failed' },
      },
    })
    expect(lintText((res.body as { error: { message: string } }).error.message)).toEqual([])
    expect(fake.events.size).toBe(1)
    expect((await status(u)).settings.enabled).toBe(true)
    expect(await rowsOf(u)).toMatchObject([{ state: 'sent' }])
    expect(JSON.stringify(res.body)).not.toContain(API_KEY)
  })

  test('refuses a removal when the key is not usable', async () => {
    const { u, planId } = await runner('put-remove-auth@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    await ctx.prisma.integration.updateMany({ data: { status: 'needs_auth' } })
    online()
    fake.forget()

    const res = await put(u, { enabled: false, garminLinked: false, removeSent: true })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ error: { details: { requires: 'reconnect-intervals' } } })
    expect(fake.calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// POST /api/wrist/publish
// ---------------------------------------------------------------------------------------------

describe('POST /api/wrist/publish', () => {
  const post = (u: TestUser, body?: unknown) =>
    client(ctx, u)
      .post('/api/wrist/publish')
      .send(body ?? {})

  test('answers 202, clears the back-off of one session and runs in the background', async () => {
    const { u, planId } = await runner('post-one@example.com')
    const [first, second] = await place(ctx, planId, [
      { date: addDays(today, 1), kind: 'easy' },
      { date: addDays(today, 2), kind: 'easy' },
    ])
    fake.hooks.create = () => json({ error: 'Unreadable steps' }, 422)
    await publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'schedule' })
    // three tries in all, then it waits
    for (const minutes of [2, 6]) {
      vi.setSystemTime(at(minutes))
      await publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'schedule' })
    }
    expect(await rowsOf(u)).toMatchObject([
      { failCode: 'rejected', attempts: 3, nextAttemptAt: null },
      { failCode: 'rejected', attempts: 3, nextAttemptAt: null },
    ])
    delete fake.hooks.create
    online()

    const res = await post(u, { sessionId: first!.id })

    expect(res.status).toBe(202)
    expect(res.body).toMatchObject({ enabled: true })
    await settleBackground()
    // only the session that was asked for went; the other still waits
    const byExt = Object.fromEntries((await rowsOf(u)).map((row) => [row.externalId, row]))
    expect(byExt[first!.externalId]).toMatchObject({ state: 'sent', attempts: 0 })
    expect(byExt[second!.externalId]).toMatchObject({ state: 'failed', nextAttemptAt: null })
    expect(fake.events.size).toBe(1)

    // without a session, every waiting one is cleared
    expect((await post(u)).status).toBe(202)
    await settleBackground()
    expect(fake.events.size).toBe(2)
  })

  test('answers 404 for a session outside the active plan, and 409 when it cannot send', async () => {
    const { u, planId } = await runner('post-404@example.com')
    const other = await runner('post-404-other@example.com')
    const [theirs] = await place(ctx, other.planId, [{ date: tomorrow, kind: 'easy' }])
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    online()

    const unknown = await post(u, { sessionId: 'no-such-session' })
    expect(unknown.status).toBe(404)
    expect((await post(u, { sessionId: theirs!.id })).status).toBe(404)
    expect((await post(u, { sessionId: 7 })).status).toBe(400)
    expect((await post(u, { extra: true })).status).toBe(400)

    await ctx.prisma.deliveryChannel.updateMany({
      where: { userId: u.id },
      data: { enabled: false },
    })
    const off = await post(u)
    expect(off.status).toBe(409)
    expect(off.body).toMatchObject({
      error: {
        message: 'Sending to your watch is off. Turn it on under Integrations.',
        details: { requires: 'enable-publishing' },
      },
    })

    const bare = await seedUser(ctx, { email: 'post-bare@example.com' })
    const disconnected = await client(ctx, bare).post('/api/wrist/publish').send({})
    expect(disconnected.status).toBe(409)
    expect(disconnected.body).toMatchObject({
      error: { details: { requires: 'connect-intervals' } },
    })
    expect(fake.calls).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// DELETE /api/integrations/intervals
// ---------------------------------------------------------------------------------------------

describe('DELETE /api/integrations/intervals', () => {
  const remove = (u: TestUser, query = '') =>
    client(ctx, u).delete(`/api/integrations/intervals${query}`)

  test('with removeSent=true takes the sent sessions off first, then drops the integration', async () => {
    const { u, planId } = await runner('delete-remove@example.com', { garminLinked: true })
    await place(ctx, planId, [
      { date: tomorrow, kind: 'easy' },
      { date: addDays(today, 3), kind: 'long', minutes: 90 },
    ])
    await sentOnce(u)
    const ids = fake.byDate().map((event) => String(event.id))
    online()
    fake.forget()

    const res = await remove(u, '?removeSent=true')

    expect(res.status).toBe(204)
    expect(fake.events.size).toBe(0)
    expect(writes()).toEqual(['PUT /athlete/i1001/events/bulk-delete'])
    expect(await ctx.prisma.integration.count({ where: { userId: u.id } })).toBe(0)
    expect(
      await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } }),
    ).toMatchObject({
      enabled: false,
      garminLinked: false,
      referenceJson: null,
    })
    // the ids stay, for a later adoption
    expect((await rowsOf(u)).map((row) => [row.state, row.remoteId]).sort()).toEqual(
      ids.map((id) => ['withdrawn', id]).sort(),
    )
  })

  test('a removal that fails answers 409 remove-failed and keeps the integration', async () => {
    const { u, planId } = await runner('delete-fail@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    fake.hooks.remove = () => json({}, 503)
    online()

    const res = await remove(u, '?removeSent=true')

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      error: { code: 'conflict', details: { code: 'remove-failed' } },
    })
    expect(await ctx.prisma.integration.count({ where: { userId: u.id } })).toBe(1)
    expect(
      await ctx.prisma.deliveryChannel.findFirstOrThrow({ where: { userId: u.id } }),
    ).toMatchObject({
      enabled: true,
    })
    expect(await rowsOf(u)).toMatchObject([{ state: 'sent' }])
    expect(fake.events.size).toBe(1)

    // the runner can still disconnect without removing them
    delete fake.hooks.remove
    fake.forget()
    expect((await remove(u)).status).toBe(204)
    expect(fake.calls).toEqual([])
    expect(fake.events.size).toBe(1)
  })

  test('a removal that takes longer than the cap is a failure; the cap is 20 seconds', async () => {
    expect(REMOVE_TIMEOUT_MS).toBe(20_000)
    const { u, planId } = await runner('delete-slow@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    // a request that never answers; only the abort signal the app passes can end it
    const hang: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    await expect(
      prepareDisconnect(ctx, u.id, { removeSent: true, fetch: hang, timeoutMs: 40 }),
    ).rejects.toMatchObject({ status: 409, details: { code: 'remove-failed' } })
    await expect(
      setPublishing(
        ctx,
        u.id,
        { enabled: false, garminLinked: false, removeSent: true },
        { fetch: hang, timeoutMs: 40 },
      ),
    ).rejects.toMatchObject({ status: 409, details: { code: 'remove-failed' } })
    // nothing changed
    expect(await ctx.prisma.integration.count({ where: { userId: u.id } })).toBe(1)
    expect((await status(u)).settings.enabled).toBe(true)
    expect(fake.events.size).toBe(1)
  })

  test('without removeSent it drops the key and leaves the events', async () => {
    const { u, planId } = await runner('delete-keep@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    online()
    fake.forget()

    expect((await remove(u)).status).toBe(204)
    expect((await remove(u, '?removeSent=false')).status).toBe(204)

    expect(fake.calls).toEqual([])
    expect(fake.events.size).toBe(1)
    expect(await ctx.prisma.integration.count({ where: { userId: u.id } })).toBe(0)
    expect(await rowsOf(u)).toMatchObject([
      { state: 'withdrawn', remoteId: expect.any(String) as unknown },
    ])
    // publishing is off, so the scheduler has nothing to do
    expect(await publishForUser(ctx, u.id, { fetch: fake.fetch })).toMatchObject({ ran: false })
  })

  test('a runner who never turned publishing on disconnects without a channel row appearing', async () => {
    const { u } = await runner('delete-never@example.com', { enabled: false })
    online()

    expect((await remove(u, '?removeSent=true')).status).toBe(204)

    expect(await ctx.prisma.integration.count({ where: { userId: u.id } })).toBe(0)
    expect(await ctx.prisma.deliveryChannel.count({ where: { userId: u.id } })).toBe(0)
    expect(fake.calls).toEqual([])
  })

  test('refuses an unknown query value, and other providers ignore the whole thing', async () => {
    const { u } = await runner('delete-query@example.com')
    expect((await remove(u, '?removeSent=maybe')).status).toBe(400)
    expect((await remove(u, '?other=1')).status).toBe(400)
    await ctx.prisma.integration.create({
      data: {
        userId: u.id,
        provider: 'strava',
        status: 'connected',
        secret: 'x',
        config: '{}',
      },
    })
    expect((await client(ctx, u).delete('/api/integrations/strava')).status).toBe(204)
    expect(
      await ctx.prisma.integration.count({ where: { userId: u.id, provider: 'intervals' } }),
    ).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------------------------

describe('the health note about tomorrow', () => {
  const getToday = (u: TestUser) => client(ctx, u).get('/api/today')
  const notes = async (u: TestUser) => {
    const res = await getToday(u)
    expect(res.status).toBe(200)
    return (res.body as TodayView).coach.health.notes
  }

  test('appears when tomorrow is not on the watch, in words, and not otherwise', async () => {
    const { u, planId } = await runner('note@example.com')
    await place(ctx, planId, [
      { date: today, kind: 'easy' },
      { date: tomorrow, kind: 'easy' },
    ])
    expect(await notes(u)).toEqual([])
    // not yet tried: nothing to say, the next run does it within minutes
    await sentOnce(u)
    expect(await notes(u)).toEqual([])

    // tomorrow's send fails
    fake.hooks.update = () => json({ error: 'Unreadable steps' }, 422)
    // a new maximum heart rate changes the text of both sessions, so both are sent again
    await ctx.prisma.athleteProfile.update({ where: { userId: u.id }, data: { hrMax: 188 } })
    await publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'manual' })
    const found = await notes(u)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ code: 'wrist-tomorrow', href: '/plan' })
    const text = renderFact(found[0]!, 'km')
    expect(text).toBe(
      "Tomorrow's run is not on the watch yet. Open the plan to send it again or to download the workout file.",
    )
    expect(lintText(text)).toEqual([])

    // the device refuses it: also a note
    delete fake.hooks.update
    vi.setSystemTime(at(3))
    await publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'manual' })
    expect(await notes(u)).toEqual([])
    fake.byDate()[1]!.push_errors = ['Garmin Connect refused the workout.']
    await publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'manual' })
    expect(await notes(u)).toHaveLength(1)

    // and none once publishing is off: the rows are withdrawn
    expect(
      (
        await client(ctx, u)
          .put('/api/wrist/intervals')
          .send({ enabled: false, garminLinked: false })
      ).status,
    ).toBe(200)
    expect(await notes(u)).toEqual([])
  })

  test('changes the page tag, so a client holding the old one is not told nothing changed', async () => {
    const { u, planId } = await runner('note-tag@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    const first = await getToday(u)
    const tag = String(first.headers.etag)
    expect((await getToday(u).set('If-None-Match', tag)).status).toBe(304)

    // only the publication rows change: no state is written
    vi.setSystemTime(at(1))
    await ctx.prisma.wristPublication.updateMany({
      data: { state: 'failed', failCode: 'rejected', failMessage: 'x', nextAttemptAt: null },
    })
    const after = await getToday(u).set('If-None-Match', tag)
    expect(after.status).toBe(200)
    expect((after.body as TodayView).coach.health.notes).toHaveLength(1)
    expect((await getToday(u).set('If-None-Match', String(after.headers.etag))).status).toBe(304)

    // and turning publishing off moves it too
    await client(ctx, u).put('/api/wrist/intervals').send({ enabled: false, garminLinked: false })
    expect((await getToday(u).set('If-None-Match', String(after.headers.etag))).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------------

describe('the key', () => {
  test('reaches no response, no row and no log line, even when intervals.icu echoes it', async () => {
    const { u, planId } = await runner('secret-routes@example.com')
    await place(ctx, planId, [{ date: tomorrow, kind: 'easy' }])
    await sentOnce(u)
    // a second session whose creation is refused with the key and the header echoed back
    await place(ctx, planId, [{ date: addDays(today, 3), kind: 'easy' }])
    const echo = (status: number) => (req: Request) =>
      json(
        { error: `Rejected ${req.headers.get('authorization') ?? ''} with key ${API_KEY}` },
        status,
      )
    fake.hooks.create = echo(422)
    await publishForUser(ctx, u.id, { fetch: fake.fetch, trigger: 'manual' })
    expect((await rowsOf(u)).some((row) => row.state === 'failed')).toBe(true)

    // and a removal that is refused the same way
    fake.hooks.remove = echo(400)
    online()
    const refused = await client(ctx, u)
      .put('/api/wrist/intervals')
      .send({ enabled: false, garminLinked: false, removeSent: true })
    expect(refused.status).toBe(409)

    const bodies = [
      refused.body,
      (await client(ctx, u).get('/api/wrist/status')).body,
      (await client(ctx, u).get('/api/integrations')).body,
      (await client(ctx, u).get('/api/integrations/intervals/runs')).body,
      (await client(ctx, u).get('/api/jobs')).body,
    ]
    const seen = JSON.stringify({
      bodies,
      rows: await rowsOf(u),
      runs: await ctx.prisma.syncRun.findMany({ where: { userId: u.id } }),
      channels: await ctx.prisma.deliveryChannel.findMany({ where: { userId: u.id } }),
    })
    const lines = logged.lines.join('')
    const basic = Buffer.from(`API_KEY:${API_KEY}`).toString('base64')
    for (const secret of [API_KEY, basic]) {
      expect(seen).not.toContain(secret)
      expect(lines).not.toContain(secret)
    }
    // positive controls: the echo was read and kept without the key, and the log was captured
    expect((await rowsOf(u)).find((row) => row.state === 'failed')?.failMessage).toContain(
      'Rejected',
    )
    expect(lines).toContain('removing the sent sessions from intervals.icu failed')
  })
})
