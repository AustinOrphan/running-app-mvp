import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { assertCleanCopy } from '../../shared/copy/lint.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type {
  AdjustResult,
  PlanAdjustment,
  PlanPreview,
  PlanRevisionView,
  PlanSession,
  UndoResult,
} from '../../shared/types.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { applyAdjust, planAdjust, StaleAdjust } from '../../server/services/adjust.ts'
import { ownedSession } from '../../server/services/planEngine.ts'
import { sessionHash } from '../../server/services/replan.ts'
import {
  adjustAt as adjustTo,
  content,
  errorOf,
  nextWeek,
  only,
  planFixture,
  postTo,
  rowsOf as rowsOfPlan,
  type Fixture,
} from './adjustFixture.ts'
import { client, createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

// Move, swap, swap-kind, shorten, skip and restore as one guarded action [phase 3a design 9.4, 9.5;
// task E5-6]: the adjust route, the same action through the preview, the older PUT that delegates,
// and what a shortened session means to the rest of the app. A Wednesday, so that the current
// week has sessions left; only Date is faked.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))

const today = todayIso()
const thisMonday = mondayOf(today)
const nextMonday = addDays(thisMonday, 7)

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  vi.setSystemTime(new Date(2026, 9, 21, 12))
  expectNoRefusedFetches(ctx)
})

const fixture = (email: string) => planFixture(ctx, email)
const rowsOf = (planId: string) => rowsOfPlan(ctx, planId)
const adjustAt = (f: Fixture, id: string, body: object) => adjustTo(ctx, f, id, body)
const post = (f: Fixture, url: string, body: object = {}) => postTo(ctx, f, url, body)

interface Counts {
  sessions: number
  revisions: number
  version: Awaited<ReturnType<typeof dataVersionKey>>
}
async function countsOf(f: Fixture): Promise<Counts> {
  return {
    sessions: await ctx.prisma.planSession.count({ where: { planId: f.plan.id } }),
    revisions: await ctx.prisma.planRevision.count({ where: { planId: f.plan.id } }),
    version: await dataVersionKey(ctx.prisma),
  }
}

/** The one edit of each kind the cases below run, on the sessions of next week. */
function edits(
  f: Fixture,
): Array<{ name: string; session: PlanSession; adjustment: PlanAdjustment }> {
  const easy = nextWeek(f, 'easy')
  const long = only(f, 'long')
  return [
    {
      name: 'move',
      session: easy[1]!,
      adjustment: { type: 'move', date: addDays(nextMonday, 3) },
    },
    { name: 'swap', session: easy[0]!, adjustment: { type: 'swap', withSessionId: long.id } },
    { name: 'swap-kind', session: easy[0]!, adjustment: { type: 'swap-kind', kind: 'long' } },
    {
      name: 'shorten',
      session: easy[1]!,
      adjustment: { type: 'shorten', durationMin: easy[1]!.durationMin - 8 },
    },
    { name: 'skip', session: easy[0]!, adjustment: { type: 'skip' } },
  ]
}

describe('POST /api/plan/sessions/:id/adjust', () => {
  test('the plan the cases below stand on', async () => {
    const f = await fixture('adjust-shape@example.com')
    expect(nextWeek(f, 'easy').length).toBeGreaterThanOrEqual(2)
    expect(nextWeek(f, 'long')).toHaveLength(1)
    expect(nextWeek(f, 'easy')[1]!.durationMin).toBeGreaterThanOrEqual(30)
  })

  test('a shorten updates the row in place, records a revision and its undo restores the row', async () => {
    const f = await fixture('adjust-shorten@example.com')
    const target = only(f, 'easy', 1)
    const was = await rowsOf(f.plan.id)
    const newMin = target.durationMin - 8

    const res = await adjustAt(f, target.id, {
      adjustment: { type: 'shorten', durationMin: newMin },
    })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const result = res.body as AdjustResult
    expect(result.allowed).toBe(true)
    expect(result.guards).toEqual([])
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/)

    // in place: same row, same identity, one more revision
    expect(result.session).toMatchObject({
      id: target.id,
      externalId: target.externalId,
      durationMin: newMin,
      status: 'adjusted',
    })
    const now = await rowsOf(f.plan.id)
    expect(now).toHaveLength(was.length)
    expect(now.find((r) => r.id === target.id)).toMatchObject({
      durationMin: newMin,
      status: 'adjusted',
      externalId: target.externalId,
    })
    // the first plan is kept, and no other session moved by a minute
    expect(JSON.parse(now.find((r) => r.id === target.id)!.original!)).toMatchObject({
      durationMin: target.durationMin,
      date: target.date,
    })
    expect(content(now.filter((r) => r.id !== target.id))).toEqual(
      content(was.filter((r) => r.id !== target.id)),
    )
    expect(JSON.parse(now.find((r) => r.id === target.id)!.rules)).toContain('g-6')

    const revision = result.revision!
    expect(revision).toMatchObject({ reason: 'owner', auto: false })
    expect(revision.summary).toMatch(/^Shortened .* from \d+ min to \d+ min\.$/)
    expect(revision.diff!.totals).toMatchObject({ added: 0, removed: 0, changed: 1 })
    expect(revision.diff!.sessions[0]).toMatchObject({
      change: 'changed',
      sessionId: target.id,
      externalId: target.externalId,
      before: { durationMin: target.durationMin },
      after: { durationMin: newMin },
    })
    expect(revision.diff!.sessions[0]!.fields).toEqual(
      expect.arrayContaining(['durationMin', 'status']),
    )
    expect(result.diff).toEqual(revision.diff)
    expect(revision.undo).toMatchObject({ available: true, reasons: [] })
    expect(revision.changes).toEqual([
      expect.objectContaining({
        field: 'session.durationMin',
        from: target.durationMin,
        to: newMin,
      }),
    ])

    const list = (await client(ctx, f.u).get('/api/plan/revisions').send())
      .body as PlanRevisionView[]
    expect(list[0]!.id).toBe(revision.id)

    const undone = await post(f, `/api/plan/revisions/${revision.id}/undo`)
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect((undone.body as UndoResult).target.undo.undoneAt).not.toBeNull()
    expect(content(await rowsOf(f.plan.id))).toEqual(content(was))
  })

  test.each(['move', 'swap', 'swap-kind', 'shorten', 'skip'])(
    'a %s is a revision with a diff and an undo, and updates its rows in place',
    async (name) => {
      const f = await fixture(`adjust-each-${name}@example.com`)
      const edit = edits(f).find((e) => e.name === name)!
      const was = await rowsOf(f.plan.id)

      const res = await adjustAt(f, edit.session.id, { adjustment: edit.adjustment })
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      const result = res.body as AdjustResult
      expect(result.allowed).toBe(true)
      expect(result.revision).toMatchObject({ reason: 'owner' })
      expect(result.diff.empty).toBe(false)
      expect(result.diff.totals).toMatchObject({ added: 0, removed: 0 })
      assertCleanCopy(result.revision!.summary, name)

      // the rows are the same rows: ids and identities kept
      const now = await rowsOf(f.plan.id)
      const identities = (rows: typeof now) =>
        rows.map((r) => `${r.id}|${r.externalId}`).sort((a, b) => a.localeCompare(b))
      expect(identities(now)).toEqual(identities(was))
      expect(now.map((r) => r.id)).toContain(result.session.id)
      expect(content(now)).not.toEqual(content(was))
      // only the sessions of the diff changed
      const changed = new Set(result.diff.sessions.map((line) => line.sessionId))
      expect(content(now.filter((r) => !changed.has(r.id)))).toEqual(
        content(was.filter((r) => !changed.has(r.id))),
      )

      const undone = await post(f, `/api/plan/revisions/${result.revision!.id}/undo`)
      expect(undone.status, JSON.stringify(undone.body)).toBe(200)
      const restored = await rowsOf(f.plan.id)
      expect(content(restored)).toEqual(content(was))
      expect(restored.map(sessionHash)).toEqual(was.map(sessionHash))
    },
  )

  test('a restore puts a skipped session back, and its undo skips it again', async () => {
    const f = await fixture('adjust-restore@example.com')
    const target = only(f, 'easy')
    expect((await adjustAt(f, target.id, { adjustment: { type: 'skip' } })).status).toBe(200)
    const skipped = await rowsOf(f.plan.id)
    expect(skipped.find((r) => r.id === target.id)!.status).toBe('skipped')

    const res = await adjustAt(f, target.id, { adjustment: { type: 'restore' } })
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    const restored = res.body as AdjustResult
    expect(restored.session.status).toBe('planned')
    expect(restored.revision!.summary).toMatch(/^Restored /)

    const undone = await post(f, `/api/plan/revisions/${restored.revision!.id}/undo`)
    expect(undone.status, JSON.stringify(undone.body)).toBe(200)
    expect(content(await rowsOf(f.plan.id))).toEqual(content(skipped))
  })

  test('an edit that changes nothing writes nothing and says so', async () => {
    const f = await fixture('adjust-noop@example.com')
    const target = only(f, 'easy')
    const before = await countsOf(f)
    for (const adjustment of [
      { type: 'move', date: target.date },
      { type: 'restore' },
      { type: 'swap-kind', kind: 'easy' },
      { type: 'shorten', durationMin: target.durationMin },
    ]) {
      const res = await adjustAt(f, target.id, { adjustment })
      expect(res.status, JSON.stringify(adjustment)).toBe(200)
      expect(res.body).toMatchObject({ allowed: true, guards: [], revision: null })
      expect((res.body as AdjustResult).diff.empty).toBe(true)
      expect((res.body as AdjustResult).session.id).toBe(target.id)
    }
    expect(await countsOf(f)).toEqual(before)
  })
})

describe('the dry run and the preview', () => {
  test.each(['move', 'swap', 'swap-kind', 'shorten', 'skip'])(
    'a %s dry run writes nothing, and its diff is the diff of the commit',
    async (name) => {
      const f = await fixture(`adjust-dry-${name}@example.com`)
      const edit = edits(f).find((e) => e.name === name)!
      const body = { adjustment: edit.adjustment }
      const rows = await rowsOf(f.plan.id)
      const before = await countsOf(f)

      const dry = await adjustAt(f, edit.session.id, { ...body, dryRun: true })
      expect(dry.status, JSON.stringify(dry.body)).toBe(200)
      const preview = dry.body as AdjustResult
      expect(preview).toMatchObject({ allowed: true, revision: null })
      expect(preview.diff.empty).toBe(false)
      // no row, no revision, no data version
      expect(await countsOf(f)).toEqual(before)
      expect(await rowsOf(f.plan.id)).toEqual(rows)

      // the same action through the preview route gives the same diff and the same hash
      const via = await post(f, '/api/plan/preview', {
        type: 'adjust',
        sessionId: edit.session.id,
        adjustment: edit.adjustment,
      })
      expect(via.status, JSON.stringify(via.body)).toBe(200)
      const planPreview = via.body as PlanPreview
      expect(planPreview).toMatchObject({
        action: { type: 'adjust', sessionId: edit.session.id, adjustment: edit.adjustment },
        blocked: false,
        reasons: [],
        guards: [],
        today,
      })
      expect(planPreview.diff).toEqual(preview.diff)
      expect(planPreview.hash).toBe(preview.hash)
      expect(planPreview.summary.length).toBeGreaterThan(0)
      expect(await countsOf(f)).toEqual(before)

      const commit = await adjustAt(f, edit.session.id, { ...body, expectHash: preview.hash })
      expect(commit.status, JSON.stringify(commit.body)).toBe(200)
      const done = commit.body as AdjustResult
      expect(done.diff).toEqual(preview.diff)
      expect(done.revision!.diff).toEqual(preview.diff)
      expect(done.revision!.summary).toBe(planPreview.summary)
      const { updatedAt: _a, ...dryRow } = preview.session
      const { updatedAt: _b, ...doneRow } = done.session
      expect(doneRow).toEqual(dryRow)
    },
  )

  test('a refused dry run is information: allowed false, the guards, nothing written', async () => {
    const f = await fixture('adjust-dry-refused@example.com')
    const easy = only(f, 'easy')
    const threshold = only(f, 'threshold')
    const before = await countsOf(f)

    const res = await adjustAt(f, easy.id, {
      adjustment: { type: 'move', date: threshold.date },
      dryRun: true,
    })
    expect(res.status).toBe(200)
    const result = res.body as AdjustResult
    expect(result.allowed).toBe(false)
    expect(result.diff.empty).toBe(true)
    expect(result.revision).toBeNull()
    expect(result.guards[0]).toMatchObject({
      code: 'one-run-a-day',
      effect: 'blocks',
      rules: ['F1'],
    })

    const via = await post(f, '/api/plan/preview', {
      type: 'adjust',
      sessionId: easy.id,
      adjustment: { type: 'move', date: threshold.date },
    })
    expect(via.body).toMatchObject({ blocked: true, reasons: [] })
    expect((via.body as PlanPreview).summary).toBe(result.guards[0]!.message)
    expect(await countsOf(f)).toEqual(before)
  })
})

describe('a guard that refuses', () => {
  test('answers 409 with the guards and the first message, writes nothing, and offers the swap that works', async () => {
    const f = await fixture('adjust-refused@example.com')
    const easy = only(f, 'easy')
    const threshold = only(f, 'threshold')
    const was = await rowsOf(f.plan.id)
    const before = await countsOf(f)

    const res = await adjustAt(f, easy.id, { adjustment: { type: 'move', date: threshold.date } })
    expect(res.status).toBe(409)
    const error = errorOf(res)
    expect(error.code).toBe('conflict')
    const guards = error.details!.guards as AdjustResult['guards']
    expect(guards[0]!.code).toBe('one-run-a-day')
    expect(error.message).toBe(guards[0]!.message)
    expect(error.message).toMatch(
      /already has a run; one run a day keeps the week's spacing \(rule F1\)/,
    )
    expect(guards[0]!.suggest).toMatchObject({
      label: `Swap with ${threshold.title} ${String(threshold.durationMin)} min instead`,
      adjustment: { type: 'swap', withSessionId: threshold.id },
    })
    assertCleanCopy(error.message, 'guard')
    expect(await countsOf(f)).toEqual(before)
    expect(await rowsOf(f.plan.id)).toEqual(was)

    // the suggestion is one tap: it commits
    const swap = await adjustAt(f, easy.id, { adjustment: guards[0]!.suggest!.adjustment })
    expect(swap.status, JSON.stringify(swap.body)).toBe(200)
    const now = await rowsOf(f.plan.id)
    expect(now.find((r) => r.id === easy.id)).toMatchObject({
      date: threshold.date,
      status: 'moved',
      externalId: easy.externalId,
    })
    expect(now.find((r) => r.id === threshold.id)).toMatchObject({
      date: easy.date,
      status: 'moved',
      externalId: threshold.externalId,
    })
  })

  test.each([
    ['the race day', 'race', { type: 'skip' }, 'The race day cannot be skipped.'],
    [
      'the race day',
      'race',
      { type: 'shorten', durationMin: 60 },
      'The race day stays where it is.',
    ],
  ] as const)('%s cannot be changed (%j)', async (_name, kind, adjustment, message) => {
    const f = await fixture(`adjust-race-${adjustment.type}@example.com`)
    const race = f.plan.sessions.find((s) => s.kind === kind)!
    const res = await adjustAt(f, race.id, { adjustment })
    expect(res.status).toBe(409)
    expect(errorOf(res).message).toBe(message)
  })

  test('shorten refuses more minutes, fewer than the smallest run, and a session that is not a run', async () => {
    const f = await fixture('adjust-shorten-refused@example.com')
    const easy = only(f, 'easy')
    const before = await countsOf(f)
    const cases: Array<[PlanSession, PlanAdjustment, string]> = [
      [easy, { type: 'shorten', durationMin: easy.durationMin + 1 }, 'not-shorter'],
      [easy, { type: 'shorten', durationMin: 5 }, 'below-minimum'],
      [nextWeek(f, 'strength')[0]!, { type: 'shorten', durationMin: 10 }, 'not-shortenable'],
    ]
    for (const [target, adjustment, code] of cases) {
      const res = await adjustAt(f, target.id, { adjustment })
      expect(res.status, code).toBe(409)
      expect((errorOf(res).details!.guards as AdjustResult['guards'])[0]!.code).toBe(code)
    }
    expect(await countsOf(f)).toEqual(before)
  })

  test('a linked session, a skipped one and one in the past stay as they are', async () => {
    const f = await fixture('adjust-stays@example.com')
    const [linked, skipped] = [only(f, 'easy', 0), only(f, 'easy', 1)]
    const run = await ctx.prisma.activity.create({
      data: {
        userId: f.u.id,
        date: linked.date,
        type: 'run',
        durationSec: linked.durationMin * 60,
        source: 'manual',
      },
    })
    await ctx.prisma.planSession.update({
      where: { id: linked.id },
      data: { activityId: run.id, linkSource: 'owner', status: 'completed' },
    })
    expect((await adjustAt(f, skipped.id, { adjustment: { type: 'skip' } })).status).toBe(200)
    // The engine plans nothing before today, so a session is put in the past by hand: next week's
    // long run, moved to yesterday with the week it belongs to.
    const past = only(f, 'long')
    const yesterday = addDays(today, -1)
    await ctx.prisma.planSession.update({
      where: { id: past.id },
      data: { date: yesterday, weekStart: mondayOf(yesterday) },
    })
    const cases: Array<[string, PlanAdjustment, string]> = [
      [linked.id, { type: 'move', date: addDays(linked.date, 1) }, 'linked'],
      [linked.id, { type: 'skip' }, 'linked'],
      [skipped.id, { type: 'shorten', durationMin: 25 }, 'skipped'],
      [past.id, { type: 'move', date: today }, 'past-session'],
    ]
    for (const [id, adjustment, code] of cases) {
      const res = await adjustAt(f, id, { adjustment })
      expect(res.status, code).toBe(409)
      expect((errorOf(res).details!.guards as AdjustResult['guards'])[0]!.code).toBe(code)
    }
  })

  test('a closed day is refused through the profile', async () => {
    const f = await fixture('adjust-closed@example.com')
    const easy = only(f, 'easy', 1)
    const day = addDays(nextMonday, 4)
    await ctx.prisma.athleteProfile.upsert({
      where: { userId: f.u.id },
      create: {
        userId: f.u.id,
        availability: JSON.stringify({ fri: { available: false, maxMin: null } }),
      },
      update: { availability: JSON.stringify({ fri: { available: false, maxMin: null } }) },
    })
    const res = await adjustAt(f, easy.id, { adjustment: { type: 'move', date: day } })
    expect(res.status).toBe(409)
    expect(errorOf(res).message).toMatch(/is not a day you run/)
  })
})

describe('a stale preview', () => {
  test('a commit whose hash no longer matches is refused with the new preview, and nothing is written', async () => {
    const f = await fixture('adjust-stale@example.com')
    const edit = edits(f).find((e) => e.name === 'shorten')!
    const body = { adjustment: edit.adjustment }
    const dry = (await adjustAt(f, edit.session.id, { ...body, dryRun: true })).body as AdjustResult

    // The plan moves on: another write lands before the commit.
    const other = only(f, 'easy', 0)
    expect((await adjustAt(f, other.id, { adjustment: { type: 'skip' } })).status).toBe(200)
    const rows = await rowsOf(f.plan.id)
    const before = await countsOf(f)

    const res = await adjustAt(f, edit.session.id, { ...body, expectHash: dry.hash })
    expect(res.status).toBe(409)
    expect(errorOf(res).details).toMatchObject({ code: 'stale-preview' })
    const fresh = errorOf(res).details!.preview as PlanPreview
    expect(fresh.hash).not.toBe(dry.hash)
    expect(fresh.action).toMatchObject({ type: 'adjust', sessionId: edit.session.id })
    assertCleanCopy(errorOf(res).message, 'stale preview')
    expect(await rowsOf(f.plan.id)).toEqual(rows)
    expect(await countsOf(f)).toEqual(before)

    // the new preview's hash applies
    const again = await adjustAt(f, edit.session.id, { ...body, expectHash: fresh.hash })
    expect(again.status, JSON.stringify(again.body)).toBe(200)
  })

  test('a row that changed after it was read writes nothing', async () => {
    const f = await fixture('adjust-changed@example.com')
    const target = only(f, 'easy', 1)
    const row = await ownedSession(ctx, f.u.id, target.id)
    const { plan: _plan, ...session } = row
    const planned = await planAdjust(ctx, {
      userId: f.u.id,
      row: session,
      adjustment: { type: 'shorten', durationMin: target.durationMin - 5 },
      today,
    })
    expect(planned.check.allowed).toBe(true)
    // another write changes the same row before this one is written
    await ctx.prisma.planSession.update({
      where: { id: target.id },
      data: { durationMin: target.durationMin + 2 },
    })
    const rows = await rowsOf(f.plan.id)
    const before = await countsOf(f)
    await expect(applyAdjust(ctx, planned, () => true)).rejects.toBeInstanceOf(StaleAdjust)
    // and a diff that is no longer the one previewed
    await expect(
      applyAdjust(ctx, { ...planned, session: row }, () => false),
    ).rejects.toBeInstanceOf(StaleAdjust)
    expect(await rowsOf(f.plan.id)).toEqual(rows)
    expect((await countsOf(f)).revisions).toBe(before.revisions)
  })
})

describe('validation, ownership and sign-in', () => {
  test('refuses what it cannot read with 400 and writes nothing', async () => {
    const f = await fixture('adjust-400@example.com')
    const easy = only(f, 'easy')
    const before = await countsOf(f)
    const bodies: object[] = [
      {},
      { adjustment: {} },
      { adjustment: { type: 'teleport' } },
      { adjustment: { type: 'move' } },
      { adjustment: { type: 'move', date: 'soon' } },
      { adjustment: { type: 'move', date: '2026-02-30' } },
      { adjustment: { type: 'move', date: nextMonday, extra: 1 } },
      { adjustment: { type: 'swap' } },
      { adjustment: { type: 'swap-kind', kind: 'race' } },
      { adjustment: { type: 'swap-kind', kind: 'sprint' } },
      { adjustment: { type: 'shorten' } },
      { adjustment: { type: 'shorten', durationMin: 0 } },
      { adjustment: { type: 'shorten', durationMin: 20.5 } },
      { adjustment: { type: 'shorten', durationMin: 1441 } },
      { adjustment: { type: 'shorten', durationMin: '20' } },
      { adjustment: { type: 'skip', date: nextMonday } },
      { adjustment: { type: 'skip' }, dryRun: 'yes' },
      { adjustment: { type: 'skip' }, expectHash: 'abc' },
      { adjustment: { type: 'skip' }, extra: true },
    ]
    for (const body of bodies) {
      const res = await adjustAt(f, easy.id, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(errorOf(res).code).toBe('validation')
    }
    expect(
      (
        await post(f, '/api/plan/preview', {
          type: 'adjust',
          sessionId: easy.id,
          adjustment: { type: 'move', date: 'soon' },
        })
      ).status,
    ).toBe(400)
    expect(
      (await post(f, '/api/plan/preview', { type: 'adjust', adjustment: { type: 'skip' } })).status,
    ).toBe(400)
    expect(await countsOf(f)).toEqual(before)
  })

  test('answers 401 before it reads the body, and 404 for a session that is not the user’s', async () => {
    const f = await fixture('adjust-owner@example.com')
    const theirs = await fixture('adjust-theirs@example.com')
    const other = await seedUser(ctx, { email: 'adjust-stranger@example.com' })
    const easy = only(f, 'easy')
    const url = `/api/plan/sessions/${easy.id}/adjust`
    expect((await client(ctx).post(url).send({ nonsense: true })).status).toBe(401)
    expect((await client(ctx).post('/api/plan/preview').send({ type: 'adjust' })).status).toBe(401)

    const before = await countsOf(f)
    const stranger = client(ctx, other)
    for (const body of [
      { adjustment: { type: 'skip' } },
      { adjustment: { type: 'skip' }, dryRun: true },
    ]) {
      expect((await stranger.post(url).send(body)).status).toBe(404)
    }
    expect(
      (
        await stranger
          .post('/api/plan/preview')
          .send({ type: 'adjust', sessionId: easy.id, adjustment: { type: 'skip' } })
      ).status,
    ).toBe(404)
    expect(
      (await post(f, '/api/plan/sessions/nope/adjust', { adjustment: { type: 'skip' } })).status,
    ).toBe(404)
    // nor can a session be swapped with one of another user's plan
    const res = await adjustAt(f, easy.id, {
      adjustment: { type: 'swap', withSessionId: only(theirs, 'long').id },
    })
    expect(res.status).toBe(409)
    expect((errorOf(res).details!.guards as AdjustResult['guards'])[0]!.code).toBe(
      'partner-unavailable',
    )
    expect(await countsOf(f)).toEqual(before)
  })
})
