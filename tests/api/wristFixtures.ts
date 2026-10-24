// What the wrist tests share: a stateful stand-in for the intervals.icu API (synthetic responses, no
// network), a runner with a hand-made plan, and the rows a connected, publishing runner has.
import { randomUUID } from 'node:crypto'
import { mondayOf, addDays } from '../../shared/dates.ts'
import { prescribe } from '../../shared/engine/sessions.ts'
import type { SessionKind } from '../../shared/engine/types.ts'
import type { PlanSessionStatus } from '../../shared/types.ts'
import type { PlanSession } from '../../server/db.ts'
import { sealSecret } from '../../server/services/sync.ts'
import { fakeFetch } from '../fakeFetch.ts'
import { weekFixture, zoneSetFixture } from '../unit/engine/fixtures.ts'
import { seedUser, type TestCtx, type TestUser } from './helpers.ts'

export const ATHLETE_ID = 'i1001'
export const API_KEY = 'synthetic-intervals-key-4242'
const BASE = 'https://intervals.icu/api/v1'
export const EVENTS = `${BASE}/athlete/${ATHLETE_ID}/events`

// ---------------------------------------------------------------------------------------------
// intervals.icu
// ---------------------------------------------------------------------------------------------

export interface RemoteEvent {
  id: number
  external_id: string | null
  start_date_local: string
  name: string
  description: string
  category: string
  type: string
  push_errors: string[]
}

export interface IntervalsCall {
  method: string
  /** The path and query, without the origin. */
  path: string
  body: unknown
}

/**
 * Returns a response to take the place of the default one, or undefined to use the default. It may
 * wait (a test holds a call open) or throw (a network error).
 */
export type Hook = (
  req: Request,
  body: unknown,
) => Response | undefined | Promise<Response | undefined>

export interface FakeIntervals {
  fetch: typeof fetch
  events: Map<number, RemoteEvent>
  calls: IntervalsCall[]
  hooks: { settings?: Hook; list?: Hook; create?: Hook; update?: Hook; remove?: Hook }
  /** The answer of the sport-settings call. */
  settings: unknown
  /** Calls of a method whose path starts with `part` (after the athlete). */
  made(method: string, part: string): IntervalsCall[]
  /** Forgets the calls so far. */
  forget(): void
  /** The events by day. */
  byDate(): RemoteEvent[]
}

const text = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

/**
 * A small intervals.icu: events created in bulk (an `external_id` that exists is updated, as the
 * upsert flag does for the app that made it), updated by id (404 for an unknown id), listed by day
 * and deleted in bulk. Every call is recorded; `hooks` take over one kind of call.
 */
export function fakeIntervals(athleteId: string = ATHLETE_ID): FakeIntervals {
  const athleteBase = `${BASE}/athlete/${athleteId}`
  const eventsUrl = `${athleteBase}/events`
  const events = new Map<number, RemoteEvent>()
  const calls: IntervalsCall[] = []
  let nextId = 5001
  const fake: FakeIntervals = {
    fetch: undefined as unknown as typeof fetch,
    events,
    calls,
    hooks: {},
    settings: [{ types: ['Run'], max_hr: 190, lthr: 170, threshold_pace: 3.8 }],
    made: (method, part) =>
      calls.filter(
        (call) => call.method === method && call.path.startsWith(`/athlete/${athleteId}/${part}`),
      ),
    forget: () => {
      calls.length = 0
    },
    byDate: () =>
      [...events.values()].sort((a, b) => a.start_date_local.localeCompare(b.start_date_local)),
  }

  const record = async (req: Request): Promise<unknown> => {
    const url = new URL(req.url)
    const text = req.method === 'GET' ? '' : await req.text()
    const body: unknown = text === '' ? null : JSON.parse(text)
    calls.push({ method: req.method, path: url.pathname.replace('/api/v1', '') + url.search, body })
    return body
  }
  const store = (item: Record<string, unknown>, id: number): RemoteEvent => {
    const event: RemoteEvent = {
      id,
      external_id: typeof item['external_id'] === 'string' ? item['external_id'] : null,
      start_date_local: `${String(item['start_date_local']).slice(0, 10)}T00:00:00`,
      name: text(item['name'], ''),
      description: text(item['description'], ''),
      category: text(item['category'], 'WORKOUT'),
      type: text(item['type'], 'Run'),
      push_errors: events.get(id)?.push_errors ?? [],
    }
    events.set(id, event)
    return event
  }
  const view = (event: RemoteEvent) => ({
    ...event,
    workout_doc: { steps: [{ duration: 60 }] },
  })

  fake.fetch = fakeFetch({
    // the connect check of the provider reads the athlete itself
    [`GET ${athleteBase}`]: (req) => {
      if (new URL(req.url).pathname !== `/api/v1/athlete/${athleteId}`) {
        throw new Error(`fakeFetch: no route for GET ${req.url}`)
      }
      return json({ id: athleteId })
    },
    [`GET ${athleteBase}/sport-settings`]: async (req) => {
      const body = await record(req)
      return (await fake.hooks.settings?.(req, body)) ?? json(fake.settings)
    },
    [`GET ${eventsUrl}`]: async (req) => {
      const body = await record(req)
      const hooked = await fake.hooks.list?.(req, body)
      if (hooked) return hooked
      const query = new URL(req.url).searchParams
      const oldest = query.get('oldest') ?? '0000-00-00'
      const newest = query.get('newest') ?? '9999-99-99'
      return json(
        fake
          .byDate()
          .filter((e) => e.start_date_local.slice(0, 10) >= oldest)
          .filter((e) => e.start_date_local.slice(0, 10) <= newest)
          .map(view),
      )
    },
    [`POST ${eventsUrl}/bulk`]: async (req) => {
      const body = await record(req)
      const hooked = await fake.hooks.create?.(req, body)
      if (hooked) return hooked
      const created = (body as Array<Record<string, unknown>>).map((item) => {
        const existing = [...events.values()].find((e) => e.external_id === item['external_id'])
        return view(store(item, existing?.id ?? nextId++))
      })
      return json(created)
    },
    [`PUT ${eventsUrl}/bulk-delete`]: async (req) => {
      const body = await record(req)
      const hooked = await fake.hooks.remove?.(req, body)
      if (hooked) return hooked
      let removed = 0
      for (const item of body as Array<{ id?: number; external_id?: string }>) {
        for (const event of [...events.values()]) {
          if (
            event.id === item.id ||
            (item.external_id && event.external_id === item.external_id)
          ) {
            events.delete(event.id)
            removed += 1
          }
        }
      }
      return json({ deleted: removed })
    },
    [`PUT ${eventsUrl}/`]: async (req) => {
      const body = await record(req)
      const hooked = await fake.hooks.update?.(req, body)
      if (hooked) return hooked
      const id = Number(new URL(req.url).pathname.split('/').pop())
      if (!events.has(id)) return json({ error: 'Not found' }, 404)
      return json(view(store(body as Record<string, unknown>, id)))
    },
  })
  return fake
}

// ---------------------------------------------------------------------------------------------
// A runner with a plan
// ---------------------------------------------------------------------------------------------

export interface Placed {
  date: string
  kind: SessionKind
  minutes?: number
  status?: PlanSessionStatus
  flags?: string[]
  /** Reused by an undo that restores a deleted session. */
  externalId?: string
  title?: string
}

/**
 * A signed-in runner with a heart-rate zone set and an active version-2 plan that holds no
 * sessions; `place` adds them, so each test controls exactly what is planned. The plan has weeks
 * for the current Monday and the five after it.
 */
export async function seedRunner(
  ctx: TestCtx,
  email: string,
  today: string,
): Promise<{ u: TestUser; planId: string; goalId: string }> {
  const u = await seedUser(ctx, { email, units: 'km' })
  await ctx.prisma.athleteProfile.create({
    data: { userId: u.id, hrMax: 190, hrMaxSource: 'measured', hrRest: 50, timezone: 'UTC' },
  })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(today, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const monday = mondayOf(today)
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: addDays(monday, -7 * 12),
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: Array.from({ length: 6 }, (_, index) => ({
          weekStart: addDays(monday, 7 * index),
          index,
          phase: 'build',
          baselineRunMin: 200,
          targetRunMin: 200,
          longRunMin: 70,
          runDays: 4,
          strengthSessions: 0,
        })),
      },
    },
  })
  return { u, planId: plan.id, goalId: goal.id }
}

/** Twelve weeks of runs and a 10 km race a month ago, so the runner's pace zones exist. */
export async function seedHistory(ctx: TestCtx, userId: string, today: string): Promise<void> {
  const week = [
    { dow: 1, min: 40, distanceM: 6400 },
    { dow: 3, min: 45, distanceM: 7200 },
    { dow: 5, min: 35, distanceM: 5600 },
    { dow: 6, min: 70, distanceM: 11_000 },
  ]
  const monday = mondayOf(today)
  const rows = []
  for (let w = 1; w <= 12; w += 1) {
    for (const run of week) {
      rows.push({
        userId,
        date: addDays(monday, -7 * w + run.dow),
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
  await ctx.prisma.activity.create({
    data: {
      userId,
      date: addDays(today, -30),
      type: 'race',
      durationSec: 3300,
      movingSec: 3300,
      distanceM: 10_000,
      rpe: 9,
      source: 'manual',
    },
  })
}

/** Adds sessions to the plan as the engine writes them (structure, target, rules). */
export async function place(
  ctx: TestCtx,
  planId: string,
  placed: Placed[],
): Promise<PlanSession[]> {
  const rows: PlanSession[] = []
  for (const [index, p] of placed.entries()) {
    const spec = prescribe(p.kind, p.minutes ?? 60, zoneSetFixture(), weekFixture(), {
      goalPaceSecPerKm: 330,
    })
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId,
          externalId: p.externalId ?? randomUUID(),
          weekStart: mondayOf(p.date),
          date: p.date,
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

/** The intervals.icu integration of a runner, with the synthetic API key sealed as the app seals it. */
export async function connectIntervals(
  ctx: TestCtx,
  userId: string,
  status: 'connected' | 'needs_auth' | 'error' = 'connected',
): Promise<void> {
  await ctx.prisma.integration.create({
    data: {
      userId,
      provider: 'intervals',
      status,
      secret: sealSecret({ apiKey: API_KEY }, ctx.config.sessionSecret),
      config: JSON.stringify({ athleteId: ATHLETE_ID }),
    },
  })
}

/** Publishing switched on, as `PUT /api/wrist/intervals` leaves the channel. */
export async function enablePublishing(
  ctx: TestCtx,
  userId: string,
  garminLinked = false,
): Promise<void> {
  await ctx.prisma.deliveryChannel.upsert({
    where: { userId_channel: { userId, channel: 'intervals' } },
    create: { userId, channel: 'intervals', enabled: true, garminLinked },
    update: { enabled: true, garminLinked },
  })
}
