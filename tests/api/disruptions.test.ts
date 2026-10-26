import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type {
  DisruptionResult,
  DisruptionView,
  PlanDiff,
  PlanPreview,
  PlanRevisionView,
  PlanWithSessions,
  TodayView,
  UndoResult,
} from '../../shared/types.ts'
import type { Deps } from '../../server/app.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { HttpError } from '../../server/errors.ts'
import { loadAthleteContext, disruptionHorizonDays } from '../../server/services/athleteState.ts'
import {
  applyReplan,
  computeReplan,
  replanActivePlan,
  StaleWrite,
} from '../../server/services/replan.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// Rest and limited-running windows (design 9.3 and 9.4): validation, the preview that writes
// nothing, the commit that matches it, the skips of back-dated days, the undo of a window, Today
// and the athlete snapshot. Only Date is faked. The plan is generated on a Monday and the clock
// then moves to the Thursday, so Monday to Wednesday are past.
vi.useFakeTimers({ toFake: ['Date'] })

// Lets one test make the quality checklist fail; every other call goes to the real engine.
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

// Lets one test make a request land while the weekly re-plan is deciding: the hook runs once, the
// first time the re-plan reads the assessments of last week, after it has read the newest revision.
const race = vi.hoisted(() => ({ during: null as null | (() => Promise<void>) }))
vi.mock('../../server/services/planEngine.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../server/services/planEngine.ts')>()
  return {
    ...real,
    executionRecordsByWeek: async (...args: Parameters<typeof real.executionRecordsByWeek>) => {
      const hook = race.during
      race.during = null
      if (hook !== null) await hook()
      return real.executionRecordsByWeek(...args)
    },
  }
})

const MONDAY = '2026-10-19'
const TUESDAY = addDays(MONDAY, 1)
const WEDNESDAY = addDays(MONDAY, 2)
const THURSDAY = addDays(MONDAY, 3)
const FRIDAY = addDays(MONDAY, 4)
const SATURDAY = addDays(MONDAY, 5)
const SUNDAY = addDays(MONDAY, 6)
const GOAL_DATE = addDays(MONDAY, 7 * 3 + 5)
/** The Tuesday of the second week, when last week has ended and there is a week to assess. */
const TUESDAY_NEXT = addDays(MONDAY, 8)
const NOVEMBER_DAY = addDays(MONDAY, 19)

function at(iso: string, hour = 12): void {
  vi.setSystemTime(new Date(`${iso}T${String(hour).padStart(2, '0')}:00:00`))
}

let ctx: TestCtx
const deps = (): Deps => ({ prisma: ctx.prisma, config: ctx.config, fetch: ctx.fetch })

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  race.during = null
  force.failChecklist = false
  at(THURSDAY)
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
        date: addDays(mondayOf(MONDAY), -7 * w + run.dow),
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

/** The runs of the first week of the plan, so that the Tuesday of the second week has no layoff. */
async function runFirstWeek(userId: string): Promise<void> {
  await ctx.prisma.activity.createMany({
    data: [
      { dow: 1, min: 40 },
      { dow: 3, min: 45 },
      { dow: 5, min: 60 },
    ].map((run) => ({
      userId,
      date: addDays(MONDAY, run.dow),
      type: 'run',
      durationSec: run.min * 60,
      movingSec: run.min * 60,
      distanceM: run.min * 160,
      rpe: 3,
      source: 'manual',
    })),
  })
}

interface Fixture {
  u: TestUser
  goalId: string
  plan: PlanWithSessions
}

/** A runner with twelve weeks of history and a plan generated on the Monday (four weeks long). */
async function fixture(email: string, weeks = 4): Promise<Fixture> {
  at(MONDAY)
  const u = await seedUser(ctx, { email })
  await seedHistory(u.id)
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(MONDAY, 7 * (weeks - 1) + 5),
      distanceM: 21_097,
      goalType: 'finish',
    },
  })
  const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  at(THURSDAY)
  return { u, goalId: goal.id, plan: res.body as PlanWithSessions }
}

/** Ill from Monday to Wednesday: the window of a head cold, reported on the Thursday. */
const cold = (over: Record<string, unknown> = {}) => ({
  reason: 'illness-above-neck',
  mode: 'rest',
  startDate: MONDAY,
  endDate: WEDNESDAY,
  ...over,
})

const api = (f: Pick<Fixture, 'u'>) => client(ctx, f.u)

/** What the error answers of the window routes carry in `details`. */
interface ErrorDetails {
  issues: Array<{ path: string; message: string }>
  code: string
  preview: PlanPreview
  checklist: Array<{ id: string }>
  reasons: Array<{ code: string; message: string; disruptionId?: string }>
}

/** The error object of an API answer, typed. */
function errorOf(res: { body: unknown }): {
  code: string
  message: string
  details: ErrorDetails
} {
  return (res.body as { error: { code: string; message: string; details: ErrorDetails } }).error
}

async function createWindow(
  f: Pick<Fixture, 'u'>,
  body: Record<string, unknown> = cold(),
): Promise<DisruptionResult> {
  const res = await api(f).post('/api/plan/disruptions').send(body)
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as DisruptionResult
}

async function previewOf(
  f: Pick<Fixture, 'u'>,
  action: Record<string, unknown>,
): Promise<PlanPreview> {
  const res = await api(f).post('/api/plan/preview').send(action)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as PlanPreview
}

const sessionsOf = (planId: string) =>
  ctx.prisma.planSession.findMany({
    where: { planId },
    orderBy: [{ date: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  })

const flagsOf = (row: { flags: string }) => JSON.parse(row.flags) as string[]

/** The row counts of the tables a window action may write, and the data version. */
async function counts() {
  const [disruption, revision, session, week, prediction] = await Promise.all([
    ctx.prisma.disruption.count(),
    ctx.prisma.planRevision.count(),
    ctx.prisma.planSession.count(),
    ctx.prisma.planWeek.count(),
    ctx.prisma.predictionLog.count(),
  ])
  return {
    disruption,
    revision,
    session,
    week,
    prediction,
    version: (await dataVersionKey(ctx.prisma)).key,
  }
}

/**
 * A diff with the identity of its added sessions blanked: a session that is only previewed has no
 * id and no `externalId` yet (they are allocated when the row is written), so a preview and its
 * commit agree on everything else.
 */
function withoutIds(diff: PlanDiff): PlanDiff {
  return {
    ...diff,
    sessions: diff.sessions.map((line) =>
      line.change === 'added' ? { ...line, sessionId: null, externalId: '' } : line,
    ),
  }
}

const RUN_KINDS = new Set([
  'easy',
  'recovery',
  'long',
  'long-fast-finish',
  'threshold',
  'intervals',
  'race-pace',
  'strides',
  'hills',
  'b2b',
])

// ---------------------------------------------------------------------------------------------
// The body rules
// ---------------------------------------------------------------------------------------------

describe('the body of a window', () => {
  const refused: Array<[string, Record<string, unknown>, string, RegExp]> = [
    ['illness is rest only', cold({ mode: 'limited', maxRunMin: 30 }), 'mode', /rest only/i],
    [
      'limited needs a longest run',
      cold({ reason: 'travel', mode: 'limited' }),
      'maxRunMin',
      /longest run/i,
    ],
    [
      'a longest run under the least easy run',
      cold({ reason: 'travel', mode: 'limited', maxRunMin: 10 }),
      'maxRunMin',
      /20 min to 240 min/,
    ],
    [
      'a longest run above the range',
      cold({ reason: 'travel', mode: 'limited', maxRunMin: 300 }),
      'maxRunMin',
      /20 min to 240 min/,
    ],
    [
      'a rest window with a run length',
      cold({ reason: 'travel', maxRunMin: 30 }),
      'maxRunMin',
      /no run length/i,
    ],
    ['an area on an illness', cold({ area: 'calf' }), 'area', /niggle only/i],
    ['pain on an illness', cold({ pain: 3 }), 'pain', /niggle only/i],
    ['a change in gait on an illness', cold({ gaitChange: true }), 'gaitChange', /niggle only/i],
    ['pain above 10', cold({ reason: 'niggle', pain: 11 }), 'pain', /0 to 10/],
    ['pain that is not whole', cold({ reason: 'niggle', pain: 3.5 }), 'pain', /0 to 10/],
    [
      'an end before the start',
      cold({ startDate: WEDNESDAY, endDate: MONDAY }),
      'endDate',
      /cannot come before/i,
    ],
    [
      'a window longer than the maximum',
      cold({ startDate: addDays(THURSDAY, -5), endDate: addDays(THURSDAY, 30) }),
      'endDate',
      new RegExp(`up to ${P.j9.maxWindowDays.value} days`),
    ],
    [
      'a start older than the maximum back-date',
      cold({
        startDate: addDays(THURSDAY, -(P.j9.maxBackdateDays.value + 1)),
        endDate: addDays(THURSDAY, -(P.j9.maxBackdateDays.value - 1)),
      }),
      'startDate',
      new RegExp(`up to ${P.j9.maxBackdateDays.value} days ago`),
    ],
    [
      'an end after the race',
      cold({ startDate: addDays(GOAL_DATE, -2), endDate: addDays(GOAL_DATE, 3) }),
      'endDate',
      /after the race/i,
    ],
    [
      'a first day that is not a date',
      cold({ startDate: '2026-13-40' }),
      'startDate',
      /not a valid date/i,
    ],
    ['a last day that is not a date', cold({ endDate: 'soon' }), 'endDate', /not a valid date/i],
  ]

  test.each(refused)(
    'refuses %s with a 400 that names the field',
    async (_name, body, path, message) => {
      const f = await fixture(`body-${path}-${String(Math.abs(hash(_name)))}@example.com`)
      const before = await counts()
      for (const request of [
        () => api(f).post('/api/plan/disruptions').send(body),
        () =>
          api(f)
            .post('/api/plan/preview')
            .send({ type: 'disruption-create', ...body }),
      ]) {
        const res = await request()
        expect(res.status, JSON.stringify(res.body)).toBe(400)
        expect(errorOf(res).code).toBe('validation')
        const issues = errorOf(res).details.issues
        const named = issues.find((issue) => issue.path === path)
        expect(named, JSON.stringify(issues)).toBeDefined()
        expect(named!.message).toMatch(message)
      }
      expect(await counts()).toEqual(before)
    },
  )

  test('lists every refused field at once', async () => {
    const f = await fixture('body-many@example.com')
    const res = await api(f)
      .post('/api/plan/disruptions')
      .send(cold({ mode: 'limited', area: 'calf', startDate: 'x' }))
    expect(res.status).toBe(400)
    const paths = errorOf(res).details.issues.map((i) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['startDate', 'mode', 'area', 'maxRunMin']))
  })

  test('the shape is checked first: unknown keys, wrong types and a missing field are 400', async () => {
    const f = await fixture('body-shape@example.com')
    const before = await counts()
    const bodies: Array<Record<string, unknown>> = [
      cold({ extra: 1 }),
      cold({ reason: 'flu' }),
      cold({ mode: 'sprint' }),
      cold({ gaitChange: 'yes' }),
      cold({ maxRunMin: '30' }),
      { reason: 'travel', mode: 'rest' },
    ]
    for (const body of bodies) {
      const res = await api(f).post('/api/plan/disruptions').send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(errorOf(res).details.issues.length).toBeGreaterThan(0)
      const preview = await api(f)
        .post('/api/plan/preview')
        .send({ type: 'disruption-create', ...body })
      expect(preview.status, JSON.stringify(body)).toBe(400)
    }
    expect((await api(f).patch('/api/plan/disruptions/x').send({})).status).toBe(400)
    expect(await counts()).toEqual(before)
  })

  test('is read after authentication: an anonymous request is 401 before anything is parsed', async () => {
    const anonymous = client(ctx)
    expect((await anonymous.post('/api/plan/disruptions').send({ nonsense: true })).status).toBe(
      401,
    )
    expect(
      (await anonymous.post('/api/plan/preview').send({ type: 'disruption-remove' })).status,
    ).toBe(401)
    expect((await anonymous.get('/api/plan/disruptions?include=bogus')).status).toBe(401)
    expect((await anonymous.delete('/api/plan/disruptions/x')).status).toBe(401)
  })

  test('needs an active plan: 404 and nothing written', async () => {
    const u = await seedUser(ctx, { email: 'no-plan@example.com' })
    const before = await counts()
    const res = await client(ctx, u).post('/api/plan/disruptions').send(cold())
    expect(res.status).toBe(404)
    expect(await counts()).toEqual(before)
  })

  test('stores only what the reason takes, and the runner words as given', async () => {
    const f = await fixture('body-stored@example.com')
    const { disruption } = await createWindow(f, {
      reason: 'niggle',
      mode: 'limited',
      maxRunMin: 30,
      startDate: THURSDAY,
      endDate: FRIDAY,
      area: '  left calf ',
      pain: 3,
      gaitChange: false,
      note: ' tight since Sunday ',
    })
    expect(disruption).toMatchObject({
      reason: 'niggle',
      mode: 'limited',
      maxRunMin: 30,
      area: 'left calf',
      pain: 3,
      gaitChange: false,
      note: 'tight since Sunday',
      status: 'active',
    })
    const travel = await createWindow(f, {
      reason: 'travel',
      mode: 'rest',
      startDate: SUNDAY,
      endDate: addDays(SUNDAY, 1),
    })
    expect(travel.disruption).toMatchObject({
      maxRunMin: null,
      area: null,
      pain: null,
      gaitChange: false,
      note: null,
    })
  })
})

/** A small stable number for a string, to give each table row its own runner. */
function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

// ---------------------------------------------------------------------------------------------
// Preview and commit
// ---------------------------------------------------------------------------------------------

describe('the preview of a window action', () => {
  test('writes nothing, for a creation, a change and a removal', async () => {
    const f = await fixture('preview-writes-nothing@example.com')
    const { disruption } = await createWindow(f, {
      reason: 'travel',
      mode: 'limited',
      maxRunMin: 30,
      startDate: FRIDAY,
      endDate: SATURDAY,
    })
    const before = await counts()
    const actions = [
      { type: 'disruption-create', ...cold({ startDate: THURSDAY, endDate: THURSDAY }) },
      { type: 'disruption-update', id: disruption.id, endDate: SUNDAY },
      { type: 'disruption-update', id: disruption.id, maxRunMin: 45 },
      { type: 'disruption-remove', id: disruption.id },
    ]
    for (const action of actions) {
      const preview = await previewOf(f, action)
      expect(preview.blocked, action.type).toBe(false)
      expect(preview.diff.empty, action.type).toBe(false)
      expect(preview.diff.holds, action.type).toHaveLength(1)
      expect(await counts(), action.type).toEqual(before)
    }
  })

  test('is one answer for every action: summary, diff, hash and the day it was built for', async () => {
    const f = await fixture('preview-shape@example.com')
    const preview = await previewOf(f, { type: 'disruption-create', ...cold() })
    expect(preview).toMatchObject({
      action: { type: 'disruption-create', reason: 'illness-above-neck' },
      summary: 'Added a window (illness) from Mon 19 Oct to Wed 21 Oct.',
      blocked: false,
      guards: [],
      reasons: [],
      today: THURSDAY,
    })
    expect(preview.hash).toHaveLength(64)
    expect(preview.diff.holds).toEqual([
      { from: MONDAY, to: WEDNESDAY, label: 'Rest: illness', disruptionId: null },
    ])
  })

  test('states the running time of the next 28 days, before and after, from the rows the commit writes', async () => {
    const f = await fixture('preview-run-minutes@example.com')
    // The runner skipped one run on a day the window will hold: it is not in the first figure, and
    // the window releasing it must not take its minutes from the second.
    const held = (await sessionsOf(f.plan.id)).find(
      (row) => row.date >= THURSDAY && row.date <= SUNDAY && RUN_KINDS.has(row.kind),
    )!
    await ctx.prisma.planSession.update({ where: { id: held.id }, data: { status: 'skipped' } })
    const last = addDays(THURSDAY, 27)
    const stillToRun = async () =>
      (await sessionsOf(f.plan.id))
        .filter(
          (row) =>
            row.date >= THURSDAY &&
            row.date <= last &&
            (RUN_KINDS.has(row.kind) || row.kind === 'race') &&
            ['planned', 'moved', 'downgraded', 'adjusted'].includes(row.status),
        )
        .reduce((sum, row) => sum + row.durationMin, 0)
    const now = await stillToRun()

    const action = { type: 'disruption-create', ...cold({ startDate: THURSDAY, endDate: SUNDAY }) }
    const preview = await previewOf(f, action)
    expect(preview.runMin).not.toBeNull()
    expect(preview.runMin!.before).toBe(now)
    expect(preview.runMin!.after).toBeLessThan(now)
    expect(preview.diff.sessions.some((line) => line.sessionId === held.id)).toBe(true)

    await createWindow(f, cold({ startDate: THURSDAY, endDate: SUNDAY, expectHash: preview.hash }))
    expect(preview.runMin!.after).toBe(await stillToRun())
    // A preview of nothing to change states the same figure on both sides.
    const quiet = await previewOf(f, { type: 'replan' })
    expect(quiet.runMin!.before).toBe(preview.runMin!.after)
  })

  test('says a refused plan is refused, without writing: the checklist is a reason, not an error', async () => {
    const f = await fixture('preview-checklist@example.com')
    const before = await counts()
    force.failChecklist = true
    const preview = await previewOf(f, { type: 'disruption-create', ...cold() })
    expect(preview.blocked).toBe(true)
    expect(preview.reasons.map((reason) => reason.code)).toEqual(['checklist'])
    expect(await counts()).toEqual(before)
  })
})

describe('the commit of a window action', () => {
  test('creating: the revision carries the diff, the summary and the window the preview showed', async () => {
    const f = await fixture('commit-create@example.com')
    const preview = await previewOf(f, { type: 'disruption-create', ...cold() })
    const { disruption, revision } = await createWindow(f, cold({ expectHash: preview.hash }))
    expect(withoutIds(revision.diff!)).toEqual(withoutIds(preview.diff))
    expect(revision.summary).toBe(preview.summary)
    expect(revision).toMatchObject({
      reason: 'disruption',
      auto: false,
      disruptionId: disruption.id,
      undo: { available: true, reasons: [] },
    })
    expect(disruption).toMatchObject({ phase: 'rest-gate', status: 'active' })
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: revision.id } })
    expect(stored.disruptionId).toBe(disruption.id)
    expect(stored.undo).not.toBeNull()
  })

  test('changing: the preview and the revision agree, and the window has its new end', async () => {
    const f = await fixture('commit-update@example.com')
    const { disruption } = await createWindow(f)
    const action = { type: 'disruption-update', id: disruption.id, endDate: THURSDAY }
    const preview = await previewOf(f, action)
    const res = await api(f)
      .patch(`/api/plan/disruptions/${disruption.id}`)
      .send({ endDate: THURSDAY, expectHash: preview.hash })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const done = res.body as DisruptionResult
    expect(withoutIds(done.revision.diff!)).toEqual(withoutIds(preview.diff))
    expect(done.revision.summary).toBe(preview.summary)
    expect(done.revision.summary).toBe(
      'Changed the window (illness) to run from Mon 19 Oct to Thu 22 Oct.',
    )
    expect(done.disruption).toMatchObject({ id: disruption.id, endDate: THURSDAY })
    expect(done.revision.disruptionId).toBe(disruption.id)
    expect(preview.diff.holds).toEqual([
      { from: MONDAY, to: THURSDAY, label: 'Rest: illness', disruptionId: disruption.id },
    ])
  })

  test('removing: the preview and the revision agree, and the window is withdrawn', async () => {
    const f = await fixture('commit-remove@example.com')
    const { disruption } = await createWindow(f)
    const preview = await previewOf(f, { type: 'disruption-remove', id: disruption.id })
    const res = await api(f).delete(
      `/api/plan/disruptions/${disruption.id}?expectHash=${preview.hash}`,
    )
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const done = res.body as DisruptionResult
    expect(withoutIds(done.revision.diff!)).toEqual(withoutIds(preview.diff))
    expect(done.revision.summary).toBe(
      'Removed the window (illness) from Mon 19 Oct to Wed 21 Oct.',
    )
    expect(done.disruption).toMatchObject({ id: disruption.id, status: 'undone', phase: 'done' })
    expect(
      (await ctx.prisma.disruption.findUniqueOrThrow({ where: { id: disruption.id } })).status,
    ).toBe('undone')
  })

  test('a limited window caps the days and shows it: runs up to the cap, none longer', async () => {
    const f = await fixture('commit-limited@example.com')
    // Friday to the Sunday after. Friday to Sunday alone holds one long run, which the engine drops
    // instead of capping; next week holds several runs longer than the cap, which stay as capped
    // runs, so the window reaches over it and the cap has days to act on.
    const lastDay = addDays(SUNDAY, 7)
    const runsInWindow = async () =>
      (await sessionsOf(f.plan.id)).filter(
        (s) => s.date >= FRIDAY && s.date <= lastDay && RUN_KINDS.has(s.kind),
      )
    expect((await runsInWindow()).some((s) => s.durationMin > 30)).toBe(true)
    const { disruption } = await createWindow(f, {
      reason: 'travel',
      mode: 'limited',
      maxRunMin: 30,
      startDate: FRIDAY,
      endDate: lastDay,
    })
    expect(disruption).toMatchObject({ phase: 'upcoming', runFrom: FRIDAY, qualityFrom: FRIDAY })
    const runs = await runsInWindow()
    expect(runs.length).toBeGreaterThan(0)
    for (const row of runs) {
      expect(row.durationMin, `${row.date} ${row.kind}`).toBeLessThanOrEqual(30)
    }
    // up to the cap: the runs that were longer are cut to it, not dropped
    expect(Math.max(...runs.map((s) => s.durationMin))).toBe(30)
  })

  test('a stale hash is a 409 with the new preview, and writes nothing', async () => {
    const f = await fixture('commit-stale@example.com')
    const old = await previewOf(f, { type: 'disruption-create', ...cold() })
    // Another write lands first: the plan moves on.
    await createWindow(f, { reason: 'travel', mode: 'rest', startDate: SUNDAY, endDate: SUNDAY })
    const before = await counts()
    const res = await api(f)
      .post('/api/plan/disruptions')
      .send(cold({ expectHash: old.hash }))
    expect(res.status).toBe(409)
    expect(errorOf(res).details.code).toBe('stale-preview')
    const fresh = errorOf(res).details.preview
    expect(fresh.hash).not.toBe(old.hash)
    expect(fresh.action).toMatchObject({ type: 'disruption-create' })
    expect(await counts()).toEqual(before)
    // Sending the new hash goes through, and the revision is the one it showed.
    const done = await createWindow(f, cold({ expectHash: fresh.hash }))
    expect(withoutIds(done.revision.diff!)).toEqual(withoutIds(fresh.diff))
  })

  test('a hash for another action is stale too', async () => {
    const f = await fixture('commit-hash-other@example.com')
    const other = await previewOf(f, { type: 'replan' })
    const res = await api(f)
      .post('/api/plan/disruptions')
      .send(cold({ expectHash: other.hash }))
    expect(res.status).toBe(409)
    expect(errorOf(res).details.code).toBe('stale-preview')
  })

  test('a plan that fails the checklist is a 422 with the checklist, and nothing is written', async () => {
    const f = await fixture('commit-checklist@example.com')
    const before = await counts()
    force.failChecklist = true
    const res = await api(f).post('/api/plan/disruptions').send(cold())
    expect(res.status).toBe(422)
    expect(errorOf(res).details.checklist.map((item) => item.id)).toEqual(['spike-guard'])
    expect(await counts()).toEqual(before)
  })

  test('is not found for a window that is not there, was withdrawn, or is another runner’s', async () => {
    const f = await fixture('commit-missing@example.com')
    const { disruption } = await createWindow(f)
    await api(f).delete(`/api/plan/disruptions/${disruption.id}`).expect(200)
    const before = await counts()
    expect(
      (await api(f).patch(`/api/plan/disruptions/${disruption.id}`).send({ endDate: THURSDAY }))
        .status,
    ).toBe(404)
    expect((await api(f).delete(`/api/plan/disruptions/${disruption.id}`)).status).toBe(404)
    expect((await api(f).delete('/api/plan/disruptions/nope')).status).toBe(404)
    const res = await api(f)
      .post('/api/plan/preview')
      .send({ type: 'disruption-remove', id: 'nope' })
    expect(res.status).toBe(404)
    expect(await counts()).toEqual(before)
  })
})

// ---------------------------------------------------------------------------------------------
// Changing a window
// ---------------------------------------------------------------------------------------------

describe('PATCH /api/plan/disruptions/:id', () => {
  test('"I am better" shortens the window and the return is resized from the days actually lost', async () => {
    const f = await fixture('patch-better@example.com')
    const { disruption } = await createWindow(
      f,
      cold({ startDate: addDays(MONDAY, -5), endDate: FRIDAY }),
    )
    expect(disruption.endDate).toBe(FRIDAY)
    // Rest through the symptom-free Saturday: the first run is Sunday, the only day of the return
    // week left, and the return week is capped for that one day.
    expect(disruption.runFrom).toBe(addDays(FRIDAY, 2))
    expect(disruption.returnWeekMin).toBeGreaterThan(0)
    const runsFrom = async (date: string) =>
      (await sessionsOf(f.plan.id)).filter(
        (s) => s.date >= date && s.date <= SUNDAY && RUN_KINDS.has(s.kind),
      )
    const kindsOn = async (date: string) =>
      (await sessionsOf(f.plan.id)).filter((s) => s.date === date).map((s) => s.kind)
    expect(await kindsOn(SATURDAY)).toEqual(['rest'])

    const res = await api(f)
      .patch(`/api/plan/disruptions/${disruption.id}`)
      .send({ endDate: THURSDAY })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const better = (res.body as DisruptionResult).disruption
    expect(better.runFrom).toBe(addDays(THURSDAY, 2))
    // Saturday is given back: the return week has two days to run in now, and its cap grows with
    // them. The runs of those days stay within it.
    expect(better.returnWeekMin).toBeGreaterThan(disruption.returnWeekMin!)
    expect(await kindsOn(FRIDAY)).toEqual(['rest'])
    const restored = await kindsOn(SATURDAY)
    expect(restored.some((kind) => RUN_KINDS.has(kind))).toBe(true)
    expect(restored).not.toContain('rest')
    const returned = await runsFrom(better.runFrom)
    expect(returned.length).toBeGreaterThan(0)
    expect(returned.reduce((sum, s) => sum + s.durationMin, 0)).toBeLessThanOrEqual(
      better.returnWeekMin!,
    )
  })

  test('extends a window, and the rest sessions follow it', async () => {
    const f = await fixture('patch-extend@example.com')
    const { disruption } = await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    const extended = await api(f)
      .patch(`/api/plan/disruptions/${disruption.id}`)
      .send({ endDate: SATURDAY })
    expect(extended.status, JSON.stringify(extended.body)).toBe(200)
    const rows = await sessionsOf(f.plan.id)
    // Thursday to Saturday, and the symptom-free day after it, carry a rest session and no run.
    for (const date of [THURSDAY, FRIDAY, SATURDAY, SUNDAY]) {
      const kinds = rows.filter((s) => s.date === date).map((s) => s.kind)
      expect(kinds, date).toContain('rest')
      expect(
        kinds.filter((kind) => RUN_KINDS.has(kind)),
        date,
      ).toEqual([])
    }
  })

  test('re-caps a limited window', async () => {
    const f = await fixture('patch-cap@example.com')
    const { disruption } = await createWindow(f, {
      reason: 'short-on-time',
      mode: 'limited',
      maxRunMin: 30,
      startDate: FRIDAY,
      endDate: SUNDAY,
    })
    const res = await api(f).patch(`/api/plan/disruptions/${disruption.id}`).send({ maxRunMin: 45 })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect((res.body as DisruptionResult).disruption.maxRunMin).toBe(45)
  })

  test('refuses what the body rules refuse, and a change that changes nothing to say', async () => {
    const f = await fixture('patch-refused@example.com')
    const { disruption } = await createWindow(f)
    const before = await counts()
    const url = `/api/plan/disruptions/${disruption.id}`
    const cap = await api(f).patch(url).send({ maxRunMin: 30 })
    expect(cap.status).toBe(400)
    expect(errorOf(cap).details.issues[0]).toMatchObject({ path: 'maxRunMin' })
    const long = await api(f)
      .patch(url)
      .send({ endDate: addDays(MONDAY, 40) })
    expect(long.status).toBe(400)
    expect(errorOf(long).details.issues[0]).toMatchObject({ path: 'endDate' })
    const goal = await api(f)
      .patch(url)
      .send({ endDate: addDays(GOAL_DATE, 1) })
    expect(goal.status).toBe(400)
    expect((await api(f).patch(url).send({})).status).toBe(400)
    expect((await api(f).patch(url).send({ startDate: MONDAY })).status).toBe(400)
    expect(await counts()).toEqual(before)
  })

  test('does not ask the age of a start that is not being changed', async () => {
    const f = await fixture('patch-old-start@example.com')
    const start = addDays(THURSDAY, -P.j9.maxBackdateDays.value)
    const { disruption } = await createWindow(
      f,
      cold({ startDate: start, endDate: addDays(start, 2) }),
    )
    at(FRIDAY)
    const res = await api(f)
      .patch(`/api/plan/disruptions/${disruption.id}`)
      .send({ endDate: addDays(start, 3) })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------
// Back-dating
// ---------------------------------------------------------------------------------------------

describe('a window reported late', () => {
  test('skips the unlinked planned sessions of the past days, keeps the original and flags them', async () => {
    const f = await fixture('late-skips@example.com')
    const before = await sessionsOf(f.plan.id)
    const past = before.filter((s) => s.date >= MONDAY && s.date <= WEDNESDAY)
    expect(past.length).toBeGreaterThanOrEqual(3)
    const { revision } = await createWindow(f)
    const after = await sessionsOf(f.plan.id)
    for (const row of past) {
      const now = after.find((s) => s.id === row.id)!
      expect(now.status, `${row.date} ${row.kind}`).toBe('skipped')
      expect(flagsOf(now)).toContain('rest-window')
      expect(JSON.parse(now.original!)).toMatchObject({
        date: row.date,
        kind: row.kind,
        title: row.title,
      })
      // the same session, in place: the identity is kept
      expect(now.externalId).toBe(row.externalId)
    }
    const lines = revision.diff!.sessions.filter((line) => line.fields.includes('status'))
    expect(lines.map((line) => line.sessionId).sort()).toEqual(past.map((s) => s.id).sort())
  })

  test('leaves a session that is linked to a run or already completed', async () => {
    const f = await fixture('late-linked@example.com')
    const rows = await sessionsOf(f.plan.id)
    const monday = rows.find((s) => s.date === MONDAY)!
    const tuesday = rows.filter((s) => s.date === TUESDAY)
    const run = await ctx.prisma.activity.create({
      data: {
        userId: f.u.id,
        date: MONDAY,
        type: 'run',
        durationSec: monday.durationMin * 60,
        movingSec: monday.durationMin * 60,
        distanceM: 7000,
        rpe: 4,
        source: 'manual',
      },
    })
    const linked = await api(f)
      .post(`/api/plan/sessions/${monday.id}/link`)
      .send({ activityId: run.id })
    expect(linked.status, JSON.stringify(linked.body)).toBe(200)
    const completed = tuesday[0]!
    await ctx.prisma.planSession.update({
      where: { id: completed.id },
      data: { status: 'completed' },
    })

    await createWindow(f)
    const after = await sessionsOf(f.plan.id)
    const mondayAfter = after.find((s) => s.id === monday.id)!
    expect(mondayAfter.activityId).toBe(run.id)
    expect(mondayAfter.status).not.toBe('skipped')
    expect(flagsOf(mondayAfter)).not.toContain('rest-window')
    const tuesdayAfter = after.find((s) => s.id === completed.id)!
    expect(tuesdayAfter.status).toBe('completed')
    expect(flagsOf(tuesdayAfter)).not.toContain('rest-window')
    // the sessions that remained planned are skipped
    for (const row of after.filter((s) => s.date >= MONDAY && s.date <= WEDNESDAY)) {
      if (row.id !== monday.id && row.id !== completed.id) expect(row.status).toBe('skipped')
    }
  })

  test('puts both directions in the undo payload and the undo brings the sessions back', async () => {
    const f = await fixture('late-undo@example.com')
    const before = await sessionsOf(f.plan.id)
    const { revision } = await createWindow(f)
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: revision.id } })
    const payload = JSON.parse(stored.undo!) as {
      sessions: {
        created: Array<{ id: string }>
        updated: Array<{ id: string; before: Record<string, unknown> }>
      }
      disruptions: { created: Array<{ id: string }>; updated: unknown[] }
    }
    // skipped: the old status, flags and (absent) original come back
    const skipped = before.filter((s) => s.date >= MONDAY && s.date <= WEDNESDAY)
    for (const row of skipped) {
      const entry = payload.sessions.updated.find((candidate) => candidate.id === row.id)
      expect(entry, row.date).toBeDefined()
      expect(entry!.before).toMatchObject({ status: 'planned', original: null })
    }
    // rest: the day the window newly holds is created, and withdrawn by the undo
    expect(payload.sessions.created.length).toBeGreaterThan(0)
    expect(payload.disruptions.created).toHaveLength(1)

    const undone = await api(f).post(`/api/plan/revisions/${revision.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const after = await sessionsOf(f.plan.id)
    for (const row of skipped) {
      const now = after.find((s) => s.id === row.id)!
      expect(now.status).toBe(row.status)
      expect(now.flags).toBe(row.flags)
      expect(now.original).toBe(row.original)
    }
    expect(after.filter((s) => s.kind === 'rest' && s.date >= THURSDAY)).toEqual([])
  })

  test('releases the runner’s own move onto a day the window holds, and the undo puts it back', async () => {
    const f = await fixture('late-released@example.com')
    const long = f.plan.sessions.find((s) => s.kind === 'long' && s.date === SATURDAY)!
    const moved = await api(f).put(`/api/plan/sessions/${long.id}`).send({ date: SUNDAY })
    expect(moved.status, JSON.stringify(moved.body)).toBe(200)

    const { revision, disruption } = await createWindow(f, {
      reason: 'illness-below-neck',
      mode: 'rest',
      startDate: SATURDAY,
      endDate: SUNDAY,
    })
    expect(disruption.phase).toBe('upcoming')
    const held = (await sessionsOf(f.plan.id)).filter((s) => s.date === SUNDAY)
    expect(held.map((s) => s.kind)).toEqual(['rest'])
    expect(revision.diff!.sessions.some((line) => line.sessionId === long.id)).toBe(true)

    const undone = await api(f).post(`/api/plan/revisions/${revision.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    const back = (await sessionsOf(f.plan.id)).find((s) => s.id === long.id)!
    expect(back).toMatchObject({ date: SUNDAY, status: 'moved' })
  })

  test('never adds the minutes of the skipped days back to the days that are left', async () => {
    const f = await fixture('late-not-run@example.com')
    const before = await ctx.prisma.planWeek.findFirstOrThrow({
      where: { planId: f.plan.id, weekStart: MONDAY },
    })
    const { revision } = await createWindow(f)
    const line = revision.diff!.weeks.find((week) => week.weekStart === MONDAY)!
    // Monday to Wednesday were planned and not run [G-6]: the week's target is where it was, and
    // the days from Thursday hold no more than the plan gave them.
    expect(line.runMinBefore).toBe(before.targetRunMin)
    const rows = (await sessionsOf(f.plan.id)).filter((s) => s.date >= THURSDAY && s.date <= SUNDAY)
    const remaining = rows
      .filter((s) => RUN_KINDS.has(s.kind))
      .reduce((sum, s) => sum + s.durationMin, 0)
    const was = f.plan.sessions
      .filter((s) => s.date >= THURSDAY && s.date <= SUNDAY && RUN_KINDS.has(s.kind))
      .reduce((sum, s) => sum + s.durationMin, 0)
    expect(remaining).toBeLessThanOrEqual(was)
  })
})

// ---------------------------------------------------------------------------------------------
// Today and the snapshot
// ---------------------------------------------------------------------------------------------

describe('GET /api/today', () => {
  test('reflects a window at once: the next read after the POST shows it, whatever tag the client holds', async () => {
    const f = await fixture('today-now@example.com')
    const first = await api(f).get('/api/today')
    expect(first.status).toBe(200)
    expect((first.body as TodayView).coach.disruptions).toEqual([])
    expect((first.body as TodayView).coach.slots.disruption).toBeNull()
    const tag = first.headers.etag as string
    expect((await api(f).get('/api/today').set('If-None-Match', tag)).status).toBe(304)

    const { disruption } = await createWindow(f, cold({ startDate: THURSDAY, endDate: FRIDAY }))
    const second = await api(f).get('/api/today').set('If-None-Match', tag)
    expect(second.status).toBe(200)
    expect(second.headers.etag).not.toBe(tag)
    const view = second.body as TodayView
    expect(view.coach.disruptions.map((d) => d.id)).toEqual([disruption.id])
    expect(view.coach.disruptions[0]).toMatchObject({ phase: 'resting', status: 'active' })
    expect(view.coach.slots.disruption).toMatchObject({
      windows: [{ id: disruption.id }],
      offer: false,
    })
    expect(view.sessions.map((entry) => entry.session.kind)).toEqual(['rest'])
  })

  test('gives the phase of the viewed date, and a rest window tomorrow shows as rest in the preview', async () => {
    const f = await fixture('today-date@example.com')
    await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    const phases: Record<string, string> = {}
    for (const date of [THURSDAY, FRIDAY, SATURDAY]) {
      const res = await api(f).get(`/api/today?date=${date}`)
      expect(res.status).toBe(200)
      const view = res.body as TodayView
      phases[date] = view.coach.disruptions[0]!.phase
      expect(view.coach.slots.disruption!.windows.map((window) => window.phase)).toEqual([
        phases[date],
      ])
    }
    expect(phases).toEqual({
      [THURSDAY]: 'resting',
      [FRIDAY]: 'rest-gate',
      [SATURDAY]: 'easy-only',
    })
    const tomorrow = (await api(f).get(`/api/today?date=${FRIDAY}`)).body as TodayView
    expect(tomorrow.coach.preview).toBe(true)
    expect(tomorrow.sessions.map((entry) => entry.session.kind)).toEqual(['rest'])
  })

  test('a window tomorrow is upcoming today', async () => {
    const f = await fixture('today-upcoming@example.com')
    await createWindow(f, cold({ reason: 'travel', startDate: FRIDAY, endDate: FRIDAY }))
    const today = (await api(f).get('/api/today')).body as TodayView
    expect(today.coach.disruptions[0]).toMatchObject({ phase: 'upcoming' })
    expect(today.coach.slots.disruption).toMatchObject({
      windows: [{ phase: 'upcoming' }],
      offer: false,
    })
  })

  test('states an illness window once: the verdict names the day, and the note and the signal leave it to the band', async () => {
    const f = await fixture('today-once@example.com')
    const read = async () => (await api(f).get('/api/today')).body as TodayView
    const codes = (view: TodayView) => ({
      notes: view.readiness.redFlags.map((flag) => flag.code),
      signals: view.coach.signals.map((signal) => signal.code),
    })
    // A check-in that reports illness, with no window: the note and the signal each state it.
    await api(f).put(`/api/checkins/${THURSDAY}`).send({ illness: true }).expect(200)
    const reported = await read()
    expect(codes(reported)).toEqual({ notes: ['illness'], signals: ['illness'] })

    // The window holds the same days: the band states it, and the page need not.
    await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    const view = await read()
    expect(view.coach.disruptions[0]).toMatchObject({ phase: 'resting' })
    expect(view.sessions.map((entry) => entry.session.kind)).toEqual(['rest'])
    expect(codes(view)).toEqual({ notes: [], signals: [] })
    expect(view.coach.verdict).toEqual({
      code: 'window-rest',
      template: 'today.verdict.window-rest',
      slots: {},
    })
    expect(view.coach.slots.disruption?.windows).toHaveLength(1)
  })

  test('names the day by the phase of the window: "Ready as planned." is not said while one is open', async () => {
    const f = await fixture('today-day-name@example.com')
    await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    const code = async (date: string) =>
      ((await api(f).get(`/api/today?date=${date}`)).body as TodayView).coach.verdict?.code ?? null
    expect(await code(THURSDAY)).toBe('window-rest')
    // a day ahead has no verdict at all
    expect(await code(FRIDAY)).toBeNull()
    // with no window open the engine's own verdict is back
    await ctx.prisma.disruption.deleteMany({ where: { userId: f.u.id } })
    expect(await code(THURSDAY)).not.toMatch(/^window-/)
  })

  test('keeps the illness note and signal when a check-in holds the gate past what the window says', async () => {
    const f = await fixture('today-gate-past@example.com')
    // The window ends on the Wednesday; the Thursday's check-in reports illness again.
    await createWindow(f, cold())
    await api(f).put(`/api/checkins/${THURSDAY}`).send({ illness: true }).expect(200)
    const view = (await api(f).get('/api/today')).body as TodayView
    expect(view.coach.disruptions[0]).toMatchObject({ phase: 'rest-gate' })
    expect(view.readiness.redFlags.map((flag) => flag.code)).toContain('illness')
    expect(view.coach.signals.map((signal) => signal.code)).toContain('illness')
  })

  test('lists every open window in the slot, an illness and an injury one line each, oldest first', async () => {
    const f = await fixture('today-two-windows@example.com')
    const illness = await createWindow(f, cold({ startDate: WEDNESDAY, endDate: FRIDAY }))
    const injury = await createWindow(f, {
      reason: 'niggle',
      mode: 'limited',
      maxRunMin: 30,
      area: 'left calf',
      pain: 3,
      startDate: THURSDAY,
      endDate: SATURDAY,
    })
    const view = (await api(f).get('/api/today')).body as TodayView
    expect(view.coach.slots.disruption).toMatchObject({ offer: false })
    expect(view.coach.slots.disruption?.windows.map((window) => window.id)).toEqual([
      illness.disruption.id,
      injury.disruption.id,
    ])
    expect(view.coach.slots.disruption?.windows.map((window) => window.phase)).toEqual([
      'resting',
      'limited',
    ])
    // every window of the payload is on the slot's lines: nothing open is left out
    expect(view.coach.disruptions.map((window) => window.id)).toEqual(
      view.coach.slots.disruption?.windows.map((window) => window.id),
    )
  })

  test('offers a window, and creates none, when a check-in reports illness or pain with no window in effect', async () => {
    const f = await fixture('today-offer@example.com')
    const slot = async (date?: string) =>
      ((await api(f).get(`/api/today${date ? `?date=${date}` : ''}`)).body as TodayView).coach.slots
        .disruption
    expect(await slot()).toBeNull()
    await api(f)
      .put(`/api/checkins/${THURSDAY}`)
      .send({ painScore: P.pain.flagScore.value - 1 })
      .expect(200)
    expect(await slot()).toBeNull()
    await api(f)
      .put(`/api/checkins/${THURSDAY}`)
      .send({ painScore: P.pain.flagScore.value })
      .expect(200)
    expect(await slot()).toEqual({ windows: [], offer: true })
    await api(f).put(`/api/checkins/${THURSDAY}`).send({ painScore: 0, illness: true }).expect(200)
    expect(await slot()).toEqual({ windows: [], offer: true })
    // a day ahead is read-only: no offer
    expect(await slot(FRIDAY)).toBeNull()
    expect(await ctx.prisma.disruption.count({ where: { userId: f.u.id } })).toBe(0)
    // with a window in effect the slot is the window, not the offer
    await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    expect(await slot()).toMatchObject({ windows: [{ phase: 'resting' }], offer: false })
  })
})

describe('the athlete snapshot', () => {
  test('feeds the windows to the engine: a niggle that hurts sets the injury report', async () => {
    const f = await fixture('snapshot-injury@example.com')
    const read = () => loadAthleteContext(deps(), { userId: f.u.id, today: THURSDAY })
    expect((await read()).state.risk.injuryReport).toBeUndefined()
    await createWindow(f, {
      reason: 'niggle',
      mode: 'rest',
      startDate: THURSDAY,
      endDate: FRIDAY,
      pain: P.pain.flagScore.value,
    })
    const after = await read()
    expect(after.state.risk.injuryReport).toBe(true)
    expect(after.disruptions).toHaveLength(1)
    // a niggle that does not hurt and does not change the gait is no report
    await api(f).delete(`/api/plan/disruptions/${after.disruptions[0]!.id}`).expect(200)
    await createWindow(f, {
      reason: 'niggle',
      mode: 'rest',
      startDate: THURSDAY,
      endDate: FRIDAY,
      pain: P.pain.flagScore.value - 1,
    })
    expect((await read()).state.risk.injuryReport).toBeUndefined()
  })

  test('loads the active windows that can still matter and no others', async () => {
    const f = await fixture('snapshot-horizon@example.com')
    const horizon = disruptionHorizonDays()
    expect(horizon).toBeGreaterThanOrEqual(P.j9.maxWindowDays.value)
    const row = (endDate: string, status = 'active') => ({
      userId: f.u.id,
      reason: 'travel',
      mode: 'rest',
      startDate: addDays(endDate, -1),
      endDate,
      status,
    })
    await ctx.prisma.disruption.createMany({
      data: [
        row(addDays(THURSDAY, -horizon)),
        row(addDays(THURSDAY, -horizon - 1)),
        row(addDays(THURSDAY, -400)),
        row(addDays(THURSDAY, 5)),
        row(addDays(THURSDAY, 2), 'undone'),
      ],
    })
    const context = await loadAthleteContext(deps(), { userId: f.u.id, today: THURSDAY })
    expect(context.disruptions.map((d) => d.endDate)).toEqual([
      addDays(THURSDAY, -horizon),
      addDays(THURSDAY, 5),
    ])
  })
})

// ---------------------------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------------------------

describe('GET /api/plan/disruptions', () => {
  test('lists the windows that are not over, with the phase of the date and what the engine says', async () => {
    const f = await fixture('list-phases@example.com')
    const { disruption } = await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    const list = async (query = '') =>
      (await api(f).get(`/api/plan/disruptions${query}`)).body as DisruptionView[]
    expect((await list()).map((d) => [d.id, d.phase])).toEqual([[disruption.id, 'resting']])
    // rest through the symptom-free day, then three easy days before any hard session
    expect(await list()).toEqual([
      expect.objectContaining({ runFrom: addDays(THURSDAY, 2), qualityFrom: addDays(THURSDAY, 5) }),
    ])
    expect((await list(`?date=${FRIDAY}`))[0]!.phase).toBe('rest-gate')
    expect((await list(`?date=${SUNDAY}`))[0]!.phase).toBe('easy-only')
    expect((await list(`?date=${addDays(THURSDAY, 5)}`)).map((d) => d.phase)).toEqual([])
    expect((await list(`?date=${addDays(MONDAY, -3)}`))[0]!.phase).toBe('upcoming')
  })

  test('with include=all it also lists the done and the withdrawn', async () => {
    const f = await fixture('list-all@example.com')
    const first = await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    await api(f).delete(`/api/plan/disruptions/${first.disruption.id}`).expect(200)
    const second = await createWindow(f, {
      reason: 'travel',
      mode: 'rest',
      startDate: SUNDAY,
      endDate: SUNDAY,
    })
    const plain = (await api(f).get('/api/plan/disruptions')).body as DisruptionView[]
    expect(plain.map((d) => d.id)).toEqual([second.disruption.id])
    const all = (await api(f).get('/api/plan/disruptions?include=all')).body as DisruptionView[]
    expect(all.map((d) => [d.id, d.status, d.phase])).toEqual([
      [first.disruption.id, 'undone', 'done'],
      [second.disruption.id, 'active', 'upcoming'],
    ])
  })

  test('sizes the return week of a long hold from the week before, and not of a short one', async () => {
    const f = await fixture('list-return@example.com', 8)
    const long = await createWindow(f, cold({ startDate: THURSDAY, endDate: addDays(THURSDAY, 8) }))
    expect(long.disruption.returnWeekMin).toBeGreaterThan(0)
    const week = await ctx.prisma.planWeek.findMany({ where: { planId: f.plan.id } })
    expect(week.some((w) => (JSON.parse(w.flags) as string[]).includes('disruption-return'))).toBe(
      true,
    )
    await api(f).delete(`/api/plan/disruptions/${long.disruption.id}`).expect(200)
    const short = await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    expect(short.disruption.returnWeekMin).toBeNull()
  })

  test('refuses what the query does not allow', async () => {
    const f = await fixture('list-query@example.com')
    expect((await api(f).get('/api/plan/disruptions?include=some')).status).toBe(400)
    expect((await api(f).get('/api/plan/disruptions?date=tomorrow')).status).toBe(400)
    expect((await api(f).get('/api/plan/disruptions?other=1')).status).toBe(400)
  })
})

// ---------------------------------------------------------------------------------------------
// Removing a window
// ---------------------------------------------------------------------------------------------

describe('DELETE /api/plan/disruptions/:id', () => {
  test('is a forward revision with its own undo, and the days already skipped stay skipped', async () => {
    const f = await fixture('delete-forward@example.com')
    const { disruption, revision: created } = await createWindow(f)
    const skipped = (await sessionsOf(f.plan.id)).filter((s) => s.status === 'skipped')
    expect(skipped.length).toBeGreaterThan(0)

    const res = await api(f).delete(`/api/plan/disruptions/${disruption.id}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const { revision } = res.body as DisruptionResult
    expect(revision).toMatchObject({
      reason: 'disruption',
      disruptionId: disruption.id,
      undo: { available: true },
    })
    expect(revision.id).not.toBe(created.id)
    // the rest session of Thursday is gone and the plan is training again
    const after = await sessionsOf(f.plan.id)
    expect(after.filter((s) => s.date >= THURSDAY).some((s) => s.kind === 'rest')).toBe(false)
    for (const row of skipped) expect(after.find((s) => s.id === row.id)!.status).toBe('skipped')

    // its own undo puts the window back
    const undone = await api(f).post(`/api/plan/revisions/${revision.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(
      (await ctx.prisma.disruption.findUniqueOrThrow({ where: { id: disruption.id } })).status,
    ).toBe('active')
    expect(
      (await sessionsOf(f.plan.id))
        .filter((s) => s.date >= THURSDAY)
        .some((s) => s.kind === 'rest'),
    ).toBe(true)
  })

  test('is never blocked by later edits: not of the window, not of the sessions it holds', async () => {
    const f = await fixture('delete-never-blocked@example.com')
    const { disruption, revision: created } = await createWindow(
      f,
      cold({ startDate: THURSDAY, endDate: FRIDAY }),
    )
    await api(f)
      .patch(`/api/plan/disruptions/${disruption.id}`)
      .send({ endDate: SATURDAY })
      .expect(200)
    // Saturday is the last day of the window now, and the plan holds it with a rest session.
    const held = (await sessionsOf(f.plan.id)).find((s) => s.date === SATURDAY && s.kind === 'rest')
    expect(held, 'a rest session on the last day of the window').toBeDefined()
    await api(f).put(`/api/plan/sessions/${held!.id}`).send({ skip: true }).expect(200)
    // the undo of the creation is refused: the window changed since
    const listed = (await api(f).get('/api/plan/revisions')).body as PlanRevisionView[]
    const creation = listed.find((r) => r.id === created.id)!
    expect(creation.undo.available).toBe(false)
    expect(creation.undo.reasons[0]).toMatchObject({
      code: 'edited-since',
      disruptionId: disruption.id,
    })
    // the removal is not
    const res = await api(f).delete(`/api/plan/disruptions/${disruption.id}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  test('undoing a removal is not refused while the safety rule behind the window still holds', async () => {
    const f = await fixture('delete-undo-safety@example.com')
    const { disruption } = await createWindow(f, cold({ startDate: THURSDAY, endDate: FRIDAY }))
    const removed = (await api(f).delete(`/api/plan/disruptions/${disruption.id}`))
      .body as DisruptionResult
    // the check-in reports illness today: n-3 is active, and the removal cites it
    await api(f).put(`/api/checkins/${THURSDAY}`).send({ illness: true }).expect(200)
    const listed = (await api(f).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.find((r) => r.id === removed.revision.id)!.undo.available).toBe(true)
    const res = await api(f).post(`/api/plan/revisions/${removed.revision.id}/undo`).send({})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------
// Undoing a window
// ---------------------------------------------------------------------------------------------

describe('POST /api/plan/revisions/:id/undo for a window', () => {
  test('withdraws the window the revision created and restores the plan, in one revision of its own', async () => {
    const f = await fixture('undo-create@example.com')
    const before = await sessionsOf(f.plan.id)
    const { disruption, revision } = await createWindow(
      f,
      cold({ startDate: THURSDAY, endDate: FRIDAY }),
    )
    const preview = await previewOf(f, { type: 'undo', revisionId: revision.id })
    expect(preview.blocked).toBe(false)
    const res = await api(f)
      .post(`/api/plan/revisions/${revision.id}/undo`)
      .send({ expectHash: preview.hash })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const done = res.body as UndoResult
    expect(done.revision).toMatchObject({
      reason: 'undo',
      undoOf: revision.id,
      disruptionId: disruption.id,
    })
    expect(withoutIds(done.revision.diff!)).toEqual(withoutIds(preview.diff))
    expect(done.target.undo.undoneAt).not.toBeNull()
    expect(
      (await ctx.prisma.disruption.findUniqueOrThrow({ where: { id: disruption.id } })).status,
    ).toBe('undone')
    expect((await api(f).get('/api/plan/disruptions')).body as DisruptionView[]).toEqual([])
    const after = await sessionsOf(f.plan.id)
    expect(after.map((s) => [s.date, s.kind, s.status, s.durationMin])).toEqual(
      before.map((s) => [s.date, s.kind, s.status, s.durationMin]),
    )
    // Today no longer shows it
    const view = (await api(f).get('/api/today')).body as TodayView
    expect(view.coach.disruptions).toEqual([])
  })

  test('is refused once the window changed, naming it, and the runner can remove it instead', async () => {
    const f = await fixture('undo-edited@example.com')
    const { disruption, revision } = await createWindow(
      f,
      cold({ startDate: THURSDAY, endDate: FRIDAY }),
    )
    await api(f)
      .patch(`/api/plan/disruptions/${disruption.id}`)
      .send({ endDate: SATURDAY })
      .expect(200)
    const res = await api(f).post(`/api/plan/revisions/${revision.id}/undo`).send({})
    expect(res.status).toBe(409)
    expect(errorOf(res).details.reasons[0]).toMatchObject({
      code: 'edited-since',
      disruptionId: disruption.id,
      message: 'The window changed after this update, so it cannot be restored.',
    })
  })

  test('restores the end of a window the revision changed', async () => {
    const f = await fixture('undo-update@example.com')
    // travel, not illness: lengthening an illness window follows n-3, which an undo may not undo
    // while the illness is still there
    const { disruption } = await createWindow(
      f,
      cold({ reason: 'travel', startDate: THURSDAY, endDate: FRIDAY }),
    )
    const changed = (
      await api(f).patch(`/api/plan/disruptions/${disruption.id}`).send({ endDate: SUNDAY })
    ).body as DisruptionResult
    const res = await api(f).post(`/api/plan/revisions/${changed.revision.id}/undo`).send({})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const row = await ctx.prisma.disruption.findUniqueOrThrow({ where: { id: disruption.id } })
    expect(row).toMatchObject({ endDate: FRIDAY, status: 'active' })
  })

  test('a window the runner reported can always be withdrawn, with n-3 still active', async () => {
    const f = await fixture('undo-safety@example.com')
    const { revision } = await createWindow(f, cold({ startDate: THURSDAY, endDate: FRIDAY }))
    await api(f).put(`/api/checkins/${THURSDAY}`).send({ illness: true }).expect(200)
    const listed = (await api(f).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(listed.find((r) => r.id === revision.id)!.undo).toMatchObject({ available: true })
    const res = await api(f).post(`/api/plan/revisions/${revision.id}/undo`).send({})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  test('undoing one window leaves another in force, and the restored plan still holds it', async () => {
    const f = await fixture('undo-two-windows@example.com', 8)
    const first = await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    const later = addDays(MONDAY, 22)
    const second = await createWindow(f, {
      reason: 'travel',
      mode: 'rest',
      startDate: later,
      endDate: later,
    })
    const res = await api(f).post(`/api/plan/revisions/${first.revision.id}/undo`).send({})
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const rows = await sessionsOf(f.plan.id)
    expect(rows.filter((s) => s.date === THURSDAY).map((s) => s.kind)).not.toContain('rest')
    expect(rows.filter((s) => s.date === later).map((s) => s.kind)).toEqual(['rest'])
    const windows = (await api(f).get('/api/plan/disruptions')).body as DisruptionView[]
    expect(windows.map((w) => w.id)).toEqual([second.disruption.id])
  })
})

// ---------------------------------------------------------------------------------------------
// Whose windows
// ---------------------------------------------------------------------------------------------

describe('windows belong to one runner', () => {
  test('another runner can neither see nor change them, and their plan does not move', async () => {
    const a = await fixture('owner-a@example.com')
    const b = await fixture('owner-b@example.com')
    const bBefore = await sessionsOf(b.plan.id)
    const { disruption } = await createWindow(a)
    expect(
      (await api(b).get('/api/plan/disruptions?include=all')).body as DisruptionView[],
    ).toEqual([])
    expect(
      (await api(b).patch(`/api/plan/disruptions/${disruption.id}`).send({ endDate: THURSDAY }))
        .status,
    ).toBe(404)
    expect((await api(b).delete(`/api/plan/disruptions/${disruption.id}`)).status).toBe(404)
    expect(
      (
        await api(b)
          .post('/api/plan/preview')
          .send({ type: 'disruption-remove', id: disruption.id })
      ).status,
    ).toBe(404)
    expect(((await api(b).get('/api/today')).body as TodayView).coach.disruptions).toEqual([])
    expect(await sessionsOf(b.plan.id)).toEqual(bBefore)
    expect(
      (await ctx.prisma.disruption.findUniqueOrThrow({ where: { id: disruption.id } })).status,
    ).toBe('active')
    // and the windows of one runner are not in the other’s snapshot
    const context = await loadAthleteContext(deps(), { userId: b.u.id, today: THURSDAY })
    expect(context.disruptions).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// A new plan
// ---------------------------------------------------------------------------------------------

describe('regenerating the plan', () => {
  test('applies every active window to the new plan', async () => {
    const f = await fixture('regenerate@example.com')
    await createWindow(f, cold({ startDate: THURSDAY, endDate: THURSDAY }))
    const res = await api(f).post('/api/plan/generate').send({ goalId: f.goalId })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions
    expect(plan.id).not.toBe(f.plan.id)
    for (const date of [THURSDAY, FRIDAY]) {
      const kinds = plan.sessions.filter((s) => s.date === date).map((s) => s.kind)
      expect(kinds, date).toContain('rest')
      expect(
        kinds.filter((kind) => RUN_KINDS.has(kind)),
        date,
      ).toEqual([])
    }
    expect(plan.weeks.find((w) => w.weekStart === MONDAY)!.flags).toContain('disrupted')
    // and the withdrawn ones are not applied
    const rows = await ctx.prisma.disruption.findMany({ where: { userId: f.u.id } })
    await api(f).delete(`/api/plan/disruptions/${rows[0]!.id}`).expect(200)
    const again = (await api(f).post('/api/plan/generate').send({ goalId: f.goalId }))
      .body as PlanWithSessions
    expect(again.sessions.filter((s) => s.date === THURSDAY).map((s) => s.kind)).not.toContain(
      'rest',
    )
  })
})

// ---------------------------------------------------------------------------------------------
// A request that lands while a re-plan is being decided
// ---------------------------------------------------------------------------------------------

describe('the head revision', () => {
  test('a re-plan decided before another revision landed is not written', async () => {
    const f = await fixture('head-stale@example.com', 8)
    await runFirstWeek(f.u.id)
    at(TUESDAY_NEXT)
    const decided = await computeReplan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: TUESDAY_NEXT,
    })
    await createWindow(f, {
      reason: 'travel',
      mode: 'rest',
      startDate: NOVEMBER_DAY,
      endDate: NOVEMBER_DAY,
    })
    const { version: _was, ...before } = await counts()
    await expect(applyReplan(deps(), decided, { checkHead: true })).rejects.toBeInstanceOf(
      StaleWrite,
    )
    // no row moved (a transaction that rolls back still counts as one for the data version)
    const { version: _now, ...after } = await counts()
    expect(after).toEqual(before)
    // without the check the write goes through, as it always did
    await expect(applyReplan(deps(), decided)).resolves.toMatchObject({ reason: 'weekly' })
  })

  test('the weekly re-plan decides again once, and so keeps the window that landed meanwhile', async () => {
    const f = await fixture('head-retry@example.com', 8)
    await runFirstWeek(f.u.id)
    at(TUESDAY_NEXT)
    race.during = async () => {
      await createWindow(f, {
        reason: 'travel',
        mode: 'rest',
        startDate: NOVEMBER_DAY,
        endDate: NOVEMBER_DAY,
      })
    }
    const revision = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: TUESDAY_NEXT,
    })
    expect(revision.reason).toBe('weekly')
    const rows = await sessionsOf(f.plan.id)
    // the first decision knew nothing of the window and would have drawn a run on its day
    expect(rows.filter((s) => s.date === NOVEMBER_DAY).map((s) => s.kind)).toEqual(['rest'])
  })

  test('a second collision is a 409 for the caller, and nothing is written', async () => {
    const f = await fixture('head-twice@example.com', 8)
    await runFirstWeek(f.u.id)
    at(TUESDAY_NEXT)
    let landed = 0
    const land = async () => {
      landed += 1
      const day = addDays(NOVEMBER_DAY, landed)
      await createWindow(f, { reason: 'travel', mode: 'rest', startDate: day, endDate: day })
      if (landed < 2) race.during = land
    }
    race.during = land
    const weekly = () =>
      ctx.prisma.planRevision.count({ where: { planId: f.plan.id, reason: 'weekly' } })
    const error = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'weekly',
      today: TUESDAY_NEXT,
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(HttpError)
    expect((error as HttpError).status).toBe(409)
    expect(landed).toBe(2)
    expect(await weekly()).toBe(0)
  })
})
