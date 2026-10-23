import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { SessionSpec } from '../../shared/engine/types.ts'
import type { PlanSession, PlanWithSessions, TodayView } from '../../shared/types.ts'
import type { PlanSession as PlanSessionRow } from '../../server/db.ts'
import { sessionSpec } from '../../server/services/engineInput.ts'
import { replanActivePlan, writeReplannedSessions } from '../../server/services/planEngine.ts'
import { toPlanSession } from '../../server/serialize.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// Session identity (spec 4.1, 5.9): a session keeps its id and externalId through every write that
// keeps it, and a re-plan or a regenerate pairs sessions by (date, kind, occurrence).
// A Monday, so that a Monday re-plan is the weekly job's re-plan. Only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 19, 12))

const today = todayIso()
const thisMonday = mondayOf(today)
const nextMonday = addDays(thisMonday, 7)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  vi.setSystemTime(new Date(2026, 9, 19, 12))
})

const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

/** Twelve completed weeks of four runs, so the engine has a history to build on. */
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

/** A user with a history, a four-week goal and the plan the engine builds for it today. */
async function fourWeekPlan(
  email: string,
): Promise<{ u: TestUser; goalId: string; plan: PlanWithSessions }> {
  const u = await seedUser(ctx, { email })
  await seedHistory(u.id)
  // A race result gives the prediction something to stand on.
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
  return { u, goalId: goal.id, plan: res.body as PlanWithSessions }
}

const rowsOf = (planId: string) =>
  ctx.prisma.planSession.findMany({
    where: { planId },
    orderBy: [{ date: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  })

/** The identity columns that must survive: id to externalId, for every row of the plan. */
async function identities(planId: string): Promise<Map<string, string>> {
  return new Map((await rowsOf(planId)).map((r) => [r.id, r.externalId]))
}

describe('a Monday re-plan of an unchanged plan', () => {
  test('keeps every id and externalId, the links and the unchanged columns', async () => {
    const { u, plan } = await fourWeekPlan('monday-replan@example.com')
    expect(plan.weeks.length).toBeGreaterThanOrEqual(4)
    const before = await rowsOf(plan.id)
    expect(before.length).toBeGreaterThan(15)
    expect(before.every((r) => r.date >= today)).toBe(true)

    // A run of the week before fulfils a session of next week. The re-plan replaces that session
    // (it is neither current nor an owner edit), so the link must survive the write.
    const linkable = before.find((r) => r.weekStart === nextMonday && r.kind === 'easy')!
    const run = await ctx.prisma.activity.findFirstOrThrow({
      where: { userId: u.id, type: 'run' },
      orderBy: { date: 'desc' },
    })
    const linked = await client(ctx, u)
      .post(`/api/plan/sessions/${linkable.id}/link`)
      .send({ activityId: run.id })
    expect(linked.status, JSON.stringify(linked.body)).toBe(200)
    const linkedBefore = await ctx.prisma.planSession.findUniqueOrThrow({
      where: { id: linkable.id },
    })
    expect(linkedBefore.activityId).toBe(run.id)

    const predictions = await ctx.prisma.predictionLog.count({ where: { userId: u.id } })
    const revision = await replanActivePlan(deps(), {
      userId: u.id,
      reason: 'weekly',
      today: thisMonday,
    })
    expect(revision).toMatchObject({ planId: plan.id, reason: 'weekly' })

    const after = await rowsOf(plan.id)
    expect(new Map(after.map((r) => [r.id, r.externalId]))).toEqual(
      new Map(before.map((r) => [r.id, r.externalId])),
    )
    expect(after).toHaveLength(before.length)
    const previous = new Map(before.map((r) => [r.id, r]))
    for (const row of after) {
      const old = previous.get(row.id)!
      expect(row.externalId, row.id).toBe(old.externalId)
      expect(row.externalId).toMatch(UUID_V4)
      if (row.id !== linkable.id) {
        // Nothing about an unchanged session is rewritten.
        expect(row.updatedAt.getTime(), row.id).toBe(old.updatedAt.getTime())
      }
    }
    expect(new Set(after.map((r) => r.externalId)).size).toBe(after.length)

    // The linked session is still linked, with its assessment and status.
    const stillLinked = after.find((r) => r.id === linkable.id)!
    expect(stillLinked).toMatchObject({
      activityId: run.id,
      linkSource: 'owner',
      status: linkedBefore.status,
      execution: linkedBefore.execution,
    })

    // One revision is written with the sessions, in the same transaction. The week already holds
    // the prediction that the generate logged, so the re-plan refreshes that row and adds none.
    expect(await ctx.prisma.planRevision.count({ where: { planId: plan.id } })).toBe(2)
    expect(await ctx.prisma.predictionLog.count({ where: { userId: u.id } })).toBe(predictions)
  })

  test('keeps the externalIds that every route serves', async () => {
    const { u, plan } = await fourWeekPlan('monday-served@example.com')
    const served = (await client(ctx, u).get('/api/plan')).body as PlanWithSessions
    const first = new Map(served.sessions.map((s) => [s.id, s.externalId]))
    await replanActivePlan(deps(), { userId: u.id, reason: 'weekly', today: thisMonday })
    const again = (await client(ctx, u).get('/api/plan')).body as PlanWithSessions
    expect(again.id).toBe(plan.id)
    expect(new Map(again.sessions.map((s) => [s.id, s.externalId]))).toEqual(first)
  })
})

// ---------------------------------------------------------------------------------------------
// The row-level write, with hand-made plans so that every case is exact
// ---------------------------------------------------------------------------------------------

const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})

interface Seed {
  date: string
  kind: string
  order?: number
  min?: number
  status?: string
  rules?: string[]
  activityId?: string
  original?: string
}

/** A version-2 plan with hand-made sessions. */
async function planWith(email: string, seeds: Seed[]) {
  const u = await seedUser(ctx, { email })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: thisMonday,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
    },
  })
  const rows: PlanSessionRow[] = []
  for (const [i, s] of seeds.entries()) {
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: randomUUID(),
          weekStart: mondayOf(s.date),
          date: s.date,
          order: s.order ?? 0,
          kind: s.kind,
          title: `${s.kind} ${i}`,
          durationMin: s.min ?? 40,
          target: TARGET,
          purpose: 'Synthetic.',
          rules: JSON.stringify(s.rules ?? ['f-1']),
          status: s.status ?? 'planned',
          activityId: s.activityId ?? null,
          linkSource: s.activityId === undefined ? null : 'owner',
          execution: s.activityId === undefined ? null : JSON.stringify({ synthetic: true }),
          original: s.original ?? null,
        },
      }),
    )
  }
  return { u, plan, rows }
}

const specOfRow = (row: PlanSessionRow): SessionSpec => sessionSpec(toPlanSession(row))
const write = (planId: string, sessions: SessionSpec[]) =>
  ctx.prisma.$transaction((tx) => writeReplannedSessions(tx, { planId, today, sessions }))
const byId = (id: string) => ctx.prisma.planSession.findUniqueOrThrow({ where: { id } })

describe('the row-level re-plan write', () => {
  test('updates a paired row in place and returns the write set', async () => {
    const { plan, rows } = await planWith('write-update@example.com', [
      { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
      { date: addDays(nextMonday, 3), kind: 'easy', min: 45 },
      { date: addDays(nextMonday, 5), kind: 'long', min: 90 },
    ])
    const [tue, thu, sat] = rows as [PlanSessionRow, PlanSessionRow, PlanSessionRow]
    // Tuesday is unchanged, Thursday is shortened, Saturday gets a new title and prescription.
    const draft = [
      specOfRow(tue),
      { ...specOfRow(thu), durationMin: 35, distanceM: 5600 },
      {
        ...specOfRow(sat),
        title: 'Long run, steadier',
        purpose: 'Sturdier.',
        rules: ['f-1', 'g-1'],
      },
    ]
    const written = await write(plan.id, draft)

    expect(written.created).toEqual([])
    expect(written.deleted).toEqual([])
    expect(written.updated.map((u) => u.id).sort()).toEqual([thu.id, sat.id].sort())

    const thursday = written.updated.find((u) => u.id === thu.id)!
    expect(thursday.before).toEqual(thu)
    expect(thursday.after).toMatchObject({
      id: thu.id,
      externalId: thu.externalId,
      planId: plan.id,
      durationMin: 35,
      distanceM: 5600,
    })
    expect(thursday.after).toEqual(await byId(thu.id))

    for (const row of [thu, sat]) {
      const stored = await byId(row.id)
      expect(stored.externalId).toBe(row.externalId)
      expect(stored.planId).toBe(plan.id)
    }
    expect(await byId(sat.id)).toMatchObject({ title: 'Long run, steadier', trimmed: false })
    expect(JSON.parse((await byId(sat.id)).rules) as string[]).toEqual(['f-1', 'g-1'])
    // The unchanged row is not written: not even its updatedAt moves.
    expect((await byId(tue.id)).updatedAt.getTime()).toBe(tue.updatedAt.getTime())
    expect(await rowsOf(plan.id)).toHaveLength(3)
  })

  test('derives trimmed and status from the new rules, through sessionRow', async () => {
    const { plan, rows } = await planWith('write-trimmed@example.com', [
      { date: addDays(nextMonday, 2), kind: 'threshold', min: 50 },
    ])
    const draft = [{ ...specOfRow(rows[0]!), rules: ['C8', 'design-4.3'] }]
    await write(plan.id, draft)
    expect(await byId(rows[0]!.id)).toMatchObject({ trimmed: true, status: 'downgraded' })
  })

  test('a changed kind is a deletion plus a creation with a new externalId', async () => {
    const { plan, rows } = await planWith('write-kind@example.com', [
      { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
      { date: addDays(nextMonday, 3), kind: 'easy', min: 45 },
    ])
    const [tue, thu] = rows as [PlanSessionRow, PlanSessionRow]
    const draft = [
      { ...specOfRow(tue), kind: 'threshold' as const, title: 'Threshold' },
      specOfRow(thu),
    ]
    const written = await write(plan.id, draft)

    expect(written.updated).toEqual([])
    expect(written.deleted).toEqual([tue])
    expect(written.created).toHaveLength(1)
    const created = written.created[0]!
    expect(created).toMatchObject({ kind: 'threshold', date: tue.date, planId: plan.id })
    expect(created.id).not.toBe(tue.id)
    expect(created.externalId).toMatch(UUID_V4)
    expect(created.externalId).not.toBe(tue.externalId)
    expect(await ctx.prisma.planSession.findUnique({ where: { id: tue.id } })).toBeNull()
    expect((await byId(thu.id)).externalId).toBe(thu.externalId)
  })

  test('a changed date is a deletion plus a creation with a new externalId', async () => {
    const { plan, rows } = await planWith('write-date@example.com', [
      { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
    ])
    const tue = rows[0]!
    const written = await write(plan.id, [{ ...specOfRow(tue), date: addDays(nextMonday, 2) }])
    expect(written.deleted).toEqual([tue])
    expect(written.created).toHaveLength(1)
    expect(written.created[0]).toMatchObject({ date: addDays(nextMonday, 2), kind: 'easy' })
    expect(written.created[0]!.externalId).not.toBe(tue.externalId)
  })

  test('two sessions of one kind on a day keep their pairs by occurrence', async () => {
    const day = addDays(nextMonday, 1)
    const { plan, rows } = await planWith('write-twins@example.com', [
      { date: day, kind: 'strength', order: 1, min: 20 },
      { date: day, kind: 'strength', order: 2, min: 25 },
    ])
    const [first, second] = rows as [PlanSessionRow, PlanSessionRow]
    // A run takes order 0 and the strength sessions shift by one; their pairs stay.
    const draft = [
      { ...specOfRow(first), order: 2 },
      { ...specOfRow(second), order: 3 },
      { ...specOfRow(first), kind: 'easy' as const, order: 0, title: 'Easy run' },
    ]
    const written = await write(plan.id, draft)
    expect(written.deleted).toEqual([])
    expect(written.created.map((r) => r.kind)).toEqual(['easy'])
    expect((await byId(first.id)).order).toBe(2)
    expect((await byId(second.id)).order).toBe(3)
    expect((await byId(first.id)).externalId).toBe(first.externalId)
    expect((await byId(second.id)).externalId).toBe(second.externalId)
  })

  test('a draft with one session fewer of a kind deletes only the surplus', async () => {
    const day = addDays(nextMonday, 1)
    const { plan, rows } = await planWith('write-surplus@example.com', [
      { date: day, kind: 'strength', order: 0 },
      { date: day, kind: 'strength', order: 1 },
    ])
    const written = await write(plan.id, [specOfRow(rows[0]!)])
    expect(written.deleted).toEqual([rows[1]])
    expect(written.created).toEqual([])
    expect(written.updated).toEqual([])
  })

  test('keeps kept rows out of pairing', async () => {
    // Next Wednesday holds an owner-moved strength session (kept, order 2) and a planned one that
    // the re-plan replaces (order 1). The engine puts back the kept one unchanged and adds a new
    // strength session after it (order 3). Pairing by order alone would put the planned row with
    // the kept session's copy and the kept row with the new session.
    const wednesday = addDays(nextMonday, 2)
    const { plan, rows } = await planWith('write-kept@example.com', [
      { date: addDays(today, -1), kind: 'easy', status: 'completed' },
      { date: wednesday, kind: 'strength', order: 1, min: 20 },
      { date: wednesday, kind: 'strength', order: 2, min: 25, status: 'moved' },
    ])
    const [done, planned, moved] = rows as [PlanSessionRow, PlanSessionRow, PlanSessionRow]
    const draft = [
      specOfRow(done),
      specOfRow(moved),
      { ...specOfRow(planned), order: 3, title: 'New strength', durationMin: 15 },
    ]
    const written = await write(plan.id, draft)

    expect(written.created).toEqual([])
    expect(written.deleted).toEqual([])
    expect(written.updated.map((u) => u.id)).toEqual([planned.id])
    expect(await byId(planned.id)).toMatchObject({ order: 3, title: 'New strength' })
    // The kept rows are exactly as they were.
    for (const kept of [done, moved]) expect(await byId(kept.id)).toEqual(kept)
  })

  test('keeps the activity link of a replaced session and its status', async () => {
    const activity = await seedUserActivity()
    const { plan, rows } = await planWith('write-linked@example.com', [
      {
        date: addDays(nextMonday, 1),
        kind: 'easy',
        status: 'completed',
        activityId: activity.id,
      },
    ])
    const row = rows[0]!
    const written = await write(plan.id, [{ ...specOfRow(row), durationMin: 30, title: 'Easier' }])
    expect(written.deleted).toEqual([])
    expect(written.created).toEqual([])
    expect(written.updated).toHaveLength(1)
    expect(await byId(row.id)).toMatchObject({
      id: row.id,
      externalId: row.externalId,
      activityId: activity.id,
      linkSource: 'owner',
      execution: row.execution,
      status: 'completed',
      durationMin: 30,
      title: 'Easier',
    })
  })

  test('drops the owner edit of a replaced row beyond the kept days, as a new session would', async () => {
    const day = addDays(today, 20)
    const { plan, rows } = await planWith('write-edit@example.com', [
      {
        date: day,
        kind: 'easy',
        status: 'moved',
        original: JSON.stringify({ date: addDays(day, -1) }),
      },
    ])
    const row = rows[0]!
    await write(plan.id, [specOfRow(row)])
    expect(await byId(row.id)).toMatchObject({
      externalId: row.externalId,
      status: 'planned',
      original: null,
    })
  })

  test('creates only unpaired drafts and gives each a distinct uuid', async () => {
    const { plan, rows } = await planWith('write-create@example.com', [
      { date: addDays(nextMonday, 1), kind: 'easy' },
    ])
    const extra = [2, 3, 4].map((day) => ({
      ...specOfRow(rows[0]!),
      date: addDays(nextMonday, day),
      title: `Easy ${day}`,
    }))
    const written = await write(plan.id, [specOfRow(rows[0]!), ...extra])
    expect(written.updated).toEqual([])
    expect(written.deleted).toEqual([])
    expect(written.created).toHaveLength(3)
    const ids = written.created.map((r) => r.externalId)
    expect(new Set([...ids, rows[0]!.externalId]).size).toBe(4)
    for (const id of ids) expect(id).toMatch(UUID_V4)
    expect(await rowsOf(plan.id)).toHaveLength(4)
  })
})

/** An activity of a user of its own, for a link. */
async function seedUserActivity() {
  const u = await seedUser(ctx, { email: `link-${randomUUID()}@example.com` })
  return ctx.prisma.activity.create({
    data: {
      userId: u.id,
      date: addDays(today, -3),
      type: 'run',
      durationSec: 2400,
      distanceM: 6000,
      source: 'manual',
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Regenerate
// ---------------------------------------------------------------------------------------------

describe('regenerate', () => {
  test('carries externalIds to the paired sessions dated today or later', async () => {
    const { u, goalId, plan: first } = await fourWeekPlan('regenerate@example.com')
    const oldRows = await rowsOf(first.id)

    // Three days later (Thursday): the first week has passed in part.
    const thursday = addDays(thisMonday, 3)
    vi.setSystemTime(new Date(2026, 9, 22, 12))
    expect(todayIso()).toBe(thursday)
    const res = await client(ctx, u).post('/api/plan/generate').send({ goalId })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const second = res.body as PlanWithSessions
    expect(second.id).not.toBe(first.id)
    expect(await ctx.prisma.plan.findUnique({ where: { id: first.id } })).toMatchObject({
      status: 'archived',
    })

    const newRows = await rowsOf(second.id)
    expect(newRows.length).toBeGreaterThan(20)
    expect(new Set(newRows.map((r) => r.externalId)).size).toBe(newRows.length)

    // Expected carry, worked out by hand: the n-th session of a kind on a day takes the id of the
    // n-th session of that kind on that day in the plan that was archived.
    const slot = (r: PlanSessionRow, rank: number) => `${r.date}|${r.kind}|${rank}`
    const ranked = (rows: PlanSessionRow[]) => {
      const seen = new Map<string, number>()
      return rows.map((r) => {
        const key = `${r.date}|${r.kind}`
        const rank = seen.get(key) ?? 0
        seen.set(key, rank + 1)
        return slot(r, rank)
      })
    }
    const archivedIds = new Map(
      ranked(oldRows.filter((r) => r.date >= thursday)).map((key, i) => [
        key,
        oldRows.filter((r) => r.date >= thursday)[i]!.externalId,
      ]),
    )
    const keys = ranked(newRows)
    let carried = 0
    for (const [i, row] of newRows.entries()) {
      const expected = archivedIds.get(keys[i]!)
      if (expected === undefined) {
        expect(oldRows.map((r) => r.externalId)).not.toContain(row.externalId)
      } else {
        expect(row.externalId, keys[i]).toBe(expected)
        carried += 1
      }
    }
    expect(carried).toBeGreaterThan(10)
    // Sessions of the archived plan dated before today are not carried.
    for (const old of oldRows.filter((r) => r.date < thursday)) {
      expect(newRows.map((r) => r.externalId)).not.toContain(old.externalId)
    }
    // The archived plan is as it was.
    expect((await rowsOf(first.id)).map((r) => r.externalId)).toEqual(
      oldRows.map((r) => r.externalId),
    )
  })

  test('gives fresh uuids when the user has no earlier plan', async () => {
    const { plan } = await fourWeekPlan('regenerate-none@example.com')
    const rows = await rowsOf(plan.id)
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(rows.length)
    for (const r of rows) expect(r.externalId).toMatch(UUID_V4)
  })
})

// ---------------------------------------------------------------------------------------------
// Owner edits
// ---------------------------------------------------------------------------------------------

describe('owner edits', () => {
  test('move, swap, skip and restore keep the id and externalId of every row', async () => {
    const { u, plan, rows } = await planWith('owner-edits@example.com', [
      { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
      { date: addDays(nextMonday, 3), kind: 'threshold', min: 40 },
      { date: addDays(nextMonday, 5), kind: 'long', min: 90 },
    ])
    const [easy, threshold, long] = rows as [PlanSessionRow, PlanSessionRow, PlanSessionRow]
    const c = client(ctx, u)
    const before = await identities(plan.id)

    const moved = await c
      .put(`/api/plan/sessions/${easy.id}`)
      .send({ date: addDays(nextMonday, 2) })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)
    expect(moved.body).toMatchObject({ id: easy.id, externalId: easy.externalId, status: 'moved' })
    expect(await identities(plan.id)).toEqual(before)

    const swapped = await c.put(`/api/plan/sessions/${easy.id}`).send({ kind: 'threshold' })
    expect(swapped.status, JSON.stringify(swapped.body)).toBe(200)
    expect(swapped.body).toMatchObject({
      id: easy.id,
      externalId: easy.externalId,
      kind: 'threshold',
    })
    expect(await byId(threshold.id)).toMatchObject({
      kind: 'easy',
      externalId: threshold.externalId,
    })
    expect(await identities(plan.id)).toEqual(before)

    const skipped = await c.put(`/api/plan/sessions/${long.id}`).send({ skip: true })
    expect(skipped.body).toMatchObject({
      id: long.id,
      externalId: long.externalId,
      status: 'skipped',
    })
    expect(await identities(plan.id)).toEqual(before)

    const restored = await c.put(`/api/plan/sessions/${long.id}`).send({ skip: false })
    expect(restored.body).toMatchObject({
      id: long.id,
      externalId: long.externalId,
      status: 'planned',
    })
    expect(await identities(plan.id)).toEqual(before)
  })
})

// ---------------------------------------------------------------------------------------------
// What the routes serve
// ---------------------------------------------------------------------------------------------

describe('externalId in the API', () => {
  test('GET /api/plan, the session routes and GET /api/today expose it', async () => {
    const { u, plan, rows } = await planWith('served@example.com', [
      { date: today, kind: 'easy', min: 40 },
      { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
      { date: addDays(nextMonday, 4), kind: 'long', min: 80 },
    ])
    const [now, tue, fri] = rows as [PlanSessionRow, PlanSessionRow, PlanSessionRow]
    const c = client(ctx, u)

    const served = (await c.get('/api/plan')).body as PlanWithSessions
    expect(served.id).toBe(plan.id)
    expect(new Map(served.sessions.map((s) => [s.id, s.externalId]))).toEqual(
      new Map(rows.map((r) => [r.id, r.externalId])),
    )

    const put = await c.put(`/api/plan/sessions/${tue.id}`).send({ date: addDays(nextMonday, 2) })
    expect((put.body as PlanSession).externalId).toBe(tue.externalId)

    const run = await ctx.prisma.activity.create({
      data: {
        userId: u.id,
        date: today,
        type: 'run',
        durationSec: 2400,
        distanceM: 6000,
        rpe: 3,
        source: 'manual',
      },
    })
    const link = await c.post(`/api/plan/sessions/${now.id}/link`).send({ activityId: run.id })
    expect(link.status, JSON.stringify(link.body)).toBe(200)
    expect((link.body as PlanSession).externalId).toBe(now.externalId)

    const view = (await c.get('/api/today')).body as TodayView
    expect(view.sessions.map((entry) => entry.session.externalId)).toEqual([now.externalId])

    const skip = await c.put(`/api/plan/sessions/${fri.id}`).send({ skip: true })
    expect((skip.body as PlanSession).externalId).toBe(fri.externalId)
  })
})
