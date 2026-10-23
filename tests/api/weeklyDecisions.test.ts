import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { ExecutionRecord } from '../../shared/engine/adapt.ts'
import type { ExecutionAssessment } from '../../shared/engine/types.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import type { PlanSession as PlanSessionRow, PrismaClient } from '../../server/db.ts'
import { executionRecordsByWeek, weeklyDecisions } from '../../server/services/planEngine.ts'
import { toPlanSession } from '../../server/serialize.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'

// The weekly decisions read the stored execution assessments of every requested week. They are
// fetched with one session query for any number of weeks, and give the same decisions as one query
// per week. A Wednesday; only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))

const today = todayIso()
const thisMonday = mondayOf(today)

let ctx: TestCtx
let deps: { prisma: TestCtx['prisma']; config: TestCtx['config'] }

beforeAll(async () => {
  ctx = await createTestCtx()
  deps = { prisma: ctx.prisma, config: ctx.config }
})

afterAll(async () => {
  await ctx.close()
})

function assessment(score: -2 | -1 | 0 | 1 | 2, flags: ExecutionAssessment['flags'] = []) {
  const value: ExecutionAssessment = {
    completion: 'completed',
    intensity: score > 0 ? 'above' : 'on',
    effort: {
      score,
      confidence: 'moderate',
      parts: { rpeDelta: null, feel: score, hrResidualZ: null, paceResidualPct: null },
    },
    conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
    flags,
    lines: [],
  }
  return JSON.stringify(value)
}

/** The per-week query the batched one replaces: the reference the batch is compared with. */
async function perWeekRecords(planId: string, weekStart: string): Promise<ExecutionRecord[]> {
  const rows = await ctx.prisma.planSession.findMany({
    where: { planId, weekStart, execution: { not: null } },
    orderBy: [{ date: 'asc' }, { order: 'asc' }],
  })
  return rows.map((row) => {
    const session = toPlanSession(row)
    return { date: session.date, kind: session.kind, assessment: session.execution! }
  })
}

describe('executionRecordsByWeek', () => {
  function fakeRow(weekStart: string, offset: number): PlanSessionRow {
    return {
      id: `s-${weekStart}-${offset}`,
      planId: 'p1',
      externalId: randomUUID(),
      weekStart,
      date: addDays(weekStart, offset),
      order: 0,
      kind: 'easy',
      title: 'Easy run',
      durationMin: 40,
      distanceM: null,
      gainM: null,
      structure: '[]',
      target: JSON.stringify({ zone: 'z1', rpe: [3, 4], hr: null, paceSecPerKm: null }),
      purpose: 'Synthetic.',
      rules: '[]',
      trimmed: false,
      flags: '[]',
      status: 'completed',
      activityId: null,
      linkSource: null,
      execution: assessment(0),
      original: null,
      updatedAt: new Date('2026-10-01T00:00:00Z'),
    }
  }

  test('issues one session query for 26 weeks and groups the rows by week', async () => {
    const weeks = Array.from({ length: 26 }, (_, i) => addDays(thisMonday, 7 * i))
    // Rows for the first, a middle and the last week; the other weeks have none.
    const rows = [
      fakeRow(weeks[0]!, 1),
      fakeRow(weeks[0]!, 3),
      fakeRow(weeks[13]!, 2),
      fakeRow(weeks[25]!, 5),
    ]
    const findMany = vi.fn((_args: unknown) => Promise.resolve(rows))
    const stub = { planSession: { findMany } } as unknown as Pick<PrismaClient, 'planSession'>

    const byWeek = await executionRecordsByWeek(stub, 'p1', weeks)

    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { planId: 'p1', weekStart: { in: weeks }, execution: { not: null } },
    })
    expect([...byWeek.keys()]).toEqual(weeks)
    expect(byWeek.get(weeks[0]!)?.map((r) => r.date)).toEqual([
      addDays(weeks[0]!, 1),
      addDays(weeks[0]!, 3),
    ])
    expect(byWeek.get(weeks[13]!)).toHaveLength(1)
    expect(byWeek.get(weeks[25]!)).toHaveLength(1)
    expect(byWeek.get(weeks[1]!)).toEqual([])
  })

  test('asks nothing for no weeks', async () => {
    const findMany = vi.fn((_args: unknown) => Promise.resolve([]))
    const stub = { planSession: { findMany } } as unknown as Pick<PrismaClient, 'planSession'>
    expect((await executionRecordsByWeek(stub, 'p1', [])).size).toBe(0)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('weeklyDecisions over a 12-week plan', () => {
  test('equal the decisions from one query per week', async () => {
    const u = await seedUser(ctx, { email: 'decisions@example.com' })
    const runs = []
    for (let w = 1; w <= 12; w += 1) {
      for (const [dow, min] of [
        [1, 40],
        [3, 45],
        [5, 35],
        [6, 70],
      ] as const) {
        runs.push({
          userId: u.id,
          date: addDays(thisMonday, -7 * w + dow),
          type: 'run',
          durationSec: min * 60,
          movingSec: min * 60,
          distanceM: min * 160,
          rpe: 3,
          source: 'manual',
        })
      }
    }
    await ctx.prisma.activity.createMany({ data: runs })
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Synthetic half',
        priority: 'A',
        targetDate: addDays(thisMonday, 7 * 14 + 5),
        distanceM: 21_097,
        goalType: 'finish',
      },
    })
    const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    const weekStarts = plan.weeks.slice(0, 12).map((w) => w.weekStart)
    expect(weekStarts).toHaveLength(12)

    // Assessed sessions in most weeks, easy and hard, so the decisions rest on stored executions.
    const quality = ['threshold', 'intervals', 'hills', 'race-pace', 'long-fast-finish']
    for (const [i, weekStart] of weekStarts.entries()) {
      if (i % 4 === 3) continue
      const score = i % 3 === 0 ? 2 : i % 3 === 1 ? -1 : 0
      for (const s of plan.sessions.filter((x) => x.weekStart === weekStart)) {
        if (!quality.includes(s.kind) && s.kind !== 'easy') continue
        await ctx.prisma.planSession.update({
          where: { id: s.id },
          data: { execution: assessment(score as -2 | -1 | 0 | 1 | 2), status: 'completed' },
        })
      }
    }

    const batched = await executionRecordsByWeek(ctx.prisma, plan.id, weekStarts)
    let assessed = 0
    for (const weekStart of weekStarts) {
      const expected = await perWeekRecords(plan.id, weekStart)
      assessed += expected.length
      expect(batched.get(weekStart), weekStart).toEqual(expected)
    }
    expect(assessed).toBeGreaterThan(12)

    const all = await weeklyDecisions(deps, { userId: u.id, today, weekStarts })
    expect([...all.keys()]).toEqual(weekStarts)
    for (const weekStart of weekStarts) {
      const single = await weeklyDecisions(deps, { userId: u.id, today, weekStarts: [weekStart] })
      expect(all.get(weekStart), weekStart).toEqual(single.get(weekStart))
    }
  })
})
