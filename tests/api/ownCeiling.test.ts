// The own easy ceiling through the zone-proposal routes (rules C4, C8; owner decision D4, 2026-11-14):
// offered from cool runs that pass B2, applied only on accept, recorded as the existing proposal
// revision, and read by the zones, the Plan page's input list and My paces after it.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { HrQuality, PlanRevision, ZoneProposalView } from '../../shared/types.ts'
import type { ZoneSet } from '../../shared/engine/types.ts'
import { client, createTestCtx, expectNoRefusedFetches, seedUser, type TestCtx } from './helpers.ts'

vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))

const today = todayIso()
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

const QUALITY: HrQuality = {
  v: 1,
  th: 'test',
  source: 'strap',
  movingSec: 2400,
  cleanSec: 2400,
  lockSec: 0,
  spikeSec: 0,
  dropSec: 0,
  flatSec: 0,
  mismatchSec: 0,
  halves: null,
  gapDecouplingPct: null,
}

/**
 * A runner with a measured maximum of 185 and a threshold pace of 5:00 /km (the easy pace limit is
 * then about 5:36 /km and the heart-rate ceiling 144), a plan, and `count` cool steady flat runs on
 * the line HR = `intercept` + 20 x speed.
 */
async function runnerWithRuns(email: string, count: number, intercept: number) {
  const u = await seedUser(ctx, { email })
  await ctx.prisma.athleteProfile.create({
    data: { userId: u.id, hrMax: 185, hrMaxSource: 'measured', thresholdPaceSecPerKm: 300 },
  })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(mondayOf(today), 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: mondayOf(today),
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: [
          {
            weekStart: mondayOf(today),
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
  await addRuns(u.id, count, intercept, (i) => addDays(today, -2 * (count - i)))
  return u
}

/** `count` cool steady flat runs on the line HR = `intercept` + 20 x speed, on the days `dateOf` gives. */
async function addRuns(
  userId: string,
  count: number,
  intercept: number,
  dateOf: (i: number) => string,
) {
  const durationSec = 2400
  for (let i = 0; i < count; i += 1) {
    const speed = 2.4 + (0.9 * i) / Math.max(count - 1, 1)
    const hr = Math.round(intercept + 20 * speed)
    await ctx.prisma.activity.create({
      data: {
        userId,
        date: dateOf(i),
        type: 'run',
        source: 'manual',
        durationSec,
        movingSec: durationSec,
        distanceM: speed * durationSec,
        gapDistanceM: speed * durationSec,
        elevationGainM: 20,
        avgHr: hr,
        tempC: 8,
        humidityPct: 55,
        windKph: 5,
        hrHistogram: JSON.stringify({
          start: 100,
          width: 5,
          sec: Array.from({ length: 20 }, (_, bin) =>
            bin === Math.floor((hr - 100) / 5) ? durationSec : 0,
          ),
        }),
        hrQuality: JSON.stringify(QUALITY),
      },
    })
  }
}

const lt1Proposals = (list: ZoneProposalView[]) => list.filter((p) => p.boundary === 'lt1Hr')

describe('the own easy ceiling proposal', () => {
  test('is offered with its evidence, and accepting applies it through the proposal path', async () => {
    const u = await runnerWithRuns('ceiling-accept@example.com', 10, 60)
    const c = client(ctx, u)
    const before = (await c.get('/api/zones')).body as ZoneSet
    expect(before.lt1Hr).toMatchObject({ value: 144, source: 'hrmax-observed' })

    const [offer] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    expect(offer).toMatchObject({ boundary: 'lt1Hr', from: 144, observations: 3 })
    expect(offer!.to).toBeLessThan(144)
    expect(offer!.evidence).toMatchObject({ direction: 'lower' })
    expect(offer!.evidence!.runs).toHaveLength(10)
    // Nothing applied before the answer.
    expect(((await c.get('/api/zones')).body as ZoneSet).lt1Hr!.value).toBe(144)

    const accepted = await c.post(`/api/zones/proposals/${offer!.id}/accept`).send({})
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    const zones = accepted.body as ZoneSet
    expect(zones.lt1Hr).toMatchObject({ value: offer!.to, source: 'own-line' })
    // Every reader of the first threshold follows: the Z1 ceiling that the targets, the watch and
    // the race plan read.
    expect(zones.hr!.z1[1]).toBe(offer!.to)
    const profile = await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: u.id } })
    expect(profile).toMatchObject({ ownLt1Hr: offer!.to, hrMax: 185 })

    // The existing proposal revision: an owner revision with the zone change and a template summary.
    const [revision] = (await c.get('/api/plan/revisions')).body as PlanRevision[]
    expect(revision).toMatchObject({ reason: 'owner' })
    expect(revision!.summary).toMatch(/^Accepted the proposed easy heart rate limit on /)
    expect(revision!.changes).toEqual([
      expect.objectContaining({ field: 'zones.lt1Hr', from: 144, to: offer!.to }),
    ])
    // Accepted: it is not offered again, and a second accept finds nothing.
    expect(lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])).toEqual(
      [],
    )
    expect((await c.post(`/api/zones/proposals/${offer!.id}/accept`).send({})).status).toBe(404)
    // The tier word reaches the page that says what the plan can see.
    const inputs = (await c.get('/api/plan-inputs')).body as {
      zones: Array<{ key: string; boundary: { source: string } | null }>
    }
    expect(inputs.zones.find((z) => z.key === 'lt1Hr')?.boundary?.source).toBe('own-line')
  })

  test('declining records the decline and changes nothing else', async () => {
    const u = await runnerWithRuns('ceiling-decline@example.com', 10, 60)
    const c = client(ctx, u)
    const [offer] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    const res = await c.post(`/api/zones/proposals/${offer!.id}/decline`).send({})
    expect(res.status).toBe(204)
    const profile = await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: u.id } })
    expect(profile.ownLt1Hr).toBeNull()
    expect(((await c.get('/api/zones')).body as ZoneSet).lt1Hr).toMatchObject({
      value: 144,
      source: 'hrmax-observed',
    })
    const [revision] = (await c.get('/api/plan/revisions')).body as PlanRevision[]
    expect(revision!.changes).toEqual([
      expect.objectContaining({ field: 'zones.lt1Hr.declined', from: 144, to: offer!.to }),
    ])
    expect(lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])).toEqual(
      [],
    )
  })

  test('a higher ceiling is offered only on the stricter bar', async () => {
    // The line gives about 151 bpm at the easy pace limit, over the 144 in force.
    const few = await runnerWithRuns('ceiling-few@example.com', 10, 91)
    expect(
      lt1Proposals((await client(ctx, few).get('/api/zones/proposals')).body as ZoneProposalView[]),
    ).toEqual([])
    const enough = await runnerWithRuns('ceiling-enough@example.com', 14, 91)
    const c = client(ctx, enough)
    const [offer] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    expect(offer).toMatchObject({ from: 144, to: 149 })
    expect(offer!.evidence!.direction).toBe('higher')
    await c.post(`/api/zones/proposals/${offer!.id}/accept`).send({})
    expect(((await c.get('/api/zones')).body as ZoneSet).lt1Hr).toMatchObject({
      value: 149,
      source: 'own-line',
    })
  })

  test('each step needs new evidence: only cool runs after the accepted change count', async () => {
    const u = await runnerWithRuns('ceiling-fresh@example.com', 14, 110)
    const c = client(ctx, u)
    const [offer] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    expect(offer).toMatchObject({ from: 144, to: 149 })
    await c.post(`/api/zones/proposals/${offer!.id}/accept`).send({})
    // The same runs do not offer the next step, though their line (about 169 bpm) is far over the
    // 149 now in force: only the fresh-data rule is left to hold it back.
    expect(lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])).toEqual(
      [],
    )
    // Fourteen new cool runs, on a higher line, do.
    vi.setSystemTime(new Date(2026, 10, 4, 12))
    await addRuns(u.id, 14, 110, (i) => addDays(today, 1 + i))
    const [next] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    expect(next).toMatchObject({ from: 149, to: 151 })
    expect(next!.evidence!.runs).toHaveLength(14)
  })

  test('a runner with cool runs and no plan gets no offer, and cannot answer one', async () => {
    const u = await runnerWithRuns('ceiling-noplan@example.com', 10, 60)
    await ctx.prisma.plan.deleteMany({ where: { userId: u.id } })
    const c = client(ctx, u)
    expect(lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])).toEqual(
      [],
    )
    expect((await c.post('/api/zones/proposals/lt1Hr-144-120/accept').send({})).status).toBe(404)
  })

  test('a decline of a lower ceiling leaves a later higher offer listed', async () => {
    const u = await runnerWithRuns('ceiling-dir@example.com', 10, 60)
    const c = client(ctx, u)
    const [offer] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    await c.post(`/api/zones/proposals/${offer!.id}/decline`).send({})
    // Later cool runs on a much higher line: the next offer points the other way.
    // The first ten runs are gone (as if they had left the eight-week window), the decline is still
    // inside the proposal window.
    await ctx.prisma.activity.deleteMany({ where: { userId: u.id } })
    vi.setSystemTime(new Date(2026, 10, 10, 12))
    await addRuns(u.id, 14, 120, (i) => addDays(today, 1 + i))
    const [next] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    expect(next?.evidence?.direction).toBe('higher')
  })

  test('a decline holds for its direction when one more run moves the offered value', async () => {
    const u = await runnerWithRuns('ceiling-hold@example.com', 10, 60)
    const c = client(ctx, u)
    const [offer] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    await c.post(`/api/zones/proposals/${offer!.id}/decline`).send({})
    await addRuns(u.id, 1, 55, () => addDays(today, -1))
    expect(lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])).toEqual(
      [],
    )
  })

  test('a new maximum or threshold heart rate from the runner clears an accepted ceiling', async () => {
    const u = await runnerWithRuns('ceiling-clear@example.com', 10, 60)
    const c = client(ctx, u)
    const [offer] = lt1Proposals((await c.get('/api/zones/proposals')).body as ZoneProposalView[])
    await c.post(`/api/zones/proposals/${offer!.id}/accept`).send({})
    // An unrelated edit keeps it; a new maximum goes with it.
    await c.put('/api/profile').send({ heightCm: 170 })
    expect(
      (await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: u.id } })).ownLt1Hr,
    ).toBe(offer!.to)
    await c.put('/api/profile').send({ hrMax: 190 })
    expect(
      (await ctx.prisma.athleteProfile.findUniqueOrThrow({ where: { userId: u.id } })).ownLt1Hr,
    ).toBeNull()
  })
})
