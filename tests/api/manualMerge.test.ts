import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { Activity } from '../../shared/types.ts'
import type { MergeCandidate } from '../../shared/domain/manualMerge.ts'
import { markDuplicates } from '../../server/services/duplicates.ts'
import {
  blockNetwork,
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// MM1: "I should be able to force merge manually if I need to" (owner, 2026-11-18). An app-logged
// strength session and the watch's copy did not pair on their own; the runner pairs them.

let ctx: TestCtx
let user: TestUser

const today = todayIso()
const yesterday = addDays(today, -1)

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  blockNetwork(ctx)
  await ctx.prisma.plan.deleteMany()
  await ctx.prisma.goal.deleteMany()
  await ctx.prisma.activity.deleteMany()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

let seq = 0
async function seed(
  type: 'run' | 'strength' | 'race',
  source: string,
  over: {
    date?: string
    durationSec?: number
    avgHr?: number | null
    rpe?: number
    rpeSource?: string
    notes?: string
    status?: string
    of?: string
    startUtc?: string
    startTime?: string
  } = {},
) {
  seq += 1
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: over.date ?? today,
      type,
      durationSec: over.durationSec ?? 2400,
      distanceM: type === 'strength' ? null : 5000,
      source,
      providerKey: source === 'manual' ? null : `${source}:${String(seq)}`,
      avgHr: over.avgHr ?? null,
      ...(over.rpe === undefined ? {} : { rpe: over.rpe, rpeSource: over.rpeSource ?? 'manual' }),
      ...(over.notes === undefined ? {} : { notes: over.notes }),
      ...(over.startUtc === undefined ? {} : { startUtc: over.startUtc }),
      ...(over.startTime === undefined ? {} : { startTime: over.startTime }),
      ...(over.status === undefined
        ? {}
        : { duplicateStatus: over.status, duplicateOfId: over.of ?? null }),
    },
  })
}

async function strengthLog(activityId: string) {
  return ctx.prisma.strengthLog.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      activityId,
      prescribed: '{}',
      sets: {
        create: Array.from({ length: 6 }, (_, position) => ({
          userId: user.id,
          exerciseId: 'back-squat',
          position,
          loadG: 60_000,
          count: 5,
          rir: 2,
        })),
      },
    },
  })
}

function merge(id: string, withId: string) {
  return client(ctx, user).post(`/api/activities/${id}/merge`).send({ withId })
}

async function row(id: string) {
  return ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
}

describe('POST /api/activities/:id/merge', () => {
  test('an app-logged strength session merges into the watch copy and its log and rating move', async () => {
    const app = await seed('strength', 'manual', { durationSec: 2400, rpe: 7, notes: 'Felt solid' })
    const watch = await seed('strength', 'intervals', { durationSec: 2760, avgHr: 118 })
    const log = await strengthLog(app.id)

    const res = await merge(app.id, watch.id)
    expect(res.status).toBe(200)
    expect((res.body as Activity).id).toBe(app.id)

    expect(await row(app.id)).toMatchObject({
      duplicateOfId: watch.id,
      duplicateStatus: 'confirmed',
    })
    // The device copy stays the record: its length and heart rate are untouched, and it is no copy.
    expect(await row(watch.id)).toMatchObject({
      durationSec: 2760,
      avgHr: 118,
      rpe: 7,
      rpeSource: 'manual',
      notes: 'Felt solid',
      duplicateOfId: null,
      duplicateStatus: 'none',
    })
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: log.id } })).activityId,
    ).toBe(watch.id)
  })

  test('the entry the runner starts from is the copy when the sources rank alike', async () => {
    const b = await seed('strength', 'intervals')
    const c = await seed('strength', 'intervals', { durationSec: 3000 })
    const res = await merge(b.id, c.id)
    expect(res.status).toBe(200)
    expect((await row(b.id)).duplicateOfId).toBe(c.id)
  })

  test('a run with a strength session is refused with a 409', async () => {
    const run = await seed('run', 'intervals')
    const strength = await seed('strength', 'manual')
    const res = await merge(run.id, strength.id)
    expect(res.status).toBe(409)
    expect((res.body as { error: { message: string } }).error.message).toMatch(/run with a run/)
    expect((await row(strength.id)).duplicateStatus).toBe('none')
  })

  test('a race merges with a run', async () => {
    const race = await seed('race', 'manual')
    const run = await seed('run', 'file')
    expect((await merge(race.id, run.id)).status).toBe(200)
    expect((await row(race.id)).duplicateOfId).toBe(run.id)
  })

  test('entries two days apart are refused; one day apart is allowed', async () => {
    const a = await seed('strength', 'manual')
    const far = await seed('strength', 'intervals', { date: addDays(today, -2) })
    const near = await seed('strength', 'intervals', { date: yesterday })
    const refused = await merge(a.id, far.id)
    expect(refused.status).toBe(409)
    expect((refused.body as { error: { message: string } }).error.message).toMatch(/within a day/)
    expect((await merge(a.id, near.id)).status).toBe(200)
  })

  test('an entry that is already a confirmed duplicate of another is refused', async () => {
    const original = await seed('strength', 'intervals')
    const copy = await seed('strength', 'manual', { status: 'confirmed', of: original.id })
    const other = await seed('strength', 'file')
    const res = await merge(copy.id, other.id)
    expect(res.status).toBe(409)
    expect((res.body as { error: { message: string } }).error.message).toMatch(/already merged/)
    expect((await row(copy.id)).duplicateOfId).toBe(original.id)
  })

  test('merging again changes nothing and answers 200', async () => {
    const app = await seed('strength', 'manual', { rpe: 6 })
    const watch = await seed('strength', 'intervals')
    expect((await merge(app.id, watch.id)).status).toBe(200)
    const before = await row(app.id)
    const again = await merge(watch.id, app.id)
    expect(again.status).toBe(200)
    expect((again.body as Activity).id).toBe(app.id)
    expect(await row(app.id)).toEqual(before)
  })

  test('an entry with itself, an unknown id and another runner’s entry are refused or not found', async () => {
    const a = await seed('strength', 'manual')
    expect((await merge(a.id, a.id)).status).toBe(409)
    expect((await merge(a.id, 'missing')).status).toBe(404)
    const stranger = await ctx.prisma.user.create({
      data: { email: 'other@example.com', passwordHash: 'x' },
    })
    const theirs = await ctx.prisma.activity.create({
      data: {
        userId: stranger.id,
        date: today,
        type: 'strength',
        durationSec: 2400,
        source: 'intervals',
        providerKey: 'intervals:theirs',
      },
    })
    expect((await merge(a.id, theirs.id)).status).toBe(404)
    await ctx.prisma.user.delete({ where: { id: stranger.id } })
  })

  test('the body is parsed', async () => {
    const a = await seed('strength', 'manual')
    const res = await client(ctx, user).post(`/api/activities/${a.id}/merge`).send({})
    expect(res.status).toBe(400)
  })

  test('a fuel log and a plan session move to the record', async () => {
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: user.id,
        name: 'Synthetic half',
        priority: 'A',
        targetDate: addDays(today, 90),
        distanceM: 21_097,
      },
    })
    const plan = await ctx.prisma.plan.create({
      data: {
        userId: user.id,
        goalId: goal.id,
        name: goal.name,
        startDate: mondayOf(today),
        raceWeekStart: mondayOf(goal.targetDate),
        generatorVersion: 2,
        weeks: {
          create: [
            {
              weekStart: mondayOf(today),
              index: 0,
              phase: 'build',
              baselineRunMin: 200,
              targetRunMin: 200,
              longRunMin: 70,
              runDays: 4,
              strengthSessions: 1,
            },
          ],
        },
      },
    })
    const typed = await seed('run', 'manual', { rpe: 5 })
    const device = await seed('run', 'file')
    const session = await ctx.prisma.planSession.create({
      data: {
        planId: plan.id,
        externalId: randomUUID(),
        weekStart: mondayOf(today),
        date: today,
        order: 1,
        kind: 'easy',
        title: 'Easy run',
        durationMin: 40,
        structure: '[]',
        target: JSON.stringify({
          zone: 'z1',
          rpe: [2, 3],
          hr: null,
          paceSecPerKm: null,
          heatNote: null,
        }),
        purpose: 'Synthetic.',
        status: 'completed',
        activityId: typed.id,
        linkSource: 'owner',
      },
    })
    const fuel = await ctx.prisma.fuelLog.create({
      data: { userId: user.id, activityId: typed.id, skipped: true },
    })

    expect((await merge(typed.id, device.id)).status).toBe(200)

    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })).activityId,
    ).toBe(device.id)
    expect(
      (await ctx.prisma.fuelLog.findUniqueOrThrow({ where: { id: fuel.id } })).activityId,
    ).toBe(device.id)
    expect((await row(device.id)).rpe).toBe(5)
  })

  test('copies of the entry that becomes the copy are pointed at the record', async () => {
    const record = await seed('run', 'file')
    const typed = await seed('run', 'manual')
    const stravaCopy = await seed('run', 'smashrun', { status: 'confirmed', of: typed.id })
    expect((await merge(typed.id, record.id)).status).toBe(200)
    expect((await row(stravaCopy.id)).duplicateOfId).toBe(record.id)
  })
})

describe('separating a merged entry', () => {
  test('POST /:id/duplicate with dismissed counts it again and the pass leaves the pair alone', async () => {
    // A pair the pass would flag on its own (same day, lengths within 5%, no start instants).
    const app = await seed('strength', 'manual', { durationSec: 2700 })
    const watch = await seed('strength', 'intervals', { durationSec: 2760 })
    expect((await merge(app.id, watch.id)).status).toBe(200)

    const res = await client(ctx, user)
      .post(`/api/activities/${app.id}/duplicate`)
      .send({ status: 'dismissed' })
    expect(res.status).toBe(200)
    expect(await row(app.id)).toMatchObject({ duplicateStatus: 'dismissed' })

    expect(await markDuplicates(ctx.prisma, user.id, [app.id, watch.id])).toBe(0)
    expect(await row(app.id)).toMatchObject({ duplicateStatus: 'dismissed' })
    expect(await row(watch.id)).toMatchObject({ duplicateStatus: 'none', duplicateOfId: null })
  })

  test('a log that moved stays on the record: the data model keeps no origin for it', async () => {
    const app = await seed('strength', 'manual')
    const watch = await seed('strength', 'intervals')
    const log = await strengthLog(app.id)
    await merge(app.id, watch.id)
    await client(ctx, user)
      .post(`/api/activities/${app.id}/duplicate`)
      .send({ status: 'dismissed' })
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: log.id } })).activityId,
    ).toBe(watch.id)
  })
})

describe('GET /api/activities/:id/merge-candidates', () => {
  test('lists the same kind within a day and nothing else, with what the picker needs', async () => {
    const me = await seed('strength', 'manual')
    const watch = await seed('strength', 'intervals', {
      date: yesterday,
      durationSec: 2760,
      avgHr: 118,
      startTime: '07:10',
    })
    await seed('strength', 'file', { date: addDays(today, -2) })
    await seed('run', 'file')
    await seed('race', 'file')
    const merged = await seed('strength', 'smashrun', { status: 'confirmed', of: watch.id })
    const res = await client(ctx, user).get(`/api/activities/${me.id}/merge-candidates`)
    expect(res.status).toBe(200)
    const body = res.body as MergeCandidate[]
    expect(body).toEqual([
      {
        id: watch.id,
        date: yesterday,
        startTime: '07:10',
        type: 'strength',
        durationSec: 2760,
        source: 'intervals',
        avgHr: 118,
      },
    ])
    expect(body.map((c) => c.id)).not.toContain(merged.id)
  })

  test('a race is offered runs, and a merged copy has no candidates', async () => {
    const race = await seed('race', 'manual')
    const run = await seed('run', 'file', { date: yesterday })
    const strength = await seed('strength', 'file')
    const res = await client(ctx, user).get(`/api/activities/${race.id}/merge-candidates`)
    expect((res.body as MergeCandidate[]).map((c) => c.id)).toEqual([run.id])
    expect((res.body as MergeCandidate[]).map((c) => c.id)).not.toContain(strength.id)

    await merge(race.id, run.id)
    const after = await client(ctx, user).get(`/api/activities/${race.id}/merge-candidates`)
    expect(after.body).toEqual([])
  })

  test('another runner’s activity is not found', async () => {
    const res = await client(ctx, user).get('/api/activities/missing/merge-candidates')
    expect(res.status).toBe(404)
  })

  test('needs a session', async () => {
    const a = await seed('strength', 'manual')
    expect((await client(ctx).get(`/api/activities/${a.id}/merge-candidates`)).status).toBe(401)
  })
})
