import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { Deps } from '../../server/app.ts'
import { replanActivePlan } from '../../server/services/planEngine.ts'
import type {
  PlanDiff,
  PlanRevisionView,
  PlanWithSessions,
  TodayView,
  UndoResult,
} from '../../shared/types.ts'
import { weekHash, type UndoPayload } from '../../server/services/replan.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// A week target the runner raised by hand at a re-plan (load-progression proposal 4.8, cases H22
// to H25; ADR 0007): kept within the limit of the week, lowered to it above, named in the diff and
// the summary, and restored as it was by an undo. A Monday, as the weekly job's re-plan is. Only
// Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
const MONDAY = new Date(2026, 9, 19, 12)
vi.setSystemTime(MONDAY)

const today = todayIso()
const thisMonday = mondayOf(today)
const nextMonday = addDays(thisMonday, 7)
const raceWeekMonday = addDays(thisMonday, 7 * 3)
const afterRaceMonday = addDays(thisMonday, 7 * 4)
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(() => {
  vi.setSystemTime(MONDAY)
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

const deps = (): Deps => ({ prisma: ctx.prisma, config: ctx.config, fetch: ctx.fetch })

interface Fixture {
  u: TestUser
  plan: PlanWithSessions
}

/**
 * A user with twelve steady weeks of runs (190 min), a half marathon three weeks and five days
 * away and the plan the engine builds for it today: this week, a peak week, a taper week, the race
 * week and the week after the race. `injuries` is written to the profile before the plan is made.
 */
async function fourWeekPlan(email: string, injuries?: string): Promise<Fixture> {
  const u = await seedUser(ctx, { email })
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
        userId: u.id,
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
  if (injuries !== undefined) {
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: u.id },
      create: { userId: u.id, injuries },
      update: { injuries },
    })
  }
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
  return { u, plan: res.body as PlanWithSessions }
}

/** Closes the weekday of the first easy run of next week, so the next re-plan has to move runs. */
async function closeBusyDay(f: Fixture): Promise<void> {
  const easy = f.plan.sessions.find((s) => s.weekStart === nextMonday && s.kind === 'easy')!
  const weekday = WEEKDAYS[(new Date(`${easy.date}T00:00:00Z`).getUTCDay() + 6) % 7]!
  const availability = JSON.stringify({ [weekday]: { available: false, maxMin: null } })
  await ctx.prisma.athleteProfile.upsert({
    where: { userId: f.u.id },
    create: { userId: f.u.id, availability },
    update: { availability },
  })
}

const weekRow = (f: Fixture, weekStart: string) =>
  ctx.prisma.planWeek.findFirstOrThrow({ where: { planId: f.plan.id, weekStart } })

/** The running minutes of a week's stored sessions. */
async function plannedMinutes(f: Fixture, weekStart: string): Promise<number> {
  const rows = await ctx.prisma.planSession.findMany({ where: { planId: f.plan.id, weekStart } })
  return rows
    .filter((r) => !['strength', 'mobility', 'rest', 'cross', 'race', 'hike'].includes(r.kind))
    .reduce((sum, r) => sum + r.durationMin, 0)
}

/** The runner sets the target of a week by hand, through the route that is unchanged. */
async function raise(f: Fixture, weekStart: string, targetRunMin: number): Promise<void> {
  const res = await client(ctx, f.u)
    .put(`/api/plan/weeks/${weekStart}`)
    .send({ targetRunMin, overrideNote: 'Synthetic note.' })
  expect(res.status, JSON.stringify(res.body)).toBe(200)
}

const weekly = (f: Fixture): Promise<PlanRevisionView> =>
  replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: thisMonday })

const list = async (f: Fixture): Promise<PlanRevisionView[]> =>
  (await client(ctx, f.u).get('/api/plan/revisions?include=empty')).body as PlanRevisionView[]

describe('H22: a target raised within the limit', () => {
  test('stays at the re-plan, and the revision names it with the plan’s own figure', async () => {
    const f = await fourWeekPlan('raised-kept@example.com')
    await closeBusyDay(f)
    const engine = (await weekRow(f, nextMonday)).baselineRunMin
    expect(engine).toBe(209)
    await raise(f, nextMonday, 230)

    const made = await weekly(f)

    // The row is the runner's, the baseline is the plan's own figure, the note is kept.
    expect(await weekRow(f, nextMonday)).toMatchObject({
      targetRunMin: 230,
      baselineRunMin: engine,
      targetSource: 'override',
      overrideNote: 'Synthetic note.',
    })
    // The sessions are the plan's: the week adds none and none grows to the raised target.
    expect(await plannedMinutes(f, nextMonday)).toBeLessThanOrEqual(engine)
    // The diff names the week, kept, with the figures and the limit that applied.
    expect(made.diff?.targets).toEqual([
      {
        weekStart: nextMonday,
        outcome: 'kept',
        askedMin: 230,
        keptMin: 230,
        engineMin: engine,
        limit: 'ceiling',
        bound: 'limit',
        ramp: 0.3,
      },
    ])
    // The re-plan did other work (a busy day closed), so this revision is one the list shows.
    expect(made.diff?.empty).toBe(false)
    expect(made.summary).toContain(
      "Week of Mon 26 Oct: the target set by hand, 230 min, stays; the plan's own figure would be 209 min.",
    )
    assertCleanCopy(made.summary, 'revision summary')
    const served = (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    const shown = served.find((revision) => revision.id === made.id)
    expect(shown?.diff?.targets).toEqual(made.diff?.targets)
    expect(shown?.summary).toBe(made.summary)
    // A raised target caps nothing: the sessions of its week moved for the closed day, and the
    // revision does not say that the runner's target made them.
    const lines = shown!.diff!.sessions.filter((line) => line.weekStart === nextMonday)
    expect(lines.length).toBeGreaterThan(0)
    for (const line of lines) {
      expect(shown!.causes!.sessions[line.externalId], line.externalId).not.toContain(
        'owner-target-kept',
      )
    }
  })

  test('is not a write of its own: a re-plan that changes nothing else is an empty revision', async () => {
    const f = await fourWeekPlan('raised-kept-empty@example.com')
    await raise(f, nextMonday, 230)
    const before = await weekRow(f, nextMonday)

    const made = await weekly(f)

    expect(made.diff?.empty).toBe(true)
    expect(made.diff?.weeks).toEqual([])
    expect(made.diff?.targets).toHaveLength(1)
    expect(made.undo.available).toBe(false)
    // The list hides it unless asked, as it hides any revision that wrote nothing.
    const shown = (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(shown.map((r) => r.id)).not.toContain(made.id)
    expect((await list(f)).map((r) => r.id)).toContain(made.id)
    expect(await weekRow(f, nextMonday)).toEqual(before)
  })

  test('the weeks after it are planned by the ordinary rules and pass the checklist', async () => {
    const f = await fourWeekPlan('raised-later@example.com')
    const without = await fourWeekPlan('raised-later-control@example.com')
    await raise(f, nextMonday, 247)
    const made = await weekly(f)
    await weekly(without)
    expect(made.diff?.targets?.[0]).toMatchObject({ outcome: 'kept', keptMin: 247 })

    // The plan was accepted by the checklist (a failing draft is refused with a 422), and the weeks
    // after the kept week are the plan's own, as without the raise.
    const stored = await ctx.prisma.planWeek.findMany({
      where: { planId: f.plan.id, weekStart: { gt: nextMonday } },
      orderBy: { weekStart: 'asc' },
    })
    const control = await ctx.prisma.planWeek.findMany({
      where: { planId: without.plan.id, weekStart: { gt: nextMonday } },
      orderBy: { weekStart: 'asc' },
    })
    expect(stored.map((w) => w.targetRunMin)).toEqual(control.map((w) => w.targetRunMin))
    const checklist = JSON.parse(
      (await ctx.prisma.plan.findUniqueOrThrow({ where: { id: f.plan.id } })).checklist,
    ) as Array<{ ok: boolean }>
    expect(checklist.every((item) => item.ok)).toBe(true)
  })
})

describe('H23: a target raised past the limit', () => {
  test('is lowered to the limit, which the diff and the summary name', async () => {
    const f = await fourWeekPlan('raised-clipped@example.com')
    await raise(f, nextMonday, 400)

    const made = await weekly(f)

    // 30% over the 190 minutes of two weeks before.
    expect(await weekRow(f, nextMonday)).toMatchObject({
      targetRunMin: 247,
      baselineRunMin: 209,
      targetSource: 'override',
      overrideNote: 'Synthetic note.',
    })
    expect(made.diff?.targets).toEqual([
      {
        weekStart: nextMonday,
        outcome: 'clipped',
        askedMin: 400,
        keptMin: 247,
        engineMin: 209,
        limit: 'ceiling',
        bound: 'limit',
        ramp: 0.3,
      },
    ])
    // The week is a row written: the diff has its line, from the runner's number to the limit.
    expect(made.diff?.weeks).toEqual([
      expect.objectContaining({ weekStart: nextMonday, runMinBefore: 400, runMinAfter: 247 }),
    ])
    expect(made.diff?.empty).toBe(false)
    expect(made.summary).toContain(
      'Week of Mon 26 Oct: the target set by hand, 400 min, is lowered to 247 min, the most the limits allow that week (growth over two weeks stays within 30%).',
    )
    assertCleanCopy(made.summary, 'revision summary')
  })

  test('is restored as the runner set it by an undo, from the rows written', async () => {
    const f = await fourWeekPlan('raised-undo@example.com')
    await raise(f, nextMonday, 400)
    const before = await weekRow(f, nextMonday)
    const made = await weekly(f)
    expect(made.undo.available).toBe(true)

    // The payload holds the column the write changed, as it was, and the hash of the row written.
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: made.id } })
    const payload = JSON.parse(stored.undo!) as UndoPayload
    expect(payload.weeks.updated).toEqual([
      {
        id: before.id,
        before: { targetRunMin: 400 },
        hash: weekHash(await weekRow(f, nextMonday)),
      },
    ])
    expect((JSON.parse(stored.diff!) as PlanDiff).targets).toHaveLength(1)

    const undone = await client(ctx, f.u).post(`/api/plan/revisions/${made.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect((undone.body as UndoResult).revision.reason).toBe('undo')
    const after = await weekRow(f, nextMonday)
    expect(after).toMatchObject({
      targetRunMin: 400,
      targetSource: 'override',
      overrideNote: 'Synthetic note.',
      baselineRunMin: before.baselineRunMin,
    })
  })

  test('is lowered again at the next re-plan, and the second revision says so too', async () => {
    const f = await fourWeekPlan('raised-clipped-twice@example.com')
    await raise(f, nextMonday, 400)
    await weekly(f)
    // The row now holds 247, the limit; the runner's raise is the number the row keeps.
    const again = await weekly(f)
    expect(again.diff?.targets).toEqual([
      expect.objectContaining({ outcome: 'kept', askedMin: 247, keptMin: 247 }),
    ])
    expect(again.diff?.empty).toBe(true)
  })

  test('is lowered to the plan’s own figure when that is above the ceiling, and the sentence says so', async () => {
    const f = await fourWeekPlan('raised-logged@example.com')
    // 260 minutes run today, 13 above the 247 that two weeks of 190 allow: the week's own figure
    // counts what has been run, so the plan's figure is 260 and no limit goes under it
    await ctx.prisma.activity.create({
      data: {
        userId: f.u.id,
        date: thisMonday,
        type: 'run',
        durationSec: 260 * 60,
        movingSec: 260 * 60,
        distanceM: 40_000,
        rpe: 3,
        source: 'manual',
      },
    })
    await raise(f, thisMonday, 400)

    const made = await weekly(f)

    expect(made.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: thisMonday,
        outcome: 'clipped',
        askedMin: 400,
        keptMin: 260,
        engineMin: 260,
        limit: 'ceiling',
        bound: 'plan',
        ramp: 0.3,
      }),
    ])
    expect(made.summary).toContain(
      "Week of Mon 19 Oct: the target set by hand, 400 min, is lowered to 260 min, the plan's own figure that week, which the limits do not go under.",
    )
    assertCleanCopy(made.summary, 'revision summary')
    // the plan's own figure is not the ramp's limit, so the week is the plan's again
    expect(await weekRow(f, thisMonday)).toMatchObject({
      targetRunMin: 260,
      targetSource: 'baseline',
      overrideNote: null,
    })
  })

  test('the route is unchanged: any whole number of minutes is accepted with a note', async () => {
    const f = await fourWeekPlan('raised-route@example.com')
    const week = await weekRow(f, nextMonday)
    const url = `/api/plan/weeks/${nextMonday}`
    const huge = await client(ctx, f.u)
      .put(url)
      .send({ targetRunMin: 1200, overrideNote: 'Synthetic note.' })
    expect(huge.status, JSON.stringify(huge.body)).toBe(200)
    expect(huge.body).toMatchObject({ targetRunMin: 1200, targetSource: 'override' })
    expect(await weekRow(f, nextMonday)).toMatchObject({
      targetRunMin: 1200,
      baselineRunMin: week.baselineRunMin,
    })
  })

  test('a regenerated plan still starts without the overrides', async () => {
    const f = await fourWeekPlan('raised-regenerate@example.com')
    await raise(f, nextMonday, 230)
    await weekly(f)
    const goal = await ctx.prisma.goal.findFirstOrThrow({ where: { userId: f.u.id } })
    const regenerated = await client(ctx, f.u).post('/api/plan/generate').send({ goalId: goal.id })
    expect(regenerated.status).toBe(201)
    const week = (regenerated.body as PlanWithSessions).weeks.find(
      (w) => w.weekStart === nextMonday,
    )
    expect(week).toMatchObject({ targetSource: 'baseline', overrideNote: null })
    expect(week?.targetRunMin).toBe(week?.baselineRunMin)
  })
})

describe('H24: a target lowered by hand', () => {
  test('stays as set and caps the week, as before, and names nothing', async () => {
    const f = await fourWeekPlan('lowered@example.com')
    await closeBusyDay(f)
    await raise(f, nextMonday, 150)

    const made = await weekly(f)

    expect(await weekRow(f, nextMonday)).toMatchObject({
      targetRunMin: 150,
      targetSource: 'override',
    })
    expect(await plannedMinutes(f, nextMonday)).toBeLessThanOrEqual(150)
    expect(made.diff?.targets).toBeUndefined()
    expect(made.summary).not.toContain('set by hand')
  })
})

describe('H25: a target raised where a rule draws the week', () => {
  test('in the week after the race it is lowered to the plan’s own figure', async () => {
    const f = await fourWeekPlan('raised-post-race@example.com')
    const engine = (await weekRow(f, afterRaceMonday)).baselineRunMin
    expect((await weekRow(f, afterRaceMonday)).flags).toContain('post-race')
    await raise(f, afterRaceMonday, engine + 80)

    const made = await weekly(f)

    // The week is the plan's again, as if never raised; the diff keeps the ask and the limit.
    expect(await weekRow(f, afterRaceMonday)).toMatchObject({
      targetRunMin: engine,
      targetSource: 'baseline',
      overrideNote: null,
    })
    expect(made.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: afterRaceMonday,
        outcome: 'clipped',
        askedMin: engine + 80,
        keptMin: engine,
        limit: 'post-race',
        bound: 'plan',
        ramp: null,
      }),
    ])
    expect(made.summary).toContain("the plan's own figure for the weeks after a race.")
    assertCleanCopy(made.summary, 'revision summary')
  })

  test('in the race week and in a taper week it is lowered to the plan’s own figure', async () => {
    const f = await fourWeekPlan('raised-structure@example.com')
    const taper = (await weekRow(f, addDays(thisMonday, 14))).baselineRunMin
    const race = (await weekRow(f, raceWeekMonday)).baselineRunMin
    await raise(f, addDays(thisMonday, 14), taper + 60)
    await raise(f, raceWeekMonday, race + 60)

    const made = await weekly(f)

    expect(made.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: addDays(thisMonday, 14),
        outcome: 'clipped',
        keptMin: taper,
        limit: 'structure',
      }),
      expect.objectContaining({
        weekStart: raceWeekMonday,
        outcome: 'clipped',
        keptMin: race,
        limit: 'structure',
      }),
    ])
  })

  test('in a week a rest window touches it is lowered to the plan’s own figure', async () => {
    const f = await fourWeekPlan('raised-window@example.com')
    const created = await client(ctx, f.u)
      .post('/api/plan/disruptions')
      .send({
        reason: 'travel',
        mode: 'rest',
        startDate: addDays(nextMonday, 1),
        endDate: addDays(nextMonday, 3),
      })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const held = await weekRow(f, nextMonday)
    expect(held.flags).toContain('disrupted')
    await raise(f, nextMonday, held.targetRunMin + 60)

    const made = await weekly(f)

    expect(made.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: nextMonday,
        outcome: 'clipped',
        limit: 'window',
        ramp: null,
      }),
    ])
    const after = await weekRow(f, nextMonday)
    expect(after.targetRunMin).toBe(made.diff?.targets?.[0]?.keptMin)
    expect(after.targetRunMin).toBeLessThan(held.targetRunMin + 60)
    expect(made.summary).toContain("the plan's own figure for a week a rest window touches.")
    assertCleanCopy(made.summary, 'revision summary')
  })

  test('under a tightened profile it is lowered to the profile’s ramp', async () => {
    const injuries = JSON.stringify([
      { area: 'tibia', side: 'left', year: 2025, month: 4, kind: 'bone-stress', notes: null },
    ])
    const f = await fourWeekPlan('raised-profile@example.com', injuries)
    const engine = (await weekRow(f, nextMonday)).baselineRunMin
    // 5% over the 190 minutes of the week before, rounded down.
    expect(engine).toBe(199)
    await raise(f, nextMonday, 230)

    const made = await weekly(f)

    expect(await weekRow(f, nextMonday)).toMatchObject({ targetRunMin: 199 })
    expect(made.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: nextMonday,
        outcome: 'clipped',
        askedMin: 230,
        keptMin: 199,
        limit: 'profile',
        ramp: 0.05,
      }),
    ])
    expect(made.summary).toContain(
      'the most the tightened weekly step allows that week (5% a week).',
    )
    assertCleanCopy(made.summary, 'revision summary')
  })

  test('under a progression hold it is lowered to the plan’s own figure', async () => {
    const f = await fourWeekPlan('raised-hold@example.com')
    await raise(f, nextMonday, 230)
    // Two signs on the energy-availability screening hold progression [rules n-4, J5].
    const screened = await client(ctx, f.u)
      .post('/api/screenings')
      .send({ answers: { a: true, b: true } })
    expect(screened.status).toBe(201)

    const made = await weekly(f)

    expect(made.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: nextMonday,
        outcome: 'clipped',
        askedMin: 230,
        limit: 'hold',
        ramp: null,
      }),
    ])
    const after = await weekRow(f, nextMonday)
    expect(after.targetRunMin).toBe(after.baselineRunMin)
    expect(made.summary).toContain("the plan's own figure while progression is on hold.")
    assertCleanCopy(made.summary, 'revision summary')
  })
})

describe('a week the plan takes back is the plan’s again', () => {
  /** Two signs on the screening hold progression; a later screening without signs ends the hold. */
  const screen = (f: Fixture, date: string, signs: boolean) =>
    client(ctx, f.u)
      .post('/api/screenings')
      .send({ date, answers: { a: signs, b: signs } })
      .expect(201)

  test('is free again at the next re-plan once the hold has passed', async () => {
    const f = await fourWeekPlan('raised-released@example.com')
    const free = await weekRow(f, nextMonday)
    await raise(f, nextMonday, 230)
    await screen(f, addDays(today, -1), true)

    const held = await weekly(f)

    // The hold lowers the ask to the plan's own figure, and the week is the plan's, not a cap.
    const heldRow = await weekRow(f, nextMonday)
    expect(held.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: nextMonday,
        outcome: 'clipped',
        askedMin: 230,
        keptMin: heldRow.targetRunMin,
        limit: 'hold',
        bound: 'plan',
      }),
    ])
    expect(heldRow).toMatchObject({ targetSource: 'baseline', overrideNote: null })
    expect(heldRow.targetRunMin).toBe(heldRow.baselineRunMin)
    expect(heldRow.targetRunMin).toBeLessThan(free.baselineRunMin)

    // The hold passes: the next re-plan draws the week as the plan would without the hold. A
    // figure left as an override would have capped it at the held figure.
    await screen(f, today, false)
    const after = await weekly(f)
    expect(await weekRow(f, nextMonday)).toMatchObject({
      targetRunMin: free.baselineRunMin,
      baselineRunMin: free.baselineRunMin,
      targetSource: 'baseline',
      overrideNote: null,
    })
    expect(after.diff?.targets).toBeUndefined()
  })

  test('the undo of the re-plan that took the week back restores the target as the runner set it', async () => {
    const f = await fourWeekPlan('raised-released-undo@example.com')
    const engine = (await weekRow(f, afterRaceMonday)).baselineRunMin
    await raise(f, afterRaceMonday, engine + 80)
    const made = await weekly(f)
    expect(made.undo.available).toBe(true)
    const week = await weekRow(f, afterRaceMonday)
    expect(week).toMatchObject({ targetRunMin: engine, targetSource: 'baseline' })

    // The payload holds the three columns the write changed, as the runner had them.
    const stored = await ctx.prisma.planRevision.findUniqueOrThrow({ where: { id: made.id } })
    const payload = JSON.parse(stored.undo!) as UndoPayload
    expect(payload.weeks.updated.find((entry) => entry.id === week.id)?.before).toEqual({
      targetRunMin: engine + 80,
      targetSource: 'override',
      overrideNote: 'Synthetic note.',
    })

    const undone = await client(ctx, f.u).post(`/api/plan/revisions/${made.id}/undo`).send({})
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(await weekRow(f, afterRaceMonday)).toMatchObject({
      targetRunMin: engine + 80,
      targetSource: 'override',
      overrideNote: 'Synthetic note.',
    })
  })
})

describe('the weekly decision wins over a raised target', () => {
  /** A week of the plan run at half its minutes, then the Monday re-plan that reviews it. */
  async function reviewedHalfWeek(f: Fixture, target: number): Promise<PlanRevisionView> {
    for (const s of f.plan.sessions.filter((x) => x.weekStart === thisMonday)) {
      if (['strength', 'mobility', 'rest'].includes(s.kind)) continue
      await ctx.prisma.activity.create({
        data: {
          userId: f.u.id,
          date: s.date,
          type: 'run',
          durationSec: Math.round(s.durationMin * 60 * 0.5),
          movingSec: Math.round(s.durationMin * 60 * 0.5),
          distanceM: 8000,
          rpe: 3,
          source: 'manual',
        },
      })
    }
    vi.setSystemTime(new Date(2026, 9, 26, 12))
    await raise(f, nextMonday, target)
    return replanActivePlan(deps(), { userId: f.u.id, reason: 'weekly', today: nextMonday })
  }

  test('a hold caps the week it names, and a higher target is lowered to that cap', async () => {
    const f = await fourWeekPlan('raised-decision@example.com')

    const made = await reviewedHalfWeek(f, 230)

    // 95 of 190 planned minutes were run, so the decision holds and caps this week at 104.
    expect(made.decision).toMatchObject({ decision: 'hold', nextWeekTargetMin: 104 })
    expect(made.diff?.targets).toEqual([
      expect.objectContaining({
        weekStart: nextMonday,
        outcome: 'clipped',
        askedMin: 230,
        keptMin: 104,
        engineMin: 104,
        limit: 'decision',
        ramp: null,
      }),
    ])
    expect(await weekRow(f, nextMonday)).toMatchObject({ targetRunMin: 104 })
    expect(made.summary).toContain("the plan's own figure after last week's decision.")
    assertCleanCopy(made.summary, 'revision summary')
  })

  test('a target under the cap stays and caps the week, as before', async () => {
    const f = await fourWeekPlan('raised-decision-lower@example.com')

    const made = await reviewedHalfWeek(f, 90)

    expect(made.decision).toMatchObject({ decision: 'hold', nextWeekTargetMin: 104 })
    expect(made.diff?.targets).toBeUndefined()
    expect(await weekRow(f, nextMonday)).toMatchObject({
      targetRunMin: 90,
      targetSource: 'override',
    })
    expect(await plannedMinutes(f, nextMonday)).toBeLessThanOrEqual(90)
  })
})

// A loading week run past its planned minutes is taken as run (rules g-2, g-6): the engine stores
// the minutes run as the target and keeps the plan in the flags. The payloads state the plan, and
// the summary and the diff word the week as run past it instead of a target that rose.
describe('a week run past its plan', () => {
  const friday = addDays(thisMonday, 4)

  /**
   * The current week run past its planned minutes: the sessions up to Thursday run as planned and
   * linked, the Saturday long run taken on Thursday and a 60-minute run on Friday, then the re-plan
   * of Friday that takes the week as run (190 planned, 250 run).
   */
  async function runPastPlan(email: string) {
    const f = await fourWeekPlan(email)
    const planned = (await weekRow(f, thisMonday)).targetRunMin
    const log = (date: string, min: number) =>
      ctx.prisma.activity.create({
        data: {
          userId: f.u.id,
          date,
          type: 'run',
          durationSec: min * 60,
          movingSec: min * 60,
          distanceM: min * 160,
          rpe: 3,
          source: 'manual',
        },
      })
    const thisWeek = f.plan.sessions.filter((s) => s.weekStart === thisMonday)
    for (const session of thisWeek.filter((s) => s.date < friday && s.kind !== 'strength')) {
      if (session.kind === 'long') continue
      const run = await log(session.date, session.durationMin)
      await ctx.prisma.planSession.update({
        where: { id: session.id },
        data: { status: 'completed', activityId: run.id },
      })
    }
    const long = thisWeek.find((s) => s.kind === 'long')!
    await log(addDays(thisMonday, 3), long.durationMin)
    await log(friday, 60)
    const ran = 250
    vi.setSystemTime(new Date(2026, 9, 23, 12))
    const made = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'owner',
      today: friday,
    })
    return { f, planned, ran, made }
  }

  test('the stored target is the minutes run, and the payload states what was planned', async () => {
    const { f, planned, ran } = await runPastPlan('overshoot-payload@example.com')

    // The engine writes the minutes run as the target and keeps the plan in the flags.
    const row = await weekRow(f, thisMonday)
    expect(row.targetRunMin).toBe(ran)
    expect(JSON.parse(row.flags) as string[]).toEqual(
      expect.arrayContaining(['overshoot', `planned-${String(planned)}`]),
    )

    const res = await client(ctx, f.u).get('/api/plan')
    expect(res.status).toBe(200)
    const weeks = (res.body as PlanWithSessions).weeks
    expect(weeks.find((w) => w.weekStart === thisMonday)).toMatchObject({
      targetRunMin: ran,
      plannedRunMin: planned,
      overshoot: true,
    })
    // Any other week states its target as the plan.
    for (const week of weeks.filter((w) => w.weekStart !== thisMonday)) {
      expect(week.overshoot).toBe(false)
      expect(week.plannedRunMin).toBe(week.targetRunMin)
    }
  })

  test('Today draws the week against the planned minutes', async () => {
    const { f, planned, ran } = await runPastPlan('overshoot-today@example.com')

    const res = await client(ctx, f.u).get(`/api/today?date=${friday}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const strip = (res.body as TodayView).coach.weekStrip
    expect(strip).toMatchObject({ weekStart: thisMonday, runMin: ran, overshoot: true })
    expect(strip?.targetRunMin).toBe(planned)
    expect(strip?.remaining?.remainingMin).toBe(0)
  })

  test('the summary and the diff word the week as run past its plan', async () => {
    const { f, planned, ran, made } = await runPastPlan('overshoot-revision@example.com')

    const sentence = `Week of Mon 19 Oct was run past its plan: ${String(ran)} min against ${String(planned)} min; the weeks after it are drawn from the plan.`
    expect(made.summary).toContain(sentence)
    assertCleanCopy(made.summary, 'revision summary')

    // The diff records what it always did: the minutes before and after, and the flags added.
    const line = made.diff?.weeks.find((week) => week.weekStart === thisMonday)
    expect(line).toMatchObject({ runMinBefore: planned, runMinAfter: ran })
    expect(line?.flagsAdded).toEqual(
      expect.arrayContaining(['overshoot', `planned-${String(planned)}`]),
    )
    const served = (await client(ctx, f.u).get('/api/plan/revisions')).body as PlanRevisionView[]
    expect(served.find((revision) => revision.id === made.id)?.summary).toContain(sentence)

    // A second re-plan the same day takes nothing new as run, so it adds no sentence.
    const again = await replanActivePlan(deps(), {
      userId: f.u.id,
      reason: 'owner',
      today: friday,
    })
    expect(again.summary).not.toContain('was run past its plan')
  })

  test('saving a target on the week follows the rules of any week, against the stored baseline', async () => {
    const { f, planned, ran } = await runPastPlan('overshoot-save@example.com')
    const url = `/api/plan/weeks/${thisMonday}`
    const row = await weekRow(f, thisMonday)
    // The engine wrote the minutes run as the target and as the baseline.
    expect(row).toMatchObject({ targetRunMin: ran, baselineRunMin: ran, targetSource: 'baseline' })

    // The planned figure is not the baseline, so a target at the plan needs a note like any other.
    const bare = await client(ctx, f.u).put(url).send({ targetRunMin: planned })
    expect(bare.status).toBe(400)
    expect(JSON.stringify(bare.body)).toContain('overrideNote')

    // With a note it is an override. The response states the plan, and `plannedMinOf` takes the
    // lower of the plan and the stored target, so a target above the plan leaves the plan as it was.
    const above = await client(ctx, f.u)
      .put(url)
      .send({ targetRunMin: planned + 20, overrideNote: 'Synthetic note.' })
    expect(above.status, JSON.stringify(above.body)).toBe(200)
    expect(above.body).toMatchObject({
      targetRunMin: planned + 20,
      targetSource: 'override',
      plannedRunMin: planned,
      overshoot: true,
    })

    // A target below the plan is the new plan figure of the week.
    const below = await client(ctx, f.u)
      .put(url)
      .send({ targetRunMin: planned - 30, overrideNote: 'Synthetic note.' })
    expect(below.body).toMatchObject({ plannedRunMin: planned - 30, overshoot: true })

    // The stored baseline resets the week: the minutes run again, still stating the plan.
    const reset = await client(ctx, f.u).put(url).send({ targetRunMin: ran })
    expect(reset.status, JSON.stringify(reset.body)).toBe(200)
    expect(reset.body).toMatchObject({
      targetRunMin: ran,
      targetSource: 'baseline',
      plannedRunMin: planned,
      overshoot: true,
    })
  })
})
