import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { replan, weeklyDecision, weeklyRamp } from '../../shared/engine/index.ts'
import { P, PARAMS_VERSION } from '../../shared/engine/params/index.ts'
import type { EngineInput, PlanChange, WeeklyDecision } from '../../shared/engine/types.ts'
import type {
  PlanDiff,
  PlanPreview,
  PlanRevisionReason,
  PlanRevisionView,
  PlanWithSessions,
  UndoReason,
  UndoResult,
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
import { loadAthleteContext } from '../../server/services/athleteState.ts'
import { gatherEngineInput } from '../../server/services/engineInput.ts'
import {
  executionRecordsByWeek,
  failedChecklist,
  replanActivePlan,
  weekRow,
  writeReplannedSessions,
} from '../../server/services/planEngine.ts'
import { recordPrediction } from '../../server/services/predictionLog.ts'
import { computeAction } from '../../server/services/planActions.ts'
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

// Lets one test force a failed checklist; every other call goes to the real engine. `runChecklist`
// is counted where the undo calls it (the list of revisions must never run it).
const force = vi.hoisted(() => ({
  failChecklist: false,
  /** Makes the checklist the undo runs pass, for a test of the writes and not of the policy. */
  checklistOk: false,
  failRecord: false,
  checklistRuns: 0,
  contextReads: 0,
}))
vi.mock('../../shared/engine/index.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../shared/engine/index.ts')>()
  return {
    ...real,
    runChecklist: (...args: Parameters<typeof real.runChecklist>) => {
      force.checklistRuns += 1
      const results = real.runChecklist(...args)
      return force.checklistOk ? results.map((item) => ({ ...item, ok: true })) : results
    },
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
// The cached athlete input is read through this one function; the list of revisions reads it at
// most once.
vi.mock('../../server/services/athleteState.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../server/services/athleteState.ts')>()
  return {
    ...real,
    loadAthleteContext: (...args: Parameters<typeof real.loadAthleteContext>) => {
      force.contextReads += 1
      return real.loadAthleteContext(...args)
    },
  }
})
// Lets one test fail an undo inside its transaction, after the rows were written.
vi.mock('../../server/services/replan.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../server/services/replan.ts')>()
  return {
    ...real,
    recordPlanWrite: (...args: Parameters<typeof real.recordPlanWrite>) => {
      if (force.failRecord) {
        force.failRecord = false
        return Promise.reject(new Error('forced failure inside the transaction'))
      }
      return real.recordPlanWrite(...args)
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
  force.checklistOk = false
  force.failRecord = false
  vi.restoreAllMocks()
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
    // The link columns and the timestamp are outside the hash. The status the assessment sets with
    // the link is inside it, so undo checks the link before it compares hashes (a test below).
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

// ---------------------------------------------------------------------------------------------
// Preview, undo, seen (R0-2)
// ---------------------------------------------------------------------------------------------

const post = (f: Fixture, url: string, body: object = {}) => client(ctx, f.u).post(url).send(body)
const undoUrl = (revisionId: string) => `/api/plan/revisions/${revisionId}/undo`

/** Opens every weekday again, as a runner who no longer needs a closed day would. */
async function reopenDays(f: Fixture): Promise<void> {
  await ctx.prisma.athleteProfile.update({
    where: { userId: f.u.id },
    data: { availability: '{}' },
  })
}

interface Replanned {
  f: Fixture
  /** The re-plan that closed a day. Its undo would put a run back on the closed day. */
  first: PlanRevisionView
  /** The re-plan that opened the day again. Its undo restores a plan today's input accepts. */
  second: PlanRevisionView
  /** The rows before `second` was written. */
  before: Snapshot
}

async function replannedTwice(email: string): Promise<Replanned> {
  const f = await fourWeekPlan(email)
  await closeBusyDay(f)
  const first = await post(f, '/api/plan/replan')
  expect(first.status, JSON.stringify(first.body)).toBe(200)
  await reopenDays(f)
  const before = await snapshot(f.plan.id)
  const second = await post(f, '/api/plan/replan')
  expect(second.status, JSON.stringify(second.body)).toBe(200)
  const view = second.body as PlanRevisionView
  expect(view.diff?.empty, 'the second re-plan changes rows').toBe(false)
  return { f, first: first.body as PlanRevisionView, second: view, before }
}

/** Every column of both tables, as the data model lists them, equal to `want`. */
async function expectSameRows(planId: string, want: Snapshot): Promise<void> {
  const now = await snapshot(planId)
  const nowSessions = content(now.sessions)
  const wantSessions = content(want.sessions)
  expect(nowSessions.map((row) => row.id)).toEqual(wantSessions.map((row) => row.id))
  for (const column of PLAN_SESSION_COLUMNS.filter((c) => c !== 'updatedAt')) {
    expect(
      nowSessions.map((row) => row[column]),
      `PlanSession.${column}`,
    ).toEqual(wantSessions.map((row) => row[column]))
  }
  const nowWeeks = content(now.weeks)
  const wantWeeks = content(want.weeks)
  expect(nowWeeks.map((row) => row.id)).toEqual(wantWeeks.map((row) => row.id))
  for (const column of PLAN_WEEK_COLUMNS.filter((c) => c !== 'updatedAt')) {
    expect(
      nowWeeks.map((row) => row[column]),
      `PlanWeek.${column}`,
    ).toEqual(wantWeeks.map((row) => row[column]))
  }
}

/** The athlete snapshot's picture of the plan, which must equal the database after a refusal. */
async function expectCacheMatchesDatabase(f: Fixture): Promise<void> {
  const context = await loadAthleteContext(deps(), { userId: f.u.id, today: todayIso() })
  const rows = await snapshot(f.plan.id)
  const existing = context.existing()!
  const cached = existing.sessions
    .map((s) => `${s.id}|${s.date}|${s.kind}|${s.durationMin}|${s.status}`)
    .sort()
  const stored = rows.sessions
    .map((s) => `${s.id}|${s.date}|${s.kind}|${s.durationMin}|${s.status}`)
    .sort()
  expect(cached).toEqual(stored)
  expect(existing.weeks.map((w) => `${w.weekStart}|${w.targetRunMin}`).sort()).toEqual(
    rows.weeks.map((w) => `${w.weekStart}|${w.targetRunMin}`).sort(),
  )
}

interface Counts {
  revisions: number
  predictions: number
  version: Awaited<ReturnType<typeof dataVersionKey>>
}
async function counts(f: Fixture): Promise<Counts> {
  return {
    revisions: await ctx.prisma.planRevision.count({ where: { planId: f.plan.id } }),
    predictions: await ctx.prisma.predictionLog.count({ where: { userId: f.u.id } }),
    version: await dataVersionKey(ctx.prisma),
  }
}

interface Was {
  rows: Snapshot
  counts: Counts
}
async function stateOf(f: Fixture): Promise<Was> {
  return { rows: await snapshot(f.plan.id), counts: await counts(f) }
}

/** A refusal wrote nothing: rows, revisions, predictions and the data version are as they were. */
async function expectNothingWritten(f: Fixture, was: Was): Promise<void> {
  expect(await snapshot(f.plan.id)).toEqual(was.rows)
  expect(await counts(f)).toEqual(was.counts)
  await expectCacheMatchesDatabase(f)
}

function reasonsOf(res: { body: unknown }): UndoReason[] {
  return (res.body as { error: { details: { reasons: UndoReason[] } } }).error.details.reasons
}
const errorOf = (res: { body: unknown }) =>
  (res.body as { error: { code: string; message: string; details?: Record<string, unknown> } })
    .error

/** A session a revision wrote and that is still to come, to edit or to link. */
function touchedSession(revision: PlanRevisionView) {
  const line = revision.diff!.sessions.find((l) => l.change !== 'removed' && l.sessionId !== null)
  expect(line, 'the revision wrote a session').toBeDefined()
  return line!
}

/** Ids of the sessions a revision's payload names. */
async function touchedIds(revisionId: string): Promise<Set<string>> {
  const row = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: revisionId } })
  const payload = JSON.parse(row.undo!) as UndoPayload
  return new Set([
    ...payload.sessions.created.map((e) => e.id),
    ...payload.sessions.updated.map((e) => e.id),
    ...payload.sessions.deleted.map((e) => e.id),
  ])
}

/** A session no revision of the plan has touched and that an owner edit can skip. */
async function untouchedSession(r: Replanned) {
  const touched = await touchedIds(r.second.id)
  const all = await sessionsOf(r.f.plan.id)
  const found = all.find(
    (s) => !touched.has(s.id) && s.date >= today && s.kind !== 'race' && s.activityId === null,
  )
  expect(found, 'a session the update did not touch').toBeDefined()
  return found!
}

const lineKey = (line: PlanDiff['sessions'][number]) => {
  const brief = (line.after ?? line.before)!
  return `${line.date}|${brief.kind}|${line.change}|${brief.title}|${String(brief.durationMin)}`
}
/** A preview's diff names rows that do not exist yet without ids; the rest must equal the commit's. */
function withoutIds(diff: PlanDiff): PlanDiff {
  return {
    ...diff,
    sessions: diff.sessions
      .map((line) =>
        line.change === 'added' ? { ...line, sessionId: null, externalId: '' } : line,
      )
      .sort((a, b) => lineKey(a).localeCompare(lineKey(b))),
  }
}

describe('POST /api/plan/preview', () => {
  test('a re-plan preview is the diff of the commit, and writes nothing', async () => {
    const f = await fourWeekPlan('preview-replan@example.com')
    await closeBusyDay(f)
    const was = await stateOf(f)

    const res = await post(f, '/api/plan/preview', { type: 'replan' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const preview = res.body as PlanPreview
    expect(preview).toMatchObject({
      action: { type: 'replan' },
      blocked: false,
      guards: [],
      reasons: [],
      today,
    })
    expect(preview.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(preview.diff.empty).toBe(false)
    expect(preview.summary.length).toBeGreaterThan(0)
    expect(Array.isArray(preview.warnings)).toBe(true)
    // No row, no revision, no prediction and no data version.
    expect(await snapshot(f.plan.id)).toEqual(was.rows)
    expect(await counts(f)).toEqual(was.counts)

    const commit = await post(f, '/api/plan/replan', { expectHash: preview.hash })
    expect(commit.status, JSON.stringify(commit.body)).toBe(200)
    const revision = commit.body as PlanRevisionView
    expect(withoutIds(revision.diff!)).toEqual(withoutIds(preview.diff))
    expect(revision.summary).toBe(preview.summary)
    // The answer carries the structural undo state of the revision it wrote.
    expect(revision.undo).toMatchObject({ available: true, reasons: [] })
  })

  test('a re-plan commit whose hash no longer matches is refused with the new preview', async () => {
    const f = await fourWeekPlan('preview-stale-replan@example.com')
    await closeBusyDay(f)
    const preview = (await post(f, '/api/plan/preview', { type: 'replan' })).body as PlanPreview
    // The plan moves on: another write lands before the commit.
    expect((await post(f, '/api/plan/replan')).status).toBe(200)
    const was = await stateOf(f)

    const res = await post(f, '/api/plan/replan', { expectHash: preview.hash })
    expect(res.status).toBe(409)
    expect(errorOf(res).details).toMatchObject({ code: 'stale-preview' })
    const fresh = errorOf(res).details!.preview as PlanPreview
    expect(fresh.hash).not.toBe(preview.hash)
    expect(fresh.action).toEqual({ type: 'replan' })
    assertCleanCopy(errorOf(res).message, 'stale preview')
    expect(await snapshot(f.plan.id)).toEqual(was.rows)
    expect(await counts(f)).toEqual(was.counts)
  })

  test('answers a refused undo as information, not as an error', async () => {
    const r = await replannedTwice('preview-refused@example.com')
    const was = await stateOf(r.f)
    await ctx.prisma.planRevision.update({
      where: { id: r.second.id },
      data: { undoneAt: new Date(), undoneById: 'x' },
    })
    const res = await post(r.f, '/api/plan/preview', { type: 'undo', revisionId: r.second.id })
    expect(res.status).toBe(200)
    const preview = res.body as PlanPreview
    expect(preview.blocked).toBe(true)
    expect(preview.reasons).toMatchObject([{ code: 'already-undone' }])
    expect(preview.diff.empty).toBe(true)
    expect(preview.hash).toMatch(/^[0-9a-f]{64}$/)
    expect((await snapshot(r.f.plan.id)).sessions).toEqual(was.rows.sessions)
  })

  test('refuses a body that is not an action', async () => {
    const f = await fourWeekPlan('preview-body@example.com')
    for (const body of [
      {},
      { type: 'nonsense' },
      { type: 'undo' },
      { type: 'undo', revisionId: '' },
      { type: 'replan', extra: 1 },
    ]) {
      const res = await post(f, '/api/plan/preview', body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(errorOf(res).code).toBe('validation')
    }
  })

  test('answers 401 before it reads the body, and 404 for another user’s revision', async () => {
    const r = await replannedTwice('preview-auth@example.com')
    const anonymous = client(ctx)
    expect((await anonymous.post('/api/plan/preview').send({ nonsense: true })).status).toBe(401)
    expect((await anonymous.post(undoUrl(r.second.id)).send({ expectHash: 'short' })).status).toBe(
      401,
    )
    expect((await anonymous.post(`/api/plan/revisions/${r.second.id}/seen`).send({})).status).toBe(
      401,
    )

    const other = await seedUser(ctx, { email: 'preview-auth-other@example.com' })
    const stranger = client(ctx, other)
    const preview = await stranger
      .post('/api/plan/preview')
      .send({ type: 'undo', revisionId: r.second.id })
    expect(preview.status).toBe(404)
    expect((await stranger.post(undoUrl(r.second.id)).send({})).status).toBe(404)
    expect((await stranger.post(`/api/plan/revisions/${r.second.id}/seen`).send({})).status).toBe(
      404,
    )
  })

  test('computeAction is the one builder: a direct call and the route give the same preview', async () => {
    const r = await replannedTwice('preview-parity@example.com')
    const direct = await computeAction(deps(), {
      userId: r.f.u.id,
      action: { type: 'undo', revisionId: r.second.id },
      today,
    })
    const preview = (
      await post(r.f, '/api/plan/preview', { type: 'undo', revisionId: r.second.id })
    ).body as PlanPreview
    expect(direct.hash).toBe(preview.hash)
    expect(JSON.parse(JSON.stringify(direct.diff))).toEqual(preview.diff)
    expect(direct.reasons).toEqual([])
  })
})

describe('POST /api/plan/revisions/:id/undo', () => {
  test('restores the rows exactly, with their ids and externalIds, and links the two revisions', async () => {
    const r = await replannedTwice('undo-restores@example.com')
    const after = await snapshot(r.f.plan.id)
    expect(rowWrites(r.before.sessions, after.sessions).created.length).toBeGreaterThan(0)

    const res = await post(r.f, undoUrl(r.second.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision, target } = res.body as UndoResult

    // Every column of every row is as it was, ids and externalIds included (the DMMF lists).
    await expectSameRows(r.f.plan.id, r.before)
    expect(revision).toMatchObject({
      reason: 'undo',
      undoOf: r.second.id,
      auto: false,
      undo: { available: false, reasons: [{ code: 'is-undo' }] },
    })
    expect(target).toMatchObject({
      id: r.second.id,
      undo: { available: false, reasons: [{ code: 'already-undone' }] },
    })
    expect(target.undo.undoneAt).not.toBeNull()
    expect(Object.keys(revision.undo).sort()).toEqual(['available', 'reasons', 'undoneAt'])

    // Linked both ways; the undo revision has no payload of its own.
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: r.second.id } })
    expect(stored.undoneById).toBe(revision.id)
    expect(stored.undoneAt).not.toBeNull()
    const written = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: revision.id } })
    expect(written).toMatchObject({ reason: 'undo', undoOf: r.second.id, undo: null, auto: false })
    expect(revision.summary).toBe(`Undid: ${r.second.summary}`)

    // The undo is a diff of its own: what the update added is removed, and the reverse.
    expect(revision.diff!.totals).toMatchObject({
      added: r.second.diff!.totals.removed,
      removed: r.second.diff!.totals.added,
      changed: r.second.diff!.totals.changed,
    })
    expect(revision.diff!.empty).toBe(false)
    await expectCacheMatchesDatabase(r.f)
  })

  test('the preview diff deep-equals the committed diff, and the preview writes nothing', async () => {
    const r = await replannedTwice('undo-parity@example.com')
    const was = await stateOf(r.f)
    const res = await post(r.f, '/api/plan/preview', { type: 'undo', revisionId: r.second.id })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const preview = res.body as PlanPreview
    expect(preview).toMatchObject({ blocked: false, reasons: [], guards: [], today })
    expect(preview.diff.empty).toBe(false)
    expect(await snapshot(r.f.plan.id)).toEqual(was.rows)
    expect(await counts(r.f)).toEqual(was.counts)

    const commit = await post(r.f, undoUrl(r.second.id), { expectHash: preview.hash })
    expect(commit.status, JSON.stringify(commit.body)).toBe(200)
    expect((commit.body as UndoResult).revision.diff).toEqual(preview.diff)
    expect((commit.body as UndoResult).revision.summary).toBe(preview.summary)
  })

  test('recomputes the plan columns that follow the rows', async () => {
    const r = await replannedTwice('undo-plan-columns@example.com')
    await ctx.prisma.plan.update({
      where: { id: r.f.plan.id },
      data: { checklist: '[]', warnings: '[]', paramsVersion: 'old' },
    })
    const res = await post(r.f, undoUrl(r.second.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const plan = await ctx.prisma.plan.findUniqueOrThrow({ where: { id: r.f.plan.id } })
    const checklist = JSON.parse(plan.checklist) as Array<{ ok: boolean }>
    expect(checklist.length).toBeGreaterThan(0)
    expect(checklist.every((item) => item.ok)).toBe(true)
    expect(plan.paramsVersion).toBe(PARAMS_VERSION)
  })

  test('is refused when the update was already undone, and when it is an undo', async () => {
    const r = await replannedTwice('undo-twice@example.com')
    const done = await post(r.f, undoUrl(r.second.id))
    expect(done.status).toBe(200)
    const undoId = (done.body as UndoResult).revision.id
    const was = await stateOf(r.f)

    const again = await post(r.f, undoUrl(r.second.id))
    expect(again.status).toBe(409)
    expect(reasonsOf(again)).toMatchObject([{ code: 'already-undone' }])
    expect(errorOf(again).message).toBe(reasonsOf(again)[0]!.message)

    const ofUndo = await post(r.f, undoUrl(undoId))
    expect(ofUndo.status).toBe(409)
    expect(reasonsOf(ofUndo)).toMatchObject([{ code: 'is-undo' }])
    await expectNothingWritten(r.f, was)
  })

  test('is refused for a revision with nothing to restore', async () => {
    const f = await fourWeekPlan('undo-none@example.com')
    const generate = await lastRevision(f.plan.id)
    const was = await stateOf(f)
    const res = await post(f, undoUrl(generate.id))
    expect(res.status).toBe(409)
    expect(reasonsOf(res)).toMatchObject([{ code: 'not-undoable' }])
    await expectNothingWritten(f, was)
  })

  test('is refused once the plan is archived, and once the window has passed', async () => {
    const r = await replannedTwice('undo-plan-window@example.com')
    const was = await stateOf(r.f)

    const eight = new Date(MONDAY.getTime() - 8 * 86_400_000)
    await ctx.prisma.planRevision.update({ where: { id: r.second.id }, data: { createdAt: eight } })
    const late = await post(r.f, undoUrl(r.second.id))
    expect(late.status).toBe(409)
    expect(reasonsOf(late)).toMatchObject([{ code: 'window-passed' }])
    expect(reasonsOf(late)[0]!.message).toContain(`${String(P.revision.undoWindowDays.value)}-day`)
    await ctx.prisma.planRevision.update({
      where: { id: r.second.id },
      data: { createdAt: new Date() },
    })

    await ctx.prisma.plan.update({ where: { id: r.f.plan.id }, data: { status: 'archived' } })
    const archived = await post(r.f, undoUrl(r.second.id))
    expect(archived.status).toBe(409)
    expect(reasonsOf(archived)).toMatchObject([{ code: 'plan-archived' }])
    await ctx.prisma.plan.update({ where: { id: r.f.plan.id }, data: { status: 'active' } })

    expect((await snapshot(r.f.plan.id)).sessions).toEqual(was.rows.sessions)
  })

  test('is refused for a row edited since, naming it; a later edit of another row does not block it', async () => {
    const r = await replannedTwice('undo-edited@example.com')

    // Another row changes first: the update's undo stays available.
    const other = await untouchedSession(r)
    const skipped = await client(ctx, r.f.u)
      .put(`/api/plan/sessions/${other.id}`)
      .send({ skip: true })
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200)
    const listed = (await client(ctx, r.f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.find((v) => v.id === r.second.id)!.undo).toMatchObject({
      available: true,
      reasons: [],
    })

    // A row the update wrote changes: refused, and the row is named.
    const line = touchedSession(r.second)
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: line.sessionId! } })
    await ctx.prisma.planSession.update({
      where: { id: row.id },
      data: { durationMin: row.durationMin + 5 },
    })
    const was = await stateOf(r.f)
    const res = await post(r.f, undoUrl(r.second.id))
    expect(res.status).toBe(409)
    const reasons = reasonsOf(res)
    expect(reasons.length).toBeGreaterThan(0)
    expect(reasons.every((reason) => reason.code === 'edited-since')).toBe(true)
    const named = reasons.find((reason) => reason.sessionId === row.id)!
    expect(named.message).toContain(row.title)
    for (const reason of reasons) assertCleanCopy(reason.message, reason.code)
    await expectNothingWritten(r.f, was)
  })

  test('is refused for a week edited since, and restores a week it did not', async () => {
    const f = await fourWeekPlan('undo-week-edited@example.com')
    const week = (await weeksOf(f.plan.id)).find((w) => w.weekStart === nextMonday)!
    // A revision that changed one column of next week (written by hand: no engine path edits
    // only a week).
    const changed = await ctx.prisma.planWeek.update({
      where: { id: week.id },
      data: { longRunMin: week.longRunMin + 5 },
    })
    const revision = await ctx.prisma.planRevision.create({
      data: {
        planId: f.plan.id,
        reason: 'owner',
        summary: 'Synthetic.',
        undo: JSON.stringify({
          v: 1,
          sessions: { created: [], deleted: [], updated: [] },
          weeks: {
            created: [],
            deleted: [],
            updated: [
              { id: week.id, before: { longRunMin: week.longRunMin }, hash: weekHash(changed) },
            ],
          },
          disruptions: { created: [], updated: [] },
        } satisfies UndoPayload),
      },
    })

    await ctx.prisma.planWeek.update({
      where: { id: week.id },
      data: { runDays: week.runDays - 1 },
    })
    const was = await stateOf(f)
    const refused = await post(f, undoUrl(revision.id))
    expect(refused.status).toBe(409)
    const [named] = reasonsOf(refused)
    expect(named).toMatchObject({ code: 'edited-since', weekStart: nextMonday })
    expect(named!.message).toContain('The week of')
    assertCleanCopy(named!.message, 'edited-since')
    await expectNothingWritten(f, was)

    // Put the week back as the revision left it and the undo restores the column it changed.
    await ctx.prisma.planWeek.update({ where: { id: week.id }, data: { runDays: week.runDays } })
    const res = await post(f, undoUrl(revision.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const restored = await ctx.prisma.planWeek.findUniqueOrThrow({ where: { id: week.id } })
    expect(restored.longRunMin).toBe(week.longRunMin)
    expect(restored.runDays).toBe(week.runDays)
  })

  test('writes back the weeks a re-plan created and deleted, with their ids', async () => {
    const f = await fourWeekPlan('undo-week-rows@example.com')
    const goalDate = addDays(thisMonday, 7 * 3 + 5)
    // The restored plan is for a race on another date than the goal now has, so its checklist
    // would refuse it; this test is about the writes, not the policy.
    force.checklistOk = true

    // A race two weeks later adds two weeks.
    let before = await snapshot(f.plan.id)
    await ctx.prisma.goal.update({
      where: { id: f.goalId },
      data: { targetDate: addDays(goalDate, 14) },
    })
    let revision = (await post(f, '/api/plan/replan')).body as PlanRevisionView
    expect(
      rowWrites(before.weeks, (await snapshot(f.plan.id)).weeks).created.length,
    ).toBeGreaterThan(0)
    let res = await post(f, undoUrl(revision.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    await expectSameRows(f.plan.id, before)

    // A race back at the first date drops them again, and the undo recreates them.
    await ctx.prisma.goal.update({
      where: { id: f.goalId },
      data: { targetDate: addDays(goalDate, 14) },
    })
    await post(f, '/api/plan/replan')
    before = await snapshot(f.plan.id)
    await ctx.prisma.goal.update({ where: { id: f.goalId }, data: { targetDate: goalDate } })
    revision = (await post(f, '/api/plan/replan')).body as PlanRevisionView
    expect(
      rowWrites(before.weeks, (await snapshot(f.plan.id)).weeks).deleted.length,
    ).toBeGreaterThan(0)
    res = await post(f, undoUrl(revision.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    await expectSameRows(f.plan.id, before)
  })

  test('a run linked since is its own reason, never an edit', async () => {
    const r = await replannedTwice('undo-run@example.com')
    const line = touchedSession(r.second)
    const run = await ctx.prisma.activity.findFirstOrThrow({
      where: { userId: r.f.u.id, type: 'run' },
      orderBy: { date: 'desc' },
    })
    // Linking a run also changes the session's status; the content hash must not read that as an edit.
    await ctx.prisma.planSession.update({
      where: { id: line.sessionId! },
      data: { activityId: run.id, linkSource: 'owner', status: 'completed', execution: '{}' },
    })
    const was = await stateOf(r.f)
    const res = await post(r.f, undoUrl(r.second.id))
    expect(res.status).toBe(409)
    const reasons = reasonsOf(res)
    const runs = reasons.filter((reason) => reason.code === 'session-run')
    expect(runs.map((reason) => reason.sessionId)).toEqual([line.sessionId])
    expect(
      reasons.some(
        (reason) => reason.sessionId === line.sessionId && reason.code === 'edited-since',
      ),
    ).toBe(false)
    expect(runs[0]!.message).toContain('A run is linked to')
    assertCleanCopy(runs[0]!.message, 'session-run')
    await expectNothingWritten(r.f, was)

    const listed = (await client(ctx, r.f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.find((v) => v.id === r.second.id)!.undo.reasons.map((x) => x.code)).toContain(
      'session-run',
    )
  })

  test('a run linked by the link route to a row the update changed reads as a run, not as an edit', async () => {
    const f = await fourWeekPlan('undo-run-linked@example.com')
    const session = f.plan.sessions.find(
      (s) => s.date >= addDays(today, 1) && s.kind === 'easy' && s.activityId === null,
    )!
    // An owner edit updates this row in place; its payload holds the hash of the row as left.
    const skipped = await client(ctx, f.u)
      .put(`/api/plan/sessions/${session.id}`)
      .send({ skip: true })
    expect(skipped.status).toBe(200)
    const revision = await lastRevision(f.plan.id)
    const entry = (JSON.parse(revision.undo!) as UndoPayload).sessions.updated.find(
      (candidate) => candidate.id === session.id,
    )!
    const unlinked = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(sessionHash(unlinked)).toBe(entry.hash)
    const run = await ctx.prisma.activity.findFirstOrThrow({
      where: { userId: f.u.id, type: 'run' },
      orderBy: { date: 'desc' },
    })

    const link = await post(f, `/api/plan/sessions/${session.id}/link`, { activityId: run.id })
    expect(link.status, JSON.stringify(link.body)).toBe(200)
    const linked = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(linked.activityId).toBe(run.id)
    expect(linked.execution).not.toBeNull()
    // The link and the assessment are outside the hash. The status the assessment sets is inside
    // it, which is why the check on the link comes before the comparison of hashes.
    expect(linked.status).not.toBe(unlinked.status)
    expect(sessionHash({ ...linked, status: unlinked.status })).toBe(entry.hash)
    expect(sessionHash(linked)).not.toBe(entry.hash)

    const listed = (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    const reasons = listed.find((v) => v.id === revision.id)!.undo.reasons
    expect(reasons.map((x) => [x.code, x.sessionId])).toEqual([['session-run', session.id]])
    const was = await stateOf(f)
    const res = await post(f, undoUrl(revision.id))
    expect(res.status).toBe(409)
    expect(reasonsOf(res).map((x) => [x.code, x.sessionId])).toEqual([['session-run', session.id]])
    await expectNothingWritten(f, was)
  })

  test('a cited safety rule that is still active refuses the undo, and lifts when it clears', async () => {
    const r = await replannedTwice('undo-safety@example.com')
    // The weekly decision behind this update cited illness (n-3).
    await ctx.prisma.planRevision.update({
      where: { id: r.second.id },
      data: {
        decision: JSON.stringify({
          decision: 'reduce',
          signals: [{ code: 'illness', detail: 'Illness was reported.', rules: ['n-3', 'J5'] }],
          nextWeekTargetMin: 90,
        }),
      },
    })
    const illness = await client(ctx, r.f.u).put(`/api/checkins/${today}`).send({ illness: true })
    expect(illness.status).toBe(200)

    const was = await stateOf(r.f)
    const res = await post(r.f, undoUrl(r.second.id))
    expect(res.status).toBe(409)
    expect(reasonsOf(res)).toMatchObject([{ code: 'safety-rule', rules: ['n-3'] }])
    expect(reasonsOf(res)[0]!.message).toContain('illness')
    assertCleanCopy(reasonsOf(res)[0]!.message, 'safety-rule')
    await expectNothingWritten(r.f, was)

    const listed = (await client(ctx, r.f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.find((v) => v.id === r.second.id)!.undo.reasons).toMatchObject([
      { code: 'safety-rule', rules: ['n-3'] },
    ])

    await client(ctx, r.f.u).put(`/api/checkins/${today}`).send({ illness: false })
    const cleared = await post(r.f, undoUrl(r.second.id))
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200)
  })

  test('a rest window the runner reported is never refused on safety grounds', async () => {
    const r = await replannedTwice('undo-window@example.com')
    const row = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: r.second.id } })
    const payload = JSON.parse(row.undo!) as UndoPayload
    payload.disruptions.created.push({ id: 'window-1', hash: 'unused' })
    await ctx.prisma.planRevision.update({
      where: { id: row.id },
      data: {
        reason: 'disruption',
        disruptionId: 'window-1',
        undo: JSON.stringify(payload),
        decision: JSON.stringify({
          decision: 'reduce',
          signals: [{ code: 'illness', detail: 'Illness was reported.', rules: ['n-3'] }],
          nextWeekTargetMin: 90,
        }),
      },
    })
    await client(ctx, r.f.u).put(`/api/checkins/${today}`).send({ illness: true })

    const listed = (await client(ctx, r.f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.find((v) => v.id === row.id)!.undo).toMatchObject({ available: true })
    const res = await post(r.f, undoUrl(row.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  test('is refused with the checklist when the restored plan does not pass it, and writes nothing', async () => {
    const f = await fourWeekPlan('undo-checklist@example.com')
    await closeBusyDay(f)
    const first = (await post(f, '/api/plan/replan')).body as PlanRevisionView
    const was = await stateOf(f)

    // Restoring would put a run back on the day the runner closed.
    const preview = (await post(f, '/api/plan/preview', { type: 'undo', revisionId: first.id }))
      .body as PlanPreview
    expect(preview.blocked).toBe(true)
    expect(preview.reasons).toMatchObject([{ code: 'checklist' }])
    expect(preview.reasons[0]!.message).toBe(
      'The earlier plan no longer meets the plan checks, so it cannot be restored.',
    )
    expect(preview.reasons[0]!.items).toContain('availability')
    assertCleanCopy(preview.reasons[0]!.message, 'checklist')
    expect(preview.diff.empty).toBe(false)

    const res = await post(f, undoUrl(first.id))
    expect(res.status).toBe(422)
    const details = errorOf(res).details as { checklist: Array<{ id: string; ok: boolean }> }
    expect(details.checklist.some((item) => item.id === 'availability' && !item.ok)).toBe(true)
    expect(errorOf(res).message).toBe(preview.reasons[0]!.message)
    await expectNothingWritten(f, was)
  })

  test('is refused as stale when the plan moved after the preview', async () => {
    const r = await replannedTwice('undo-stale@example.com')
    const preview = (
      await post(r.f, '/api/plan/preview', { type: 'undo', revisionId: r.second.id })
    ).body as PlanPreview

    // Another revision is written first.
    const other = await untouchedSession(r)
    expect(
      (await client(ctx, r.f.u).put(`/api/plan/sessions/${other.id}`).send({ skip: true })).status,
    ).toBe(200)
    const was = await stateOf(r.f)
    const moved = await post(r.f, undoUrl(r.second.id), { expectHash: preview.hash })
    expect(moved.status).toBe(409)
    expect(errorOf(moved).details).toMatchObject({ code: 'stale-preview' })
    const fresh = errorOf(moved).details!.preview as PlanPreview
    expect(fresh.hash).not.toBe(preview.hash)
    expect(fresh.action).toEqual({ type: 'undo', revisionId: r.second.id })
    await expectNothingWritten(r.f, was)

    // The fresh preview commits.
    const ok = await post(r.f, undoUrl(r.second.id), { expectHash: fresh.hash })
    expect(ok.status, JSON.stringify(ok.body)).toBe(200)
  })

  test('is refused as stale after midnight', async () => {
    const r = await replannedTwice('undo-midnight@example.com')
    const preview = (
      await post(r.f, '/api/plan/preview', { type: 'undo', revisionId: r.second.id })
    ).body as PlanPreview
    const was = await stateOf(r.f)
    vi.setSystemTime(new Date(MONDAY.getTime() + 86_400_000))
    const res = await post(r.f, undoUrl(r.second.id), { expectHash: preview.hash })
    expect(res.status).toBe(409)
    expect(errorOf(res).details).toMatchObject({ code: 'stale-preview' })
    expect((errorOf(res).details!.preview as PlanPreview).today).toBe(addDays(today, 1))
    expect(await snapshot(r.f.plan.id)).toEqual(was.rows)
  })

  test('validates the body with Zod', async () => {
    const r = await replannedTwice('undo-body@example.com')
    for (const body of [{ expectHash: 'short' }, { expectHash: 7 }, { extra: true }]) {
      const res = await post(r.f, undoUrl(r.second.id), body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect((await post(r.f, undoUrl('no-such-revision'))).status).toBe(404)
  })

  test('a failure inside the transaction rolls everything back and leaves no stale snapshot', async () => {
    const r = await replannedTwice('undo-rollback@example.com')
    // Warm the cache with the plan as it is, then fail after the rows were written.
    await expectCacheMatchesDatabase(r.f)
    const was = await stateOf(r.f)
    force.failRecord = true
    const res = await post(r.f, undoUrl(r.second.id))
    expect(res.status).toBe(500)
    expect(await snapshot(r.f.plan.id)).toEqual(was.rows)
    expect(await ctx.prisma.planRevision.count({ where: { planId: r.f.plan.id } })).toBe(
      was.counts.revisions,
    )
    const target = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: r.second.id } })
    expect(target.undoneAt).toBeNull()
    await expectCacheMatchesDatabase(r.f)

    // The same undo then works.
    const again = await post(r.f, undoUrl(r.second.id))
    expect(again.status, JSON.stringify(again.body)).toBe(200)
    await expectSameRows(r.f.plan.id, r.before)
  })

  test('undoes an owner’s skip, restoring the status and the prescription they kept', async () => {
    const f = await fourWeekPlan('undo-owner-skip@example.com')
    const session = f.plan.sessions.find(
      (s) => s.date >= addDays(today, 1) && s.kind === 'easy' && s.activityId === null,
    )!
    const before = await snapshot(f.plan.id)
    const skipped = await client(ctx, f.u)
      .put(`/api/plan/sessions/${session.id}`)
      .send({ skip: true })
    expect(skipped.status).toBe(200)
    const revision = await lastRevision(f.plan.id)
    const res = await post(f, undoUrl(revision.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    await expectSameRows(f.plan.id, before)
  })

  test('restores the sessions from today on and leaves the past as it is', async () => {
    const r = await replannedTwice('undo-past@example.com')
    const after = await snapshot(r.f.plan.id)
    // Thursday: the sessions of Monday to Wednesday are in the past.
    const thursday = addDays(thisMonday, 3)
    vi.setSystemTime(new Date(2026, 9, 22, 12))
    expect(todayIso()).toBe(thursday)

    const res = await post(r.f, undoUrl(r.second.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const want: Snapshot = {
      sessions: [
        ...after.sessions.filter((row) => row.date < thursday),
        ...r.before.sessions.filter((row) => row.date >= thursday),
      ],
      weeks: r.before.weeks,
    }
    await expectSameRows(r.f.plan.id, want)
    // The fixture only tests the rule when the update touched a day before Thursday.
    const writes = rowWrites(r.before.sessions, after.sessions)
    const dateOf = new Map(
      [...r.before.sessions, ...after.sessions].map((row) => [row.id, row.date]),
    )
    const touched = [...writes.created, ...writes.deleted, ...writes.changed]
    expect(touched.some((id) => dateOf.get(id)! < thursday)).toBe(true)
  })

  test('a revision whose rows are all in the past has nothing to restore', async () => {
    const f = await fourWeekPlan('undo-all-past@example.com')
    const session = f.plan.sessions.find(
      (s) => s.date >= today && s.kind === 'easy' && s.activityId === null,
    )!
    const skip = await client(ctx, f.u).put(`/api/plan/sessions/${session.id}`).send({ skip: true })
    expect(skip.status).toBe(200)
    const revision = await lastRevision(f.plan.id)
    vi.setSystemTime(new Date(new Date(`${session.date}T12:00:00`).getTime() + 86_400_000))
    const was = await stateOf(f)

    const res = await post(f, undoUrl(revision.id))
    expect(res.status).toBe(409)
    expect(reasonsOf(res)).toMatchObject([{ code: 'not-undoable' }])
    await expectNothingWritten(f, was)
  })

  test('brings back the sessions a rest window skipped in the past, and only for a window', async () => {
    const f = await fourWeekPlan('undo-backdated@example.com')
    const past = f.plan.sessions.find(
      (s) => s.date >= today && s.kind === 'easy' && s.activityId === null,
    )!
    // The window skipped a session in the past, then a day passed.
    const original = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: past.id } })
    const skipped = await ctx.prisma.planSession.update({
      where: { id: past.id },
      data: { status: 'skipped', original: '{"synthetic":true}' },
    })
    const payload = (windowCreated: boolean): UndoPayload => ({
      v: 1,
      sessions: {
        created: [],
        deleted: [],
        updated: [
          {
            id: past.id,
            before: { status: original.status, original: original.original },
            hash: sessionHash(skipped),
          },
        ],
      },
      weeks: { created: [], deleted: [], updated: [] },
      disruptions: {
        created: windowCreated ? [{ id: 'window-2', hash: 'unused' }] : [],
        updated: [],
      },
    })
    const make = (reason: string, windowCreated: boolean, disruptionId: string | null) =>
      ctx.prisma.planRevision.create({
        data: {
          planId: f.plan.id,
          reason,
          summary: 'Synthetic.',
          disruptionId,
          undo: JSON.stringify(payload(windowCreated)),
        },
      })
    const plain = await make('owner', false, null)
    const window = await make('disruption', true, 'window-2')
    vi.setSystemTime(new Date(new Date(`${past.date}T12:00:00`).getTime() + 86_400_000))

    const refused = await post(f, undoUrl(plain.id))
    expect(refused.status).toBe(409)
    expect(reasonsOf(refused)).toMatchObject([{ code: 'not-undoable' }])
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: past.id } })).status,
    ).toBe('skipped')

    const res = await post(f, undoUrl(window.id))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const restored = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: past.id } })
    expect(restored.status).toBe(original.status)
    expect(restored.original).toBe(original.original)
  })
})

describe('GET /api/plan/revisions: the structural undo state', () => {
  test('computes availability from the rows with one query per table and never runs the checklist', async () => {
    const r = await replannedTwice('list-structural@example.com')
    // A third revision with a payload, so the page holds three.
    const other = await untouchedSession(r)
    await client(ctx, r.f.u).put(`/api/plan/sessions/${other.id}`).send({ skip: true })

    const sessions = vi.spyOn(ctx.prisma.planSession, 'findMany')
    const weeks = vi.spyOn(ctx.prisma.planWeek, 'findMany')
    force.checklistRuns = 0
    force.contextReads = 0
    const res = await client(ctx, r.f.u).get('/api/plan/revisions')
    expect(res.status).toBe(200)
    const listed = res.body as PlanRevisionView[]
    // The first re-plan's rows were rewritten by the second, so only the second and the skip can
    // still be undone; the generate revision has nothing to restore.
    const reasonCodes = (id: string) =>
      listed.find((v) => v.id === id)!.undo.reasons.map((x) => x.code)
    expect(listed).toHaveLength(4)
    expect(listed.filter((v) => v.undo.available).map((v) => v.reason)).toEqual(['owner', 'owner'])
    expect(reasonCodes(r.first.id)).toContain('edited-since')
    expect(reasonCodes(r.second.id)).toEqual([])

    expect(sessions).toHaveBeenCalledTimes(1)
    expect(weeks).toHaveBeenCalledTimes(1)
    expect(force.checklistRuns).toBe(0)
    // Nothing on the page cites a safety rule, so the cached input is not read at all.
    expect(force.contextReads).toBe(0)
    for (const view of listed) expect(JSON.stringify(view)).not.toContain('"deleted"')
  })

  test('reads the cached input once for a page where several revisions cite a safety rule', async () => {
    const r = await replannedTwice('list-safety-once@example.com')
    const cite = JSON.stringify({
      decision: 'reduce',
      signals: [{ code: 'illness', detail: 'Illness was reported.', rules: ['n-3'] }],
      nextWeekTargetMin: 90,
    })
    await ctx.prisma.planRevision.updateMany({
      where: { planId: r.f.plan.id, undo: { not: null } },
      data: { decision: cite },
    })
    await client(ctx, r.f.u).put(`/api/checkins/${today}`).send({ illness: true })
    force.checklistRuns = 0
    force.contextReads = 0
    const res = await client(ctx, r.f.u).get('/api/plan/revisions')
    const listed = res.body as PlanRevisionView[]
    const cited = listed.filter((v) => v.undo.reasons.some((x) => x.code === 'safety-rule'))
    expect(cited.length).toBe(2)
    expect(force.contextReads).toBe(1)
    expect(force.checklistRuns).toBe(0)
  })

  test('a revision refused for its own state reads no row', async () => {
    const f = await fourWeekPlan('list-own-state@example.com')
    const sessions = vi.spyOn(ctx.prisma.planSession, 'findMany')
    const weeks = vi.spyOn(ctx.prisma.planWeek, 'findMany')
    const res = await client(ctx, f.u).get('/api/plan/revisions')
    expect((res.body as PlanRevisionView[])[0]!.undo.reasons).toMatchObject([
      { code: 'not-undoable' },
    ])
    expect(sessions).not.toHaveBeenCalled()
    expect(weeks).not.toHaveBeenCalled()
  })

  test('does not select the payload of the page, only of the revisions that can still be undone', async () => {
    const r = await replannedTwice('list-no-payload@example.com')
    // The second update is undone and the first has its rows rewritten; the generate revision and
    // the undo hold no payload, and the undone one needs none.
    expect((await post(r.f, undoUrl(r.second.id))).status).toBe(200)

    const findMany = vi.spyOn(ctx.prisma.planRevision, 'findMany')
    const res = await client(ctx, r.f.u).get('/api/plan/revisions')
    expect(res.status).toBe(200)
    expect((res.body as PlanRevisionView[]).map((v) => v.reason)).toEqual([
      'undo',
      'owner',
      'owner',
      'generate',
    ])

    type Args = { omit?: { undo?: boolean }; select?: Record<string, boolean>; where: object }
    const calls = findMany.mock.calls.map(([args]) => args as Args)
    // The page itself leaves the payload out.
    expect(calls[0]).toMatchObject({ omit: { undo: true } })
    // Whether a payload exists is asked without reading one.
    expect(calls[1]).toMatchObject({ select: { id: true } })
    expect(calls[1]!.select).not.toHaveProperty('undo')
    // The payload is read for the one revision that is neither undone, nor an undo, nor empty.
    const reads = calls.filter((call) => call.select?.undo === true)
    expect(reads).toHaveLength(1)
    expect(reads[0]!.where).toMatchObject({ id: { in: [r.first.id] } })
    expect(JSON.stringify(res.body)).not.toContain('"deleted"')
  })
})

describe('POST /api/plan/revisions/:id/seen', () => {
  test('stamps the revision once and answers 204 every time', async () => {
    const r = await replannedTwice('seen@example.com')
    expect(r.second.seenAt).toBeNull()
    const first = await post(r.f, `/api/plan/revisions/${r.second.id}/seen`)
    expect(first.status).toBe(204)
    const stamped = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: r.second.id } })
    expect(stamped.seenAt).not.toBeNull()

    const was = await counts(r.f)
    vi.setSystemTime(new Date(MONDAY.getTime() + 60_000))
    const again = await post(r.f, `/api/plan/revisions/${r.second.id}/seen`)
    expect(again.status).toBe(204)
    const same = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: r.second.id } })
    expect(same.seenAt?.getTime()).toBe(stamped.seenAt?.getTime())
    // The second call writes nothing, so the data version stays.
    expect(await counts(r.f)).toEqual(was)

    const listed = (await client(ctx, r.f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.find((v) => v.id === r.second.id)!.seenAt).toBe(stamped.seenAt!.toISOString())
    expect(listed.find((v) => v.id === r.first.id)!.seenAt).toBeNull()
  })

  test('finds no revision that does not exist', async () => {
    const f = await fourWeekPlan('seen-missing@example.com')
    expect((await post(f, '/api/plan/revisions/no-such/seen')).status).toBe(404)
  })
})
