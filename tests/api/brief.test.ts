// The weekly brief on the server (phase 3a design 8.3 to 8.5, 8.7, 8.8): what the weekly job
// writes after its re-plan and after a failed one, what the routes serve, the current week built on
// a request, and a table the data version does not follow.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { BRIEF_VERSION } from '../../shared/engine/brief.ts'
import type { BriefFacts, ExplainView } from '../../shared/engine/types.ts'
import type {
  BriefListItem,
  BriefView,
  PlanRevisionView,
  PlanWithSessions,
} from '../../shared/types.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { HttpError, notFound, validationError } from '../../server/errors.ts'
import { runReplanJob } from '../../server/jobs/scheduler.ts'
import { generateBrief, readFacts, replanNoteOf } from '../../server/services/brief.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// A Monday at noon. Only Date is faked; timers and promises keep working.
const MONDAY_NOON = new Date(2026, 9, 19, 12)
const SUNDAY_EVENING = new Date(2026, 9, 18, 20)
const monday = todayIso(MONDAY_NOON)
const lastMonday = addDays(monday, -7)
const nextMonday = addDays(monday, 7)

vi.useFakeTimers({ toFake: ['Date'] })

/** Matches any string, typed as one so it can stand where a string is expected. */
const anyString = expect.any(String) as unknown as string

let ctx: TestCtx
let deps: { prisma: TestCtx['prisma']; config: TestCtx['config'] }
let nextUser = 1

beforeAll(async () => {
  ctx = await createTestCtx()
  deps = { prisma: ctx.prisma, config: ctx.config }
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  vi.setSystemTime(MONDAY_NOON)
})

afterEach(() => {
  vi.setSystemTime(MONDAY_NOON)
})

interface Runner {
  u: TestUser
  c: ReturnType<typeof client>
  plan: PlanWithSessions
  goalId: string
}

/** Twelve completed weeks of four runs before the Monday, and a goal some weeks out. */
async function seedHistory(userId: string): Promise<void> {
  const week = [
    { dow: 1, min: 40, distanceM: 6400 },
    { dow: 3, min: 45, distanceM: 7200 },
    { dow: 5, min: 35, distanceM: 5600 },
    { dow: 6, min: 70, distanceM: 11_000 },
  ]
  await ctx.prisma.activity.createMany({
    data: Array.from({ length: 12 }, (_, w) =>
      week.map((run) => ({
        userId,
        date: addDays(monday, -7 * (w + 1) + run.dow),
        type: 'run',
        durationSec: run.min * 60,
        movingSec: run.min * 60,
        distanceM: run.distanceM,
        rpe: 3,
        source: 'manual',
      })),
    ).flat(),
  })
}

/**
 * A runner with history and a plan made on the Sunday evening before the Monday, as a plan that
 * the weekly update then finds: it covers last week, so the update has a decision to state. The
 * clock is back at the Monday when this returns.
 */
async function runner(email: string, opts: { weeksToRace?: number } = {}): Promise<Runner> {
  const u = await seedUser(ctx, { email, units: 'km' })
  await seedHistory(u.id)
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(monday, 7 * (opts.weeksToRace ?? 7) + 5),
      distanceM: 21_097,
      goalType: 'finish',
    },
  })
  const c = client(ctx, u)
  vi.setSystemTime(SUNDAY_EVENING)
  const generated = await c.post('/api/plan/generate').send({ goalId: goal.id })
  vi.setSystemTime(MONDAY_NOON)
  expect(generated.status, JSON.stringify(generated.body)).toBe(201)
  return { u, c, plan: generated.body as PlanWithSessions, goalId: goal.id }
}

function email(): string {
  return `brief-${String(nextUser++)}@example.com`
}

/** Closes the weekday of an easy run of next week, so the next update changes the plan. */
async function closeADay(r: Runner): Promise<void> {
  const easy = r.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
  const weekday = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'][
    (new Date(`${easy.date}T00:00:00Z`).getUTCDay() + 6) % 7
  ]!
  const availability = JSON.stringify({ [weekday]: { available: false, maxMin: null } })
  await ctx.prisma.athleteProfile.upsert({
    where: { userId: r.u.id },
    create: { userId: r.u.id, availability },
    update: { availability },
  })
}

const briefOf = (userId: string, weekStart = monday) =>
  ctx.prisma.weeklyBrief.findUnique({ where: { userId_weekStart: { userId, weekStart } } })

async function getBrief(r: Runner, query = ''): Promise<BriefView | null> {
  const res = await r.c.get(`/api/brief${query}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return (res.body as { brief: BriefView | null }).brief
}

/** A runner whose Monday update ran and changed the plan. */
async function updated(label: string): Promise<Runner & { revisionId: string }> {
  const r = await runner(label)
  await closeADay(r)
  await runReplanJob(deps, { now: MONDAY_NOON })
  const weekly = await ctx.prisma.planRevision.findFirstOrThrow({
    where: { planId: r.plan.id, reason: 'weekly' },
    orderBy: { createdAt: 'desc' },
  })
  return { ...r, revisionId: weekly.id }
}

// ---------------------------------------------------------------------------------------------

describe('the weekly job', () => {
  test('writes the brief after its re-plan: the revision, the changes with causes, the key session', async () => {
    const r = await updated(email())
    const row = await briefOf(r.u.id)
    expect(row).toMatchObject({
      planId: r.plan.id,
      revisionId: r.revisionId,
      provisional: false,
      version: BRIEF_VERSION,
    })
    const facts = readFacts(row!.facts)!
    expect(facts.weekStart).toBe(monday)
    expect(facts.replan).toBeNull()
    expect(facts.changes!.count).toBeGreaterThan(0)
    for (const line of facts.changes!.lines)
      expect(line.causes.length, line.type).toBeGreaterThan(0)
    expect(facts.lastWeek).toMatchObject({ weekStart: lastMonday, ranMin: 190 })
    expect(facts.decision).not.toBeNull()
    expect(facts.countdown).toMatchObject({ name: 'Synthetic half' })
    // the key session is a key kind within a week of today, and has the resolver's figures
    expect(facts.keySession).toMatchObject({ target: { zone: anyString } })
    expect(facts.keySession!.date >= monday).toBe(true)
    expect(facts.keySession!.date <= addDays(monday, 6)).toBe(true)
    // the stored facts hold no sentence: every string is an id, a code, a date or the goal's name
    const text = JSON.stringify(facts).replace('Synthetic half', '')
    expect(text).not.toMatch(/\b(?:the|was|you|your|plan)\b/i)
  })

  test('writes a brief for a quiet week too: no changes, the revision still described', async () => {
    const r = await runner(email())
    await runReplanJob(deps, { now: MONDAY_NOON })
    const row = await briefOf(r.u.id)
    const facts = readFacts(row!.facts)!
    expect(row!.revisionId).not.toBeNull()
    expect(facts.changes).toMatchObject({ count: 0, lines: [] })
  })

  test('writes a brief with a replan note after a re-plan that failed, and the plan stays', async () => {
    const r = await runner(email())
    // the goal date passes: the weekly update refuses, the plan stays as it is
    await ctx.prisma.goal.update({
      where: { id: r.goalId },
      data: { targetDate: addDays(monday, -1) },
    })
    await runReplanJob(deps, { now: MONDAY_NOON })
    const row = await briefOf(r.u.id)
    expect(row).toMatchObject({ revisionId: null, provisional: false, planId: r.plan.id })
    const facts = readFacts(row!.facts)!
    expect(facts.replan).toBe('goal-passed')
    expect(facts.changes).toBeNull()
    expect(facts.decision).toBeNull()
    // the re-plan's own run is recorded as the error it was; the brief did not change that
    const run = await ctx.prisma.syncRun.findFirstOrThrow({
      where: { userId: r.u.id, provider: 'replan' },
    })
    expect(run.status).toBe('error')
    expect(
      await ctx.prisma.planRevision.count({ where: { planId: r.plan.id, reason: 'weekly' } }),
    ).toBe(0)
    // and the page serves it
    const brief = (await getBrief(r))!
    expect(brief).toMatchObject({ provisional: false, seen: true, revision: null })
    expect(brief.facts.replan).toBe('goal-passed')
  })

  test('never fails the re-plan when the brief cannot be written', async () => {
    const own = await createTestCtx()
    try {
      const u = await seedUser(own, { email: 'brief-broken@example.com', units: 'km' })
      const week = [1, 3, 5, 6]
      await own.prisma.activity.createMany({
        data: Array.from({ length: 12 }, (_, w) =>
          week.map((dow) => ({
            userId: u.id,
            date: addDays(monday, -7 * (w + 1) + dow),
            type: 'run',
            durationSec: 2400,
            movingSec: 2400,
            distanceM: 6400,
            rpe: 3,
            source: 'manual',
          })),
        ).flat(),
      })
      const goal = await own.prisma.goal.create({
        data: {
          userId: u.id,
          name: 'Synthetic half',
          priority: 'A',
          targetDate: addDays(monday, 7 * 7 + 5),
          distanceM: 21_097,
          goalType: 'finish',
        },
      })
      const generated = await client(own, u).post('/api/plan/generate').send({ goalId: goal.id })
      expect(generated.status).toBe(201)
      await own.prisma.$executeRawUnsafe('DROP TABLE "WeeklyBrief"')

      const warn = vi.fn()
      await runReplanJob({ prisma: own.prisma, config: own.config }, { now: MONDAY_NOON }, {
        warn,
      } as never)
      const run = await own.prisma.syncRun.findFirstOrThrow({
        where: { userId: u.id, provider: 'replan' },
      })
      expect(run.status).toBe('ok')
      expect(await own.prisma.planRevision.count({ where: { reason: 'weekly' } })).toBe(1)
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: u.id }),
        'weekly brief failed',
      )
    } finally {
      await own.close()
    }
  })

  test('makes a normal brief when the catch-up runs the update late', async () => {
    // the plan was made on the Sunday evening before; the 03:00 slot never ran
    const r = await runner(email())
    const wednesday = new Date(2026, 9, 21, 12)
    vi.setSystemTime(wednesday)
    await runReplanJob(deps, { now: wednesday, catchUp: true })
    const row = await briefOf(r.u.id)
    expect(row).toMatchObject({ provisional: false, weekStart: monday })
    expect(row!.revisionId).not.toBeNull()
    const revision = await ctx.prisma.planRevision.findUniqueOrThrow({
      where: { id: row!.revisionId! },
    })
    expect(revision.reason).toBe('weekly')
    // the brief opens the week, and was read on the Wednesday it was written
    expect(readFacts(row!.facts)).toMatchObject({ weekStart: monday, asOf: todayIso(wednesday) })
  })

  test('keeps the brief of an update that ran when a later attempt fails', async () => {
    const r = await updated(email())
    const before = await briefOf(r.u.id)
    await generateBrief(deps, { userId: r.u.id, today: monday, failure: new Error('later') })
    const after = await briefOf(r.u.id)
    expect(after!.revisionId).toBe(r.revisionId)
    expect(after!.facts).toBe(before!.facts)
  })

  test('keeps the brief of an update that changed the plan when a second update of the week changes nothing', async () => {
    // The catch-up and the 03:00 slot can both re-plan one plan in a week: the second one finds the
    // plan already as the first left it, and its empty revision must not replace the first's brief.
    const r = await updated(email())
    const before = (await briefOf(r.u.id))!
    expect(readFacts(before.facts)!.changes!.count).toBeGreaterThan(0)

    await runReplanJob(deps, { now: MONDAY_NOON })

    const weekly = await ctx.prisma.planRevision.findMany({
      where: { planId: r.plan.id, reason: 'weekly' },
      orderBy: { createdAt: 'asc' },
    })
    expect(weekly).toHaveLength(2)
    expect(weekly[1]!.diff).toContain('"empty":true')
    const after = (await briefOf(r.u.id))!
    expect(after.revisionId).toBe(r.revisionId)
    expect(after.facts).toBe(before.facts)
    expect(after.provisional).toBe(false)
  })

  test('replaces a provisional brief with its own', async () => {
    const r = await runner(email())
    const provisional = (await getBrief(r))!
    expect(provisional).toMatchObject({ provisional: true, revision: null, seen: true })
    expect(provisional.facts.changes).toBeNull()
    const rowBefore = (await briefOf(r.u.id))!
    await runReplanJob(deps, { now: MONDAY_NOON })
    const replaced = (await getBrief(r))!
    expect(replaced.provisional).toBe(false)
    expect(replaced.revision).not.toBeNull()
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(1)
    expect((await briefOf(r.u.id))!.id).toBe(rowBefore.id)
  })
})

// ---------------------------------------------------------------------------------------------

describe('why an update wrote nothing', () => {
  const context = (over: { plan?: object | null; goalDate?: string | null } = {}) => ({
    plan: over.plan === undefined ? ({ id: 'p' } as never) : (over.plan as never),
    goal:
      over.goalDate === null
        ? null
        : ({ targetDate: over.goalDate ?? addDays(monday, 90) } as never),
  })

  test('names the cause from what is known, never from the message', () => {
    expect(replanNoteOf(notFound('There is no active plan to re-plan.'), context(), monday)).toBe(
      'no-plan',
    )
    expect(replanNoteOf(new Error('x'), context({ plan: null }), monday)).toBe('no-plan')
    expect(
      replanNoteOf(
        validationError('The goal date has passed.'),
        context({ goalDate: addDays(monday, -1) }),
        monday,
      ),
    ).toBe('goal-passed')
    expect(
      replanNoteOf(
        new HttpError(422, 'validation', 'The plan checks failed.', { checklist: [] }),
        context(),
        monday,
      ),
    ).toBe('checklist')
    expect(replanNoteOf(new HttpError(409, 'conflict', 'Stale.'), context(), monday)).toBe('error')
    expect(replanNoteOf('a string', context({ goalDate: null }), monday)).toBe('error')
    // a goal due today has not passed
    expect(replanNoteOf(new Error('x'), context({ goalDate: monday }), monday)).toBe('error')
  })
})

// ---------------------------------------------------------------------------------------------

describe('GET /api/brief', () => {
  test('serves the brief with the revision, its undo state as the revision list gives it, and no seen column', async () => {
    const r = await updated(email())
    const brief = (await getBrief(r))!
    expect(brief).toMatchObject({
      weekStart: monday,
      planId: r.plan.id,
      version: BRIEF_VERSION,
      provisional: false,
      seen: false,
      prev: null,
      next: null,
      since: [],
    })
    expect(brief.facts.weekStart).toBe(monday)
    expect(brief.revision).toMatchObject({ id: r.revisionId, reason: 'weekly', auto: true })
    expect(Object.keys(brief)).not.toContain('seenAt')

    const list = (await r.c.get('/api/plan/revisions')).body as PlanRevisionView[]
    const same = list.find((revision) => revision.id === r.revisionId)!
    expect(brief.revision!.undo).toEqual(same.undo)
    expect(brief.revision!.undo.available).toBe(true)
    expect(brief.revision!.causes).toEqual(same.causes)
  })

  test('is seen when its revision is, and a request-made brief has none to wait for', async () => {
    const r = await updated(email())
    expect((await getBrief(r))!.seen).toBe(false)
    await ctx.prisma.planRevision.update({
      where: { id: r.revisionId },
      data: { seenAt: new Date() },
    })
    expect((await getBrief(r))!.seen).toBe(true)
    const fresh = await runner(email())
    expect((await getBrief(fresh))!).toMatchObject({ provisional: true, seen: true })
  })

  test('builds the current week provisionally, and a past or future week never', async () => {
    const r = await runner(email())
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(0)
    expect(await getBrief(r, `?weekStart=${lastMonday}`)).toBeNull()
    expect(await getBrief(r, `?weekStart=${nextMonday}`)).toBeNull()
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(0)

    const brief = (await getBrief(r))!
    expect(brief).toMatchObject({ weekStart: monday, provisional: true, revision: null, since: [] })
    expect(brief.facts).toMatchObject({ replan: null, changes: null, weekStart: monday })
    expect(brief.facts.keySession).not.toBeNull()
    // any day of the week asks for the same Monday
    const wednesday = (await getBrief(r, `?weekStart=${addDays(monday, 2)}`))!
    expect(wednesday.weekStart).toBe(monday)
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(1)
  })

  test('is null for a runner with no plan, and builds nothing', async () => {
    const u = await seedUser(ctx, { email: email() })
    const c = client(ctx, u)
    const res = await c.get('/api/brief')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ brief: null })
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: u.id } })).toBe(0)
  })

  test('shows the prediction line only when two weekly rows a week apart exist', async () => {
    const r = await runner(email())
    const row = (weekStart: string, predictedSec: number) => ({
      userId: r.u.id,
      goalId: r.goalId,
      method: 'synthetic',
      predictedSec,
      lowSec: predictedSec - 300,
      highSec: predictedSec + 300,
      weekStart,
      loggedOn: weekStart,
    })
    const prediction = async () => (await getBrief(r))!.facts.prediction
    // none, then this week's alone, then a row two weeks back: no line
    expect(await prediction()).toBeNull()
    await ctx.prisma.predictionLog.create({ data: row(monday, 7511) })
    expect(await prediction()).toBeNull()
    await ctx.prisma.predictionLog.create({ data: row(addDays(monday, -14), 7800) })
    expect(await prediction()).toBeNull()
    // last week's row completes the pair; the provisional brief reads it on the next request
    await ctx.prisma.predictionLog.create({ data: row(lastMonday, 7629) })
    expect(await prediction()).toEqual({ nowSec: 7500, priorSec: 7620 })
  })

  test('creates one row for concurrent requests', async () => {
    const r = await runner(email())
    const responses = await Promise.all(Array.from({ length: 8 }, () => r.c.get('/api/brief')))
    for (const res of responses) expect(res.status).toBe(200)
    const briefs = responses.map((res) => (res.body as { brief: BriefView }).brief)
    expect(new Set(briefs.map((b) => b.facts.asOf)).size).toBe(1)
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(1)
  })

  test('takes the weekly revision when the job wrote it and lost its brief', async () => {
    const r = await updated(email())
    await ctx.prisma.weeklyBrief.deleteMany({ where: { userId: r.u.id } })
    const brief = (await getBrief(r))!
    expect(brief.provisional).toBe(false)
    expect(brief.revision?.id).toBe(r.revisionId)
    expect(brief.facts.changes!.count).toBeGreaterThan(0)
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(1)
  })

  test('reads a provisional brief again, so it follows the plan until the update runs', async () => {
    const r = await runner(email())
    const first = (await getBrief(r))!
    const key = first.facts.keySession!
    // the runner skips the key session; the next brief read names the following one
    await ctx.prisma.planSession.update({
      where: { id: key.sessionId },
      data: { status: 'skipped' },
    })
    const second = (await getBrief(r))!
    expect(second.facts.keySession?.sessionId).not.toBe(key.sessionId)
    expect(second.provisional).toBe(true)
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(1)
  })

  test('reads a provisional brief of a week that is over as an update that did not run', async () => {
    const r = await runner(email())
    const stored = await getBrief(r)
    await ctx.prisma.weeklyBrief.update({
      where: { userId_weekStart: { userId: r.u.id, weekStart: monday } },
      data: { weekStart: lastMonday, provisional: true },
    })
    expect(stored).not.toBeNull()
    const brief = (await getBrief(r, `?weekStart=${lastMonday}`))!
    expect(brief.provisional).toBe(false)
    expect(brief.facts.replan).toBe('not-run')
    expect(brief.facts.decision).toBeNull()
    expect(brief.since).toEqual([])
    // the current week has none of its own now, so it is built
    expect((await getBrief(r))!.weekStart).toBe(monday)
  })

  test('links the briefs on either side, and lists the revisions made since', async () => {
    const r = await updated(email())
    // last week's brief, as a job of the week before would have left it
    const facts = JSON.parse((await briefOf(r.u.id))!.facts) as BriefFacts
    await ctx.prisma.weeklyBrief.create({
      data: {
        userId: r.u.id,
        weekStart: lastMonday,
        planId: r.plan.id,
        version: BRIEF_VERSION,
        facts: JSON.stringify({ ...facts, weekStart: lastMonday }),
      },
    })
    const current = (await getBrief(r))!
    expect(current).toMatchObject({ prev: lastMonday, next: null })
    expect(await getBrief(r, `?weekStart=${lastMonday}`)).toMatchObject({
      prev: null,
      next: monday,
    })

    // a later revision of the plan within the week is listed; the brief's own is not
    const anchor = (
      await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: r.revisionId } })
    ).createdAt
    const later = await ctx.prisma.planRevision.create({
      data: {
        planId: r.plan.id,
        reason: 'disruption',
        summary: 'A rest window.',
        auto: true,
        createdAt: new Date(anchor.getTime() + 60_000),
      },
    })
    const quiet = await ctx.prisma.planRevision.create({
      data: {
        planId: r.plan.id,
        reason: 'owner',
        summary: 'Nothing.',
        diff: JSON.stringify({ empty: true }),
        createdAt: new Date(anchor.getTime() + 120_000),
      },
    })
    const after = (await getBrief(r))!
    expect(after.since.map((revision) => revision.id)).toEqual([later.id])
    expect(after.since.map((revision) => revision.id)).not.toContain(quiet.id)
    expect(after.since[0]!.undo.available).toBe(false)
    // a revision after the week is out
    await ctx.prisma.planRevision.create({
      data: {
        planId: r.plan.id,
        reason: 'owner',
        summary: 'Next week.',
        createdAt: new Date(`${nextMonday}T10:00:00`),
      },
    })
    expect((await getBrief(r))!.since).toHaveLength(1)
  })

  test('refuses what is not a date, an extra parameter and a request that is not signed in', async () => {
    const r = await runner(email())
    expect((await r.c.get('/api/brief?weekStart=soon')).status).toBe(400)
    expect((await r.c.get('/api/brief?weekStart=2026-02-30')).status).toBe(400)
    expect((await r.c.get('/api/brief?limit=3')).status).toBe(400)
    // authentication first: a bad query without a session is a 401, not a 400
    const anonymous = await client(ctx).get('/api/brief?weekStart=soon')
    expect(anonymous.status).toBe(401)
  })

  test('serves nothing of another runner’s', async () => {
    const r = await updated(email())
    const other = await seedUser(ctx, { email: email() })
    const c = client(ctx, other)
    const res = await c.get(`/api/brief?weekStart=${monday}`)
    expect(res.body).toEqual({ brief: null })
    expect((await c.get('/api/briefs')).body).toEqual({ briefs: [] })
    expect((await c.post(`/api/briefs/${monday}/seen`)).status).toBe(404)
    expect((await client(ctx, r.u).get('/api/briefs')).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------------------------

describe('GET /api/briefs', () => {
  test('lists the newest briefs slim: decision, changes, undone, the next key session', async () => {
    const r = await updated(email())
    const res = await r.c.get('/api/briefs')
    expect(res.status).toBe(200)
    const [item, ...rest] = (res.body as { briefs: BriefListItem[] }).briefs
    expect(rest).toEqual([])
    expect(item).toMatchObject({
      weekStart: monday,
      provisional: false,
      seen: false,
      replan: null,
      undone: false,
      nextKey: { date: anyString, kind: anyString },
    })
    expect(item!.changeCount).toBeGreaterThan(0)
    expect(['progress', 'hold', 'reduce', 'post-race']).toContain(item!.decision)
    // slim: none of the facts, none of the revision
    expect(Object.keys(item!).sort()).toEqual(
      [
        'changeCount',
        'decision',
        'generatedAt',
        'nextKey',
        'provisional',
        'replan',
        'seen',
        'undone',
        'weekStart',
      ].sort(),
    )
  })

  test('reads the revision’s state: undone after an undo, seen once stamped', async () => {
    const r = await updated(email())
    await ctx.prisma.planRevision.update({
      where: { id: r.revisionId },
      data: { undoneAt: new Date() },
    })
    const item = ((await r.c.get('/api/briefs')).body as { briefs: BriefListItem[] }).briefs[0]!
    expect(item.undone).toBe(true)
    await ctx.prisma.planRevision.update({
      where: { id: r.revisionId },
      data: { seenAt: new Date() },
    })
    const after = ((await r.c.get('/api/briefs')).body as { briefs: BriefListItem[] }).briefs[0]!
    expect(after.seen).toBe(true)
  })

  test('orders newest first and takes a limit from 1 to 52', async () => {
    const r = await updated(email())
    const facts = (await briefOf(r.u.id))!.facts
    for (let w = 1; w <= 3; w++) {
      await ctx.prisma.weeklyBrief.create({
        data: {
          userId: r.u.id,
          weekStart: addDays(monday, -7 * w),
          planId: r.plan.id,
          version: BRIEF_VERSION,
          facts,
        },
      })
    }
    const weeks = async (query: string) =>
      ((await r.c.get(`/api/briefs${query}`)).body as { briefs: BriefListItem[] }).briefs.map(
        (b) => b.weekStart,
      )
    expect(await weeks('')).toEqual([monday, ...[1, 2, 3].map((w) => addDays(monday, -7 * w))])
    expect(await weeks('?limit=2')).toEqual([monday, lastMonday])
    for (const bad of ['?limit=0', '?limit=53', '?limit=x', '?week=1']) {
      expect((await r.c.get(`/api/briefs${bad}`)).status, bad).toBe(400)
    }
    expect((await r.c.get('/api/briefs?limit=52')).status).toBe(200)
  })

  test('leaves out a row that cannot be read', async () => {
    const r = await updated(email())
    await ctx.prisma.weeklyBrief.create({
      data: { userId: r.u.id, weekStart: lastMonday, version: 99, facts: 'not json' },
    })
    const rows = ((await r.c.get('/api/briefs')).body as { briefs: BriefListItem[] }).briefs
    expect(rows.map((b) => b.weekStart)).toEqual([monday])
    expect(await getBrief(r, `?weekStart=${lastMonday}`)).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------

describe('POST /api/briefs/:weekStart/seen', () => {
  test('stamps the revision the brief describes, and the revisions listed since, once', async () => {
    const r = await updated(email())
    const anchor = (
      await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: r.revisionId } })
    ).createdAt
    const later = await ctx.prisma.planRevision.create({
      data: {
        planId: r.plan.id,
        reason: 'disruption',
        summary: 'A rest window.',
        auto: true,
        createdAt: new Date(anchor.getTime() + 60_000),
      },
    })
    expect((await getBrief(r))!.seen).toBe(false)

    const first = await r.c.post(`/api/briefs/${monday}/seen`)
    expect(first.status).toBe(204)
    const stamped = await ctx.prisma.planRevision.findMany({
      where: { id: { in: [r.revisionId, later.id] } },
    })
    for (const revision of stamped) expect(revision.seenAt, revision.id).not.toBeNull()
    expect((await getBrief(r))!.seen).toBe(true)

    // again: nothing to stamp, so nothing is written and the data version stays
    const version = await dataVersionKey(ctx.prisma)
    const stampedAt = stamped.map((revision) => revision.seenAt!.getTime())
    const second = await r.c.post(`/api/briefs/${monday}/seen`)
    expect(second.status).toBe(204)
    expect((await dataVersionKey(ctx.prisma)).key).toBe(version.key)
    const again = await ctx.prisma.planRevision.findMany({
      where: { id: { in: [r.revisionId, later.id] } },
    })
    expect(again.map((revision) => revision.seenAt!.getTime())).toEqual(stampedAt)
  })

  test('has nothing to stamp for a brief that describes no revision, and answers 204', async () => {
    const r = await runner(email())
    await getBrief(r)
    expect((await r.c.post(`/api/briefs/${monday}/seen`)).status).toBe(204)
  })

  test('answers 404 for a week without a brief, 400 for a bad week', async () => {
    const r = await runner(email())
    expect((await r.c.post(`/api/briefs/${lastMonday}/seen`)).status).toBe(404)
    expect((await r.c.post('/api/briefs/yesterday/seen')).status).toBe(400)
    expect((await client(ctx).post(`/api/briefs/${monday}/seen`)).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------------

describe('the table', () => {
  test('is not state: writing a brief leaves the data version unchanged', async () => {
    const r = await runner(email())
    const before = await dataVersionKey(ctx.prisma)
    // a request that builds the brief
    expect((await getBrief(r))!.provisional).toBe(true)
    // and the job's own write, called alone
    await generateBrief(deps, { userId: r.u.id, today: monday, failure: new Error('x') })
    expect(await briefOf(r.u.id)).toMatchObject({ provisional: false })
    const after = await dataVersionKey(ctx.prisma)
    expect(after.key).toBe(before.key)
  })

  test('goes with its runner and leaves the revision’s link empty when the revision goes', async () => {
    const r = await updated(email())
    await ctx.prisma.planRevision.delete({ where: { id: r.revisionId } })
    expect(await briefOf(r.u.id)).toMatchObject({ revisionId: null })
    const brief = (await getBrief(r))!
    expect(brief.revision).toBeNull()
    expect(brief.seen).toBe(true)
    // the changes the brief kept are still its own
    expect(brief.facts.changes!.count).toBeGreaterThan(0)
    await ctx.prisma.user.delete({ where: { id: r.u.id } })
    expect(await ctx.prisma.weeklyBrief.count({ where: { userId: r.u.id } })).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------

describe('GET /api/explain?subject=brief', () => {
  async function withNotice(label: string) {
    const r = await runner(label)
    // pain on a check-in of last week, so the brief has a fact to explain
    await ctx.prisma.wellnessDay.create({
      data: { userId: r.u.id, date: addDays(lastMonday, 2), painScore: 5, source: 'manual' },
    })
    await closeADay(r)
    await runReplanJob(deps, { now: MONDAY_NOON })
    return r
  }

  test('answers from the figures stored with the brief, grouped by rule, and they stay put', async () => {
    const r = await withNotice(email())
    const res = await r.c.get(`/api/explain?subject=brief&weekStart=${monday}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const view = res.body as ExplainView
    expect(view).toMatchObject({ subject: 'brief', frozen: true, rest: [] })
    expect(view.rules).toContain('n-2')
    const group = view.groups.find((g) => g.rule === 'n-2')!
    expect(group.facts[0]).toMatchObject({
      template: 'brief.noticed-pain',
      state: 'used',
      sources: [{ kind: 'check-in', date: addDays(lastMonday, 2) }],
    })
    // the check-in goes; the brief still says what it said when it was written
    await ctx.prisma.wellnessDay.deleteMany({ where: { userId: r.u.id } })
    const again = await r.c.get(`/api/explain?subject=brief&weekStart=${monday}`)
    expect(again.body).toEqual(res.body)
  })

  test('answers 404 for a week without a brief and for another runner’s', async () => {
    const r = await withNotice(email())
    const none = await r.c.get(`/api/explain?subject=brief&weekStart=${lastMonday}`)
    expect(none.status).toBe(404)
    expect(none.body).toMatchObject({ error: { code: 'not_found' } })
    const other = await seedUser(ctx, { email: email() })
    expect(
      (await client(ctx, other).get(`/api/explain?subject=brief&weekStart=${monday}`)).status,
    ).toBe(404)
    expect((await r.c.get('/api/explain?subject=brief')).status).toBe(400)
  })
})
