import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { Activity, PlanWithSessions } from '../../shared/types.ts'
import {
  markDuplicates,
  moveConfirmedLogs,
  releaseDuplicates,
} from '../../server/services/duplicates.ts'
import { assessSessionById, assessSessionsQuietly } from '../../server/services/execution.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// A confirmed duplicate hands its plan session to the original, as it hands its logs (D1).

let ctx: TestCtx
let user: TestUser
let planId: string

const today = todayIso()
const START = `${today}T07:00:00Z`
const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})

beforeAll(async () => {
  ctx = await createTestCtx()
  user = await seedUser(ctx)
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  await ctx.prisma.plan.deleteMany()
  await ctx.prisma.activity.deleteMany()
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
  planId = plan.id
})

let order = 0
async function session(
  kind: string,
  over: { activityId?: string; linkSource?: string; date?: string; min?: number } = {},
) {
  order += 1
  return ctx.prisma.planSession.create({
    data: {
      planId,
      externalId: randomUUID(),
      weekStart: mondayOf(over.date ?? today),
      date: over.date ?? today,
      order,
      kind,
      title: kind === 'strength' ? 'Strength' : `${kind} run`,
      durationMin: over.min ?? 40,
      structure: '[]',
      target: TARGET,
      purpose: 'Synthetic.',
      status: over.activityId === undefined ? 'planned' : 'completed',
      activityId: over.activityId ?? null,
      linkSource: over.linkSource ?? null,
    },
  })
}

let seq = 0
async function activity(
  type: 'run' | 'strength',
  source: string,
  over: {
    startUtc?: string | null
    avgHr?: number | null
    status?: string
    of?: string
    id?: string
    date?: string
    durationSec?: number
    rpe?: number
  } = {},
) {
  seq += 1
  return ctx.prisma.activity.create({
    data: {
      ...(over.id === undefined ? {} : { id: over.id }),
      userId: user.id,
      date: over.date ?? today,
      type,
      durationSec: over.durationSec ?? 2400,
      ...(over.rpe === undefined ? {} : { rpe: over.rpe }),
      distanceM: type === 'run' ? 5000 : null,
      source,
      providerKey: source === 'manual' ? null : `${source}:${String(seq)}`,
      startUtc: over.startUtc ?? null,
      avgHr: over.avgHr ?? null,
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
        create: Array.from({ length: 11 }, (_, position) => ({
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

async function reload(id: string) {
  return ctx.prisma.planSession.findUniqueOrThrow({ where: { id } })
}

async function logOwner(): Promise<string> {
  return (await ctx.prisma.strengthLog.findFirstOrThrow({ where: { userId: user.id } })).activityId
}

async function confirm(id: string) {
  return client(ctx, user).post(`/api/activities/${id}/duplicate`).send({ status: 'confirmed' })
}

/** What the Plan page reads for the session, then the activity it opens. */
async function planRead(
  sessionId: string,
): Promise<{ activityId: string | null; opens: Activity }> {
  const plan = (await client(ctx, user).get('/api/plan')).body as PlanWithSessions
  const row = plan.sessions.find((s) => s.id === sessionId)
  expect(row).toBeDefined()
  const activityId = row?.activityId ?? null
  const opened = await client(ctx, user).get(`/api/activities/${String(activityId)}`)
  return { activityId, opens: opened.body as Activity }
}

/** A manual strength copy with a log and an owner-linked completed session, and its import. */
async function strengthPair() {
  const original = await activity('strength', 'intervals', { startUtc: START, avgHr: 118 })
  const copy = await activity('strength', 'manual', { status: 'possible', of: original.id })
  await strengthLog(copy.id)
  const linked = await session('strength', { activityId: copy.id, linkSource: 'owner' })
  return { original, copy, linked }
}

describe('confirming a duplicate moves the plan session with the logs', () => {
  test('a strength copy: log and session go to the original, status and link source stay', async () => {
    const { original, copy, linked } = await strengthPair()
    expect((await confirm(copy.id)).status).toBe(200)

    expect(await logOwner()).toBe(original.id)
    expect(await reload(linked.id)).toMatchObject({
      activityId: original.id,
      linkSource: 'owner',
      status: 'completed',
    })
    const read = await planRead(linked.id)
    expect(read.activityId).toBe(original.id)
    expect(read.opens).toMatchObject({ startUtc: START, avgHr: 118 })
  })

  test('the automatic confirm of the pass does the same', async () => {
    const copy = await activity('strength', 'strava', { startUtc: `${today}T07:01:00Z` })
    await strengthLog(copy.id)
    const linked = await session('strength', { activityId: copy.id, linkSource: 'auto' })
    const original = await activity('strength', 'file', { startUtc: START, avgHr: 121 })
    await markDuplicates(ctx.prisma, user.id, [original.id])

    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id: copy.id } })).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: original.id,
    })
    expect(await logOwner()).toBe(original.id)
    expect(await reload(linked.id)).toMatchObject({
      activityId: original.id,
      linkSource: 'auto',
      status: 'completed',
    })
    expect((await planRead(linked.id)).opens).toMatchObject({ startUtc: START, avgHr: 121 })
  })

  test('a run copy behaves the same way', async () => {
    const original = await activity('run', 'intervals', { startUtc: START, avgHr: 140 })
    const copy = await activity('run', 'manual', { status: 'possible', of: original.id })
    const linked = await session('easy', { activityId: copy.id, linkSource: 'owner' })
    expect((await confirm(copy.id)).status).toBe(200)
    expect(await reload(linked.id)).toMatchObject({
      activityId: original.id,
      linkSource: 'owner',
      status: 'completed',
    })
    expect((await planRead(linked.id)).opens).toMatchObject({ startUtc: START, avgHr: 140 })
  })

  test('an original that already fulfils a session leaves both links as they are', async () => {
    const { original, copy, linked } = await strengthPair()
    const other = await session('strength', { activityId: original.id, linkSource: 'auto' })
    expect((await confirm(copy.id)).status).toBe(200)
    expect((await reload(linked.id)).activityId).toBe(copy.id)
    expect((await reload(other.id)).activityId).toBe(original.id)
  })

  test('an original whose type does not fit the session leaves the link on the copy', async () => {
    const original = await activity('run', 'intervals', { startUtc: START })
    const copy = await activity('run', 'manual', { status: 'possible', of: original.id })
    const linked = await session('strength', { activityId: copy.id, linkSource: 'owner' })
    expect((await confirm(copy.id)).status).toBe(200)
    expect((await reload(linked.id)).activityId).toBe(copy.id)
  })

  test('of two confirmed copies that each fulfil a session, the lower id gives up its session', async () => {
    const original = await activity('run', 'file', { startUtc: START })
    // The higher id is inserted first, so only the ordering of the copies decides.
    const second = await activity('run', 'manual', {
      id: 'copy-b',
      status: 'confirmed',
      of: original.id,
    })
    const first = await activity('run', 'manual', {
      id: 'copy-a',
      status: 'confirmed',
      of: original.id,
    })
    const onSecond = await session('recovery', { activityId: second.id, linkSource: 'owner' })
    const onFirst = await session('easy', { activityId: first.id, linkSource: 'owner' })
    const moved: string[] = []
    await moveConfirmedLogs(ctx.prisma, user.id, original.id, moved)
    expect(moved).toEqual([onFirst.id])
    expect((await reload(onFirst.id)).activityId).toBe(original.id)
    expect((await reload(onSecond.id)).activityId).toBe(second.id)
  })
})

function expectOriginalFindings(
  before: string | null,
  row: { status: string; execution: string | null },
) {
  // The copy's 40 min of a planned 52 was partial; the original's 52 min is the whole session.
  expect(before).toContain('"completion":"partial"')
  expect(before).toContain('"min":40')
  expect(row.execution).toContain('"completion":"completed"')
  expect(row.execution).toContain('"min":52')
  expect(row.execution).not.toContain('"min":40')
  expect(row.status).toBe('completed')
}

describe('a moved session is assessed against the original', () => {
  const old = addDays(today, -20)
  const OLD_START = `${old}T07:00:00Z`

  /** A 40 min copy rated 7, linked and assessed, and a 52 min import it duplicates. */
  async function oldPair() {
    const original = await activity('run', 'intervals', {
      date: old,
      startUtc: OLD_START,
      durationSec: 52 * 60,
      avgHr: 140,
    })
    const copy = await activity('run', 'manual', {
      date: old,
      durationSec: 40 * 60,
      rpe: 7,
      status: 'possible',
      of: original.id,
    })
    const linked = await session('easy', {
      activityId: copy.id,
      linkSource: 'owner',
      date: old,
      min: 52,
    })
    await assessSessionById(ctx, { userId: user.id, sessionId: linked.id })
    const before = (await reload(linked.id)).execution
    expect(before).not.toBeNull()
    return { original, copy, linked, before }
  }

  test('through the route the stored findings describe the original', async () => {
    const { original, copy, linked, before } = await oldPair()
    expect((await confirm(copy.id)).status).toBe(200)
    const row = await reload(linked.id)
    expect(row.activityId).toBe(original.id)
    expect(row.linkSource).toBe('owner')
    expectOriginalFindings(before, row)
  })

  test('through markDuplicates with its assess callback', async () => {
    const { original, copy, linked, before } = await oldPair()
    await ctx.prisma.activity.update({
      where: { id: copy.id },
      data: { duplicateStatus: 'possible' },
    })
    // Same pair, confirmed by the pass: both sources automated and matched on start.
    await ctx.prisma.activity.update({
      where: { id: copy.id },
      data: {
        source: 'strava',
        providerKey: 'strava:old',
        startUtc: `${old}T07:01:00Z`,
        duplicateStatus: 'none',
        duplicateOfId: null,
      },
    })
    await markDuplicates(ctx.prisma, user.id, [original.id], (sessionIds) =>
      assessSessionsQuietly(ctx, { userId: user.id, sessionIds }),
    )
    const row = await reload(linked.id)
    expect(row.activityId).toBe(original.id)
    expectOriginalFindings(before, row)
  })
})

describe('releasing and deleting after the move', () => {
  test('releasing a confirmed copy moves neither the log nor the link back', async () => {
    const { original, copy, linked } = await strengthPair()
    await confirm(copy.id)
    await releaseDuplicates(ctx.prisma, user.id, original.id, ['confirmed'])
    expect((await reload(linked.id)).activityId).toBe(original.id)
    expect(await logOwner()).toBe(original.id)
  })

  test('dismissing a confirmed copy moves neither the log nor the link back', async () => {
    const { original, copy, linked } = await strengthPair()
    await confirm(copy.id)
    const res = await client(ctx, user)
      .post(`/api/activities/${copy.id}/duplicate`)
      .send({ status: 'dismissed' })
    expect(res.status).toBe(200)
    expect((await reload(linked.id)).activityId).toBe(original.id)
    expect(await logOwner()).toBe(original.id)
  })

  test('deleting the original frees the session, as it deletes the log', async () => {
    const { original, copy, linked } = await strengthPair()
    await confirm(copy.id)
    expect((await client(ctx, user).delete(`/api/activities/${original.id}`)).status).toBe(204)
    expect((await reload(linked.id)).activityId).toBeNull()
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(0)
  })
})
