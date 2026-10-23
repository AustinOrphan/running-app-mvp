import { randomUUID } from 'node:crypto'
import { unzipSync } from 'fflate'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { prescribe } from '../../shared/engine/sessions.ts'
import type { SessionKind } from '../../shared/engine/types.ts'
import type { PlanSessionStatus, PlanWithSessions, StateView, Units } from '../../shared/types.ts'
import { loadAthleteContext } from '../../server/services/athleteState.ts'
import { loadForecast } from '../../server/services/engineInput.ts'
import { fuelLineFor, loadFuelContext } from '../../server/services/fuelLine.ts'
import {
  buildDeliverables,
  type Deliverable,
  type SendDeliverable,
} from '../../server/services/workouts.ts'
import { expandWorkout, readWorkout } from '../fixtures/fit/readWorkout.ts'
import { weekFixture, zoneSetFixture } from '../unit/engine/fixtures.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The deliverable builder and the two download routes (design 6.4 and 6.5). Spies run the real
// code: they show what the builder asked of the snapshot, the forecast and the fuel seam.
vi.mock('../../server/services/athleteState.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/athleteState.ts')>()
  return { ...original, loadAthleteContext: vi.fn(original.loadAthleteContext) }
})
vi.mock('../../server/services/engineInput.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/engineInput.ts')>()
  return { ...original, loadForecast: vi.fn(original.loadForecast) }
})
vi.mock('../../server/services/fuelLine.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/fuelLine.ts')>()
  return {
    ...original,
    loadFuelContext: vi.fn(original.loadFuelContext),
    fuelLineFor: vi.fn(original.fuelLineFor),
  }
})

// A Wednesday at noon; only Date is faked, so the database and the promises keep working.
const NOW = new Date(2026, 9, 21, 12)
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOW)

const today = todayIso()
const thisMonday = mondayOf(today)
const tomorrow = addDays(today, 1)
/** Quiet days of the plan, far enough from today that no test of today's advice touches them. */
const nextMonday = addDays(thisMonday, 7)
const DAY_A = addDays(nextMonday, 1)
const DAY_B = addDays(nextMonday, 2)

let ctx: TestCtx
const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  vi.setSystemTime(NOW)
  await ctx.prisma.user.deleteMany()
})

afterEach(() => {
  vi.mocked(loadAthleteContext).mockClear()
  vi.mocked(loadForecast).mockReset()
  vi.mocked(loadFuelContext).mockClear()
  vi.mocked(fuelLineFor).mockClear()
  expectNoRefusedFetches(ctx)
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

/** A runner with a heart-rate zone set, a history and the plan the engine builds for a half. */
async function runner(
  email: string,
  units: Units = 'km',
): Promise<{ u: TestUser; planId: string }> {
  const u = await seedUser(ctx, { email, units })
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
      targetDate: addDays(thisMonday, 7 * 3 + 5),
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
}

/**
 * Replaces every session of `date` by the given ones, written the way the engine writes them
 * (structure, target, rules), in order. Returns the stored rows.
 */
async function onlyOn(planId: string, date: string, placed: Placed[]) {
  await ctx.prisma.planSession.deleteMany({ where: { planId, date } })
  const rows = []
  for (const [index, p] of placed.entries()) {
    const spec = prescribe(p.kind, p.minutes ?? 60, zoneSetFixture(), weekFixture(), {
      goalPaceSecPerKm: 330,
    })
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

interface Download {
  status: number
  headers: Record<string, string>
  bytes: Uint8Array
  json: unknown
}

async function download(path: string, user?: TestUser): Promise<Download> {
  const res = await client(ctx, user)
    .get(path)
    .buffer(true)
    .parse((r, done) => {
      const chunks: Buffer[] = []
      r.on('data', (chunk: Buffer) => chunks.push(chunk))
      r.on('end', () => done(null, Buffer.concat(chunks)))
    })
  const body = res.body as Buffer
  const ok = res.status === 200
  return {
    status: res.status,
    headers: res.headers,
    bytes: ok ? new Uint8Array(body) : new Uint8Array(),
    json: ok ? null : (JSON.parse(body.toString('utf8')) as unknown),
  }
}

const fitPath = (id: string) => `/api/plan/sessions/${id}/workout.fit`
const zipPath = (weekStart: string) => `/api/plan/weeks/${weekStart}/workouts.zip`
const BASE_DEVICE = /^attachment; filename="([a-z0-9.-]+)"$/

function fileNameOf(download: Download): string {
  const match = BASE_DEVICE.exec(download.headers['content-disposition'] ?? '')
  expect(match, download.headers['content-disposition']).not.toBeNull()
  return match![1]!
}

async function zonesOf(u: TestUser): Promise<NonNullable<StateView['zones']['hr']>> {
  const res = await client(ctx, u).get('/api/state')
  expect(res.status).toBe(200)
  return (res.body as StateView).zones.hr!
}

const bytesOf = (name: string, files: Record<string, Uint8Array>): Uint8Array => {
  const found = files[name]
  expect(found, `${name} in ${Object.keys(files).join(', ')}`).toBeDefined()
  return found!
}

// ---------------------------------------------------------------------------------------------
// The single file
// ---------------------------------------------------------------------------------------------

describe('GET /api/plan/sessions/:id/workout.fit', () => {
  test('needs the session cookie', async () => {
    const { planId } = await runner('fit-auth@example.com')
    const [row] = await onlyOn(planId, DAY_A, [{ kind: 'easy' }])
    expect((await download(fitPath(row!.id))).status).toBe(401)
  })

  test('serves the easy run as an attachment named from its date and kind, never cached', async () => {
    const { u, planId } = await runner('fit-easy@example.com')
    const [row] = await onlyOn(planId, DAY_A, [{ kind: 'easy', minutes: 45 }])
    const file = await download(fitPath(row!.id), u)
    expect(file.status).toBe(200)
    expect(file.headers['cache-control']).toBe('no-store')
    expect(file.headers['content-type']).toMatch(/^application\/octet-stream/)
    expect(fileNameOf(file)).toBe(`${DAY_A}-easy-run.fit`)

    const read = readWorkout(file.bytes)
    expect(read.file).toMatchObject({ type: 'workout', manufacturer: 'development' })
    expect(read.workout).toMatchObject({ sport: 'running', name: 'Easy run', numValidSteps: 1 })
    // one heart-rate ceiling from the current zones, from the watch floor to the top of Z1
    const z1 = (await zonesOf(u)).z1
    expect(expandWorkout(read)).toMatchObject([
      {
        name: 'Run',
        durationSec: 2700,
        target: { type: 'heart_rate', lowBpm: 40, highBpm: z1[1] },
        intensity: 'active',
      },
    ])
  })

  test('names the file and the workout from the kind, never from the title', async () => {
    const { u, planId } = await runner('fit-title@example.com')
    const [row] = await onlyOn(planId, DAY_A, [
      { kind: 'easy', title: 'Return to running after a stress fracture, pain level 4' },
    ])
    const file = await download(fitPath(row!.id), u)
    expect(file.status).toBe(200)
    const name = fileNameOf(file)
    const inside = new TextDecoder().decode(file.bytes)
    for (const text of [name, inside]) {
      expect(text).not.toMatch(/fracture|pain|return|injur|illness|post-race|eased|run-walk/i)
    }
    expect(readWorkout(file.bytes).workout.name).toBe('Easy run, 1 h')
  })

  test('carries the figures of the current zones, not the stored target', async () => {
    const { u, planId } = await runner('fit-zones@example.com')
    const [row] = await onlyOn(planId, DAY_A, [{ kind: 'easy' }])
    // the stored target holds the fixture's Z1 (120 to 140); the runner's own zones differ
    const file = await download(fitPath(row!.id), u)
    const z1 = (await zonesOf(u)).z1
    expect(z1[1]).not.toBe(140)
    const [step] = expandWorkout(readWorkout(file.bytes))
    expect(step?.target).toMatchObject({ type: 'heart_rate', highBpm: z1[1] })
  })

  test('answers 404 outside the active plan', async () => {
    const { u, planId } = await runner('fit-404@example.com')
    const other = await runner('fit-404-other@example.com')
    const [mine] = await onlyOn(planId, DAY_A, [{ kind: 'easy' }])
    const [theirs] = await onlyOn(other.planId, DAY_A, [{ kind: 'easy' }])
    expect((await download(fitPath('no-such-session'), u)).status).toBe(404)
    expect((await download(fitPath(theirs!.id), u)).status).toBe(404)
    await ctx.prisma.plan.update({ where: { id: planId }, data: { status: 'archived' } })
    const archived = await download(fitPath(mine!.id), u)
    expect(archived.status).toBe(404)
    expect(archived.json).toMatchObject({ error: { code: 'not_found' } })
  })

  test.each(['strength', 'mobility', 'rest', 'race', 'cross'] as const)(
    'answers 409 for a %s session',
    async (kind) => {
      const { u, planId } = await runner(`fit-409-${kind}@example.com`)
      const [row] = await onlyOn(planId, DAY_A, [{ kind }])
      const file = await download(fitPath(row!.id), u)
      expect(file.status).toBe(409)
      expect(file.headers['cache-control']).toBe('no-store')
      expect(file.json).toMatchObject({
        error: { code: 'conflict', details: { reason: 'not-a-run' } },
      })
    },
  )

  test.each(['completed', 'partial', 'skipped'] as const)(
    'answers 409 for a %s session, and 200 for a moved or trimmed one',
    async (status) => {
      const { u, planId } = await runner(`fit-status-${status}@example.com`)
      const [settled, moved, downgraded] = await onlyOn(planId, DAY_A, [
        { kind: 'long', status },
        { kind: 'long', status: 'moved' },
        { kind: 'easy', status: 'downgraded' },
      ])
      const refused = await download(fitPath(settled!.id), u)
      expect(refused.status).toBe(409)
      expect(refused.json).toMatchObject({ error: { details: { reason: 'settled' } } })
      // a moved long run still downloads, under the name of what it is
      const long = await download(fitPath(moved!.id), u)
      expect(long.status).toBe(200)
      expect(fileNameOf(long)).toBe(`${DAY_A}-long-run.fit`)
      expect((await download(fitPath(downgraded!.id), u)).status).toBe(200)
    },
  )

  test('numbers a second file of one kind on one day', async () => {
    const { u, planId } = await runner('fit-two@example.com')
    const [first, second] = await onlyOn(planId, DAY_A, [
      { kind: 'easy', minutes: 30 },
      { kind: 'easy', minutes: 30 },
    ])
    expect(fileNameOf(await download(fitPath(first!.id), u))).toBe(`${DAY_A}-easy-run.fit`)
    expect(fileNameOf(await download(fitPath(second!.id), u))).toBe(`${DAY_A}-easy-run-2.fit`)
  })

  test('writes the easy version of a quality session that readiness eased today', async () => {
    const { u, planId } = await runner('fit-eased@example.com')
    const [today3, tomorrow3] = [
      (await onlyOn(planId, today, [{ kind: 'threshold', minutes: 60 }]))[0]!,
      (await onlyOn(planId, tomorrow, [{ kind: 'intervals', minutes: 60 }]))[0]!,
    ]
    expect((await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 6 })).status).toBe(
      200,
    )
    const eased = await download(fitPath(today3.id), u)
    expect(eased.status).toBe(200)
    expect(fileNameOf(eased)).toBe(`${today}-easy-run.fit`)
    const read = readWorkout(eased.bytes)
    const steps = expandWorkout(read)
    const z1 = (await zonesOf(u)).z1
    expect(steps).toMatchObject([
      {
        durationSec: 3600,
        target: { type: 'heart_rate', lowBpm: 40, highBpm: z1[1] },
        notes: 'Eased for today',
      },
    ])
    // the reason is never named
    expect(new TextDecoder().decode(eased.bytes)).not.toMatch(/pain|readiness|signal/i)

    // tomorrow is not pre-eased: that is a statement about today
    const planned = await download(fitPath(tomorrow3.id), u)
    expect(planned.status).toBe(200)
    expect(fileNameOf(planned)).toBe(`${tomorrow}-intervals.fit`)
    const targets = expandWorkout(readWorkout(planned.bytes)).map((s) => s.target.type)
    expect(targets).toContain('speed')
  })

  test('answers 409 with the rest sentence when readiness takes the run off today', async () => {
    const { u, planId } = await runner('fit-rest@example.com')
    const [todays] = await onlyOn(planId, today, [{ kind: 'easy' }])
    const [tomorrows] = await onlyOn(planId, tomorrow, [{ kind: 'easy' }])
    // focal bone pain: no running until it has been assessed
    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 7, painFocalBone: true })
    const refused = await download(fitPath(todays!.id), u)
    expect(refused.status).toBe(409)
    expect(refused.json).toMatchObject({
      error: {
        code: 'conflict',
        message: 'Rest is the better choice today, so there is no workout file.',
        details: { reason: 'rest-advice' },
      },
    })
    expect((await download(fitPath(tomorrows!.id), u)).status).toBe(200)
  })

  test('leaves every step open and says so on a day steered by effort', async () => {
    const { u, planId } = await runner('fit-hot@example.com')
    const [heat] = await onlyOn(planId, DAY_A, [{ kind: 'long', minutes: 120, flags: ['heat'] }])
    const steps = expandWorkout(readWorkout((await download(fitPath(heat!.id), u)).bytes))
    expect(steps.map((s) => s.target.type)).toEqual(['open'])
    expect(steps[0]?.notes).toBe('By effort')
  })
})

// ---------------------------------------------------------------------------------------------
// The week's zip
// ---------------------------------------------------------------------------------------------

describe('GET /api/plan/weeks/:weekStart/workouts.zip', () => {
  test('needs the session cookie', async () => {
    expect((await download(zipPath(nextMonday))).status).toBe(401)
  })

  test('checks that the week starts on a Monday', async () => {
    const { u } = await runner('zip-monday@example.com')
    for (const bad of [addDays(nextMonday, 1), '2026-13-01', 'next-week']) {
      const res = await download(zipPath(bad), u)
      expect(res.status, bad).toBe(400)
      expect(res.json).toMatchObject({ error: { code: 'validation' } })
    }
  })

  test('holds one file per run still to be done, named by day and kind', async () => {
    const { u, planId } = await runner('zip-week@example.com')
    // next week, written out: three runs, a second easy run on one day, and what is left out
    await ctx.prisma.planSession.deleteMany({ where: { planId, weekStart: nextMonday } })
    await onlyOn(planId, nextMonday, [{ kind: 'easy', minutes: 40 }])
    await onlyOn(planId, addDays(nextMonday, 1), [
      { kind: 'intervals', minutes: 60 },
      { kind: 'strength' },
      { kind: 'easy', minutes: 30, status: 'skipped' },
    ])
    await onlyOn(planId, addDays(nextMonday, 2), [{ kind: 'easy' }, { kind: 'easy' }])
    await onlyOn(planId, addDays(nextMonday, 3), [{ kind: 'rest' }])
    await onlyOn(planId, addDays(nextMonday, 5), [{ kind: 'long', minutes: 120, status: 'moved' }])
    await onlyOn(planId, addDays(nextMonday, 6), [{ kind: 'race' }])

    const res = await download(zipPath(nextMonday), u)
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['content-type']).toMatch(/^application\/zip/)
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="workouts-${nextMonday}.zip"`,
    )

    const files = unzipSync(res.bytes)
    expect(Object.keys(files).sort()).toEqual(
      [
        `${nextMonday}-easy-run.fit`,
        `${addDays(nextMonday, 1)}-intervals.fit`,
        `${addDays(nextMonday, 2)}-easy-run.fit`,
        `${addDays(nextMonday, 2)}-easy-run-2.fit`,
        `${addDays(nextMonday, 5)}-long-run.fit`,
      ].sort(),
    )
    for (const [name, bytes] of Object.entries(files)) {
      expect(readWorkout(bytes).file.type, name).toBe('workout')
    }
    // the files of one day are told apart by the identity inside them
    const serials = Object.values(files).map((bytes) => readWorkout(bytes).file.serial)
    expect(new Set(serials).size).toBe(serials.length)
    expect(serials.every((serial) => serial !== null && serial > 0)).toBe(true)
  })

  test('writes identical bytes for an identical request', async () => {
    const { u, planId } = await runner('zip-same@example.com')
    await onlyOn(planId, DAY_A, [{ kind: 'easy' }, { kind: 'threshold' }])
    const first = await download(zipPath(nextMonday), u)
    const second = await download(zipPath(nextMonday), u)
    expect(first.status).toBe(200)
    expect(Buffer.from(first.bytes).equals(Buffer.from(second.bytes))).toBe(true)
  })

  test('holds the eased version of today, and leaves out a run readiness takes off the day', async () => {
    const { u, planId } = await runner('zip-today@example.com')
    await ctx.prisma.planSession.deleteMany({ where: { planId, weekStart: thisMonday } })
    await onlyOn(planId, today, [{ kind: 'intervals', minutes: 60 }])
    await onlyOn(planId, tomorrow, [{ kind: 'threshold', minutes: 60 }])

    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 6 })
    const eased = unzipSync((await download(zipPath(thisMonday), u)).bytes)
    expect(Object.keys(eased).sort()).toEqual([
      `${today}-easy-run.fit`,
      `${tomorrow}-threshold-run.fit`,
    ])
    const first = expandWorkout(readWorkout(bytesOf(`${today}-easy-run.fit`, eased)))
    expect(first[0]?.notes).toBe('Eased for today')

    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 7, painFocalBone: true })
    const rested = unzipSync((await download(zipPath(thisMonday), u)).bytes)
    expect(Object.keys(rested)).toEqual([`${tomorrow}-threshold-run.fit`])
  })

  test('answers 409 for a week with no run to put on a watch', async () => {
    const { u, planId } = await runner('zip-empty@example.com')
    await ctx.prisma.planSession.deleteMany({ where: { planId, weekStart: nextMonday } })
    await onlyOn(planId, nextMonday, [{ kind: 'strength' }, { kind: 'easy', status: 'skipped' }])
    for (const week of [nextMonday, addDays(thisMonday, 70)]) {
      const res = await download(zipPath(week), u)
      expect(res.status, week).toBe(409)
      expect(res.json).toMatchObject({
        error: { code: 'conflict', details: { reason: 'empty' } },
      })
    }
    const nobody = await seedUser(ctx, { email: 'zip-no-plan@example.com' })
    expect((await download(zipPath(nextMonday), nobody)).status).toBe(409)
  })

  test("never serves another runner's week", async () => {
    const mine = await runner('zip-mine@example.com')
    const theirs = await runner('zip-theirs@example.com')
    await onlyOn(mine.planId, DAY_A, [{ kind: 'easy' }])
    await ctx.prisma.planSession.deleteMany({
      where: { planId: theirs.planId, weekStart: nextMonday },
    })
    expect((await download(zipPath(nextMonday), theirs.u)).status).toBe(409)
  })
})

// ---------------------------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------------------------

const sends = (deliverables: Deliverable[]): SendDeliverable[] =>
  deliverables.filter((d): d is SendDeliverable => d.action === 'send')

describe('buildDeliverables', () => {
  test('reads the snapshot once and runs no query of the history or the stored plan', async () => {
    const { u, planId } = await runner('build-once@example.com')
    await onlyOn(planId, DAY_A, [{ kind: 'easy' }, { kind: 'threshold' }])
    await onlyOn(planId, DAY_B, [{ kind: 'long', minutes: 150 }])
    // a warm snapshot, so that what the builder asks of the database is only what it adds
    await loadAthleteContext(deps(), { userId: u.id, today })
    vi.mocked(loadAthleteContext).mockClear()
    const spies = [
      vi.spyOn(ctx.prisma.activity, 'findMany'),
      vi.spyOn(ctx.prisma.wellnessDay, 'findMany'),
      vi.spyOn(ctx.prisma.weeklyReview, 'findMany'),
      vi.spyOn(ctx.prisma.planSession, 'findMany'),
      vi.spyOn(ctx.prisma.plan, 'findFirst'),
    ]
    // The fuel replay reads the weeks of every plan (a replaced plan's gut-training weeks still
    // credit the runs they covered), which the snapshot of the active plan cannot answer; it is
    // the one read of the stored plan the builder adds.
    const weeks = vi.spyOn(ctx.prisma.planWeek, 'findMany')
    const built = await buildDeliverables(deps(), u.id, { from: DAY_A, to: DAY_B, today })
    expect(sends(built)).toHaveLength(3)
    expect(loadAthleteContext).toHaveBeenCalledTimes(1)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(weeks).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })

  test('lists the sessions by date and order with their durable ids', async () => {
    const { u, planId } = await runner('build-order@example.com')
    const later = await onlyOn(planId, DAY_B, [{ kind: 'long', minutes: 120 }])
    const earlier = await onlyOn(planId, DAY_A, [
      { kind: 'easy', minutes: 30 },
      { kind: 'easy', minutes: 40 },
    ])
    const built = await buildDeliverables(deps(), u.id, { from: DAY_A, to: DAY_B, today })
    expect(built.map((d) => [d.sessionId, d.externalId, d.date, d.order])).toEqual(
      [...earlier, ...later].map((r) => [r.id, r.externalId, r.date, r.order]),
    )
    expect(built.every((d) => d.action === 'send')).toBe(true)
    const first = built[0] as SendDeliverable
    expect(first.plan).toMatchObject({ title: 'Easy run, 30 min', kind: 'easy', eased: false })
  })

  test('keeps to the sessions that are runs still to be done', async () => {
    const { u, planId } = await runner('build-filter@example.com')
    await onlyOn(planId, DAY_A, [
      { kind: 'easy' },
      { kind: 'strength' },
      { kind: 'mobility' },
      { kind: 'cross' },
      { kind: 'rest' },
      { kind: 'race' },
      { kind: 'easy', status: 'skipped' },
      { kind: 'easy', status: 'completed' },
      { kind: 'easy', status: 'partial' },
      { kind: 'hike', status: 'downgraded' },
    ])
    const built = await buildDeliverables(deps(), u.id, { from: DAY_A, to: DAY_A, today })
    expect(built.map((d) => d.plannedKind)).toEqual(['easy', 'hike'])
    expect(
      await buildDeliverables(deps(), u.id, {
        from: addDays(DAY_A, 100),
        to: addDays(DAY_A, 101),
        today,
      }),
    ).toEqual([])
    const none = await seedUser(ctx, { email: 'build-no-plan@example.com' })
    expect(await buildDeliverables(deps(), none.id, { from: DAY_A, to: DAY_A, today })).toEqual([])
  })

  test('eases today only, and withdraws today on a rest advice', async () => {
    const { u, planId } = await runner('build-today@example.com')
    const [todays, tomorrows] = [
      (await onlyOn(planId, today, [{ kind: 'intervals', minutes: 60 }]))[0]!,
      (await onlyOn(planId, tomorrow, [{ kind: 'intervals', minutes: 60 }]))[0]!,
    ]
    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 6 })
    const eased = await buildDeliverables(deps(), u.id, { from: today, to: tomorrow, today })
    const [first, second] = sends(eased)
    expect(first).toMatchObject({ sessionId: todays.id, plannedKind: 'intervals' })
    expect(first!.plan).toMatchObject({ kind: 'easy', eased: true, title: 'Easy run, 1 h' })
    expect(second).toMatchObject({ sessionId: tomorrows.id, plannedKind: 'intervals' })
    expect(second!.plan).toMatchObject({ kind: 'intervals', eased: false })

    await client(ctx, u).put(`/api/checkins/${today}`).send({ painScore: 7, painFocalBone: true })
    const rested = await buildDeliverables(deps(), u.id, { from: today, to: tomorrow, today })
    expect(rested.map((d) => d.action)).toEqual(['withdraw', 'send'])
    expect(rested[0]).toMatchObject({ sessionId: todays.id, cause: 'rest-advice' })
    expect(rested[0]).not.toHaveProperty('plan')
  })

  test('takes the targets from the resolver with the heat of the cached forecast', async () => {
    const { u, planId } = await runner('build-heat@example.com')
    await onlyOn(planId, DAY_A, [{ kind: 'easy', minutes: 60 }])
    await onlyOn(planId, DAY_B, [{ kind: 'easy', minutes: 60 }])
    // a warm afternoon on DAY_A only, on the WBGT index (hot enough to steer by effort)
    const hours = Array.from({ length: 24 }, (_, h) => ({
      time: `${DAY_A}T${String(h).padStart(2, '0')}:00:00`,
      tempC: 36,
      dewPointC: 22,
      humidityPct: 50,
      windKph: 3,
      shortwaveWm2: 800,
    }))
    vi.mocked(loadForecast).mockResolvedValue(hours)
    const [hot, mild] = sends(
      await buildDeliverables(deps(), u.id, { from: DAY_A, to: DAY_B, today }),
    )
    expect(loadForecast).toHaveBeenCalledTimes(1)
    expect(hot!.plan.targets).toMatchObject({ hot: true, mode: 'effort' })
    expect(hot!.plan.nodes).toMatchObject([{ type: 'step', target: { kind: 'open' } }])
    expect(mild!.plan.targets).toMatchObject({ hot: false, mode: 'hr-ceiling' })
    expect(mild!.plan.nodes).toMatchObject([{ type: 'step', target: { kind: 'hr-ceiling' } }])
  })

  test('asks the fuel seam once, and carries its line on the sessions it names', async () => {
    const { u, planId } = await runner('build-fuel@example.com')
    await onlyOn(planId, DAY_A, [{ kind: 'long', minutes: 150 }])
    await onlyOn(planId, DAY_B, [{ kind: 'easy', minutes: 40 }])
    vi.mocked(fuelLineFor).mockImplementation((_ctx, session) =>
      session.kind === 'long' ? 'Fuel 60 g/h carbs. Drink to thirst.' : null,
    )
    const [long, easy] = sends(
      await buildDeliverables(deps(), u.id, { from: DAY_A, to: DAY_B, today }),
    )
    expect(loadFuelContext).toHaveBeenCalledTimes(1)
    expect(vi.mocked(loadFuelContext).mock.calls[0]![1]).toEqual({
      userId: u.id,
      today,
      horizonDays: 7,
    })
    expect(fuelLineFor).toHaveBeenCalledTimes(2)
    expect(long!.plan.fuelLine).toBe('Fuel 60 g/h carbs. Drink to thirst.')
    expect(long!.plan.description).toContain('Fuel 60 g/h carbs. Drink to thirst.')
    expect(easy!.plan.fuelLine).toBeNull()

    // an empty range asks nothing of it
    vi.mocked(loadFuelContext).mockClear()
    await buildDeliverables(deps(), u.id, {
      from: addDays(DAY_A, 90),
      to: addDays(DAY_A, 91),
      today,
    })
    expect(loadFuelContext).not.toHaveBeenCalled()
  })

  test("writes the description in the runner's units", async () => {
    const { u, planId } = await runner('build-miles@example.com', 'mi')
    await onlyOn(planId, DAY_A, [{ kind: 'intervals', minutes: 60 }])
    const [d] = sends(await buildDeliverables(deps(), u.id, { from: DAY_A, to: DAY_A, today }))
    expect(d!.plan.units).toBe('mi')
    expect(d!.plan.description).toMatch(/pace \d+:\d{2} to \d+:\d{2} \/mi/)
    await ctx.prisma.user.update({ where: { id: u.id }, data: { units: 'km' } })
    const [k] = sends(await buildDeliverables(deps(), u.id, { from: DAY_A, to: DAY_A, today }))
    expect(k!.plan.description).toMatch(/\/km/)
  })
})
