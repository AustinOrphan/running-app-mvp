import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { prescribe } from '../../shared/engine/sessions.ts'
import { rungSessions, sessionMin } from '../../shared/engine/startWeeks.ts'
import type { SessionKind } from '../../shared/engine/types.ts'
import type { PlanSessionStatus, PlanWithSessions, WristStatus } from '../../shared/types.ts'
import { PUBLIC_TITLES } from '../../shared/workouts/labels.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { buildDeliverables } from '../../server/services/workouts.ts'
import { weekFixture, zoneSetFixture } from '../unit/engine/fixtures.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The private calendar feed (design 6.4 and 6.5, ADR 0008): a link behind a hashed token, opened
// by a calendar app with no cookie, no Origin and no body. These tests cover the token's life
// (made once, stored as a hash, replaced, revoked), the answers (404 for any wrong token, a limit
// on refusals), the log (the route, never the token) and the document (the next 28 days, titles
// from the allowlist, nothing about health, the same bytes for the same plan).

// The builder is the real one; the spy shows how often the feed asks for it.
vi.mock('../../server/services/workouts.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/workouts.ts')>()
  return { ...original, buildDeliverables: vi.fn(original.buildDeliverables) }
})

// Every line the server logs, at every level (the real logger is silent under test), with the
// real serializers of the app, so a test can prove the token never reached one.
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

// A Wednesday at noon; only Date is faked, so the database and the promises keep working.
const NOW = new Date(2026, 9, 21, 12)
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOW)

const today = todayIso()
const thisMonday = mondayOf(today)
const day = (offset: number) => addDays(today, offset)

let ctx: TestCtx

beforeEach(async () => {
  vi.setSystemTime(NOW)
  logged.lines.length = 0
  ctx = await createTestCtx()
  vi.mocked(buildDeliverables).mockClear()
})

afterEach(async () => {
  expectNoRefusedFetches(ctx)
  await ctx.close()
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

async function seedHistory(userId: string): Promise<void> {
  const week = [
    { dow: 1, min: 40, distanceM: 6400 },
    { dow: 3, min: 45, distanceM: 7200 },
    { dow: 5, min: 35, distanceM: 5600 },
    { dow: 6, min: 70, distanceM: 11_000 },
  ]
  const rows = []
  for (let w = 1; w <= 12; w += 1) {
    for (const run of week) {
      rows.push({
        userId,
        date: addDays(thisMonday, -7 * w + run.dow),
        type: 'run',
        durationSec: run.min * 60,
        movingSec: run.min * 60,
        distanceM: run.distanceM,
        rpe: 3,
        source: 'manual',
      })
    }
  }
  await ctx.prisma.activity.createMany({ data: rows })
}

/** A runner with zones, a history and the plan the engine builds for a race six weeks out. */
async function runner(email = 'runner@example.com'): Promise<{ u: TestUser; planId: string }> {
  const u = await seedUser(ctx, { email, units: 'km' })
  await ctx.prisma.athleteProfile.create({
    data: { userId: u.id, hrMax: 190, hrMaxSource: 'measured', hrRest: 50 },
  })
  await seedHistory(u.id)
  await ctx.prisma.activity.create({
    data: {
      userId: u.id,
      date: addDays(today, -30),
      type: 'race',
      durationSec: 3300,
      movingSec: 3300,
      distanceM: 10_000,
      rpe: 9,
      source: 'manual',
    },
  })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 6 + 5),
      distanceM: 21_097,
      goalType: 'finish',
    },
  })
  const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return { u, planId: (res.body as PlanWithSessions).id }
}

interface Placed {
  kind: SessionKind
  minutes?: number
  status?: PlanSessionStatus
  title?: string
  flags?: string[]
  blueprint?: readonly number[]
}

/** Replaces every session of `date` by the given ones, written the way the engine writes them. */
async function onlyOn(planId: string, date: string, placed: Placed[]) {
  await ctx.prisma.planSession.deleteMany({ where: { planId, date } })
  const rows = []
  for (const [index, p] of placed.entries()) {
    const spec = prescribe(
      p.kind,
      p.minutes ?? 60,
      zoneSetFixture(),
      weekFixture(),
      p.blueprint === undefined ? { goalPaceSecPerKm: 330 } : { blueprint: p.blueprint },
    )
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId,
          externalId: randomUUID(),
          weekStart: mondayOf(date),
          date,
          order: index + 1,
          kind: p.kind,
          title: p.title ?? spec.title,
          durationMin: spec.durationMin,
          distanceM: spec.distanceM,
          gainM: spec.gainM,
          structure: JSON.stringify(spec.structure),
          target: JSON.stringify(spec.target),
          purpose: spec.purpose,
          rules: JSON.stringify(spec.rules),
          flags: JSON.stringify(p.flags ?? spec.flags),
          status: p.status ?? 'planned',
        },
      }),
    )
  }
  return rows
}

/** Empties the plan, so that a test places the only sessions it looks at. */
async function emptyPlan(planId: string): Promise<void> {
  await ctx.prisma.planSession.deleteMany({ where: { planId } })
}

/** The link as the app hands it out. */
async function makeLink(u: TestUser): Promise<{ token: string; path: string }> {
  const res = await client(ctx, u).post('/api/wrist/calendar/token').send({})
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as { token: string; path: string }
}

/** What a calendar app sends: a GET with no cookie, no Origin and no body. */
async function open(path: string) {
  return request(ctx.app).get(path)
}

/**
 * A GET whose request target is sent as written. Superagent prefixes the target with the test
 * server's origin; a proxy may send the absolute form (`GET http://host/path`) instead.
 */
async function openTarget(target: string): Promise<number> {
  const server = createServer(ctx.app).listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const { port } = server.address() as AddressInfo
    return await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: target, method: 'GET', headers: { connection: 'close' } },
        (res) => {
          res.resume()
          res.on('end', () => resolve(res.statusCode ?? 0))
        },
      )
      req.on('error', reject)
      req.end()
    })
  } finally {
    // closed once the connection has ended, which is after the server has logged the request
    await new Promise((resolve) => server.close(resolve))
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
const tagOf = (userId: string) => sha256(userId).slice(0, 6)

interface Vevent {
  uid: string
  start: string
  end: string
  stamp: string
  summary: string
  description: string | null
}

const unescapeText = (text: string) =>
  text.replace(/\\(.)/g, (_all, c: string) => (c === 'n' ? '\n' : c))

/** The events of a feed, with folded lines joined and text escapes undone. */
function eventsOf(text: string): Vevent[] {
  const lines = text.replaceAll('\r\n ', '').split('\r\n')
  const events: Vevent[] = []
  let current: Record<string, string> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = {}
    else if (line === 'END:VEVENT' && current) {
      events.push({
        uid: current.UID!,
        start: current['DTSTART;VALUE=DATE']!,
        end: current['DTEND;VALUE=DATE']!,
        stamp: current.DTSTAMP!,
        summary: unescapeText(current.SUMMARY!),
        description: current.DESCRIPTION === undefined ? null : unescapeText(current.DESCRIPTION),
      })
      current = null
    } else if (current) {
      const at = line.indexOf(':')
      current[line.slice(0, at)] = line.slice(at + 1)
    }
  }
  return events
}

/** `YYYY-MM-DD` as the `YYYYMMDD` of a date value. */
const compact = (date: string) => date.replaceAll('-', '')

const icsStamp = (at: Date) =>
  at
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')

/** The feed of a runner as the calendar app reads it: text and events. */
async function feedOf(u: TestUser) {
  const link = await makeLink(u)
  const res = await open(link.path)
  expect(res.status, res.text).toBe(200)
  return { res, text: res.text, events: eventsOf(res.text), link }
}

// ---------------------------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------------------------

describe('POST and DELETE /api/wrist/calendar/token', () => {
  test('need the session', async () => {
    expect((await client(ctx).post('/api/wrist/calendar/token').send({})).status).toBe(401)
    expect((await client(ctx).delete('/api/wrist/calendar/token')).status).toBe(401)
  })

  test('hand out a token once, and keep only its hash', async () => {
    const u = await seedUser(ctx)
    const res = await client(ctx, u).post('/api/wrist/calendar/token').send({})
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    const issued = res.body as { token: string; path: string; createdAt: string }
    expect(issued.token).toMatch(/^[\w-]{43}$/)
    expect(issued.path).toBe(`/api/calendar/${issued.token}/plan.ics`)
    expect(new Date(issued.createdAt).toISOString()).toBe(issued.createdAt)

    const rows = await ctx.prisma.deliveryChannel.findMany()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      userId: u.id,
      channel: 'calendar',
      enabled: true,
      tokenHash: sha256(issued.token),
    })
    expect(rows[0]!.tokenCreatedAt?.toISOString()).toBe(issued.createdAt)
    // the token is nowhere in the row, and no other table of the channels carries it
    expect(JSON.stringify(rows)).not.toContain(issued.token)
    expect(JSON.stringify(await ctx.prisma.wristPublication.findMany())).not.toContain(issued.token)
    expect(JSON.stringify(await ctx.prisma.syncRun.findMany())).not.toContain(issued.token)
  })

  test('make no Integration row and no provider entry', async () => {
    const u = await seedUser(ctx)
    await makeLink(u)
    expect(await ctx.prisma.integration.count()).toBe(0)
    const list = await client(ctx, u).get('/api/integrations')
    expect(list.status).toBe(200)
    const providers = (list.body as Array<{ provider?: string; key?: string }>).map(
      (p) => p.provider ?? p.key,
    )
    expect(providers).not.toContain('calendar')
    expect((await client(ctx, u).get('/api/integrations/calendar/runs')).status).toBe(404)
  })

  test('replace the link: the old token ends at once and the new one opens the feed', async () => {
    const u = await seedUser(ctx)
    const first = await makeLink(u)
    expect((await open(first.path)).status).toBe(200)
    const second = await makeLink(u)
    expect(second.token).not.toBe(first.token)
    expect((await open(first.path)).status).toBe(404)
    expect((await open(second.path)).status).toBe(200)
    expect(await ctx.prisma.deliveryChannel.count()).toBe(1)
    expect((await ctx.prisma.deliveryChannel.findFirst())?.tokenHash).toBe(sha256(second.token))
  })

  test('are read back as the state of the link in the wrist status, never as the token', async () => {
    const u = await seedUser(ctx)
    const calendarOf = async () => {
      const res = await client(ctx, u).get('/api/wrist/status')
      expect(res.status).toBe(200)
      return { calendar: (res.body as WristStatus).calendar, text: JSON.stringify(res.body) }
    }
    expect((await calendarOf()).calendar).toEqual({ enabled: false, tokenCreatedAt: null })

    const res = await client(ctx, u).post('/api/wrist/calendar/token').send({})
    const issued = res.body as { token: string; createdAt: string }
    const made = await calendarOf()
    expect(made.calendar).toEqual({ enabled: true, tokenCreatedAt: issued.createdAt })
    expect(made.text).not.toContain(issued.token)

    await client(ctx, u).delete('/api/wrist/calendar/token')
    expect((await calendarOf()).calendar).toEqual({ enabled: false, tokenCreatedAt: null })
  })

  test('revoke the link, and a second revoke or one without a link changes nothing', async () => {
    const u = await seedUser(ctx)
    const link = await makeLink(u)
    expect((await client(ctx, u).delete('/api/wrist/calendar/token')).status).toBe(204)
    expect((await open(link.path)).status).toBe(404)
    expect(await ctx.prisma.deliveryChannel.findFirst()).toMatchObject({
      channel: 'calendar',
      enabled: false,
      tokenHash: null,
      tokenCreatedAt: null,
    })
    expect((await client(ctx, u).delete('/api/wrist/calendar/token')).status).toBe(204)
    const other = await seedUser(ctx, { email: 'other@example.com' })
    expect((await client(ctx, other).delete('/api/wrist/calendar/token')).status).toBe(204)
    expect(await ctx.prisma.deliveryChannel.count()).toBe(1)
  })

  test('revoking one runner leaves another runner’s link alone', async () => {
    const a = await seedUser(ctx, { email: 'a@example.com' })
    const b = await seedUser(ctx, { email: 'b@example.com' })
    const linkA = await makeLink(a)
    const linkB = await makeLink(b)
    await client(ctx, a).delete('/api/wrist/calendar/token')
    expect((await open(linkA.path)).status).toBe(404)
    expect((await open(linkB.path)).status).toBe(200)
  })

  test('leave the data version where it was: the channel is not state', async () => {
    const u = await seedUser(ctx)
    const before = (await dataVersionKey(ctx.prisma)).n
    const link = await makeLink(u)
    await makeLink(u)
    await open(link.path)
    await client(ctx, u).delete('/api/wrist/calendar/token')
    expect((await dataVersionKey(ctx.prisma)).n).toBe(before)
  })
})

// ---------------------------------------------------------------------------------------------
// The answers
// ---------------------------------------------------------------------------------------------

describe('GET /api/calendar/:token/plan.ics', () => {
  test('opens with no cookie, no Origin and no body, and says how it may be handled', async () => {
    const { u } = await runner()
    const { res } = await feedOf(u)
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['referrer-policy']).toBe('no-referrer')
    expect(res.headers['x-robots-tag']).toBe('noindex')
    expect(res.text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(res.text.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })

  test('answers 404, not 401, with the body of any unknown route, for every wrong token', async () => {
    const u = await seedUser(ctx)
    await makeLink(u)
    const unknownRoute = await client(ctx, u).get('/api/no-such-route')
    expect(unknownRoute.status).toBe(404)
    const wrong = [
      'A'.repeat(43), // the right shape, no such hash
      'short',
      'x'.repeat(200),
      '..%2F..%2Fetc',
      '%00',
    ]
    for (const token of wrong) {
      const res = await open(`/api/calendar/${token}/plan.ics`)
      expect(res.status, token).toBe(404)
      expect(res.body, token).toEqual(unknownRoute.body)
    }
    // a session cookie does not open it either: the feed is the token's alone
    const withCookie = await request(ctx.app)
      .get(`/api/calendar/${'A'.repeat(43)}/plan.ics`)
      .set('Cookie', u.cookie)
    expect(withCookie.status).toBe(404)
  })

  test('is a GET only: other methods and other files are not served', async () => {
    const u = await seedUser(ctx)
    const link = await makeLink(u)
    const post = await request(ctx.app).post(link.path).send({})
    expect([401, 403, 404]).toContain(post.status)
    const other = await open(link.path.replace('plan.ics', 'other.ics'))
    expect(other.status).not.toBe(200)
    expect(other.text).not.toContain('BEGIN:VCALENDAR')
  })

  test('limits refusals like sign-in: ten answers of 404, then 429 for the same address', async () => {
    const u = await seedUser(ctx)
    const link = await makeLink(u)
    for (let i = 0; i < 10; i += 1) {
      expect((await open(`/api/calendar/${String(i).padStart(43, 'B')}/plan.ics`)).status).toBe(404)
    }
    const limited = await open(`/api/calendar/${'C'.repeat(43)}/plan.ics`)
    expect(limited.status).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
    expect(limited.body).toMatchObject({ error: { code: 'unauthorized' } })
    // the guesser's address is out, even for the right token, until the window has passed
    expect((await open(link.path)).status).toBe(429)
  })

  test('does not count the requests it answers: a calendar app may poll all day', async () => {
    const u = await seedUser(ctx)
    const link = await makeLink(u)
    for (let i = 0; i < 25; i += 1) expect((await open(link.path)).status).toBe(200)
    for (let i = 0; i < 10; i += 1) {
      expect((await open(`/api/calendar/${String(i).padStart(43, 'D')}/plan.ics`)).status).toBe(404)
    }
    expect((await open(`/api/calendar/${'E'.repeat(43)}/plan.ics`)).status).toBe(429)
  })

  test('is an empty calendar for a runner with no plan', async () => {
    const u = await seedUser(ctx)
    const { text, events } = await feedOf(u)
    expect(events).toEqual([])
    expect(text).toContain('BEGIN:VCALENDAR')
    expect(text).not.toContain('VEVENT')
  })

  test('shows each runner their own plan only', async () => {
    const a = await runner('a@example.com')
    const b = await runner('b@example.com')
    const [rowA] = await onlyOn(a.planId, day(2), [{ kind: 'easy', minutes: 30 }])
    const [rowB] = await onlyOn(b.planId, day(3), [{ kind: 'long', minutes: 90 }])
    const feedA = await feedOf(a.u)
    const feedB = await feedOf(b.u)
    const uidA = `rl-${tagOf(a.u.id)}-${rowA!.externalId}@running-log`
    const uidB = `rl-${tagOf(b.u.id)}-${rowB!.externalId}@running-log`
    expect(feedA.events.map((e) => e.uid)).toContain(uidA)
    expect(feedA.events.map((e) => e.uid)).not.toContain(uidB)
    expect(feedB.events.map((e) => e.uid)).toContain(uidB)
    expect(feedB.text).not.toContain(rowA!.externalId)
  })

  test('reads the snapshot and one deliverable build, and nothing from the network', async () => {
    const { u } = await runner()
    const link = await makeLink(u)
    vi.mocked(buildDeliverables).mockClear()
    expect((await open(link.path)).status).toBe(200)
    expect(vi.mocked(buildDeliverables)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(buildDeliverables).mock.calls[0]![2]).toEqual({
      from: today,
      to: day(27),
      today,
    })
    // `afterEach` fails the test if a request reached the network guard
  })
})

// ---------------------------------------------------------------------------------------------
// The access log
// ---------------------------------------------------------------------------------------------

describe('the access log', () => {
  test('names the route and never holds the token, a right one or a wrong one', async () => {
    const { u } = await runner()
    const link = await makeLink(u)
    const wrong = 'W'.repeat(43)
    expect((await open(link.path)).status).toBe(200)
    expect((await open(`/api/calendar/${wrong}/plan.ics`)).status).toBe(404)
    // Express matches the mount path without regard to case, so the redaction has to as well
    expect((await open(link.path.replace('/api/calendar/', '/API/Calendar/'))).status).toBe(200)

    const log = logged.lines.join('')
    expect(log).toContain('/api/calendar/:token/plan.ics')
    expect(log).not.toContain(link.token)
    expect(log).not.toContain(wrong)
    // the lines are JSON about these requests, not an empty capture
    const urls = logged.lines
      .map((line) => (JSON.parse(line) as { req?: { url?: string } }).req?.url ?? '')
      .filter((url) => url.toLowerCase().startsWith('/api/calendar/'))
    expect(urls).toHaveLength(3)
    for (const url of urls) expect(url.toLowerCase()).toBe('/api/calendar/:token/plan.ics')
  })

  test('holds no token for an absolute-form request target or an extra slash either', async () => {
    const { u } = await runner()
    const link = await makeLink(u)
    // A proxy may send the absolute form, which Express routes to the feed.
    expect(await openTarget(`http://app.test${link.path}`)).toBe(200)
    // An extra slash after the mount path misses the feed, but the URL still carries the token.
    const doubled = link.path.replace('/api/calendar/', '/api/calendar//')
    expect(await openTarget(doubled)).not.toBe(200)

    const log = logged.lines.join('')
    expect(log).not.toContain(link.token)
    const urls = logged.lines
      .map((line) => (JSON.parse(line) as { req?: { url?: string } }).req?.url ?? '')
      .filter((url) => url.includes('/api/calendar/'))
    expect(urls.sort()).toEqual(
      ['http://app.test/api/calendar/:token/plan.ics', '/api/calendar//:token/plan.ics'].sort(),
    )
  })

  test('keeps the other routes’ URLs as they are', async () => {
    const u = await seedUser(ctx)
    await client(ctx, u).get('/api/plan?x=1')
    expect(logged.lines.join('')).toContain('/api/plan?x=1')
  })

  test('does not log the token it hands out', async () => {
    const u = await seedUser(ctx)
    const link = await makeLink(u)
    expect(logged.lines.join('')).not.toContain(link.token)
  })
})

// ---------------------------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------------------------

describe('the events of the feed', () => {
  test('list the next 28 days, today through today + 27, as all-day events by date and order', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    await onlyOn(planId, day(-1), [{ kind: 'easy', minutes: 30 }]) // yesterday
    await onlyOn(planId, day(0), [{ kind: 'easy', minutes: 45 }])
    await onlyOn(planId, day(1), [
      { kind: 'strength', minutes: 30 },
      { kind: 'easy', minutes: 40 },
    ])
    await onlyOn(planId, day(27), [{ kind: 'long', minutes: 150 }])
    await onlyOn(planId, day(28), [{ kind: 'easy', minutes: 30 }]) // one past the window

    const { events } = await feedOf(u)
    expect(events.map((e) => [e.start, e.end, e.summary])).toEqual([
      [compact(day(0)), compact(day(1)), 'Easy run, 45 min'],
      [compact(day(1)), compact(day(2)), 'Strength, 30 min'],
      [compact(day(1)), compact(day(2)), 'Easy run, 40 min'],
      [compact(day(27)), compact(day(28)), 'Long run, 2 h 30 min'],
    ])
  })

  test('leave out done and skipped sessions, keep moved, trimmed and shortened ones', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    await onlyOn(planId, day(1), [{ kind: 'easy', minutes: 31, status: 'completed' }])
    await onlyOn(planId, day(2), [{ kind: 'easy', minutes: 32, status: 'partial' }])
    await onlyOn(planId, day(3), [{ kind: 'easy', minutes: 33, status: 'skipped' }])
    await onlyOn(planId, day(4), [{ kind: 'long', minutes: 90, status: 'moved' }])
    await onlyOn(planId, day(5), [{ kind: 'easy', minutes: 35, status: 'downgraded' }])
    await onlyOn(planId, day(6), [{ kind: 'easy', minutes: 36, status: 'adjusted' }])
    await onlyOn(planId, day(7), [{ kind: 'strength', minutes: 20, status: 'skipped' }])
    const { events } = await feedOf(u)
    expect(events.map((e) => e.summary)).toEqual([
      'Long run, 1 h 30 min',
      'Easy run, 35 min',
      'Easy run, 36 min',
    ])
  })

  test('give a race a bare “Race day”, and a rest day or a rest window no event', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    await onlyOn(planId, day(9), [{ kind: 'race', minutes: 600, title: 'Synthetic Half Marathon' }])
    await onlyOn(planId, day(3), [{ kind: 'rest', title: 'Rest: illness', flags: ['rest-window'] }])
    await onlyOn(planId, day(4), [{ kind: 'rest' }])
    await onlyOn(planId, day(5), [
      { kind: 'mobility', minutes: 15 },
      { kind: 'cross', minutes: 50 },
    ])
    const { events } = await feedOf(u)
    expect(events.map((e) => e.summary)).toEqual([
      'Mobility, 15 min',
      'Cross-training, 50 min',
      'Race day',
    ])
    const race = events.at(-1)!
    expect(race.description).toBeNull()
    expect(race.start).toBe(compact(day(9)))
  })

  test('title a run with the allowlist and outline it with words and no figure', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    await onlyOn(planId, day(2), [{ kind: 'intervals', minutes: 60 }])
    await onlyOn(planId, day(3), [{ kind: 'easy', minutes: 45 }])
    await onlyOn(planId, day(4), [{ kind: 'hike', minutes: 90 }])
    const { events } = await feedOf(u)
    expect(events.map((e) => [e.summary, e.description])).toEqual([
      ['Intervals, 1 h', 'Warm up\nRepeat: Fast, at target pace; Recover\nCool down'],
      ['Easy run, 45 min', 'Run, kept easy'],
      ['Hike, 1 h 30 min', 'Hike, by effort'],
    ])
    for (const e of events) expect(e.description, e.summary).not.toMatch(/\d/)
  })

  test('take the UID from the session identity, so a move keeps it', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    const [row] = await onlyOn(planId, day(2), [{ kind: 'long', minutes: 90 }])
    const uid = `rl-${tagOf(u.id)}-${row!.externalId}@running-log`
    const before = (await feedOf(u)).events
    expect(before.map((e) => [e.uid, e.start])).toEqual([[uid, compact(day(2))]])

    // an owner move, within the week, through the route
    const moveTo = [day(3), day(4), day(5), day(6), day(1)].find(
      (d) => d > today && mondayOf(d) === mondayOf(day(2)),
    )!
    const moved = await client(ctx, u).put(`/api/plan/sessions/${row!.id}`).send({ date: moveTo })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    const after = await open((await makeLink(u)).path)
    expect(eventsOf(after.text).map((e) => [e.uid, e.start, e.summary])).toEqual([
      [uid, compact(moveTo), 'Long run, 1 h 30 min'],
    ])
  })

  test('stamp every event with the newest update in the window, never the clock', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    const [a, b] = await onlyOn(planId, day(2), [
      { kind: 'easy', minutes: 30 },
      { kind: 'easy', minutes: 40 },
    ])
    const [outside] = await onlyOn(planId, day(28), [{ kind: 'easy', minutes: 50 }])
    const touch = (id: string, iso: string) =>
      ctx.prisma.planSession.update({ where: { id }, data: { updatedAt: new Date(iso) } })
    await touch(a!.id, '2026-10-01T08:00:00Z')
    await touch(b!.id, '2026-10-15T09:30:15Z')
    await touch(outside!.id, '2026-10-20T10:00:00Z') // newer, but not in the window

    const first = await feedOf(u)
    expect(first.events.map((e) => e.stamp)).toEqual(['20261015T093015Z', '20261015T093015Z'])

    // the clock moves on; the feed does not
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 3_600_000))
    const second = await open(first.link.path)
    expect(second.text).toBe(first.text)
    expect((await open(first.link.path)).text).toBe(first.text)
    vi.setSystemTime(NOW)

    // a change to a session of the window moves the stamp
    await touch(a!.id, '2026-10-19T07:00:00Z')
    const third = await open(first.link.path)
    expect(eventsOf(third.text).map((e) => e.stamp)).toEqual([
      '20261019T070000Z',
      '20261019T070000Z',
    ])
  })

  test('stamp a skip with the time of the skip', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    const [kept, skipped] = await onlyOn(planId, day(3), [
      { kind: 'easy', minutes: 30 },
      { kind: 'easy', minutes: 40 },
    ])
    await ctx.prisma.planSession.updateMany({
      where: { planId },
      data: { updatedAt: new Date('2026-10-01T00:00:00Z') },
    })
    const link = await makeLink(u)
    expect(eventsOf((await open(link.path)).text).map((e) => e.stamp)).toEqual([
      '20261001T000000Z',
      '20261001T000000Z',
    ])
    const res = await client(ctx, u).put(`/api/plan/sessions/${skipped!.id}`).send({ skip: true })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const after = eventsOf((await open(link.path)).text)
    expect(after.map((e) => e.uid.includes(kept!.externalId))).toEqual([true])
    // the skipped session left the feed and its update is still the newest of the window
    expect(after[0]!.stamp).toBe(icsStamp(NOW))
  })

  test('carry the runner’s time zone from the profile as the calendar’s own', async () => {
    const { u, planId } = await runner()
    await onlyOn(planId, day(2), [{ kind: 'easy' }])
    await ctx.prisma.athleteProfile.update({
      where: { userId: u.id },
      data: { timezone: 'America/Chicago' },
    })
    const link = await makeLink(u)
    const text = (await open(link.path)).text
    expect(text).toContain('\r\nX-WR-TIMEZONE:America/Chicago\r\n')
    // events are dates: no time and no zone on a start or an end
    expect(text).not.toMatch(/DT(START|END)(;TZID|:\d{8}T)/)

    // a name the runtime does not know is left out, not written
    await ctx.prisma.athleteProfile.update({
      where: { userId: u.id },
      data: { timezone: 'Not/AZone' },
    })
    expect((await open(link.path)).text).not.toContain('X-WR-TIMEZONE')
  })

  test('give the same bytes every time for the same plan', async () => {
    const { u } = await runner()
    const link = await makeLink(u)
    const first = (await open(link.path)).text
    expect(eventsOf(first).length).toBeGreaterThan(5)
    for (let i = 0; i < 3; i += 1) expect((await open(link.path)).text).toBe(first)
    // and a token made later opens the same document
    expect((await open((await makeLink(u)).path)).text).toBe(first)
  })
})

describe('the feed on a day readiness changes', () => {
  test('holds the easy version of a quality session eased today, and says nothing of why', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    await onlyOn(planId, day(0), [{ kind: 'threshold', minutes: 60 }])
    await onlyOn(planId, day(1), [{ kind: 'intervals', minutes: 60 }])
    const link = await makeLink(u)
    expect(eventsOf((await open(link.path)).text).map((e) => e.summary)).toEqual([
      'Threshold run, 1 h',
      'Intervals, 1 h',
    ])

    expect((await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 6 })).status).toBe(
      200,
    )
    const eased = await open(link.path)
    expect(eventsOf(eased.text).map((e) => [e.summary, e.description])).toEqual([
      ['Easy run, 1 h', 'Run, kept easy'],
      // tomorrow is not pre-eased: that is a statement about today
      ['Intervals, 1 h', 'Warm up\nRepeat: Fast, at target pace; Recover\nCool down'],
    ])
    expect(eased.text).not.toMatch(/eased|pain|readiness|signal|reason/i)
  })

  test('leaves out a run that readiness takes off today, and keeps tomorrow’s', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    await onlyOn(planId, day(0), [{ kind: 'easy', minutes: 40 }])
    await onlyOn(planId, day(1), [{ kind: 'easy', minutes: 50 }])
    const link = await makeLink(u)
    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 7, painFocalBone: true })
    const rested = await open(link.path)
    expect(eventsOf(rested.text).map((e) => [e.start, e.summary])).toEqual([
      [compact(day(1)), 'Easy run, 50 min'],
    ])
    // no “Rest day” stands in for it: the day is simply empty
    expect(rested.text).not.toMatch(/rest day/i)
  })
})

describe('what the feed says about health', () => {
  /** Anything the engine or the runner wrote that must not reach a link whose holder is unknown. */
  const SEEDED = [
    'Achilles',
    'tendon',
    'stress fracture',
    'tibial',
    'illness',
    'Return to running',
    'pain level',
    'post-race',
    'niggle',
    'Synthetic Half Marathon',
    'Rest: illness',
  ]
  const HEALTH =
    /injur|illness|\bill\b|sick|pain|niggle|rehab|return|post-race|after the race|\beased?\b|easier|run-walk|run walk|\bwalk|readiness|reason|heart|bpm|fuel|carb|fracture|tendon|achilles|stress|screening|reds/i

  test('carries only allowlisted titles and no word about injury, illness, pain or an easing', async () => {
    const { u, planId } = await runner()
    await emptyPlan(planId)
    // the profile, a pain check-in and an illness check-in, all in the past
    await ctx.prisma.athleteProfile.update({
      where: { userId: u.id },
      data: {
        injuries: JSON.stringify([
          {
            area: 'left Achilles tendon',
            side: 'left',
            year: 2025,
            month: 3,
            kind: 'tendon',
            notes: 'tibial stress fracture history, niggle in autumn',
          },
        ]),
      },
    })
    for (const [offset, body] of [
      [-3, { illness: true, fatigue: 5 }],
      [-2, { painScore: 5, painArea: 'left Achilles tendon', painFocalBone: false }],
      [-1, { painScore: 4, painArea: 'left Achilles tendon' }],
    ] as const) {
      const res = await client(ctx, u)
        .put(`/api/checkins/${day(offset)}`)
        .send(body)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
    }
    // sessions the way a return from injury, a post-race window and a rest window write them
    const health = [
      'Return to running after a stress fracture, pain level 4',
      'Easy after the race: post-race window',
      'Run-walk, step 3: illness return',
    ]
    await onlyOn(planId, day(4), [
      { kind: 'easy', minutes: 30, title: health[0], flags: ['injury-return', 'run-walk'] },
    ])
    await onlyOn(planId, day(5), [
      { kind: 'easy', minutes: 40, title: health[1], flags: ['post-race'] },
    ])
    await onlyOn(planId, day(6), [
      {
        kind: 'easy',
        title: health[2],
        blueprint: rungSessions(2)[0]!,
        minutes: sessionMin(rungSessions(2)[0]!),
        flags: ['restart-floor', 'run-walk', 'ladder-2', 'injury-return'],
      },
    ])
    await onlyOn(planId, day(7), [{ kind: 'rest', title: 'Rest: illness', flags: ['rest-window'] }])
    await onlyOn(planId, day(8), [{ kind: 'long', minutes: 120, flags: ['injury-return', 'heat'] }])
    await onlyOn(planId, day(9), [
      { kind: 'race', minutes: 600, title: 'Synthetic Half Marathon', flags: [] },
    ])
    await onlyOn(planId, day(10), [{ kind: 'strength', minutes: 25, title: 'Rehab: Achilles' }])

    const { text, events } = await feedOf(u)
    expect(events.length).toBe(6) // the rest window has no event
    for (const word of SEEDED) expect(text.toLowerCase(), word).not.toContain(word.toLowerCase())
    expect(text).not.toMatch(HEALTH)

    // every title is one of the closed list of kinds, with a length
    const allowed = Object.values(PUBLIC_TITLES).map((entry) => entry.title)
    for (const e of events) {
      expect(
        allowed.some((title) => e.summary === title || e.summary.startsWith(`${title}, `)),
        e.summary,
      ).toBe(true)
      expect(e.description ?? '', e.summary).not.toMatch(/\d/)
    }
    expect(events.at(-2)!.summary).toBe('Race day')
  })
})
