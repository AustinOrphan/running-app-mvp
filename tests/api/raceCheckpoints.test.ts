// GET and PUT /api/race/checkpoints and the splits of GET /api/race/plan (rule H14, ADR 0018, step 4
// of the race plan design). The table is the runner's private data: the checks here include that a
// rejected row's values reach neither the response nor the log.
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, todayIso } from '../../shared/dates.ts'
import { P } from '../../shared/engine/params/index.ts'
import type { RaceCheckpointsView, RacePlanView, ValidationIssue } from '../../shared/types.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// Every line the server logs, at every level (the real logger is silent under test), with the
// serializers the app uses, so a test can prove a rejected row never reached one.
const logged = vi.hoisted(() => ({ lines: [] as string[] }))
vi.mock('../../server/logger.ts', async () => {
  const { pino } = await import('pino')
  return {
    createLogger: () =>
      pino(
        {
          level: 'debug',
          redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        },
        {
          write: (chunk: string) => {
            logged.lines.push(chunk)
          },
        },
      ),
  }
})

let ctx: TestCtx
let users = 0

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

function newUser(): Promise<TestUser> {
  users += 1
  return seedUser(ctx, { email: `checkpoints${String(users)}@example.com` })
}

const today = todayIso()
const HUNDRED_MILES_M = 160_934

async function newGoal(user: TestUser, distanceM: number | null = HUNDRED_MILES_M) {
  return ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic 100 miler',
      priority: 'A',
      isActive: true,
      targetDate: addDays(today, 30),
      distanceM,
      gainM: 5000,
      lossM: 5000,
      surface: 'trail',
      goalType: 'finish',
      startTime: '06:00',
      supportLevel: 'aided',
    },
  })
}

const ROWS = [
  { name: 'Checkpoint A', distanceM: 30_000, gainM: 900, lossM: 400, cutoffSec: 36_000 },
  { name: 'Checkpoint B', distanceM: 80_000 },
  { name: 'Checkpoint C', distanceM: 120_000, gainM: null, lossM: 600, cutoffSec: null },
]

function issuesOf(body: unknown): ValidationIssue[] {
  return (body as { error: { details: { issues: ValidationIssue[] } } }).error.details.issues
}

describe('access', () => {
  test('an anonymous request is a 401 before the body or the query is read', async () => {
    expect((await client(ctx).get('/api/race/checkpoints')).status).toBe(401)
    expect((await client(ctx).get('/api/race/checkpoints?x=1')).status).toBe(401)
    const put = await client(ctx).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    expect(put.status).toBe(401)
    const junk = await client(ctx).put('/api/race/checkpoints').send('{not json')
    expect(junk.status).toBe(401)
  })

  test('GET takes no query', async () => {
    const user = await newUser()
    expect((await client(ctx, user).get('/api/race/checkpoints?goalId=x')).status).toBe(400)
  })

  test('both answers are private and not stored', async () => {
    const user = await newUser()
    await newGoal(user)
    const get = await client(ctx, user).get('/api/race/checkpoints')
    expect(get.headers['cache-control']).toBe('private, no-store')
    const put = await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: [] })
    expect(put.headers['cache-control']).toBe('private, no-store')
  })
})

describe('reading and replacing the table', () => {
  test('a runner with no goal has no rows, and cannot save any', async () => {
    const user = await newUser()
    const get = await client(ctx, user).get('/api/race/checkpoints')
    expect(get.body).toEqual({ goalId: null, distanceM: null, checkpoints: [] })
    const put = await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    expect(put.status).toBe(409)
    expect(JSON.stringify(put.body)).not.toContain('Checkpoint')
  })

  test('a goal with no distance cannot hold a table', async () => {
    const user = await newUser()
    await newGoal(user, null)
    const put = await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    expect(put.status).toBe(409)
  })

  test('saves the rows, answers them in distance order and keeps optional fields null', async () => {
    const user = await newUser()
    const goal = await newGoal(user)
    const put = await client(ctx, user)
      .put('/api/race/checkpoints')
      .send({ checkpoints: ROWS.map((row) => ({ ...row, name: `  ${row.name}  ` })) })
    expect(put.status, JSON.stringify(put.body)).toBe(200)
    const expected: RaceCheckpointsView = {
      goalId: goal.id,
      distanceM: HUNDRED_MILES_M,
      checkpoints: [
        { name: 'Checkpoint A', distanceM: 30_000, gainM: 900, lossM: 400, cutoffSec: 36_000 },
        { name: 'Checkpoint B', distanceM: 80_000, gainM: null, lossM: null, cutoffSec: null },
        { name: 'Checkpoint C', distanceM: 120_000, gainM: null, lossM: 600, cutoffSec: null },
      ],
    }
    expect(put.body).toEqual(expected)
    expect((await client(ctx, user).get('/api/race/checkpoints')).body).toEqual(expected)
  })

  test('a save replaces the whole table, and the same body twice is the same table', async () => {
    const user = await newUser()
    await newGoal(user)
    const api = client(ctx, user)
    await api.put('/api/race/checkpoints').send({ checkpoints: ROWS })
    const second = [{ name: 'Checkpoint Z', distanceM: 50_000 }]
    const first = await api.put('/api/race/checkpoints').send({ checkpoints: second })
    const again = await api.put('/api/race/checkpoints').send({ checkpoints: second })
    expect(again.body).toEqual(first.body)
    expect((first.body as RaceCheckpointsView).checkpoints.map((row) => row.name)).toEqual([
      'Checkpoint Z',
    ])
    expect(await ctx.prisma.raceCheckpoint.count({ where: { userId: user.id } })).toBe(1)
    const cleared = await api.put('/api/race/checkpoints').send({ checkpoints: [] })
    expect((cleared.body as RaceCheckpointsView).checkpoints).toEqual([])
  })

  test('a runner reads and writes their own table only', async () => {
    const mine = await newUser()
    const theirs = await newUser()
    await newGoal(mine)
    await newGoal(theirs)
    await client(ctx, mine).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    expect((await client(ctx, theirs).get('/api/race/checkpoints')).body).toMatchObject({
      checkpoints: [],
    })
    await client(ctx, theirs)
      .put('/api/race/checkpoints')
      .send({ checkpoints: [{ name: 'Checkpoint Y', distanceM: 10_000 }] })
    expect(
      ((await client(ctx, mine).get('/api/race/checkpoints')).body as RaceCheckpointsView)
        .checkpoints,
    ).toHaveLength(3)
  })

  test('the rows go with the goal', async () => {
    const user = await newUser()
    const goal = await newGoal(user)
    await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    await ctx.prisma.goal.delete({ where: { id: goal.id } })
    expect(await ctx.prisma.raceCheckpoint.count({ where: { userId: user.id } })).toBe(0)
  })
})

describe('validation: row indexes and field names, never values', () => {
  const SECRET = 'Zq9-Private-Place'

  async function reject(user: TestUser, checkpoints: unknown[]) {
    const res = await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints })
    expect(res.status, JSON.stringify(res.body)).toBe(400)
    return res
  }

  test('names the row and the field of each problem', async () => {
    const user = await newUser()
    await newGoal(user)
    const res = await reject(user, [
      { name: 'Checkpoint A', distanceM: 30_000 },
      { name: '   ', distanceM: 40_000, gainM: -1, lossM: 20_001, cutoffSec: 1.5 },
      { name: 'x'.repeat(61), distanceM: 'far' },
    ])
    const paths = issuesOf(res.body)
      .map((issue) => issue.path)
      .sort()
    expect(paths).toEqual(
      [
        'checkpoints.1.name',
        'checkpoints.1.gainM',
        'checkpoints.1.lossM',
        'checkpoints.1.cutoffSec',
        'checkpoints.2.name',
        'checkpoints.2.distanceM',
      ].sort(),
    )
  })

  test('a distance must increase, and must lie below the course distance', async () => {
    const user = await newUser()
    await newGoal(user)
    const same = await reject(user, [
      { name: 'Checkpoint A', distanceM: 30_000 },
      { name: 'Checkpoint B', distanceM: 30_000 },
    ])
    expect(issuesOf(same.body).map((i) => i.path)).toEqual(['checkpoints.1.distanceM'])
    const past = await reject(user, [{ name: 'Checkpoint A', distanceM: HUNDRED_MILES_M }])
    expect(issuesOf(past.body).map((i) => i.path)).toEqual(['checkpoints.0.distanceM'])
    expect(await ctx.prisma.raceCheckpoint.count({ where: { userId: user.id } })).toBe(0)
  })

  test('holds at most r1.maxCheckpoints rows', async () => {
    const user = await newUser()
    await newGoal(user)
    const max = P.r1.maxCheckpoints.value
    const rows = (n: number) =>
      Array.from({ length: n }, (_unused, i) => ({
        name: `Point ${String(i)}`,
        distanceM: 1000 + i,
      }))
    expect(
      (
        await client(ctx, user)
          .put('/api/race/checkpoints')
          .send({ checkpoints: rows(max) })
      ).status,
    ).toBe(200)
    const res = await reject(user, rows(max + 1))
    expect(issuesOf(res.body).map((i) => i.path)).toEqual(['checkpoints'])
    // The refused save left the saved table alone.
    expect(await ctx.prisma.raceCheckpoint.count({ where: { userId: user.id } })).toBe(max)
  })

  test('refuses a field it does not know, and a name with a control character', async () => {
    const user = await newUser()
    await newGoal(user)
    const extra = await reject(user, [{ name: 'Checkpoint A', distanceM: 1000, [SECRET]: 1 }])
    expect(issuesOf(extra.body).map((i) => i.path)).toEqual(['checkpoints.0'])
    const control = await reject(user, [{ name: 'Check\u0000point', distanceM: 1000 }])
    expect(issuesOf(control.body).map((i) => i.path)).toEqual(['checkpoints.0.name'])
    const top = await client(ctx, user)
      .put('/api/race/checkpoints')
      .send({ checkpoints: [], [SECRET]: 1 })
    expect(top.status).toBe(400)
    expect(JSON.stringify(top.body)).not.toContain(SECRET)
  })

  test('no value of a rejected row reaches the response or the log', async () => {
    const user = await newUser()
    await newGoal(user)
    logged.lines.length = 0
    const res = await reject(user, [
      { name: SECRET, distanceM: 30_000, gainM: 99_999, cutoffSec: 777_777_777 },
      { name: `${SECRET}-2`, distanceM: 30_000 },
      { name: SECRET.repeat(10), distanceM: 424_242, lossM: 31_337 },
    ])
    const body = JSON.stringify(res.body)
    const log = logged.lines.join('')
    expect(log.length, 'the request was logged').toBeGreaterThan(0)
    for (const value of [SECRET, '99999', '777777777', '424242', '31337']) {
      expect(body, `response holds ${value}`).not.toContain(value)
      expect(log, `log holds ${value}`).not.toContain(value)
    }
  })

  test('an accepted save leaves the values out of the log too', async () => {
    const user = await newUser()
    await newGoal(user)
    logged.lines.length = 0
    const res = await client(ctx, user)
      .put('/api/race/checkpoints')
      .send({ checkpoints: [{ name: SECRET, distanceM: 424_00 }] })
    expect(res.status).toBe(200)
    expect(logged.lines.join('')).not.toContain(SECRET)
  })
})

describe('the race plan reads the table', () => {
  async function planOf(user: TestUser): Promise<RacePlanView> {
    const res = await client(ctx, user).get('/api/race/plan')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body as RacePlanView
  }

  test('has no splits without rows, and a save shows on the next read', async () => {
    const user = await newUser()
    await newGoal(user)
    expect((await planOf(user)).plan?.splits).toBeNull()
    const first = await client(ctx, user).get('/api/race/plan')
    await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    const second = await client(ctx, user)
      .get('/api/race/plan')
      .set('If-None-Match', String(first.headers.etag))
    expect(second.status, 'a save changes the validator').toBe(200)
    const plan = (second.body as RacePlanView).plan
    expect(plan?.splits?.rows.map((row) => row.name)).toEqual([
      'Checkpoint A',
      'Checkpoint B',
      'Checkpoint C',
      null,
    ])
    const finish = plan?.splits?.rows.at(-1)
    expect([finish?.lowSec, finish?.highSec]).toEqual([
      plan?.expected.lowSec,
      plan?.expected.highSec,
    ])
    await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: [] })
    expect((await planOf(user)).plan?.splits).toBeNull()
  })

  test('carries the coarse course for the profile, from the same rows, and drops it with them', async () => {
    const user = await newUser()
    await newGoal(user)
    expect((await planOf(user)).course).toBeNull()
    await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    const view = await planOf(user)
    expect(view.course?.map((p) => p.distanceM)).toEqual([
      0,
      30_000,
      80_000,
      120_000,
      HUNDRED_MILES_M,
    ])
    expect(view.course?.[0]).toEqual({ distanceM: 0, relM: 0 })
    // Checkpoint A: 900 m up, 400 m down.
    expect(view.course?.[1]?.relM).toBe(500)
    await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: [] })
    expect((await planOf(user)).course).toBeNull()
  })

  test('a goal edit that moves the finish leaves rows past it out, with a count', async () => {
    const user = await newUser()
    const goal = await newGoal(user)
    await client(ctx, user).put('/api/race/checkpoints').send({ checkpoints: ROWS })
    await ctx.prisma.goal.update({ where: { id: goal.id }, data: { distanceM: 100_000 } })
    const splits = (await planOf(user)).plan?.splits
    expect(splits?.ignored).toBe(1)
    expect(splits?.rows.map((row) => row.name)).toEqual(['Checkpoint A', 'Checkpoint B', null])
  })
})
