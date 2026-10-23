import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { refreshInsightsQuietly } from '../../server/services/insight.ts'
import { runExecutionForActivity, runNightlyMatching } from '../../server/services/execution.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import type { StandoutView } from '../../shared/copy/standoutRender.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { fitHrModel } from '../../shared/engine/execution.ts'
import { standoutFacts, STANDOUT_VERSION } from '../../shared/engine/standout.ts'
import type { ExecutionAssessment, ExplainView, InputFact } from '../../shared/engine/types.ts'
import type { ParsedActivity } from '../../shared/types.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// The file parser's summary is a separate task; this stand-in keeps the store test independent.
vi.mock('../../shared/importers/files/summarize.ts', () => ({
  summarize: (parsed: ParsedActivity) => ({
    movingSec: parsed.elapsedSec,
    hrHistogram: null,
    decouplingPct: null,
    gapDistanceM: parsed.distanceM,
    stream: { t: [0], d: null, hr: null, alt: null, cad: null, pwr: null, sampleSec: 10 },
  }),
  localDateTime: (startUtc: string, utcOffsetMin: number | null) => {
    const iso = new Date(new Date(startUtc).getTime() + (utcOffsetMin ?? 0) * 60_000).toISOString()
    return { date: iso.slice(0, 10), startTime: iso.slice(11, 16) }
  },
}))

// Spies that keep the real behaviour and count how often the findings and the model are computed.
vi.mock('../../shared/engine/standout.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/engine/standout.ts')>()
  return { ...actual, standoutFacts: vi.fn(actual.standoutFacts) }
})
vi.mock('../../shared/engine/execution.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/engine/execution.ts')>()
  return { ...actual, fitHrModel: vi.fn(actual.fitHrModel) }
})

const today = todayIso()
const thisMonday = mondayOf(today)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  vi.mocked(standoutFacts).mockClear()
  vi.mocked(fitHrModel).mockClear()
})

let seq = 0
function newUser(): Promise<TestUser> {
  seq += 1
  return seedUser(ctx, { email: `standout${String(seq)}@example.com` })
}

function addRun(
  userId: string,
  daysAgo: number,
  over: Record<string, string | number | null> = {},
) {
  return ctx.prisma.activity.create({
    data: {
      userId,
      date: addDays(today, -daysAgo),
      type: 'run',
      durationSec: 2400,
      distanceM: 7000,
      source: 'manual',
      ...over,
    },
  })
}

function standout(user: TestUser, id: string) {
  return client(ctx, user).get(`/api/activities/${id}/standout`)
}

async function viewOf(user: TestUser, id: string): Promise<StandoutView> {
  const res = await standout(user, id)
  expect(res.status).toBe(200)
  return res.body as StandoutView
}

function templates(view: StandoutView): string[] {
  return view.items.map((item) => item.template)
}

function patchFeedback(user: TestUser, id: string, body: object) {
  return request(ctx.app)
    .patch(`/api/activities/${id}/feedback`)
    .set('Host', 'app.test')
    .set('Origin', 'http://app.test')
    .set('Cookie', user.cookie)
    .send(body)
}

function stored(activityId: string) {
  return ctx.prisma.activityInsight.findUnique({ where: { activityId } })
}

/** The computed time pushed a minute back, so a later edit is plainly newer than the insight. */
async function age(activityId: string) {
  const row = await ctx.prisma.activityInsight.findUniqueOrThrow({ where: { activityId } })
  await ctx.prisma.activityInsight.update({
    where: { activityId },
    data: { computedAt: new Date(row.computedAt.getTime() - 60_000) },
  })
}

const TARGET = JSON.stringify({ zone: 'z1', rpe: [2, 3], hr: null, paceSecPerKm: null })

/** A version-2 plan with hand-made sessions, so each test controls exactly what is planned. */
async function planWith(
  userId: string,
  sessions: Array<{ date: string; kind: string; min: number; status?: string }>,
) {
  const goal = await ctx.prisma.goal.create({
    data: {
      userId,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId,
      goalId: goal.id,
      name: goal.name,
      startDate: thisMonday,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: [
          {
            weekStart: thisMonday,
            index: 0,
            phase: 'build',
            baselineRunMin: 200,
            targetRunMin: 200,
            longRunMin: 70,
            runDays: 4,
            strengthSessions: 0,
          },
        ],
      },
    },
  })
  const rows = []
  for (const [i, s] of sessions.entries()) {
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: randomUUID(),
          weekStart: mondayOf(s.date),
          date: s.date,
          order: i,
          kind: s.kind,
          title: `${s.kind} run`,
          durationMin: s.min,
          structure: '[]',
          target: TARGET,
          purpose: 'Synthetic.',
          status: s.status ?? 'planned',
        },
      }),
    )
  }
  return { plan, rows }
}

/** What the engine would store for a linked session, with the effort resting on a rating or not. */
function execution(over: Partial<ExecutionAssessment> = {}, rated = true): string {
  const assessment: ExecutionAssessment = {
    completion: 'completed',
    intensity: 'on',
    effort: {
      score: 2,
      confidence: 'moderate',
      parts: {
        rpeDelta: rated ? 5.5 : null,
        feel: null,
        hrResidualZ: rated ? null : 3,
        paceResidualPct: null,
      },
    },
    conditions: { wbgtC: null, heatAdjusted: false, gradeAdjusted: false },
    flags: [],
    lines: [],
    ...over,
  }
  return JSON.stringify(assessment)
}

describe('GET /api/activities/:id/standout', () => {
  test('computes on the first read, stores the facts and serves the second read from storage', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 6 })
    expect(await stored(run.id)).toBeNull()

    const first = await viewOf(u, run.id)
    expect(first).toMatchObject({ more: 0 })
    expect(first.items).toHaveLength(1)
    expect(first.items[0]).toMatchObject({
      template: 'standout.pain',
      rule: 'design-4.2',
      slots: { pain: { kind: 'count', n: 6 } },
    })
    const row = await ctx.prisma.activityInsight.findUniqueOrThrow({
      where: { activityId: run.id },
    })
    expect(row.version).toBe(STANDOUT_VERSION)
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)

    expect(await viewOf(u, run.id)).toEqual(first)
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)
    expect((await stored(run.id))?.computedAt).toEqual(row.computedAt)
  })

  test('stores template ids and slots, never a sentence', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 7, distanceM: 10_000, elevationGainM: 500 })
    const view = await viewOf(u, run.id)
    expect(view.items.length).toBeGreaterThan(1)
    const row = await ctx.prisma.activityInsight.findUniqueOrThrow({
      where: { activityId: run.id },
    })
    const body = JSON.parse(row.facts) as { basis: string; items: InputFact[] }
    expect(body.items).toEqual(view.items)
    for (const item of body.items) {
      expect(row.facts).not.toContain(renderFact(item, 'km'))
      expect(row.facts).not.toContain(renderFact(item, 'mi'))
    }
    expect(row.facts).not.toMatch(/out of 10|average grade|warning signs/)
  })

  test('is read in the runner’s units without a change to what is stored', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { distanceM: 10_000, elevationGainM: 500 })
    const view = await viewOf(u, run.id)
    expect(view.items[0]?.slots).toMatchObject({ distance: { kind: 'distance', m: 10_000 } })
  })

  test('keeps three findings, in rank order, and counts the others', async () => {
    const u = await newUser()
    const { rows } = await planWith(u.id, [{ date: today, kind: 'easy', min: 30 }])
    await addRun(u.id, 20, { distanceM: 5000, durationSec: 1800 })
    const run = await addRun(u.id, 0, {
      pain: 6,
      distanceM: 12_000,
      durationSec: 3600,
      elevationGainM: 600,
      rpe: 8,
    })
    await runExecutionForActivity(ctx, { userId: u.id, activityId: run.id })
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: rows[0]!.id } })).activityId,
    ).toBe(run.id)
    const view = await viewOf(u, run.id)
    expect(templates(view)).toEqual([
      'standout.pain',
      'standout.effort-harder-rpe',
      'standout.grade',
    ])
    expect(view.more).toBe(2)
  })

  test('is empty for a run with nothing unusual', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1)
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
  })

  test('returns none for strength and cross, and stores nothing for them', async () => {
    const u = await newUser()
    for (const type of ['strength', 'cross']) {
      const other = await addRun(u.id, 1, { type, pain: 8, distanceM: 10_000, elevationGainM: 900 })
      expect(await viewOf(u, other.id)).toEqual({ items: [], more: 0 })
      expect(await stored(other.id)).toBeNull()
    }
  })

  test('returns none for a run flagged as a duplicate', async () => {
    const u = await newUser()
    const copy = await addRun(u.id, 1, { pain: 8, duplicateStatus: 'confirmed' })
    expect(await viewOf(u, copy.id)).toEqual({ items: [], more: 0 })
  })

  test('answers 404 for another user’s run and for an unknown one, and 401 without a session', async () => {
    const mine = await newUser()
    const theirs = await newUser()
    const run = await addRun(mine.id, 1, { pain: 6 })
    expect((await standout(theirs, run.id)).status).toBe(404)
    expect((await standout(mine, 'missing')).status).toBe(404)
    expect(await stored(run.id)).toBeNull()
    expect((await client(ctx).get(`/api/activities/${run.id}/standout`)).status).toBe(401)
  })
})

describe('when the stored insight is stale', () => {
  test('after a rating, the run is described again (the pipeline)', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 6 })
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.pain'])
    vi.mocked(standoutFacts).mockClear()

    const res = await patchFeedback(u, run.id, { pain: 0 })
    expect(res.status).toBe(200)
    // The rating computed the insight at once; the read after it computes nothing.
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)
  })

  test('after an edit the activity changed after the insight, so the next read computes it again', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 6 })
    await viewOf(u, run.id)
    await age(run.id)
    // A write that bypasses the pipeline, as a restore or an import of another tool could.
    await ctx.prisma.activity.update({ where: { id: run.id }, data: { pain: 0 } })
    vi.mocked(standoutFacts).mockClear()
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)
  })

  test('after the edit route changes the run, the pipeline has described it again', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { distanceM: 10_000, elevationGainM: 500 })
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.grade'])
    const res = await client(ctx, u).put(`/api/activities/${run.id}`).send({
      date: run.date,
      type: 'run',
      durationSec: 2400,
      distanceM: 10_000,
      elevationGainM: 0,
    })
    expect(res.status).toBe(200)
    vi.mocked(standoutFacts).mockClear()
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
    expect(vi.mocked(standoutFacts)).not.toHaveBeenCalled()
  })

  test('after the check-in of the run s day changes, the pain finding follows it', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1)
    const put = (body: object) => client(ctx, u).put(`/api/checkins/${run.date}`).send(body)
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })

    // A pain score for that day arrives after the insight was stored.
    expect((await put({ painScore: 7 })).status).toBe(200)
    vi.mocked(standoutFacts).mockClear()
    // The check-in, not the run's own rating, supplies the figure, so the check-in sentence is used.
    const pain = await viewOf(u, run.id)
    expect(templates(pain)).toEqual(['standout.pain-checkin'])
    expect(pain.items[0]?.slots).toEqual({ pain: { kind: 'count', n: 7 } })
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)

    // Nothing changed: the stored insight is served as it is.
    await viewOf(u, run.id)
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)

    // The score is corrected below the warning score, then raised to the bone flag.
    expect((await put({ painScore: 2 })).status).toBe(200)
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
    expect((await put({ painFocalBone: true })).status).toBe(200)
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.pain-bone'])

    // The runner clears it, and the finding goes with it.
    expect((await put({ painScore: null, painFocalBone: false })).status).toBe(200)
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
  })

  test('a check-in field the findings do not read leaves the stored insight alone', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 6 })
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.pain'])
    vi.mocked(standoutFacts).mockClear()
    expect(
      (await client(ctx, u).put(`/api/checkins/${run.date}`).send({ fatigue: 4 })).status,
    ).toBe(200)
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.pain'])
    expect(vi.mocked(standoutFacts)).not.toHaveBeenCalled()
  })

  test('after a change of version', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 6 })
    await viewOf(u, run.id)
    await ctx.prisma.activityInsight.update({
      where: { activityId: run.id },
      data: { version: STANDOUT_VERSION - 1 },
    })
    vi.mocked(standoutFacts).mockClear()
    await viewOf(u, run.id)
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)
    expect((await stored(run.id))?.version).toBe(STANDOUT_VERSION)
  })

  test('after the run is linked to, or unlinked from, a session', async () => {
    const u = await newUser()
    const { rows } = await planWith(u.id, [{ date: addDays(today, -1), kind: 'easy', min: 60 }])
    const run = await addRun(u.id, 1, { durationSec: 30 * 60, distanceM: 4000 })
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })

    // The owner links the run by hand.
    const linked = await client(ctx, u)
      .post(`/api/plan/sessions/${rows[0]!.id}/link`)
      .send({ activityId: run.id })
    expect(linked.status).toBe(200)
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.ran-less'])

    // Unlinking leaves the activity untouched, so only the stored basis tells the insight is stale.
    await client(ctx, u).post(`/api/plan/sessions/${rows[0]!.id}/link`).send({ activityId: null })
    expect(await viewOf(u, run.id)).toEqual({ items: [], more: 0 })
  })
})

describe('the assessment of the session a run fulfils', () => {
  const statuses = ['planned', 'moved', 'downgraded', 'completed', 'partial'] as const

  test.each(statuses)('is used whatever the status of the linked session (%s)', async (status) => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { rpe: 8 })
    const { rows } = await planWith(u.id, [
      { date: addDays(today, -1), kind: 'easy', min: 40, status },
    ])
    await ctx.prisma.planSession.update({
      where: { id: rows[0]!.id },
      data: { activityId: run.id, linkSource: 'auto', execution: execution() },
    })
    const view = await viewOf(u, run.id)
    expect(view.items).toHaveLength(1)
    expect(view.items[0]).toMatchObject({
      template: 'standout.effort-harder-rpe',
      slots: {
        rpe: { kind: 'count', n: 8 },
        low: { kind: 'count', n: 2 },
        high: { kind: 'count', n: 3 },
      },
    })
  })

  test('gives no effort verdict without the runner’s rating, even for a high score', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { rpe: 8 })
    const { rows } = await planWith(u.id, [{ date: addDays(today, -1), kind: 'easy', min: 40 }])
    await ctx.prisma.planSession.update({
      where: { id: rows[0]!.id },
      data: { activityId: run.id, linkSource: 'auto', execution: execution({}, false) },
    })
    expect(templates(await viewOf(u, run.id))).not.toContain('standout.effort-harder-rpe')
  })

  test('is found in an archived plan too', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { rpe: 8 })
    const { plan, rows } = await planWith(u.id, [
      { date: addDays(today, -1), kind: 'easy', min: 40 },
    ])
    await ctx.prisma.plan.update({ where: { id: plan.id }, data: { status: 'archived' } })
    await ctx.prisma.planSession.update({
      where: { id: rows[0]!.id },
      data: { activityId: run.id, linkSource: 'auto', execution: execution() },
    })
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.effort-harder-rpe'])
  })
})

describe('the pipeline', () => {
  const upload = { source: 'file', importBatchId: null, channel: 'upload' } as const

  function parsed(): ParsedActivity {
    const now = new Date()
    return {
      providerKey: `fit:${randomUUID()}`,
      startUtc: now.toISOString(),
      utcOffsetMin: -now.getTimezoneOffset(),
      type: 'run',
      subtype: 'road',
      elapsedSec: 3600,
      movingSec: null,
      distanceM: 10_000,
      elevationGainM: 600,
      elevationLossM: 600,
      avgHr: null,
      maxHr: null,
      avgCadence: null,
      avgPowerW: null,
      deviceName: null,
      startLat: null,
      startLng: null,
      samples: { t: [0], d: null, hr: null, alt: null, cad: null, pwr: null },
      laps: [],
    }
  }

  test('describes a recent activity when it is stored', async () => {
    const u = await newUser()
    const result = await storeParsed(ctx, u.id, parsed(), upload)
    const row = await stored(result.activityId)
    expect(row).not.toBeNull()
    expect(templates(await viewOf(u, result.activityId))).toEqual(['standout.grade'])
    // The read came from the row the store wrote.
    expect(vi.mocked(standoutFacts)).toHaveBeenCalledTimes(1)
  })

  test('describes a manually entered activity when it is created', async () => {
    const u = await newUser()
    const res = await client(ctx, u)
      .post('/api/activities')
      .send({ date: today, type: 'run', durationSec: 3600, distanceM: 10_000, pain: 6 })
    expect(res.status).toBe(201)
    const id = (res.body as { id: string }).id
    expect(await stored(id)).not.toBeNull()
    vi.mocked(standoutFacts).mockClear()
    expect(templates(await viewOf(u, id))).toEqual(['standout.pain'])
    expect(vi.mocked(standoutFacts)).not.toHaveBeenCalled()
  })

  test('leaves an old activity to its first read, so an import of history builds no insights', async () => {
    const u = await newUser()
    const res = await client(ctx, u)
      .post('/api/activities')
      .send({
        date: addDays(today, -40),
        type: 'run',
        durationSec: 3600,
        distanceM: 10_000,
        pain: 6,
      })
    const id = (res.body as { id: string }).id
    expect(await stored(id)).toBeNull()
    expect(templates(await viewOf(u, id))).toEqual(['standout.pain'])
    expect(await stored(id)).not.toBeNull()
  })

  test('describes the other run the matching assessed, with no read in between', async () => {
    const u = await newUser()
    const { rows } = await planWith(u.id, [{ date: today, kind: 'easy', min: 60 }])
    const session = rows[0]!
    const first = await addRun(u.id, 0, { durationSec: 30 * 60, distanceM: 4000 })
    const second = await addRun(u.id, 0, { durationSec: 25 * 60, distanceM: 3500 })
    // The matching takes the first run alone, so the second has neither a session nor a row.
    await runExecutionForActivity(ctx, { userId: u.id, activityId: first.id })
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })).activityId,
    ).toBe(first.id)
    expect(await stored(first.id)).not.toBeNull()
    expect(await stored(second.id)).toBeNull()

    // The first run moves out of reach of its session. The matching unlinks it and gives the freed
    // session to the second run, which it assesses, so its row is written by the same call.
    await ctx.prisma.activity.update({
      where: { id: first.id },
      data: { date: addDays(today, -5) },
    })
    await runExecutionForActivity(ctx, { userId: u.id, activityId: first.id, reconsider: 'date' })
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })).activityId,
    ).toBe(second.id)
    expect(await stored(second.id)).not.toBeNull()
    // The row rests on the assessment: it names the shortfall, which only a linked run has.
    expect(templates(await viewOf(u, second.id))).toEqual(['standout.ran-less'])
  })

  test('describes the run even when the matching throws, and the error still reaches the caller', async () => {
    const u = await newUser()
    await planWith(u.id, [])
    const run = await addRun(u.id, 0, { pain: 6 })
    // The matching looks for the run's session first; that read fails once.
    const lookup = vi
      .spyOn(ctx.prisma.planSession, 'findFirst')
      .mockRejectedValueOnce(new Error('boom'))
    try {
      await expect(
        runExecutionForActivity(ctx, { userId: u.id, activityId: run.id }),
      ).rejects.toThrow('boom')
    } finally {
      lookup.mockRestore()
    }
    expect(await stored(run.id)).not.toBeNull()
  })

  test('the nightly sweep describes the runs of the last 7 days and no others', async () => {
    const u = await newUser()
    await planWith(u.id, [])
    const recent = await addRun(u.id, 3, { pain: 6 })
    const old = await addRun(u.id, 30, { pain: 6 })
    const strength = await addRun(u.id, 2, { type: 'strength', pain: 6 })
    await runNightlyMatching(ctx, { today })
    expect(await stored(recent.id)).not.toBeNull()
    expect(await stored(old.id)).toBeNull()
    expect(await stored(strength.id)).toBeNull()
  })

  test('a failure to describe a run never reaches the caller', async () => {
    const u = await newUser()
    vi.mocked(standoutFacts).mockImplementationOnce(() => {
      throw new Error('boom')
    })
    const run = await addRun(u.id, 0, { pain: 6 })
    await expect(
      refreshInsightsQuietly(ctx, { userId: u.id, activityIds: [run.id] }),
    ).resolves.toBeUndefined()
    expect(await stored(run.id)).toBeNull()
    // The next read computes it.
    expect(templates(await viewOf(u, run.id))).toEqual(['standout.pain'])
  })
})

describe('ActivityInsight is non-state', () => {
  test('computing and storing an insight leaves the data version unchanged', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 6, distanceM: 10_000, elevationGainM: 500 })
    const before = await dataVersionKey(ctx.prisma)
    await viewOf(u, run.id)
    expect(await stored(run.id)).not.toBeNull()
    expect(await dataVersionKey(ctx.prisma)).toEqual(before)
    // Rewriting the same row, as the pipeline and the sweep do, changes nothing either.
    await refreshInsightsQuietly(ctx, { userId: u.id, activityIds: [run.id] })
    expect(await dataVersionKey(ctx.prisma)).toEqual(before)
  })

  test('deleting the run deletes its insight', async () => {
    const u = await newUser()
    const run = await addRun(u.id, 1, { pain: 6 })
    await viewOf(u, run.id)
    const res = await client(ctx, u).delete(`/api/activities/${run.id}`)
    expect(res.status).toBe(204)
    expect(await stored(run.id)).toBeNull()
  })

  test('one service writes the table, and no provider describes a run', () => {
    const files = (dir: string): string[] =>
      readdirSync(join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? files(join(dir, entry.name))
          : entry.name.endsWith('.ts')
            ? [join(dir, entry.name)]
            : [],
      )
    const writers = files('server').filter((file) =>
      /activityInsight\.(create|update|upsert|delete)/.test(
        readFileSync(join(process.cwd(), file), 'utf8'),
      ),
    )
    expect(writers).toEqual([join('server', 'services', 'insight.ts')])
    for (const file of files(join('server', 'providers'))) {
      expect(readFileSync(join(process.cwd(), file), 'utf8'), file).not.toMatch(/insight/i)
    }
  })

  test('reads the snapshot and its memos, with no history or plan query of its own', () => {
    const source = readFileSync(join(process.cwd(), 'server/services/insight.ts'), 'utf8')
    expect(source).toMatch(/loadAthleteContext/)
    expect(source).toMatch(/hrModelOf/)
    expect(source).not.toMatch(/gatherEngineInput|gatherContextInput|currentGoalFor/)
    expect(source).not.toMatch(/loadActivities|loadActivityCores|loadProfile/)
    expect(source).not.toMatch(/prisma\.(activity|weeklyReview|screening|goal)\.find(Many|Unique)/)
    // The one check-in row of the run's day is read by its key, for the basis; never a history.
    expect(source).not.toMatch(/prisma\.wellnessDay\.find(Many|First)/)
    expect(source).not.toMatch(/\$queryRaw|\$executeRaw/)
  })
})

describe('the heart-rate model', () => {
  test('is fitted once per data version, whichever run is read', async () => {
    const u = await newUser()
    const a = await addRun(u.id, 1, { pain: 6 })
    const b = await addRun(u.id, 2, { pain: 6 })
    vi.mocked(fitHrModel).mockClear()
    await viewOf(u, a.id)
    await viewOf(u, b.id)
    const explained = await client(ctx, u).get(`/api/explain?subject=activity&id=${a.id}`)
    expect(explained.status).toBe(200)
    expect(vi.mocked(fitHrModel)).toHaveBeenCalledTimes(1)
  })
})

describe('GET /api/explain?subject=activity', () => {
  test('answers with the facts stored with the run, grouped by rule and frozen', async () => {
    const u = await newUser()
    const earlier = await addRun(u.id, 9, { distanceM: 6000 })
    const run = await addRun(u.id, 0, {
      pain: 6,
      distanceM: 12_000,
      durationSec: 3600,
      elevationGainM: 600,
    })
    const view = await viewOf(u, run.id)
    expect(templates(view)).toEqual([
      'standout.pain',
      'standout.grade',
      'standout.longest-distance',
    ])

    const res = await client(ctx, u).get(`/api/explain?subject=activity&id=${run.id}`)
    expect(res.status).toBe(200)
    const explained = res.body as ExplainView
    expect(explained).toMatchObject({ subject: 'activity', frozen: true, rest: [], asOf: today })
    expect(explained.rules).toEqual(['design-4.2', 'design-explain'])
    expect(explained.groups.map((group) => group.rule)).toEqual(['design-4.2', 'design-explain'])
    expect(explained.groups.flatMap((group) => group.facts)).toEqual(view.items)

    // The figures are the ones written with the run: a deleted source does not change them.
    const longest = view.items[2]!
    expect(longest.sources.map((source) => source.id)).toContain(earlier.id)
    await ctx.prisma.activity.delete({ where: { id: earlier.id } })
    const again = await client(ctx, u).get(`/api/explain?subject=activity&id=${run.id}`)
    expect((again.body as ExplainView).groups.flatMap((group) => group.facts)).toEqual(view.items)
  })

  test('is empty for a run with nothing unusual, and 404 for another user’s run or an unknown one', async () => {
    const mine = await newUser()
    const theirs = await newUser()
    const run = await addRun(mine.id, 1)
    const empty = await client(ctx, mine).get(`/api/explain?subject=activity&id=${run.id}`)
    expect(empty.status).toBe(200)
    expect(empty.body).toMatchObject({ rules: [], groups: [], rest: [], frozen: true })
    expect(
      (await client(ctx, theirs).get(`/api/explain?subject=activity&id=${run.id}`)).status,
    ).toBe(404)
    expect((await client(ctx, mine).get('/api/explain?subject=activity&id=missing')).status).toBe(
      404,
    )
  })
})
