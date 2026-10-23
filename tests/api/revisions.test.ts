import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { replan, weeklyDecision, weeklyRamp } from '../../shared/engine/index.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { EngineInput, PlanChange, WeeklyDecision } from '../../shared/engine/types.ts'
import type {
  PlanDiff,
  PlanRevisionReason,
  PlanRevisionView,
  PlanWithSessions,
} from '../../shared/types.ts'
import type { Deps } from '../../server/app.ts'
import {
  PLAN_SESSION_COLUMNS,
  PLAN_WEEK_COLUMNS,
  type PlanRevision as PlanRevisionRow,
  type PlanSession as PlanSessionRow,
  type PlanWeek as PlanWeekRow,
} from '../../server/db.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { HttpError } from '../../server/errors.ts'
import { toPlanRevision } from '../../server/serialize.ts'
import { gatherEngineInput } from '../../server/services/engineInput.ts'
import {
  executionRecordsByWeek,
  failedChecklist,
  replanActivePlan,
  weekRow,
  writeReplannedSessions,
} from '../../server/services/planEngine.ts'
import { recordPrediction } from '../../server/services/predictionLog.ts'
import {
  EMPTY_DIFF_MARK,
  applyReplan,
  applyUndoPayload,
  computeReplan,
  describeChanges,
  recordPlanWrite,
  sessionHash,
  weekHash,
  type SessionContent,
  type UndoPayload,
  type WeekContent,
} from '../../server/services/replan.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// Revisions (spec 4.2, ADR 0007): the compute/apply split of the re-plan, the diff and the undo
// payload every revision stores, the list route. A Monday, so that a Monday re-plan is the weekly
// job's re-plan. Only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
const MONDAY = new Date(2026, 9, 19, 12)
vi.setSystemTime(MONDAY)

// Lets one test force a failed checklist; every other call goes to the real engine.
const force = vi.hoisted(() => ({ failChecklist: false }))
vi.mock('../../shared/engine/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../shared/engine/index.ts')>()
  return {
    ...real,
    replan: (...args: Parameters<typeof real.replan>) => {
      const result = real.replan(...args)
      return force.failChecklist
        ? {
            ...result,
            draft: {
              ...result.draft,
              checklist: [{ id: 'spike-guard', ok: false, detail: 'forced', rules: ['g-1'] }],
            },
          }
        : result
    },
  }
})

const today = todayIso()
const thisMonday = mondayOf(today)
const nextMonday = addDays(thisMonday, 7)
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  force.failChecklist = false
  vi.setSystemTime(MONDAY)
})

const deps = (): Deps => ({ prisma: ctx.prisma, config: ctx.config })

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

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

interface Fixture {
  u: TestUser
  goalId: string
  plan: PlanWithSessions
}

/** A user with a history, a four-week goal and the plan the engine builds for it today. */
async function fourWeekPlan(email: string): Promise<Fixture> {
  const u = await seedUser(ctx, { email })
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
  return { u, goalId: goal.id, plan: res.body as PlanWithSessions }
}

/** Closes the weekday of the first easy run of next week, so the next re-plan has to move runs. */
async function closeBusyDay(fixture: Fixture): Promise<void> {
  const easy = fixture.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
  const weekday = WEEKDAYS[(new Date(`${easy.date}T00:00:00Z`).getUTCDay() + 6) % 7]!
  const availability = JSON.stringify({ [weekday]: { available: false, maxMin: null } })
  await ctx.prisma.athleteProfile.upsert({
    where: { userId: fixture.u.id },
    create: { userId: fixture.u.id, availability },
    update: { availability },
  })
}

const sessionsOf = (planId: string) =>
  ctx.prisma.planSession.findMany({
    where: { planId },
    orderBy: [{ date: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  })
const weeksOf = (planId: string) =>
  ctx.prisma.planWeek.findMany({ where: { planId }, orderBy: { weekStart: 'asc' } })

interface Snapshot {
  sessions: PlanSessionRow[]
  weeks: PlanWeekRow[]
}
const snapshot = async (planId: string): Promise<Snapshot> => ({
  sessions: await sessionsOf(planId),
  weeks: await weeksOf(planId),
})

const lastRevision = (planId: string): Promise<PlanRevisionRow> =>
  ctx.prisma.planRevision.findFirstOrThrow({
    where: { planId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })

/**
 * The stored undo payload of a plan's last revision, after every hash in it (created and updated
 * sessions and weeks) was compared with the hash of the stored row. Written against the exported
 * hash functions, so a change of what a hash covers needs no edit here.
 */
async function expectPayloadHashes(planId: string): Promise<UndoPayload> {
  const payload = JSON.parse((await lastRevision(planId)).undo!) as UndoPayload
  const after = await snapshot(planId)
  const sessionById = new Map(after.sessions.map((row) => [row.id, row]))
  const weekById = new Map(after.weeks.map((row) => [row.id, row]))
  for (const entry of [...payload.sessions.created, ...payload.sessions.updated]) {
    const row = sessionById.get(entry.id)
    expect(row, `session ${entry.id} is stored`).toBeDefined()
    expect(entry.hash, `session ${entry.id}`).toBe(sessionHash(row!))
  }
  for (const entry of [...payload.weeks.created, ...payload.weeks.updated]) {
    const row = weekById.get(entry.id)
    expect(row, `week ${entry.id} is stored`).toBeDefined()
    expect(entry.hash, `week ${entry.id}`).toBe(weekHash(row!))
  }
  return payload
}

const withoutUpdatedAt = <Row extends { updatedAt: Date }>(row: Row): Omit<Row, 'updatedAt'> => {
  const { updatedAt: _updatedAt, ...rest } = row
  return rest
}

/** What changed between two reads of a table: created ids, deleted ids and rows whose content differs. */
function rowWrites<Row extends { id: string; updatedAt: Date }>(before: Row[], after: Row[]) {
  const was = new Map(before.map((row) => [row.id, JSON.stringify(withoutUpdatedAt(row))]))
  const now = new Map(after.map((row) => [row.id, JSON.stringify(withoutUpdatedAt(row))]))
  return {
    created: [...now.keys()].filter((id) => !was.has(id)).sort(),
    deleted: [...was.keys()].filter((id) => !now.has(id)).sort(),
    changed: [...now.keys()].filter((id) => was.has(id) && was.get(id) !== now.get(id)).sort(),
  }
}

// ---------------------------------------------------------------------------------------------
// The pre-split implementation, kept as an oracle
// ---------------------------------------------------------------------------------------------

/**
 * `replanActivePlan` as it was before the compute/apply split (R0-1): one function that reads,
 * decides and writes. The new implementation has to leave the same plan behind.
 */
async function oracleReplan(
  d: Deps,
  args: { userId: string; reason: PlanRevisionReason; today: string },
): Promise<void> {
  const { prisma } = d
  const { userId, today: day } = args
  const plan = await prisma.plan.findFirstOrThrow({
    where: { userId, status: 'active' },
    orderBy: { createdAt: 'desc' },
    include: { goal: true },
  })
  const options = JSON.parse(plan.options) as EngineInput['options']
  const input = await gatherEngineInput(
    d,
    { userId, goalId: plan.goalId, today: day, options },
    { existing: true },
  )
  const state = estimateState(input)
  const currentMonday = mondayOf(day)
  const lastWeek = addDays(currentMonday, -7)
  const decision = input.existing?.weeks.some((w) => w.weekStart === lastWeek)
    ? weeklyDecision(input, lastWeek, {
        executions: (await executionRecordsByWeek(prisma, plan.id, [lastWeek])).get(lastWeek) ?? [],
        redsFlags: input.screeningFlags,
        ramp: weeklyRamp(state),
      })
    : null
  const weekCaps: Record<string, number> = {}
  if (decision !== null && decision.decision !== 'progress') {
    weekCaps[addDays(lastWeek, 7)] = decision.nextWeekTargetMin
  }
  const ownerWeeks = await prisma.planWeek.findMany({
    where: {
      planId: plan.id,
      weekStart: { gte: currentMonday },
      targetSource: { in: ['override', 'review'] },
    },
  })
  for (const week of ownerWeeks) weekCaps[week.weekStart] = week.targetRunMin
  const decisions: Record<string, WeeklyDecision['decision']> =
    decision !== null && decision.decision !== 'progress'
      ? { [addDays(lastWeek, 7)]: decision.decision }
      : {}
  const { draft, changes } = replan({ ...input, weekCaps }, { decisions })
  const blocked = failedChecklist(draft.checklist)
  if (blocked) throw blocked

  const reason: PlanRevisionReason =
    args.reason === 'weekly' && state.layoffDays >= P.j7.tier1Days.value ? 'break' : args.reason
  const weeks = new Set(changes.map((c) => c.weekStart)).size
  const summary = [
    changes.length === 0
      ? 'No changes to the plan.'
      : `${changes.length} change${changes.length === 1 ? '' : 's'} across ${weeks} week${weeks === 1 ? '' : 's'}.`,
    decision
      ? `Last week's decision: ${decision.decision}, next week up to ${decision.nextWeekTargetMin} min.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join(' ')

  await prisma.$transaction(async (tx) => {
    await writeReplannedSessions(tx, { planId: plan.id, today: day, sessions: draft.sessions })
    const rows = await tx.planWeek.findMany({ where: { planId: plan.id } })
    const byStart = new Map(rows.map((w) => [w.weekStart, w]))
    const future = draft.weeks.filter((w) => w.weekStart >= currentMonday)
    for (const week of future) {
      const row = weekRow(week)
      const old = byStart.get(week.weekStart)
      if (!old) {
        await tx.planWeek.create({ data: { ...row, planId: plan.id } })
        continue
      }
      const keep =
        (old.targetSource === 'override' || old.targetSource === 'review') &&
        old.targetRunMin <= week.targetRunMin
      await tx.planWeek.update({
        where: { id: old.id },
        data: keep
          ? {
              ...row,
              targetRunMin: old.targetRunMin,
              targetSource: old.targetSource,
              overrideNote: old.overrideNote,
            }
          : row,
      })
    }
    const futureStarts = new Set(future.map((w) => w.weekStart))
    const dropped = rows.filter(
      (w) => w.weekStart >= currentMonday && !futureStarts.has(w.weekStart),
    )
    if (dropped.length > 0) {
      await tx.planWeek.deleteMany({ where: { id: { in: dropped.map((w) => w.id) } } })
    }
    await tx.plan.update({
      where: { id: plan.id },
      data: {
        raceWeekStart: mondayOf(plan.goal.targetDate),
        paramsVersion: draft.paramsVersion,
        feasibility: JSON.stringify(draft.feasibility),
        warnings: JSON.stringify(draft.warnings),
        checklist: JSON.stringify(draft.checklist),
      },
    })
    await recordPrediction(tx, {
      userId,
      goal: plan.goal,
      draft,
      input,
      today: day,
      mode: 'refresh',
    })
    await tx.planRevision.create({
      data: { planId: plan.id, reason, summary, changes: JSON.stringify(changes) },
    })
  })
}

/** Everything a re-plan leaves behind, without the ids and timestamps that differ between users. */
async function leftBehind(planId: string, userId: string) {
  const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { id: planId } })
  const { sessions, weeks } = await snapshot(planId)
  const revisions = await ctx.prisma.planRevision.findMany({
    where: { planId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  const predictions = await ctx.prisma.predictionLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
  })
  return {
    plan: {
      raceWeekStart: plan.raceWeekStart,
      paramsVersion: plan.paramsVersion,
      feasibility: plan.feasibility,
      warnings: plan.warnings,
      checklist: plan.checklist,
    },
    sessions: sessions.map(
      ({ id: _id, planId: _planId, externalId: _ext, updatedAt: _u, ...row }) => row,
    ),
    weeks: weeks.map(({ id: _id, planId: _planId, updatedAt: _u, ...row }) => row),
    revisions: revisions.map((r) => ({ reason: r.reason, summary: r.summary, changes: r.changes })),
    predictions: predictions.map((p) => ({
      method: p.method,
      predictedSec: p.predictedSec,
      lowSec: p.lowSec,
      highSec: p.highSec,
    })),
  }
}

describe('the split re-plan against the pre-split implementation', () => {
  test('leaves the same plan behind on the four-week fixture, with the plan changing', async () => {
    const old = await fourWeekPlan('oracle-old@example.com')
    const split = await fourWeekPlan('oracle-new@example.com')
    for (const f of [old, split]) {
      await closeBusyDay(f)
      // The owner's working target of one week and a review's target of another stay.
      const weeks = await weeksOf(f.plan.id)
      const owned = weeks.filter((w) => w.weekStart >= nextMonday).slice(0, 2)
      const sources = [
        ['override', 'Synthetic note.'],
        ['review', null],
      ] as const
      for (const [i, week] of owned.entries()) {
        await ctx.prisma.planWeek.update({
          where: { id: week.id },
          data: {
            targetRunMin: week.targetRunMin - 20,
            targetSource: sources[i]![0],
            overrideNote: sources[i]![1],
          },
        })
      }
    }

    await oracleReplan(deps(), { userId: old.u.id, reason: 'weekly', today: thisMonday })
    const revision = await replanActivePlan(deps(), {
      userId: split.u.id,
      reason: 'weekly',
      today: thisMonday,
    })

    const expected = await leftBehind(old.plan.id, old.u.id)
    const actual = await leftBehind(split.plan.id, split.u.id)
    // The re-plan did something, so the comparison is not of two untouched plans.
    expect(revision.diff?.empty).toBe(false)
    expect(revision.diff!.totals.added + revision.diff!.totals.removed).toBeGreaterThan(0)
    expect(actual).toEqual(expected)
    expect(actual.weeks.filter((w) => w.targetSource !== 'baseline')).toHaveLength(2)
  })

  test('leaves the same plan behind when nothing changes', async () => {
    const old = await fourWeekPlan('oracle-same-old@example.com')
    const split = await fourWeekPlan('oracle-same-new@example.com')
    await oracleReplan(deps(), { userId: old.u.id, reason: 'owner', today: thisMonday })
    await replanActivePlan(deps(), { userId: split.u.id, reason: 'owner', today: thisMonday })
    expect(await leftBehind(split.plan.id, split.u.id)).toEqual(
      await leftBehind(old.plan.id, old.u.id),
    )
  })
})

// ---------------------------------------------------------------------------------------------
// computeReplan reads only
// ---------------------------------------------------------------------------------------------

describe('computeReplan', () => {
  test('writes nothing: no row, no revision, no prediction, no data version', async () => {
    const f = await fourWeekPlan('compute-reads@example.com')
    await closeBusyDay(f)
    const before = await snapshot(f.plan.id)
    const revisions = await ctx.prisma.planRevision.count({ where: { planId: f.plan.id } })
    const predictions = await ctx.prisma.predictionLog.count({ where: { userId: f.u.id } })
    const version = await dataVersionKey(ctx.prisma)

    const result = await computeReplan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: thisMonday,
    })

    expect(await snapshot(f.plan.id)).toEqual(before)
    expect(await ctx.prisma.planRevision.count({ where: { planId: f.plan.id } })).toBe(revisions)
    expect(await ctx.prisma.predictionLog.count({ where: { userId: f.u.id } })).toBe(predictions)
    expect(await dataVersionKey(ctx.prisma)).toEqual(version)
    expect(result).toMatchObject({ planId: f.plan.id, reason: 'weekly', auto: true })
    expect(result.diff.empty).toBe(false)
    // A session that is only previewed has no row and no identity yet.
    const added = result.diff.sessions.filter((line) => line.change === 'added')
    expect(added.length).toBeGreaterThan(0)
    for (const line of added) expect(line).toMatchObject({ sessionId: null, externalId: '' })
  })

  test('is deterministic: two computes of the same plan give the same diff', async () => {
    const f = await fourWeekPlan('compute-twice@example.com')
    await closeBusyDay(f)
    const args = { userId: f.u.id, reason: 'weekly' as const, today: thisMonday }
    const first = await computeReplan(deps(), args)
    const second = await computeReplan(deps(), args)
    expect(second.diff).toEqual(first.diff)
    expect(second.summary).toBe(first.summary)
  })

  test('applies the input transformer before it decides, and still writes nothing', async () => {
    const f = await fourWeekPlan('compute-transform@example.com')
    const args = { userId: f.u.id, reason: 'owner' as const, today: thisMonday }
    const plain = await computeReplan(deps(), args)
    expect(plain.diff.empty).toBe(true)

    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    const weekday = WEEKDAYS[(new Date(`${easy.date}T00:00:00Z`).getUTCDay() + 6) % 7]!
    const before = await snapshot(f.plan.id)
    const hypothetical = await computeReplan(deps(), {
      ...args,
      transform: (input) => ({
        ...input,
        profile: {
          ...input.profile,
          availability: {
            ...input.profile.availability,
            [weekday]: { available: false, maxMin: null },
          },
        },
      }),
    })
    expect(hypothetical.diff.empty).toBe(false)
    expect(await snapshot(f.plan.id)).toEqual(before)
  })

  test('refuses what a re-plan cannot do, as the old function did', async () => {
    const u = await seedUser(ctx, { email: 'compute-none@example.com' })
    await expect(
      computeReplan(deps(), { userId: u.id, reason: 'owner', today }),
    ).rejects.toMatchObject({ status: 404 })
  })

  test('a draft that fails the checklist is computed, then refused by applyReplan with no write', async () => {
    const f = await fourWeekPlan('compute-blocked@example.com')
    await closeBusyDay(f)
    const before = await snapshot(f.plan.id)
    const revisions = await ctx.prisma.planRevision.count({ where: { planId: f.plan.id } })
    force.failChecklist = true

    const result = await computeReplan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: thisMonday,
    })
    expect(result.draft.checklist.some((item) => !item.ok)).toBe(true)
    const refused = await applyReplan(deps(), result).catch((error: unknown) => error)
    expect(refused).toBeInstanceOf(HttpError)
    expect((refused as HttpError).status).toBe(422)
    expect((refused as HttpError).details).toMatchObject({
      checklist: [{ id: 'spike-guard', ok: false }],
    })

    expect(await snapshot(f.plan.id)).toEqual(before)
    expect(await ctx.prisma.planRevision.count({ where: { planId: f.plan.id } })).toBe(revisions)
  })
})

// ---------------------------------------------------------------------------------------------
// The revision a re-plan writes
// ---------------------------------------------------------------------------------------------

describe('the revision of a re-plan', () => {
  test('stores a diff whose totals equal the rows written, and an undo payload', async () => {
    const f = await fourWeekPlan('revision-totals@example.com')
    await closeBusyDay(f)
    const before = await snapshot(f.plan.id)

    const revision = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: thisMonday,
    })

    const after = await snapshot(f.plan.id)
    const sessions = rowWrites(before.sessions, after.sessions)
    const weeks = rowWrites(before.weeks, after.weeks)
    const diff = revision.diff!
    expect(diff.v).toBe(1)
    expect(diff.empty).toBe(false)
    expect(diff.totals).toMatchObject({
      added: sessions.created.length,
      removed: sessions.deleted.length,
      changed: sessions.changed.length,
      weeksChanged: weeks.created.length + weeks.deleted.length + weeks.changed.length,
    })
    expect(sessions.created.length + sessions.deleted.length).toBeGreaterThan(0)
    // One line for every row written, identified by the session's durable id.
    expect(diff.sessions).toHaveLength(
      sessions.created.length + sessions.deleted.length + sessions.changed.length,
    )
    const externalIds = new Map(
      [...before.sessions, ...after.sessions].map((row) => [row.id, row.externalId]),
    )
    const lineIds = (change: 'added' | 'removed' | 'changed') =>
      diff.sessions
        .filter((line) => line.change === change)
        .map((line) => line.sessionId)
        .sort()
    expect(lineIds('added')).toEqual(sessions.created)
    expect(lineIds('removed')).toEqual(sessions.deleted)
    expect(lineIds('changed')).toEqual(sessions.changed)
    for (const line of diff.sessions) {
      expect(line.externalId, line.sessionId ?? '').toBe(externalIds.get(line.sessionId!))
    }

    // The stored payload names the same rows, and the response never carries it.
    const stored = await lastRevision(f.plan.id)
    expect(stored.id).toBe(revision.id)
    const payload = JSON.parse(stored.undo!) as UndoPayload
    expect(payload.v).toBe(1)
    expect(payload.sessions.created.map((c) => c.id).sort()).toEqual(sessions.created)
    expect(payload.sessions.deleted.map((r) => r.id).sort()).toEqual(sessions.deleted)
    expect(payload.sessions.updated.map((u) => u.id).sort()).toEqual(sessions.changed)
    expect(payload.weeks.created.map((c) => c.id).sort()).toEqual(weeks.created)
    expect(payload.weeks.deleted.map((r) => r.id).sort()).toEqual(weeks.deleted)
    expect(payload.weeks.updated.map((u) => u.id).sort()).toEqual(weeks.changed)
    expect(payload.disruptions).toEqual({ created: [], updated: [] })
    expect(Object.keys(revision.undo).sort()).toEqual(['available', 'reasons', 'undoneAt'])
    expect(JSON.stringify(revision)).not.toContain('"deleted"')
  })

  test('the hashes in the payload are the hashes of the rows as written', async () => {
    const f = await fourWeekPlan('revision-hashes@example.com')
    await closeBusyDay(f)
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: thisMonday })
    const payload = await expectPayloadHashes(f.plan.id)
    expect(payload.sessions.created.length).toBeGreaterThan(0)
  })

  test('the hashes of updated sessions and of weeks are the hashes of the rows as written', async () => {
    const f = await fourWeekPlan('revision-hashes-updated@example.com')
    // A race two weeks later updates the sessions and weeks that stay and adds the ones that follow.
    await ctx.prisma.goal.update({
      where: { id: f.goalId },
      data: { targetDate: addDays(thisMonday, 7 * 3 + 5 + 14) },
    })
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'owner', today: thisMonday })
    const payload = await expectPayloadHashes(f.plan.id)
    // Each list holds entries, so the comparisons above ran over rows and not over nothing.
    expect(payload.sessions.created.length).toBeGreaterThan(0)
    expect(payload.sessions.updated.length).toBeGreaterThan(0)
    expect(payload.weeks.created.length).toBeGreaterThan(0)
    expect(payload.weeks.updated.length).toBeGreaterThan(0)
  })

  test('a no-op re-plan writes a hidden revision with an empty diff and nothing to undo', async () => {
    const f = await fourWeekPlan('revision-noop@example.com')
    const before = await snapshot(f.plan.id)

    const revision = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: thisMonday,
    })

    expect(await snapshot(f.plan.id)).toEqual(before)
    expect(revision.diff).toMatchObject({
      empty: true,
      sessions: [],
      weeks: [],
      holds: [],
      totals: {
        added: 0,
        removed: 0,
        changed: 0,
        weeksChanged: 0,
        runMinBefore: 0,
        runMinAfter: 0,
      },
    })
    const stored = await lastRevision(f.plan.id)
    expect(stored).toMatchObject({ id: revision.id, reason: 'weekly', auto: true, undo: null })
    expect(stored.diff).toContain(EMPTY_DIFF_MARK)
    expect(revision.undo).toMatchObject({
      available: false,
      reasons: [{ code: 'not-undoable' }],
    })

    const c = client(ctx, f.u)
    const shown = (await c.get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(shown.map((r) => r.reason)).toEqual(['generate'])
    const all = (await c.get('/api/plan/revisions?include=empty')).body as PlanRevisionView[]
    expect(all.map((r) => r.id)).toEqual([revision.id, shown[0]!.id])
  })

  test('marks only the scheduler weekly update as automatic, and keeps the decision it acted on', async () => {
    const f = await fourWeekPlan('revision-auto@example.com')
    await closeBusyDay(f)
    // Last week's plan rows exist, so the weekly decision is made and stored with the revision.
    const lastWeek = addDays(thisMonday, -7)
    await ctx.prisma.planWeek.create({
      data: {
        planId: f.plan.id,
        weekStart: lastWeek,
        index: -1,
        phase: 'build',
        baselineRunMin: 190,
        targetRunMin: 190,
        longRunMin: 70,
        runDays: 4,
        strengthSessions: 0,
      },
    })
    const weekly = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: thisMonday,
    })
    expect(weekly).toMatchObject({ reason: 'weekly', auto: true })
    expect(weekly.decision?.decision).toMatch(/^(progress|hold|reduce)$/)
    expect(weekly.summary).toContain("Last week's decision:")

    const owner = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'owner',
      today: thisMonday,
    })
    const review = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'review',
      today: thisMonday,
    })
    expect(owner).toMatchObject({ reason: 'owner', auto: false })
    expect(review).toMatchObject({ reason: 'review', auto: false })
  })

  test('a weekly update after a break reads as a break, still automatic, still with a diff', async () => {
    const f = await fourWeekPlan('revision-break@example.com')
    // No run for two weeks: the restart table applies (rule J7).
    await ctx.prisma.activity.deleteMany({
      where: { userId: f.u.id, date: { gte: addDays(thisMonday, -14) } },
    })
    const revision = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: thisMonday,
    })
    expect(revision).toMatchObject({ reason: 'break', auto: true })
    expect(revision.diff).not.toBeNull()
    const stored = await lastRevision(f.plan.id)
    expect(stored).toMatchObject({ reason: 'break', auto: true })
    expect(stored.undo === null).toBe(revision.diff!.empty)
  })

  test('a new plan writes a revision without a diff, which the list keeps', async () => {
    const f = await fourWeekPlan('revision-generate@example.com')
    const generate = await lastRevision(f.plan.id)
    expect(generate).toMatchObject({ reason: 'generate', diff: null, undo: null, auto: false })
    const listed = (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed).toHaveLength(1)
    expect(listed[0]).toMatchObject({
      reason: 'generate',
      diff: null,
      decision: null,
      auto: false,
      seenAt: null,
      undoOf: null,
      disruptionId: null,
    })
    expect(listed[0]?.summary).toMatch(
      /^Plan generated for Synthetic half: \d+ weeks, \d+ sessions\.$/,
    )
  })
})

// ---------------------------------------------------------------------------------------------
// The undo payload round trip
// ---------------------------------------------------------------------------------------------

function content<Row extends { id: string; updatedAt: Date }>(rows: Row[]) {
  return rows.map(withoutUpdatedAt).sort((a, b) => a.id.localeCompare(b.id))
}

/** Rows before a write, restored by the payload the write stored, column by column. */
async function expectRoundTrip(planId: string, before: Snapshot): Promise<void> {
  const after = await snapshot(planId)
  const payload = JSON.parse((await lastRevision(planId)).undo!) as UndoPayload
  const restored = applyUndoPayload(after, payload)
  const byId = <Row extends { id: string }>(rows: Row[]) =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id))
  const wantSessions = content(before.sessions)
  const gotSessions = byId(restored.sessions)
  expect(gotSessions).toHaveLength(wantSessions.length)
  for (const column of PLAN_SESSION_COLUMNS.filter((c) => c !== 'updatedAt')) {
    expect(
      gotSessions.map((row) => row[column]),
      `PlanSession.${column}`,
    ).toEqual(wantSessions.map((row) => row[column]))
  }
  const wantWeeks = content(before.weeks)
  const gotWeeks = byId(restored.weeks)
  expect(gotWeeks).toHaveLength(wantWeeks.length)
  for (const column of PLAN_WEEK_COLUMNS.filter((c) => c !== 'updatedAt')) {
    expect(
      gotWeeks.map((row) => row[column]),
      `PlanWeek.${column}`,
    ).toEqual(wantWeeks.map((row) => row[column]))
  }
}

describe('applyUndoPayload', () => {
  test('lists every scalar column of the two tables, from the data model', async () => {
    const f = await fourWeekPlan('payload-columns@example.com')
    const session = (await sessionsOf(f.plan.id))[0]!
    const week = (await weeksOf(f.plan.id))[0]!
    expect([...PLAN_SESSION_COLUMNS].sort()).toEqual(Object.keys(session).sort())
    expect([...PLAN_WEEK_COLUMNS].sort()).toEqual(Object.keys(week).sort())
  })

  test('restores every column of the sessions and weeks a re-plan created, deleted and updated', async () => {
    const f = await fourWeekPlan('payload-replan@example.com')
    await closeBusyDay(f)
    const before = await snapshot(f.plan.id)
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: thisMonday })
    const writes = rowWrites(before.sessions, (await snapshot(f.plan.id)).sessions)
    expect(writes.created.length).toBeGreaterThan(0)
    expect(writes.deleted.length).toBeGreaterThan(0)
    await expectRoundTrip(f.plan.id, before)
  })

  test('restores weeks the re-plan created (a later race) and deleted (an earlier one)', async () => {
    const f = await fourWeekPlan('payload-weeks@example.com')
    const goalDate = addDays(thisMonday, 7 * 3 + 5)

    // A race two weeks later adds two weeks.
    let before = await snapshot(f.plan.id)
    await ctx.prisma.goal.update({
      where: { id: f.goalId },
      data: { targetDate: addDays(goalDate, 14) },
    })
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'owner', today: thisMonday })
    let after = await snapshot(f.plan.id)
    expect(rowWrites(before.weeks, after.weeks).created.length).toBeGreaterThan(0)
    await expectRoundTrip(f.plan.id, before)

    // A race back at the first date drops them again.
    before = after
    await ctx.prisma.goal.update({ where: { id: f.goalId }, data: { targetDate: goalDate } })
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'owner', today: thisMonday })
    after = await snapshot(f.plan.id)
    expect(rowWrites(before.weeks, after.weeks).deleted.length).toBeGreaterThan(0)
    await expectRoundTrip(f.plan.id, before)
  })

  test('brings back a deleted session that was linked to a run, with its link', async () => {
    const f = await fourWeekPlan('payload-linked@example.com')
    const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
    const run = await ctx.prisma.activity.findFirstOrThrow({
      where: { userId: f.u.id, type: 'run' },
      orderBy: { date: 'desc' },
    })
    await ctx.prisma.planSession.update({
      where: { id: easy.id },
      data: {
        activityId: run.id,
        linkSource: 'owner',
        execution: JSON.stringify({ synthetic: 1 }),
      },
    })
    // Close the day of that very session so the pair is broken and its row is deleted.
    const weekday = WEEKDAYS[(new Date(`${easy.date}T00:00:00Z`).getUTCDay() + 6) % 7]!
    const availability = JSON.stringify({ [weekday]: { available: false, maxMin: null } })
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: f.u.id },
      create: { userId: f.u.id, availability },
      update: { availability },
    })
    const before = await snapshot(f.plan.id)
    await replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: thisMonday })
    const payload = JSON.parse((await lastRevision(f.plan.id)).undo!) as UndoPayload
    const deleted = payload.sessions.deleted.find((row) => row.id === easy.id)
    expect(deleted, 'the session whose day closed is deleted').toBeDefined()
    expect(deleted).toMatchObject({
      activityId: run.id,
      linkSource: 'owner',
      externalId: easy.externalId,
    })
    expect(deleted).not.toHaveProperty('updatedAt')
    await expectRoundTrip(f.plan.id, before)
  })
})

describe('the content hashes', () => {
  test('cover the content columns and not the activity link or the timestamp', async () => {
    const f = await fourWeekPlan('hash-columns@example.com')
    const row = (await sessionsOf(f.plan.id))[0]!
    const hash = sessionHash(row)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    // A linked run changes the link columns and the status the assessment sets; not the timestamp.
    expect(sessionHash({ ...row, activityId: 'a1', linkSource: 'auto', execution: '{}' })).toBe(
      hash,
    )
    expect(sessionHash({ ...row, updatedAt: new Date(0) } as SessionContent)).toBe(hash)
    for (const column of [
      'title',
      'durationMin',
      'distanceM',
      'date',
      'status',
      'original',
      'rules',
    ]) {
      const edited = { ...row, [column]: column === 'durationMin' ? row.durationMin + 1 : 'x' }
      expect(sessionHash(edited), column).not.toBe(hash)
    }
    const week = (await weeksOf(f.plan.id))[0]!
    expect(weekHash(week)).toMatch(/^[0-9a-f]{64}$/)
    expect(weekHash({ ...week, targetRunMin: week.targetRunMin + 1 })).not.toBe(weekHash(week))
    expect(weekHash({ ...week, updatedAt: new Date(0) } as WeekContent)).toBe(weekHash(week))
  })
})

// ---------------------------------------------------------------------------------------------
// Owner edits of one session
// ---------------------------------------------------------------------------------------------

const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})

/** A version-2 plan with three hand-made runs in next week: Tuesday and Thursday easy, Saturday long. */
async function handPlan(email: string) {
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
  const seeds = [
    { day: 1, kind: 'easy', min: 40 },
    { day: 3, kind: 'easy', min: 45 },
    { day: 5, kind: 'long', min: 90 },
  ]
  const rows: PlanSessionRow[] = []
  for (const [i, seed] of seeds.entries()) {
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: `00000000-0000-4000-8000-00000000000${String(i)}`,
          weekStart: nextMonday,
          date: addDays(nextMonday, seed.day),
          order: 0,
          kind: seed.kind,
          title: `${seed.kind} ${String(i)}`,
          durationMin: seed.min,
          target: TARGET,
          purpose: 'Synthetic.',
          rules: JSON.stringify(['f-1']),
        },
      }),
    )
  }
  const [tue, thu, sat] = rows as [PlanSessionRow, PlanSessionRow, PlanSessionRow]
  return { u, plan, tue, thu, sat }
}

describe('the revision of an owner edit', () => {
  test('skip, restore and move store a diff and a payload that restores the rows', async () => {
    const { u, plan, tue } = await handPlan('owner-edits@example.com')
    const c = client(ctx, u)
    const edit = async (body: object, minutes: number) => {
      vi.setSystemTime(new Date(MONDAY.getTime() + minutes * 60_000))
      const res = await c.put(`/api/plan/sessions/${tue.id}`).send(body)
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const revision = await lastRevision(plan.id)
      return { revision, diff: JSON.parse(revision.diff!) as PlanDiff }
    }

    // Skip.
    let before = await snapshot(plan.id)
    let { revision, diff } = await edit({ skip: true }, 1)
    expect(revision).toMatchObject({ reason: 'owner', auto: false })
    expect(diff.totals).toMatchObject({ added: 0, removed: 0, changed: 1, weeksChanged: 0 })
    expect(diff.sessions).toHaveLength(1)
    expect(diff.sessions[0]).toMatchObject({
      change: 'changed',
      externalId: tue.externalId,
      sessionId: tue.id,
      fields: ['status'],
    })
    expect(revision.summary).toMatch(/^Skipped easy 0 on /)
    await expectRoundTrip(plan.id, before)

    // Restore.
    before = await snapshot(plan.id)
    ;({ revision, diff } = await edit({ skip: false }, 2))
    expect(diff.sessions[0]).toMatchObject({ change: 'changed', fields: ['status'] })
    expect(revision.summary).toMatch(/^Restored easy 0 on /)
    await expectRoundTrip(plan.id, before)

    // Move to a free day of the same week: the row and its identity stay.
    before = await snapshot(plan.id)
    const friday = addDays(nextMonday, 4)
    ;({ revision, diff } = await edit({ date: friday }, 3))
    expect(diff.sessions).toHaveLength(1)
    expect(diff.sessions[0]).toMatchObject({
      change: 'changed',
      externalId: tue.externalId,
      sessionId: tue.id,
      date: friday,
      fields: ['date', 'status'],
      before: { date: tue.date },
      after: { date: friday },
    })
    expect(revision.summary).toMatch(/^Moved easy 0 from .* to /)
    await expectRoundTrip(plan.id, before)
    const list = (await c.get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(list.map((r) => r.reason)).toEqual(['owner', 'owner', 'owner'])
    expect(list.every((r) => r.diff !== null && r.diff.empty === false)).toBe(true)
  })

  test('a swap updates two rows in place and stores both in one revision', async () => {
    const { u, plan, thu, sat } = await handPlan('owner-swap@example.com')
    const before = await snapshot(plan.id)
    const res = await client(ctx, u).put(`/api/plan/sessions/${thu.id}`).send({ kind: 'long' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const revision = await lastRevision(plan.id)
    const diff = JSON.parse(revision.diff!) as PlanDiff
    expect(diff.totals).toMatchObject({ added: 0, removed: 0, changed: 2 })
    expect(diff.sessions.map((line) => line.externalId).sort()).toEqual(
      [thu.externalId, sat.externalId].sort(),
    )
    for (const line of diff.sessions) {
      expect(line.fields).toEqual(expect.arrayContaining(['kind', 'durationMin', 'status']))
    }
    expect(revision.summary).toBe('Swapped easy 1 on Thu 29 Oct with long 2 on Sat 31 Oct.')
    await expectRoundTrip(plan.id, before)
  })

  test('an edit that changes nothing writes no revision', async () => {
    const { u, plan, tue } = await handPlan('owner-noop@example.com')
    const revisions = await ctx.prisma.planRevision.count({ where: { planId: plan.id } })
    const res = await client(ctx, u).put(`/api/plan/sessions/${tue.id}`).send({ skip: false })
    expect(res.status).toBe(200)
    expect(await ctx.prisma.planRevision.count({ where: { planId: plan.id } })).toBe(revisions)
  })
})

// ---------------------------------------------------------------------------------------------
// recordPlanWrite
// ---------------------------------------------------------------------------------------------

describe('recordPlanWrite', () => {
  test('is the only function that creates a PlanRevision', () => {
    const root = join(import.meta.dirname, '..', '..', 'server')
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((path) => path.endsWith('.ts'))
      .filter((path) =>
        /\bplanRevision\s*\.\s*(create|createMany|createManyAndReturn|upsert)\b/.test(
          readFileSync(join(root, path), 'utf8'),
        ),
      )
    expect(offenders).toEqual([join('services', 'replan.ts')])
  })

  test('writes the optional fields as null and false, and the given ones as JSON', async () => {
    const f = await fourWeekPlan('record-fields@example.com')
    const decision = { decision: 'hold', signals: [], nextWeekTargetMin: 200 } as WeeklyDecision
    const changes: PlanChange[] = [
      { weekStart: thisMonday, field: 'targetRunMin', from: 250, to: 200, rules: ['J5'] },
    ]
    const view = await ctx.prisma.$transaction((tx) =>
      recordPlanWrite(tx, {
        planId: f.plan.id,
        userId: f.u.id,
        reason: 'disruption',
        summary: 'Synthetic.',
        changes,
        diff: null,
        undo: null,
        decision,
        auto: true,
        disruptionId: 'd1',
      }),
    )
    expect(view).toMatchObject({
      reason: 'disruption',
      auto: true,
      decision,
      changes,
      diff: null,
      disruptionId: 'd1',
      seenAt: null,
      undoOf: null,
    })
    expect(await lastRevision(f.plan.id)).toMatchObject({ undo: null, undoneAt: null })
    const bare = await ctx.prisma.$transaction((tx) =>
      recordPlanWrite(tx, {
        planId: f.plan.id,
        userId: f.u.id,
        reason: 'owner',
        summary: 'Synthetic.',
        changes: [],
        diff: null,
        undo: null,
      }),
    )
    expect(bare).toMatchObject({ auto: false, decision: null, disruptionId: null })
  })

  test('refuses a plan that is not the user’s and writes nothing', async () => {
    const f = await fourWeekPlan('record-owner@example.com')
    const other = await seedUser(ctx, { email: 'record-other@example.com' })
    const revisions = await ctx.prisma.planRevision.count()
    await expect(
      ctx.prisma.$transaction((tx) =>
        recordPlanWrite(tx, {
          planId: f.plan.id,
          userId: other.id,
          reason: 'owner',
          summary: 'Synthetic.',
          changes: [],
          diff: null,
          undo: null,
        }),
      ),
    ).rejects.toMatchObject({ status: 404 })
    expect(await ctx.prisma.planRevision.count()).toBe(revisions)
  })
})

// ---------------------------------------------------------------------------------------------
// The view of a revision
// ---------------------------------------------------------------------------------------------

function revisionRow(over: Partial<PlanRevisionRow> = {}): PlanRevisionRow {
  return {
    id: 'rev1',
    planId: 'p1',
    createdAt: new Date('2026-10-19T03:00:00Z'),
    reason: 'weekly',
    summary: 'Synthetic.',
    changes: '[]',
    auto: true,
    decision: null,
    diff: null,
    undo: '{"v":1}',
    undoneAt: null,
    undoneById: null,
    undoOf: null,
    seenAt: null,
    disruptionId: null,
    ...over,
  }
}

describe('the view of a revision', () => {
  const now = new Date('2026-10-20T03:00:00Z')

  test('can be undone while it has a payload, is young, is not undone and is not an undo', () => {
    expect(toPlanRevision(revisionRow(), now).undo).toEqual({
      available: true,
      reasons: [],
      undoneAt: null,
    })
  })

  test.each([
    ['a revision with no payload', { undo: null }, 'not-undoable'],
    ['an undone revision', { undoneAt: new Date('2026-10-19T09:00:00Z') }, 'already-undone'],
    ['an undo', { reason: 'undo' }, 'is-undo'],
    ['one older than the window', { createdAt: new Date('2026-10-12T03:00:00Z') }, 'window-passed'],
  ])('says why %s cannot be undone', (_name, over, code) => {
    const { undo } = toPlanRevision(revisionRow(over), now)
    expect(undo.available).toBe(false)
    expect(undo.reasons).toHaveLength(1)
    expect(undo.reasons[0]).toMatchObject({ code })
    expect(undo.reasons[0]!.message.length).toBeGreaterThan(0)
  })

  test('the window is the Param, to the millisecond', () => {
    const edge = new Date(now.getTime() - P.revision.undoWindowDays.value * 86_400_000)
    expect(toPlanRevision(revisionRow({ createdAt: edge }), now).undo.reasons[0]?.code).toBe(
      'window-passed',
    )
    expect(
      toPlanRevision(revisionRow({ createdAt: new Date(edge.getTime() + 1) }), now).undo.available,
    ).toBe(true)
  })

  test('reads the stored columns, and falls back to null for a diff that cannot be parsed', () => {
    const diff = JSON.stringify({
      v: 1,
      sessions: [],
      weeks: [],
      holds: [],
      totals: {},
      empty: true,
    })
    const view = toPlanRevision(
      revisionRow({
        diff,
        decision: JSON.stringify({ decision: 'hold' }),
        seenAt: new Date('2026-10-19T08:00:00Z'),
        undoOf: 'rev0',
        disruptionId: 'd1',
      }),
      now,
    )
    expect(view).toMatchObject({
      auto: true,
      diff: { empty: true },
      decision: { decision: 'hold' },
      seenAt: '2026-10-19T08:00:00.000Z',
      undoOf: 'rev0',
      disruptionId: 'd1',
    })
    expect(toPlanRevision(revisionRow({ diff: '{not json' }), now).diff).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------------------------

describe('describeChanges', () => {
  const change = (weekStart: string): PlanChange => ({
    weekStart,
    field: 'targetRunMin',
    from: 1,
    to: 2,
    rules: [],
  })

  test('renders the summary from the copy templates, with the right plurals', () => {
    expect(describeChanges([])).toBe('No changes to the plan.')
    expect(describeChanges([change('2026-10-19')])).toBe('1 change across 1 week.')
    expect(describeChanges([change('2026-10-19'), change('2026-10-19')])).toBe(
      '2 changes across 1 week.',
    )
    expect(
      describeChanges([change('2026-10-19'), change('2026-10-26'), change('2026-10-26')]),
    ).toBe('3 changes across 2 weeks.')
  })
})

// ---------------------------------------------------------------------------------------------
// Existing revisions
// ---------------------------------------------------------------------------------------------

describe('a revision written before the revision model', () => {
  test('reads as a revision with no diff and nothing to undo, and stays in the list', async () => {
    const f = await fourWeekPlan('legacy-row@example.com')
    // The migration leaves such a row with the defaults below; `seenAt` is its `createdAt`.
    const createdAt = new Date('2026-10-12T03:00:00Z')
    const old = await ctx.prisma.planRevision.create({
      data: {
        planId: f.plan.id,
        reason: 'weekly',
        summary: '2 changes across 1 week.',
        createdAt,
        auto: true,
        seenAt: createdAt,
      },
    })
    const listed = (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    const row = listed.find((r) => r.id === old.id)!
    expect(row).toMatchObject({
      auto: true,
      diff: null,
      decision: null,
      seenAt: createdAt.toISOString(),
      undo: { available: false, reasons: [{ code: 'not-undoable' }] },
    })
  })
})
