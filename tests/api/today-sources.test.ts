// The Today notes about a source that delivers runs (rule J10, task J10): one for a connection that
// needs signing in again, one for a connected source that has stored no run for days while the plan
// asked for runs. `Integration` is outside the data version, so the tag is tested too.
import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { HealthNote, TodayView } from '../../shared/types.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// A Wednesday at noon. Only Date is faked; timers and promises keep working.
const NOON = new Date(2026, 9, 21, 12)
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(NOON)

const today = todayIso()
const daysAgo = (n: number) => addDays(today, -n)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(async () => {
  vi.setSystemTime(NOON)
  // Each test seeds its own runner; the rows of a runner go with it.
  await ctx.prisma.user.deleteMany()
  expectNoRefusedFetches(ctx)
})

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})

/** A runner whose stored plan holds an easy run on each of `runDates`, and nothing else. */
async function runnerPlanning(email: string, runDates: string[]): Promise<TestUser> {
  const u = await seedUser(ctx, { email })
  await ctx.prisma.athleteProfile.create({
    data: { userId: u.id, hrMax: 190, hrRest: 50, timezone: 'UTC' },
  })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic race',
      priority: 'A',
      targetDate: addDays(today, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const weekStarts = [...new Set([mondayOf(today), ...runDates.map(mondayOf)])].sort()
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: addDays(mondayOf(today), -7 * 12),
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: weekStarts.map((weekStart, index) => ({
          weekStart,
          index,
          phase: 'build',
          baselineRunMin: 200,
          targetRunMin: 200,
          longRunMin: 70,
          runDays: 4,
          strengthSessions: 0,
        })),
      },
    },
  })
  for (const [order, date] of runDates.entries()) {
    await ctx.prisma.planSession.create({
      data: {
        planId: plan.id,
        externalId: randomUUID(),
        weekStart: mondayOf(date),
        date,
        order,
        kind: 'easy',
        title: 'Easy run',
        durationMin: 40,
        structure: '[]',
        target: TARGET,
        purpose: 'Synthetic.',
        flags: '[]',
        status: 'planned',
      },
    })
  }
  return u
}

/** The connection of a source; the secret and config are never read by the note. */
async function connect(
  u: TestUser,
  provider: string,
  over: { status?: string; pausedUntil?: Date | null; createdAt?: Date } = {},
) {
  return ctx.prisma.integration.create({
    data: {
      userId: u.id,
      provider,
      status: over.status ?? 'connected',
      secret: '',
      config: '{}',
      pausedUntil: over.pausedUntil ?? null,
      ...(over.createdAt === undefined ? {} : { createdAt: over.createdAt }),
    },
  })
}

/**
 * The `Activity.source` of what the watched folder stores (`ingest` in `server/services/folder.ts`):
 * `file`, not the provider key `folder`, which only the `ImportBatch` of a scan carries.
 */
const FOLDER_STORES = 'file'

/** A stored activity that a source delivered. */
async function delivered(u: TestUser, source: string, date: string, type = 'run') {
  return ctx.prisma.activity.create({
    data: { userId: u.id, date, type, durationSec: 40 * 60, distanceM: 7000, source },
  })
}

const tagOf = (res: { headers: Record<string, unknown> }) => String(res.headers.etag)
const notesOf = (res: { body: unknown }) => (res.body as TodayView).coach.health.notes
const sourceNotes = (notes: HealthNote[]) => notes.filter((note) => note.code.startsWith('source-'))

function getToday(u: TestUser, query = '') {
  return client(ctx, u).get(`/api/today${query}`)
}

async function sourceNotesFor(u: TestUser, query = ''): Promise<HealthNote[]> {
  const res = await getToday(u, query)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return sourceNotes(notesOf(res))
}

// ---------------------------------------------------------------------------------------------
// A connection that needs signing in again
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: a source that needs signing in', () => {
  test('is named at once, with the source label, and leads to the integrations page', async () => {
    const u = await seedUser(ctx, { email: 'sources-auth@example.com' })
    await connect(u, 'strava', { status: 'needs_auth' })
    const notes = await sourceNotesFor(u)
    expect(notes).toEqual([
      {
        code: 'source-needs-auth',
        template: 'today.health.source-needs-auth',
        slots: { source: 'Strava' },
        href: '/integrations',
      },
    ])
    const sentence = renderFact(notes[0]!, 'mi')
    expect(sentence).toBe('Strava needs signing in again; runs since then have not arrived.')
    assertCleanCopy(sentence, 'source-needs-auth')
  })

  test('needs no plan and no silence: a runner who ran yesterday is told as well', async () => {
    const u = await seedUser(ctx, { email: 'sources-auth-recent@example.com' })
    await connect(u, 'garmin', { status: 'needs_auth' })
    await delivered(u, 'garmin', daysAgo(1))
    expect((await sourceNotesFor(u)).map((note) => note.code)).toEqual(['source-needs-auth'])
  })

  test('is not made for a connection in error, which the integrations page shows', async () => {
    const u = await seedUser(ctx, { email: 'sources-error@example.com' })
    await connect(u, 'strava', { status: 'error' })
    expect(await sourceNotesFor(u)).toEqual([])
  })
})

// ---------------------------------------------------------------------------------------------
// A connected source that has stored no run
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: a silent source', () => {
  test('is named with the day of its last run when the plan asked for two runs since', async () => {
    const u = await runnerPlanning('sources-silent@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(5))
    const notes = await sourceNotesFor(u)
    expect(notes).toEqual([
      {
        code: 'source-silent',
        template: 'today.health.source-silent',
        slots: { source: 'Strava', since: { kind: 'date', iso: daysAgo(5), style: 'short' } },
        href: '/integrations',
      },
    ])
    const sentence = renderFact(notes[0]!, 'mi')
    expect(sentence).toBe(
      'No run has arrived from Strava since 16 Oct. If you ran, check the upload; if you did not, nothing is needed.',
    )
    assertCleanCopy(sentence, 'source-silent')
  })

  test('uses the Param: 4 days of quiet is not enough, and the 5th day is', async () => {
    expect(P.j10.silentDays.value).toBe(4)
    const u = await runnerPlanning('sources-edge@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    const run = await delivered(u, 'strava', daysAgo(P.j10.silentDays.value))
    expect(await sourceNotesFor(u)).toEqual([])
    await ctx.prisma.activity.update({
      where: { id: run.id },
      data: { date: daysAgo(P.j10.silentDays.value + 1) },
    })
    expect((await sourceNotesFor(u)).map((note) => note.code)).toEqual(['source-silent'])
  })

  test('is not made when the plan asked for one run since the last run', async () => {
    const u = await runnerPlanning('sources-one-run@example.com', [daysAgo(8), daysAgo(1)])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(5))
    expect(await sourceNotesFor(u)).toEqual([])
  })

  test('counts only the runs the plan asked for after the last run, up to today', async () => {
    // One before the last run, one after it, one tomorrow: a single run in the span.
    const u = await runnerPlanning('sources-span@example.com', [
      daysAgo(6),
      daysAgo(2),
      addDays(today, 1),
    ])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(5))
    expect(await sourceNotesFor(u)).toEqual([])
  })

  test('is not made when the plan holds no run session of its own kinds', async () => {
    const u = await runnerPlanning('sources-no-plan@example.com', [])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(20))
    expect(await sourceNotesFor(u)).toEqual([])
    const noPlan = await seedUser(ctx, { email: 'sources-no-plan-at-all@example.com' })
    await connect(noPlan, 'strava')
    await delivered(noPlan, 'strava', daysAgo(20))
    expect(await sourceNotesFor(noPlan)).toEqual([])
  })

  test('is not made when the source delivered a run two days ago', async () => {
    const u = await runnerPlanning('sources-recent@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(2))
    expect(await sourceNotesFor(u)).toEqual([])
  })

  test('is not made while a rate limit pauses the source, and is once the pause is over', async () => {
    const u = await runnerPlanning('sources-paused@example.com', [daysAgo(3), daysAgo(1)])
    const row = await connect(u, 'strava', {
      pausedUntil: new Date(NOON.getTime() + 60 * 60_000),
    })
    await delivered(u, 'strava', daysAgo(6))
    expect(await sourceNotesFor(u)).toEqual([])
    await ctx.prisma.integration.update({
      where: { id: row.id },
      data: { pausedUntil: new Date(NOON.getTime() - 60 * 60_000) },
    })
    expect((await sourceNotesFor(u)).map((note) => note.code)).toEqual(['source-silent'])
  })

  test('is read per source: another source that delivered a run does not answer for it', async () => {
    const u = await runnerPlanning('sources-each@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    await connect(u, 'intervals')
    await delivered(u, 'strava', daysAgo(7))
    await delivered(u, 'intervals', daysAgo(1))
    const notes = await sourceNotesFor(u)
    expect(notes.map((note) => note.slots.source)).toEqual(['Strava'])
  })

  test('is one note per silent source, in the order of the registry', async () => {
    const u = await runnerPlanning('sources-two@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'folder')
    await connect(u, 'garmin')
    await connect(u, 'strava', { createdAt: new Date(2026, 9, 11, 12) })
    await delivered(u, 'garmin', daysAgo(9))
    await delivered(u, FOLDER_STORES, daysAgo(6))
    const notes = await sourceNotesFor(u)
    expect(notes.map((note) => [note.code, note.slots.source])).toEqual([
      ['source-silent', 'Strava'],
      ['source-silent', 'Garmin Connect'],
      ['source-silent', 'Watched folder'],
    ])
    // Strava never delivered a run, so it counts from the day it was connected.
    expect(notes[0]!.slots.since).toEqual({ kind: 'date', iso: daysAgo(10), style: 'short' })
  })

  test('reads the runs of a watched folder under the source the folder stores, file', async () => {
    const u = await runnerPlanning('sources-folder@example.com', [daysAgo(3), daysAgo(1)])
    // Connected ten days ago: a lookup that missed the folder's runs would count from that day.
    await connect(u, 'folder', { createdAt: new Date(2026, 9, 11, 12) })
    await delivered(u, FOLDER_STORES, daysAgo(2))
    expect(await sourceNotesFor(u)).toEqual([])

    // The same folder, quiet since its last file: named, with the day of that file.
    const quiet = await runnerPlanning('sources-folder-quiet@example.com', [daysAgo(3), daysAgo(1)])
    await connect(quiet, 'folder', { createdAt: new Date(2026, 9, 11, 12) })
    await delivered(quiet, FOLDER_STORES, daysAgo(6))
    expect(await sourceNotesFor(quiet)).toEqual([
      {
        code: 'source-silent',
        template: 'today.health.source-silent',
        slots: {
          source: 'Watched folder',
          since: { kind: 'date', iso: daysAgo(6), style: 'short' },
        },
        href: '/integrations',
      },
    ])
  })

  test('counts a source that has stored no run from the day it was connected', async () => {
    const u = await runnerPlanning('sources-created@example.com', [daysAgo(4), daysAgo(2)])
    const row = await connect(u, 'strava', { createdAt: new Date(2026, 9, 15, 12) })
    const notes = await sourceNotesFor(u)
    expect(notes).toEqual([
      {
        code: 'source-silent',
        template: 'today.health.source-silent',
        slots: { source: 'Strava', since: { kind: 'date', iso: daysAgo(6), style: 'short' } },
        href: '/integrations',
      },
    ])
    // Connected two days ago, the same plan has asked for one run since: no note.
    await ctx.prisma.integration.update({
      where: { id: row.id },
      data: { createdAt: new Date(2026, 9, 19, 12) },
    })
    expect(await sourceNotesFor(u)).toEqual([])
  })

  test('counts runs and races, never strength or cross training', async () => {
    const u = await runnerPlanning('sources-types@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(6))
    await delivered(u, 'strava', daysAgo(1), 'strength')
    await delivered(u, 'strava', daysAgo(1), 'cross')
    expect((await sourceNotesFor(u)).map((note) => note.code)).toEqual(['source-silent'])
    await delivered(u, 'strava', daysAgo(1), 'race')
    expect(await sourceNotesFor(u)).toEqual([])
  })

  test('says nothing to a runner whose runs were all logged by hand, or who has no connection', async () => {
    const u = await runnerPlanning('sources-manual@example.com', [daysAgo(3), daysAgo(1)])
    await delivered(u, 'manual', daysAgo(10))
    await delivered(u, 'file', daysAgo(12))
    expect(await sourceNotesFor(u)).toEqual([])
    const none = await seedUser(ctx, { email: 'sources-none@example.com' })
    expect(await sourceNotesFor(none)).toEqual([])
  })

  test('is carried by a day-ahead preview as it stands today', async () => {
    const u = await runnerPlanning('sources-preview@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(5))
    const current = await sourceNotesFor(u)
    expect(current.map((note) => note.code)).toEqual(['source-silent'])
    expect(await sourceNotesFor(u, `?date=${addDays(today, 1)}`)).toEqual(current)
  })
})

// ---------------------------------------------------------------------------------------------
// The tag
// ---------------------------------------------------------------------------------------------

describe('GET /api/today: the tag of the source notes', () => {
  test('moves when a status flips to needs_auth with no other write, and again when it is put right', async () => {
    const u = await seedUser(ctx, { email: 'sources-tag@example.com' })
    const row = await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(1))
    const quiet = await getToday(u)
    expect(sourceNotes(notesOf(quiet))).toEqual([])
    expect((await getToday(u).set('If-None-Match', tagOf(quiet))).status).toBe(304)

    // Integration is outside the data version: only the stamp lets the flip through the tag.
    await ctx.prisma.integration.update({ where: { id: row.id }, data: { status: 'needs_auth' } })
    const flipped = await getToday(u).set('If-None-Match', tagOf(quiet))
    expect(flipped.status).toBe(200)
    expect(sourceNotes(notesOf(flipped)).map((note) => note.code)).toEqual(['source-needs-auth'])
    expect(tagOf(flipped)).not.toBe(tagOf(quiet))
    expect((await getToday(u).set('If-None-Match', tagOf(flipped))).status).toBe(304)

    await ctx.prisma.integration.update({ where: { id: row.id }, data: { status: 'connected' } })
    const mended = await getToday(u).set('If-None-Match', tagOf(flipped))
    expect(mended.status).toBe(200)
    expect(sourceNotes(notesOf(mended))).toEqual([])
  })

  test('a request holding the current tag reads the connections and no activity', async () => {
    const u = await runnerPlanning('sources-tag-reads@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(1))
    const tag = tagOf(await getToday(u))
    type Delegate = Record<string, (...args: unknown[]) => unknown>
    const activity = ctx.prisma.activity as unknown as Delegate
    const activityReads = ['findMany', 'findFirst', 'count', 'aggregate', 'groupBy'].map((method) =>
      vi.spyOn(activity, method),
    )
    const connectionReads = vi.spyOn(ctx.prisma.integration as unknown as Delegate, 'findMany')
    try {
      expect((await getToday(u).set('If-None-Match', tag)).status).toBe(304)
      expect(connectionReads).toHaveBeenCalledTimes(1)
      for (const spy of activityReads) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of [...activityReads, connectionReads]) spy.mockRestore()
    }
  })

  test('moves when a pause ends by the clock, and when the connection is removed', async () => {
    const u = await runnerPlanning('sources-tag-clock@example.com', [daysAgo(3), daysAgo(1)])
    const row = await connect(u, 'strava', {
      pausedUntil: new Date(NOON.getTime() + 30 * 60_000),
    })
    await delivered(u, 'strava', daysAgo(6))
    const paused = await getToday(u)
    expect(sourceNotes(notesOf(paused))).toEqual([])

    // Nothing is written: the pause is over, and the tag moves by itself.
    vi.setSystemTime(new Date(NOON.getTime() + 31 * 60_000))
    const open = await getToday(u).set('If-None-Match', tagOf(paused))
    expect(open.status).toBe(200)
    expect(sourceNotes(notesOf(open)).map((note) => note.code)).toEqual(['source-silent'])

    await ctx.prisma.integration.delete({ where: { id: row.id } })
    const removed = await getToday(u).set('If-None-Match', tagOf(open))
    expect(removed.status).toBe(200)
    expect(sourceNotes(notesOf(removed))).toEqual([])
  })

  test('moves when the source stores a run, through the data version', async () => {
    const u = await runnerPlanning('sources-tag-run@example.com', [daysAgo(3), daysAgo(1)])
    await connect(u, 'strava')
    await delivered(u, 'strava', daysAgo(6))
    const silent = await getToday(u)
    expect(sourceNotes(notesOf(silent)).map((note) => note.code)).toEqual(['source-silent'])
    await delivered(u, 'strava', daysAgo(1))
    const arrived = await getToday(u).set('If-None-Match', tagOf(silent))
    expect(arrived.status).toBe(200)
    expect(sourceNotes(notesOf(arrived))).toEqual([])
  })
})
