import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { addDays, mondayOf } from '../../shared/dates.ts'
import { fuelRungs } from '../../shared/engine/fuel.ts'
import { P } from '../../shared/engine/params/index.ts'
import { FUEL_LADDER_STEPS_SHOWN, FUEL_PRODUCTS_MAX } from '../../shared/limits.ts'
import type {
  FuelLogResult,
  FuelLogView,
  FuelProduct,
  FuelSettings,
  ValidationIssue,
} from '../../shared/types.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

interface ErrorBody {
  error: { code: string; message: string; details?: { issues?: ValidationIssue[]; code?: string } }
}

const errorOf = (res: { body: unknown }): ErrorBody['error'] => (res.body as ErrorBody).error

let ctx: TestCtx
let users = 0

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

/** A user of its own, so no test reads another test's logs. */
async function newUser(): Promise<TestUser> {
  users += 1
  return seedUser(ctx, { email: `runner${String(users)}@example.com` })
}

const HOUR = 3600

async function newRun(
  user: TestUser,
  date: string,
  over: { type?: string; durationSec?: number; tempC?: number; humidityPct?: number } = {},
) {
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date,
      type: over.type ?? 'run',
      durationSec: over.durationSec ?? 3 * HOUR,
      distanceM: 30_000,
      source: 'manual',
      tempC: over.tempC ?? null,
      humidityPct: over.humidityPct ?? null,
    },
  })
}

const GEL = {
  name: 'Synthetic gel',
  kind: 'gel',
  servingLabel: '1 gel',
  carbsG: 40,
  sodiumMg: 100,
  kcal: 160,
  multiCarb: true,
}

async function addProduct(
  user: TestUser,
  over: Record<string, unknown> = {},
): Promise<FuelProduct> {
  const res = await client(ctx, user)
    .post('/api/fuel/products')
    .send({ ...GEL, ...over })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body as FuelProduct
}

/** A log body taking `servings` servings of a product; seven of the 40 g gel is 93 g/h over 3 h. */
function logBody(product: FuelProduct, over: Record<string, unknown> = {}) {
  return { items: [{ productId: product.id, servings: 7 }], gut: 0, ...over }
}

async function putLog(
  user: TestUser,
  activityId: string,
  body: Record<string, unknown>,
): Promise<FuelLogResult> {
  const res = await client(ctx, user).put(`/api/fuel/logs/${activityId}`).send(body)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as FuelLogResult
}

async function getLog(user: TestUser, activityId: string): Promise<FuelLogView | null> {
  const res = await client(ctx, user).get(`/api/fuel/logs/${activityId}`)
  expect(res.status).toBe(200)
  return res.body as FuelLogView | null
}

async function putSettings(user: TestUser, body: Record<string, unknown>) {
  return client(ctx, user).put('/api/fuel/settings').send(body)
}

const SETTINGS: FuelSettings = {
  optIn90: false,
  optInAdvanced: false,
  giDisease: false,
  gutBlock: true,
}

/** The gut-training week and, optionally, a linked session on a run. */
async function planWithBlock(
  user: TestUser,
  blockMonday: string,
  linked?: { activityId: string; date: string; flags: string[] },
) {
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic 100 miler',
      priority: 'A',
      targetDate: '2027-05-15',
      distanceM: 160_934,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      name: goal.name,
      startDate: blockMonday,
      raceWeekStart: '2027-05-10',
      generatorVersion: 2,
      weeks: {
        create: [
          {
            weekStart: blockMonday,
            index: 0,
            phase: 'build',
            baselineRunMin: 200,
            targetRunMin: 200,
            longRunMin: 90,
            runDays: 4,
            strengthSessions: 0,
            flags: JSON.stringify(['gut-training']),
          },
        ],
      },
    },
  })
  if (linked) {
    await ctx.prisma.planSession.create({
      data: {
        planId: plan.id,
        externalId: randomUUID(),
        weekStart: mondayOf(linked.date),
        date: linked.date,
        order: 0,
        kind: 'long',
        title: 'Long run',
        durationMin: 70,
        target: JSON.stringify({ zone: 'z1', rpe: [3, 4], hr: null, paceSecPerKm: null }),
        purpose: 'Synthetic.',
        flags: JSON.stringify(linked.flags),
        status: 'completed',
        activityId: linked.activityId,
        linkSource: 'auto',
      },
    })
  }
  return plan
}

describe('fuel API: access', () => {
  test('every route needs a session', async () => {
    const api = client(ctx)
    for (const res of [
      await api.put('/api/fuel/settings').send(SETTINGS),
      await api.get('/api/fuel/products'),
      await api.post('/api/fuel/products').send(GEL),
      await api.put('/api/fuel/products/p1').send(GEL),
      await api.delete('/api/fuel/products/p1'),
      await api.get('/api/fuel/logs/a1'),
      await api.put('/api/fuel/logs/a1').send({ gut: 0 }),
      await api.post('/api/fuel/logs/a1/skip'),
      await api.delete('/api/fuel/logs/a1'),
    ]) {
      expect(res.status).toBe(401)
    }
  })
})

describe('fuel API: settings', () => {
  test('stores the four switches, and the same PUT twice leaves the same row', async () => {
    const user = await newUser()
    const body = { optIn90: true, optInAdvanced: false, giDisease: false, gutBlock: false }
    const first = await putSettings(user, body)
    expect(first.status).toBe(200)
    expect(first.body).toEqual(body)
    const again = await putSettings(user, body)
    expect(again.status).toBe(200)
    expect(again.body).toEqual(body)
    const rows = await ctx.prisma.fuelSettings.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject(body)
  })

  test('a gut condition forces the other three switches off', async () => {
    const user = await newUser()
    const res = await putSettings(user, {
      optIn90: true,
      optInAdvanced: true,
      giDisease: true,
      gutBlock: true,
    })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      optIn90: false,
      optInAdvanced: false,
      giDisease: true,
      gutBlock: false,
    })
  })

  test('opting out of the first opt-in clears the second', async () => {
    const user = await newUser()
    const res = await putSettings(user, { ...SETTINGS, optIn90: false, optInAdvanced: true })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(SETTINGS)
  })

  test('the second opt-in is refused until a run at the second tier went well', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const open = { ...SETTINGS, optIn90: true }
    expect((await putSettings(user, open)).status).toBe(200)

    // Under the first opt-in alone each tolerated run steps the ladder up one rung from the floor,
    // so the second tier is tolerated after `runsToTolerate(secondTier)` runs. One run fewer leaves
    // 80 g/h tolerated and 90 g/h only the next target.
    const secondTier = fuelRungs().findLastIndex((rung) => rung.gPerH <= P.h7.carbTier2GPerH.value)
    const runsToTolerate = (rungIndex: number) => (rungIndex + 1) * P.h7.stepUpToleratedRuns.value
    const runs: Array<{ id: string }> = []
    const logTolerated = async (count: number) => {
      while (runs.length < count) {
        const run = await newRun(user, addDays('2026-08-01', 7 * runs.length))
        runs.push(run)
        await putLog(user, run.id, logBody(gel))
      }
    }

    // One rung short: no run at 90 g/h went well yet.
    await logTolerated(runsToTolerate(secondTier - 1))
    const early = await putSettings(user, { ...open, optInAdvanced: true })
    expect(early.status).toBe(400)
    expect(errorOf(early).code).toBe('validation')
    expect(errorOf(early).message).toBe('This opens after a run at 90 g/h goes well.')
    expect(errorOf(early).details?.issues).toEqual([
      { path: 'optInAdvanced', message: 'This opens after a run at 90 g/h goes well.' },
    ])
    // Nothing was stored.
    const stored = await ctx.prisma.fuelSettings.findUnique({ where: { userId: user.id } })
    expect(stored?.optInAdvanced).toBe(false)

    // One more tolerated run, now at 90 g/h, opens it.
    await logTolerated(runsToTolerate(secondTier))
    const late = await putSettings(user, { ...open, optInAdvanced: true })
    expect(late.status).toBe(200)
    expect(late.body).toEqual({ ...open, optInAdvanced: true })

    // A switch that is already on is not refused again, even if the logs change under it.
    for (const run of runs) {
      expect((await client(ctx, user).delete(`/api/fuel/logs/${run.id}`)).status).toBe(200)
    }
    const repeat = await putSettings(user, { ...open, optInAdvanced: true })
    expect(repeat.status).toBe(200)
    expect(repeat.body).toEqual({ ...open, optInAdvanced: true })
  })

  test('validates the body: four booleans and nothing else', async () => {
    const user = await newUser()
    for (const bad of [
      {},
      { ...SETTINGS, optIn90: 'yes' },
      { ...SETTINGS, extra: true },
      { optIn90: true, optInAdvanced: false, giDisease: false },
    ]) {
      const res = await putSettings(user, bad)
      expect(res.status, JSON.stringify(bad)).toBe(400)
      expect(errorOf(res).code).toBe('validation')
      expect(errorOf(res).details?.issues?.length).toBeGreaterThan(0)
    }
    const missing = await putSettings(user, {
      optIn90: true,
      optInAdvanced: false,
      giDisease: false,
    })
    expect(errorOf(missing).details?.issues?.map((i) => i.path)).toEqual(['gutBlock'])
  })
})

describe('fuel API: products', () => {
  test('creates, lists, replaces and archives a product', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    expect(gel).toMatchObject({ ...GEL, archived: false })

    const list = await client(ctx, user).get('/api/fuel/products')
    expect((list.body as FuelProduct[]).map((p) => p.id)).toEqual([gel.id])

    const put = await client(ctx, user)
      .put(`/api/fuel/products/${gel.id}`)
      .send({ ...GEL, carbsG: 25, sodiumMg: null, kcal: undefined, multiCarb: undefined })
    expect(put.status).toBe(200)
    expect(put.body).toMatchObject({
      id: gel.id,
      carbsG: 25,
      sodiumMg: null,
      kcal: null,
      multiCarb: false,
    })

    const del = await client(ctx, user).delete(`/api/fuel/products/${gel.id}`)
    expect(del.status).toBe(204)
    const row = await ctx.prisma.fuelProduct.findUnique({ where: { id: gel.id } })
    expect(row?.archived).toBe(true)

    const live = await client(ctx, user).get('/api/fuel/products')
    expect(live.body).toEqual([])
    const all = await client(ctx, user).get('/api/fuel/products?archived=1')
    expect((all.body as FuelProduct[]).map((p) => [p.id, p.archived])).toEqual([[gel.id, true]])

    // Archiving twice is the same as once.
    expect((await client(ctx, user).delete(`/api/fuel/products/${gel.id}`)).status).toBe(204)
  })

  test('lists live products first, each group by name', async () => {
    const user = await newUser()
    const zeta = await addProduct(user, { name: 'zeta chews' })
    await addProduct(user, { name: 'Alpha gel' })
    const old = await addProduct(user, { name: 'Aardvark mix' })
    await client(ctx, user).delete(`/api/fuel/products/${old.id}`)
    const list = await client(ctx, user).get('/api/fuel/products?archived=1')
    expect((list.body as FuelProduct[]).map((p) => p.name)).toEqual([
      'Alpha gel',
      zeta.name,
      'Aardvark mix',
    ])
  })

  test('a live name is unique, whatever its case, and archiving frees it', async () => {
    const user = await newUser()
    const gel = await addProduct(user, { name: 'Salted gel' })
    const same = await client(ctx, user)
      .post('/api/fuel/products')
      .send({ ...GEL, name: '  salted GEL ' })
    expect(same.status).toBe(409)
    expect(errorOf(same).code).toBe('conflict')
    expect(errorOf(same).details).toEqual({ code: 'name-taken' })
    expect(errorOf(same).message).toBe(
      'A product called salted GEL is already on your list. Choose another name.',
    )

    const other = await addProduct(user, { name: 'Plain gel' })
    const rename = await client(ctx, user)
      .put(`/api/fuel/products/${other.id}`)
      .send({ ...GEL, name: 'Salted gel' })
    expect(rename.status).toBe(409)
    // Keeping its own name is not a clash.
    const keep = await client(ctx, user)
      .put(`/api/fuel/products/${other.id}`)
      .send({ ...GEL, name: 'Plain gel', carbsG: 30 })
    expect(keep.status).toBe(200)

    await client(ctx, user).delete(`/api/fuel/products/${gel.id}`)
    const reuse = await client(ctx, user)
      .post('/api/fuel/products')
      .send({ ...GEL, name: 'Salted gel' })
    expect(reuse.status).toBe(201)

    // Two users can each have a product of the same name.
    const second = await newUser()
    expect((await addProduct(second, { name: 'Salted gel' })).name).toBe('Salted gel')
  })

  test('an archived product cannot be changed', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    await client(ctx, user).delete(`/api/fuel/products/${gel.id}`)
    const res = await client(ctx, user).put(`/api/fuel/products/${gel.id}`).send(GEL)
    expect(res.status).toBe(409)
    expect(errorOf(res).details).toEqual({ code: 'archived' })
  })

  test('a list holds at most 100 live products; archiving frees a place', async () => {
    const user = await newUser()
    await ctx.prisma.fuelProduct.createMany({
      data: Array.from({ length: FUEL_PRODUCTS_MAX }, (_, i) => ({
        userId: user.id,
        name: `Synthetic product ${String(i)}`,
        kind: 'gel',
        servingLabel: '1 gel',
        carbsG: 20,
      })),
    })
    const full = await client(ctx, user)
      .post('/api/fuel/products')
      .send({ ...GEL, name: 'One too many' })
    expect(full.status).toBe(409)
    expect(errorOf(full).details).toEqual({ code: 'products-full' })
    expect(errorOf(full).message).toBe(
      `Your list holds up to ${String(FUEL_PRODUCTS_MAX)} products. Archive one to add another.`,
    )

    const first = await ctx.prisma.fuelProduct.findFirstOrThrow({ where: { userId: user.id } })
    await client(ctx, user).delete(`/api/fuel/products/${first.id}`)
    const room = await client(ctx, user)
      .post('/api/fuel/products')
      .send({ ...GEL, name: 'One too many' })
    expect(room.status).toBe(201)
  })

  test("another runner's product is not found", async () => {
    const owner = await newUser()
    const stranger = await newUser()
    const gel = await addProduct(owner)
    expect((await client(ctx, stranger).put(`/api/fuel/products/${gel.id}`).send(GEL)).status).toBe(
      404,
    )
    expect((await client(ctx, stranger).delete(`/api/fuel/products/${gel.id}`)).status).toBe(404)
    expect((await client(ctx, stranger).delete('/api/fuel/products/nope')).status).toBe(404)
    expect(
      (await ctx.prisma.fuelProduct.findUniqueOrThrow({ where: { id: gel.id } })).archived,
    ).toBe(false)
    expect((await client(ctx, stranger).get('/api/fuel/products')).body).toEqual([])
  })

  test('validates the body with a path per field', async () => {
    const user = await newUser()
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ name: '   ' }, 'name'],
      [{ name: 'x'.repeat(61) }, 'name'],
      [{ kind: 'potion' }, 'kind'],
      [{ servingLabel: '' }, 'servingLabel'],
      [{ carbsG: -1 }, 'carbsG'],
      [{ carbsG: 301 }, 'carbsG'],
      [{ sodiumMg: 1.5 }, 'sodiumMg'],
      [{ kcal: -5 }, 'kcal'],
      [{ multiCarb: 'yes' }, 'multiCarb'],
      [{ archived: true }, ''],
    ]
    for (const [over, path] of cases) {
      const res = await client(ctx, user)
        .post('/api/fuel/products')
        .send({ ...GEL, ...over })
      expect(res.status, JSON.stringify(over)).toBe(400)
      expect(errorOf(res).code).toBe('validation')
      expect(errorOf(res).details?.issues?.map((i) => i.path)).toContain(path)
    }
    // The edges are accepted.
    const edge = await client(ctx, user).post('/api/fuel/products').send({
      name: 'Electrolyte tablet',
      kind: 'electrolyte',
      servingLabel: '1 tablet',
      carbsG: 0,
    })
    expect(edge.status).toBe(201)
    expect(edge.body).toMatchObject({ carbsG: 0, sodiumMg: null, kcal: null, multiCarb: false })
  })
})

describe('fuel API: logs', () => {
  test('saves a log with a snapshot of each product and answers { log, ladder, message }', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')

    const result = await putLog(
      user,
      run.id,
      logBody(gel, {
        items: [
          { productId: gel.id, servings: 6 },
          { name: 'Boiled potato', carbsG: 15, sodiumMg: 200, servings: 2 },
        ],
        fluidMl: 1500,
        sodiumMg: 900,
        nausea: 1,
        gut: 1,
        notes: '  Felt fine.  ',
      }),
    )
    expect(result.log).toMatchObject({
      activityId: run.id,
      skipped: false,
      fluidMl: 1500,
      sodiumMg: 900,
      gut: 1,
      nausea: 1,
      hot: null,
      notes: 'Felt fine.',
      counts: 'Counted toward your ladder.',
      items: [
        {
          productId: gel.id,
          name: 'Synthetic gel',
          carbsG: 40,
          sodiumMg: 100,
          kcal: 160,
          multiCarb: true,
          servings: 6,
        },
        {
          productId: null,
          name: 'Boiled potato',
          carbsG: 15,
          sodiumMg: 200,
          kcal: null,
          multiCarb: false,
          servings: 2,
        },
      ],
    })
    expect(result.log?.step).toMatchObject({
      activityId: run.id,
      reason: 'counted',
      outcome: 'step-up',
    })
    expect(result.message).toBe('Tolerated at 30 to 50 g/h. Next long run: 60 g/h.')
    expect(result.ladder.currentIndex).toBe(1)
    expect(result.ladder.rungs[result.ladder.currentIndex]?.gPerH).toBe(60)
    expect(result.ladder.steps.map((s) => s.activityId)).toEqual([run.id])

    // The product changes and is archived; the log keeps what was eaten.
    await client(ctx, user)
      .put(`/api/fuel/products/${gel.id}`)
      .send({ ...GEL, name: 'Renamed gel', carbsG: 10 })
    await client(ctx, user).delete(`/api/fuel/products/${gel.id}`)
    const kept = await getLog(user, run.id)
    expect(kept?.items[0]).toMatchObject({ name: 'Synthetic gel', carbsG: 40 })
    expect(kept?.step.rateGPerH).toBeCloseTo((6 * 40 + 2 * 15) / 3, 5)
  })

  test('the same PUT twice leaves one log and the same answer', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')
    const body = logBody(gel, { fluidMl: 1200, nausea: 0, hot: false })
    const first = await putLog(user, run.id, body)
    const second = await putLog(user, run.id, body)
    expect(second).toEqual(first)
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: run.id } })).toBe(1)

    // A changed request replaces the log.
    const changed = await putLog(user, run.id, logBody(gel, { gut: 3 }))
    expect(changed.log?.gut).toBe(3)
    expect(changed.log?.fluidMl).toBeNull()
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: run.id } })).toBe(1)
  })

  test('GET is null for a run without a log', async () => {
    const user = await newUser()
    const run = await newRun(user, '2026-09-05')
    const res = await client(ctx, user).get(`/api/fuel/logs/${run.id}`)
    expect(res.status).toBe(200)
    expect(res.body).toBeNull()
  })

  test('stores hot only when the runner chose, and the choice survives a weather fill', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')
    const hotOf = async () =>
      (await ctx.prisma.fuelLog.findUniqueOrThrow({ where: { activityId: run.id } })).hotOverride

    await putLog(user, run.id, logBody(gel))
    expect(await hotOf()).toBeNull()
    await putLog(user, run.id, logBody(gel, { hot: null }))
    expect(await hotOf()).toBeNull()
    await putLog(user, run.id, logBody(gel, { hot: false }))
    expect(await hotOf()).toBe(false)
    await putLog(user, run.id, logBody(gel, { hot: true }))
    expect(await hotOf()).toBe(true)
    expect((await getLog(user, run.id))?.hot).toBe(true)

    // The runner said it was not hot: a hot reading that arrives later does not change that.
    await putLog(user, run.id, logBody(gel, { hot: false }))
    await ctx.prisma.activity.update({
      where: { id: run.id },
      data: { tempC: 33, humidityPct: 70, windKph: 4, weatherSource: 'open-meteo' },
    })
    const kept = await getLog(user, run.id)
    expect(kept?.step).toMatchObject({ hot: false, outcome: 'step-up' })
    expect(kept?.hot).toBe(false)
  })

  test('weather that loads after logging judges the run on the next read', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')

    const saved = await putLog(user, run.id, logBody(gel))
    expect(saved.log?.step).toMatchObject({ hot: false, outcome: 'step-up' })
    expect(saved.ladder.currentIndex).toBe(1)

    await ctx.prisma.activity.update({
      where: { id: run.id },
      data: { tempC: 33, humidityPct: 70, windKph: 4, weatherSource: 'open-meteo' },
    })
    const reread = await getLog(user, run.id)
    expect(reread?.hot).toBeNull()
    expect(reread?.step).toMatchObject({ hot: true, outcome: 'warm-tolerated' })

    // The step-up the first answer reported is retracted in the replay.
    const again = await putLog(user, run.id, logBody(gel))
    expect(again.ladder.currentIndex).toBe(0)
    expect(again.message).toBe(
      'Warm day: tolerated at 30 to 50 g/h. The target stays at 30 to 50 g/h.',
    )
  })

  test('replays the ladder from the stored logs, in the order of the runs and not of the saves', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    expect((await putSettings(user, { ...SETTINGS, optIn90: true })).status).toBe(200)
    const dates = ['2026-08-01', '2026-08-08', '2026-08-15', '2026-08-22']
    const runs: Array<{ id: string }> = []
    for (const date of dates) runs.push(await newRun(user, date))

    // Saved newest first. Replayed by date: tolerated at the floor, then at 60, a hard run at 70
    // g/h and a second, which returns the target to 60 g/h.
    const scores = [0, 0, 2, 2]
    let last: FuelLogResult | undefined
    for (const index of [3, 2, 1, 0]) {
      last = await putLog(user, runs[index]!.id, logBody(gel, { gut: scores[index] }))
    }
    expect(last?.ladder.steps.map((s) => s.date)).toEqual(dates)
    expect(last?.ladder.steps.map((s) => s.outcome)).toEqual([
      'step-up',
      'step-up',
      'hold',
      'fall-back',
    ])
    expect(last?.ladder.currentIndex).toBe(1)
    expect(last?.ladder.toleratedIndex).toBe(1)
    expect(last?.message).toBe('Tolerated at 30 to 50 g/h. Next long run: 60 g/h.')

    const final = await getLog(user, runs[3]!.id)
    expect(final?.step.outcome).toBe('fall-back')
    const view = await putLog(user, runs[3]!.id, logBody(gel, { gut: 2 }))
    expect(view.message).toBe(
      'Scored 2 of 4 at 70 g/h. The target is back at 60 g/h, the last rate that went well.',
    )
  })

  test('only the latest steps travel with the ladder, and an older log still reads', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const total = FUEL_LADDER_STEPS_SHOWN + 5
    const start = Date.UTC(2025, 0, 6)
    const runs: Array<{ id: string }> = []
    for (let i = 0; i < total; i++) {
      const date = new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10)
      runs.push(await newRun(user, date))
    }
    await ctx.prisma.fuelLog.createMany({
      data: runs.map((run) => ({
        userId: user.id,
        activityId: run.id,
        items: JSON.stringify([
          {
            productId: gel.id,
            name: gel.name,
            carbsG: 40,
            sodiumMg: null,
            kcal: null,
            multiCarb: true,
            servings: 7,
          },
        ]),
        gut: 0,
      })),
    })
    const result = await putLog(user, runs[0]!.id, logBody(gel))
    expect(result.ladder.steps).toHaveLength(FUEL_LADDER_STEPS_SHOWN)
    expect(result.ladder.steps.at(-1)?.activityId).toBe(runs[total - 1]!.id)
    // The oldest run is outside the steps shown, and its own log still carries its step.
    expect(result.ladder.steps.some((s) => s.activityId === runs[0]!.id)).toBe(false)
    expect(result.log?.step.activityId).toBe(runs[0]!.id)
    expect(result.message).toBe('Tolerated at 30 to 50 g/h. Next long run: 60 g/h.')
  })

  test('a short run counts in a gut-training week, linked to a fuel-practice session or not', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const block = '2026-09-07'
    const short = { durationSec: 70 * 60 }
    const unlinked = await newRun(user, '2026-09-08', short)
    const linked = await newRun(user, '2026-09-10', short)
    const unflagged = await newRun(user, '2026-09-12', short)
    const outside = await newRun(user, '2026-09-01', short)
    await planWithBlock(user, block, {
      activityId: linked.id,
      date: '2026-09-10',
      flags: ['fuel-practice'],
    })
    // A second session in the block week that does not carry the flag: its run follows the session.
    const plan = await ctx.prisma.plan.findFirstOrThrow({ where: { userId: user.id } })
    await ctx.prisma.planSession.create({
      data: {
        planId: plan.id,
        externalId: randomUUID(),
        weekStart: block,
        date: '2026-09-12',
        order: 0,
        kind: 'easy',
        title: 'Easy run',
        durationMin: 70,
        target: JSON.stringify({ zone: 'z1', rpe: [2, 3], hr: null, paceSecPerKm: null }),
        purpose: 'Synthetic.',
        status: 'completed',
        activityId: unflagged.id,
        linkSource: 'auto',
      },
    })

    const body = logBody(gel, { items: [{ productId: gel.id, servings: 2 }] })
    const reasons: Record<string, string | undefined> = {}
    for (const [name, run] of Object.entries({ outside, unlinked, linked, unflagged })) {
      reasons[name] = (await putLog(user, run.id, body)).log?.step.reason
    }
    expect(reasons).toEqual({
      outside: 'too-short',
      unlinked: 'counted',
      linked: 'counted',
      unflagged: 'too-short',
    })
    const said = await getLog(user, outside.id)
    expect(said?.counts).toBe(
      `The run was shorter than ${String(P.h7.logMinDurationMin.value)} min, so it does not count toward your ladder.`,
    )
  })

  test('a run too short for the ladder still saves, and says so', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05', { durationSec: 45 * 60 })
    const result = await putLog(
      user,
      run.id,
      logBody(gel, { items: [{ productId: gel.id, servings: 2 }] }),
    )
    expect(result.log?.step.reason).toBe('too-short')
    expect(result.ladder.currentIndex).toBe(0)
    expect(result.message).toBe(result.log?.counts)
  })

  test('skip marks a run "not this time" and never replaces an answer', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')
    const skip = await client(ctx, user).post(`/api/fuel/logs/${run.id}/skip`)
    expect(skip.status).toBe(200)
    const result = skip.body as FuelLogResult
    expect(result.log).toMatchObject({ skipped: true, gut: null, nausea: null, items: [] })
    expect(result.log?.step).toMatchObject({ reason: 'skipped', outcome: 'not-counted' })
    expect(result.message).toBe(
      'Not logged this time, so this run does not count toward your ladder.',
    )
    expect(result.ladder.currentIndex).toBe(0)

    // Again is the same.
    const twice = await client(ctx, user).post(`/api/fuel/logs/${run.id}/skip`)
    expect(twice.body).toEqual(skip.body)
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: run.id } })).toBe(1)

    // A real log takes the place of the skip, and a skip does not take the place of a real log.
    const logged = await putLog(user, run.id, logBody(gel))
    expect(logged.log?.skipped).toBe(false)
    const refused = await client(ctx, user).post(`/api/fuel/logs/${run.id}/skip`)
    expect(refused.status).toBe(409)
    expect(errorOf(refused).details).toEqual({ code: 'log-exists' })
    expect((await getLog(user, run.id))?.skipped).toBe(false)
  })

  test('delete removes the log and replays the ladder without it', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const first = await newRun(user, '2026-09-05')
    const second = await newRun(user, '2026-09-12')
    await putLog(user, first.id, logBody(gel))
    const both = await putLog(user, second.id, logBody(gel))
    expect(both.ladder.toleratedIndex).toBe(1)

    const del = await client(ctx, user).delete(`/api/fuel/logs/${second.id}`)
    expect(del.status).toBe(200)
    const result = del.body as FuelLogResult
    expect(result.log).toBeNull()
    expect(result.message).toBeNull()
    expect(result.ladder.steps.map((s) => s.activityId)).toEqual([first.id])
    expect(result.ladder.toleratedIndex).toBe(0)
    expect(await getLog(user, second.id)).toBeNull()

    // Deleting a run's missing log is fine.
    const again = await client(ctx, user).delete(`/api/fuel/logs/${second.id}`)
    expect(again.status).toBe(200)
    expect((again.body as FuelLogResult).log).toBeNull()
  })

  test('deleting a run takes its log out of the ladder', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')
    await putLog(user, run.id, logBody(gel))
    expect((await client(ctx, user).delete(`/api/activities/${run.id}`)).status).toBe(204)
    expect(await ctx.prisma.fuelLog.count({ where: { userId: user.id } })).toBe(0)
  })

  test('a log is for a run: other activities are a 409 and other runners are a 404', async () => {
    const user = await newUser()
    const stranger = await newUser()
    const gel = await addProduct(user)
    const strength = await newRun(user, '2026-09-05', { type: 'strength' })
    const race = await newRun(user, '2026-09-06', { type: 'race' })
    const theirs = await newRun(stranger, '2026-09-05')

    const put = await client(ctx, user).put(`/api/fuel/logs/${strength.id}`).send(logBody(gel))
    expect(put.status).toBe(409)
    expect(errorOf(put).details).toEqual({ code: 'not-a-run' })
    const skip = await client(ctx, user).post(`/api/fuel/logs/${strength.id}/skip`)
    expect(skip.status).toBe(409)
    expect(await getLog(user, strength.id)).toBeNull()

    // A race is a run.
    expect((await putLog(user, race.id, logBody(gel))).log?.activityId).toBe(race.id)

    for (const res of [
      await client(ctx, user).get(`/api/fuel/logs/${theirs.id}`),
      await client(ctx, user).put(`/api/fuel/logs/${theirs.id}`).send(logBody(gel)),
      await client(ctx, user).post(`/api/fuel/logs/${theirs.id}/skip`),
      await client(ctx, user).delete(`/api/fuel/logs/${theirs.id}`),
      await client(ctx, user).get('/api/fuel/logs/nope'),
    ]) {
      expect(res.status).toBe(404)
      expect(errorOf(res).code).toBe('not_found')
    }
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: theirs.id } })).toBe(0)
  })

  test("a runner's logs do not move another runner's ladder", async () => {
    const mine = await newUser()
    const theirs = await newUser()
    const myGel = await addProduct(mine)
    const run = await newRun(mine, '2026-09-05')
    await putLog(mine, run.id, logBody(myGel))
    const other = await newRun(theirs, '2026-09-05')
    const result = await client(ctx, theirs).post(`/api/fuel/logs/${other.id}/skip`)
    expect((result.body as FuelLogResult).ladder.steps.map((s) => s.activityId)).toEqual([other.id])
    expect((result.body as FuelLogResult).ladder.currentIndex).toBe(0)
  })

  test("a product that is not the runner's own is a 400 on the item", async () => {
    const user = await newUser()
    const stranger = await newUser()
    const gel = await addProduct(user)
    const theirs = await addProduct(stranger, { name: 'Their gel' })
    const run = await newRun(user, '2026-09-05')
    for (const productId of [theirs.id, 'nope']) {
      const res = await client(ctx, user)
        .put(`/api/fuel/logs/${run.id}`)
        .send({
          items: [
            { productId: gel.id, servings: 1 },
            { productId, servings: 1 },
          ],
          gut: 0,
        })
      expect(res.status).toBe(400)
      expect(errorOf(res).details?.issues).toEqual([
        { path: 'items.1.productId', message: 'Choose a product from your list.' },
      ])
    }
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: run.id } })).toBe(0)
  })

  test('an archived product can still be named, as a replayed request may', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')
    await client(ctx, user).delete(`/api/fuel/products/${gel.id}`)
    const result = await putLog(user, run.id, logBody(gel))
    expect(result.log?.items[0]).toMatchObject({ productId: gel.id, name: 'Synthetic gel' })
  })

  test('validates the body with a path per field', async () => {
    const user = await newUser()
    const gel = await addProduct(user)
    const run = await newRun(user, '2026-09-05')
    const food = { name: 'Rice ball', carbsG: 30, servings: 1 }
    const score = 'Use a whole number from 0 to 4.'
    const cases: Array<[Record<string, unknown>, string, string?]> = [
      [{ gut: undefined }, 'gut', score],
      [{ gut: 5 }, 'gut', score],
      [{ gut: -1 }, 'gut', score],
      [{ gut: 1.5 }, 'gut', score],
      [{ gut: '2' }, 'gut', score],
      [{ nausea: 5 }, 'nausea', score],
      [{ hot: 'yes' }, 'hot'],
      [{ fluidMl: -1 }, 'fluidMl'],
      [{ sodiumMg: 1.5 }, 'sodiumMg'],
      [{ notes: 'x'.repeat(2001) }, 'notes'],
      [{ extra: 1 }, ''],
      [{ items: 'gel' }, 'items'],
      [{ items: [{ productId: gel.id }] }, 'items.0.servings'],
      [{ items: [{ productId: gel.id, servings: 0 }] }, 'items.0.servings'],
      [{ items: [{ productId: gel.id, servings: 51 }] }, 'items.0.servings'],
      [
        { items: [{ productId: gel.id, servings: 1, carbsG: 50 }] },
        'items.0.carbsG',
        'A product from your list already has its name and amounts. Leave this field out.',
      ],
      [{ items: [{ productId: gel.id, name: 'Other', servings: 1 }] }, 'items.0.name'],
      [
        { items: [{ name: 'Rice ball', servings: 1 }] },
        'items.0.carbsG',
        'Give the name and the carbohydrate of this food.',
      ],
      [{ items: [{ carbsG: 30, servings: 1 }] }, 'items.0.name'],
      [{ items: [{ ...food, carbsG: 301 }] }, 'items.0.carbsG'],
      [{ items: [{ ...food, extra: true }] }, 'items.0'],
      [{ items: Array.from({ length: 41 }, () => food) }, 'items'],
    ]
    for (const [over, path, message] of cases) {
      const res = await client(ctx, user)
        .put(`/api/fuel/logs/${run.id}`)
        .send({ gut: 0, ...over })
      expect(res.status, JSON.stringify(over)).toBe(400)
      expect(errorOf(res).code).toBe('validation')
      const issues = errorOf(res).details?.issues ?? []
      expect(
        issues.map((i) => i.path),
        JSON.stringify(over),
      ).toContain(path)
      if (message !== undefined) expect(issues.find((i) => i.path === path)?.message).toBe(message)
    }
    expect(await ctx.prisma.fuelLog.count({ where: { activityId: run.id } })).toBe(0)

    // The edges are accepted: no items at all, the top of the scale, a run with nothing eaten.
    const edge = await putLog(user, run.id, { items: [], gut: 4, nausea: 4, fluidMl: 0 })
    expect(edge.log).toMatchObject({ items: [], gut: 4, nausea: 4, fluidMl: 0 })
    expect(edge.log?.step.reason).toBe('below-target')
    // Nothing eaten leaves the target where it was, and a score of 4 is not a failure.
    expect(edge.ladder.currentIndex).toBe(0)
  })
})

describe('fuel writes raise the data version', () => {
  test('a product, a switch and a log each move the counter; a read does not', async () => {
    const user = await newUser()
    const run = await newRun(user, '2026-09-05')
    const count = async () => (await dataVersionKey(ctx.prisma)).n

    let before = await count()
    const gel = await addProduct(user)
    expect(await count()).toBeGreaterThan(before)

    before = await count()
    await putSettings(user, { ...SETTINGS, optIn90: true })
    expect(await count()).toBeGreaterThan(before)

    before = await count()
    await putLog(user, run.id, logBody(gel))
    expect(await count()).toBeGreaterThan(before)

    before = await count()
    await getLog(user, run.id)
    await client(ctx, user).get('/api/fuel/products')
    expect(await count()).toBe(before)
  })
})
