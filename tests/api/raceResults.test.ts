import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf } from '../../shared/dates.ts'
import { estimateState } from '../../shared/engine/athlete.ts'
import { RESULT_ACTIVITY_WINDOW_DAYS } from '../../shared/limits.ts'
import type { PredictionView, RaceResultView, TrackRecordView } from '../../shared/types.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { cacheSizes } from '../../server/services/athleteState.ts'
import { gatherContextInput } from '../../server/services/engineInput.ts'
import { runExecutionQuietly } from '../../server/services/execution.ts'
import { client, createTestCtx, seedUser, type TestCtx, type TestUser } from './helpers.ts'

// Race results and the track record (design 11.4). The weekly log is seeded directly, so each case
// states the rows it scores; the engine is not run. Only `Date` is faked.
vi.mock('../../server/services/execution.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../server/services/execution.ts')>()
  return { ...original, runExecutionQuietly: vi.fn(original.runExecutionQuietly) }
})

// A Wednesday at noon. The race was the Sunday before, 2026-10-18, in the week of Monday 10-12.
const WEDNESDAY = new Date(2026, 9, 21, 12)
const TODAY = '2026-10-21'
const RACE_DAY = '2026-10-18'
const HALF_M = 21_097
/** 2:01:00. */
const FINISH_SEC = 7260

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(WEDNESDAY)
  await ctx.prisma.user.deleteMany()
  vi.mocked(runExecutionQuietly).mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

let counter = 0

interface GoalSeed {
  distanceM?: number | null
  name?: string
  targetDate?: string
}

async function seedGoal(user: TestUser, over: GoalSeed = {}): Promise<string> {
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: over.name ?? 'Synthetic half',
      priority: 'A',
      targetDate: over.targetDate ?? RACE_DAY,
      distanceM: over.distanceM === undefined ? HALF_M : over.distanceM,
      goalType: 'finish',
    },
  })
  return goal.id
}

async function seedRunner(over: GoalSeed = {}): Promise<{ user: TestUser; goalId: string }> {
  counter += 1
  const user = await seedUser(ctx, { email: `racer${String(counter)}@example.com` })
  return { user, goalId: await seedGoal(user, over) }
}

interface LogSeed {
  weekStart: string
  loggedOn: string
  predictedSec: number
  /** The course snapshot; undefined is the half marathon, null is a row from before snapshots. */
  course?: { distanceM: number | null; gainM?: number | null } | null
  createdAt?: Date
}

async function seedLog(userId: string, goalId: string, seed: LogSeed) {
  const inputs =
    seed.course === null
      ? { today: seed.loggedOn }
      : {
          today: seed.loggedOn,
          course: { gainM: null, surface: 'road', wbgtC: null, distanceM: HALF_M, ...seed.course },
        }
  return ctx.prisma.predictionLog.create({
    data: {
      userId,
      goalId,
      method: 'synthetic',
      predictedSec: seed.predictedSec,
      lowSec: seed.predictedSec - 300,
      highSec: seed.predictedSec + 300,
      weekStart: seed.weekStart,
      loggedOn: seed.loggedOn,
      inputs: JSON.stringify(inputs),
      ...(seed.createdAt === undefined ? {} : { createdAt: seed.createdAt }),
    },
  })
}

/**
 * Five weeks of a half marathon goal: a row from before course snapshots, a week with two rows (the
 * older one wildly off), two more weeks, and a row logged after race day.
 */
async function seedStandardLog(userId: string, goalId: string): Promise<void> {
  await seedLog(userId, goalId, {
    weekStart: '2026-09-21',
    loggedOn: '2026-09-23',
    predictedSec: 7500,
    course: null,
  })
  await seedLog(userId, goalId, {
    weekStart: '2026-09-28',
    loggedOn: '2026-09-29',
    predictedSec: 9999,
    createdAt: new Date(2026, 8, 29, 8),
  })
  await seedLog(userId, goalId, {
    weekStart: '2026-09-28',
    loggedOn: '2026-09-30',
    predictedSec: 7400,
    createdAt: new Date(2026, 8, 30, 8),
  })
  await seedLog(userId, goalId, {
    weekStart: '2026-10-05',
    loggedOn: '2026-10-07',
    predictedSec: 7300,
  })
  await seedLog(userId, goalId, {
    weekStart: '2026-10-12',
    loggedOn: '2026-10-14',
    predictedSec: 7200,
  })
  await seedLog(userId, goalId, {
    weekStart: '2026-10-19',
    loggedOn: '2026-10-20',
    predictedSec: 7100,
  })
}

/** One prediction, logged four days before `raceDate`, in that day's local week. */
function seedPredictionBefore(
  userId: string,
  goalId: string,
  raceDate: string,
  predictedSec: number,
) {
  const loggedOn = addDays(raceDate, -4)
  return seedLog(userId, goalId, { weekStart: mondayOf(loggedOn), loggedOn, predictedSec })
}

async function seedActivity(
  user: TestUser,
  over: { date?: string; type?: string; distanceM?: number | null; durationSec?: number } = {},
): Promise<string> {
  const activity = await ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: over.date ?? RACE_DAY,
      type: over.type ?? 'run',
      durationSec: over.durationSec ?? FINISH_SEC + 10,
      distanceM: over.distanceM === undefined ? HALF_M + 40 : over.distanceM,
      source: 'manual',
    },
  })
  return activity.id
}

const finished = (over: Record<string, unknown> = {}) => ({
  outcome: 'finished',
  timeSec: FINISH_SEC,
  date: RACE_DAY,
  ...over,
})

const putResult = (user: TestUser, goalId: string, body: unknown) =>
  client(ctx, user)
    .put(`/api/goals/${goalId}/result`)
    .send(body as object)

async function save(user: TestUser, goalId: string, body: unknown = finished()) {
  const res = await putResult(user, goalId, body)
  expect(res.status, JSON.stringify(res.body)).toBeLessThan(300)
  return res.body as RaceResultView
}

async function getRecord(user: TestUser): Promise<TrackRecordView> {
  const res = await client(ctx, user).get('/api/predictions/record')
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as TrackRecordView
}

const logRows = (goalId: string) =>
  ctx.prisma.predictionLog.findMany({
    where: { goalId },
    orderBy: [{ loggedOn: 'asc' }, { createdAt: 'asc' }],
  })

/** The paths of the issues in a 400, sorted. */
function issuePaths(res: { body: unknown }): string[] {
  const body = res.body as { error: { details?: { issues?: { path: string }[] } } }
  return (body.error.details?.issues ?? []).map((issue) => issue.path).sort()
}

describe('PUT /api/goals/:id/result: a finished race', () => {
  test('creates the result (201), scores one prediction per week and sets actualSec on pre-race rows', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    const before = await logRows(goalId)

    const res = await putResult(user, goalId, finished({ note: ' Synthetic note ' }))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      goalId,
      activityId: null,
      date: RACE_DAY,
      distanceM: HALF_M,
      gainM: null,
      outcome: 'finished',
      timeSec: FINISH_SEC,
      note: 'Synthetic note',
      // five weeks logged; the week of 09-28 counts once; the row after race day is not scored
      scoredPredictions: 4,
      activityMarkedAsRace: false,
    })

    const after = await logRows(goalId)
    // the log is untouched apart from actualSec: same rows, same predictions
    expect(after.map((r) => [r.id, r.predictedSec, r.loggedOn])).toEqual(
      before.map((r) => [r.id, r.predictedSec, r.loggedOn]),
    )
    // every row logged before race day, including the older row of a shared week
    expect(after.map((r) => [r.loggedOn, r.actualSec])).toEqual([
      ['2026-09-23', FINISH_SEC],
      ['2026-09-29', FINISH_SEC],
      ['2026-09-30', FINISH_SEC],
      ['2026-10-07', FINISH_SEC],
      ['2026-10-14', FINISH_SEC],
      ['2026-10-20', null],
    ])
  })

  test('a second PUT replaces the result (200) and scores again', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    const first = await save(user, goalId)

    const res = await putResult(user, goalId, finished({ timeSec: 7500, note: null }))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: first.id,
      timeSec: 7500,
      note: null,
      scoredPredictions: 4,
    })
    expect(await ctx.prisma.raceResult.count({ where: { goalId } })).toBe(1)
    expect((await logRows(goalId)).map((r) => r.actualSec)).toEqual([
      7500,
      7500,
      7500,
      7500,
      7500,
      null,
    ])
    // the record follows the edit
    const record = await getRecord(user)
    expect(record.races[0]).toMatchObject({ resultSec: 7500, headline: { errorSec: 300 } })
  })

  test('a race with no predictions logged saves and compares nothing', async () => {
    const { user, goalId } = await seedRunner()
    const result = await save(user, goalId)
    expect(result.scoredPredictions).toBe(0)
    const record = await getRecord(user)
    expect(record.races[0]).toMatchObject({ points: [], headline: null, unscoredCount: 0 })
    expect(record.summary.raceCount).toBe(0)
  })

  test('only comparable courses are scored: a row for another distance keeps a null actualSec', async () => {
    const { user, goalId } = await seedRunner()
    await seedLog(user.id, goalId, {
      weekStart: '2026-09-21',
      loggedOn: '2026-09-23',
      predictedSec: 7500,
      course: { distanceM: 10_000 },
    })
    await seedLog(user.id, goalId, {
      weekStart: '2026-09-28',
      loggedOn: '2026-09-30',
      predictedSec: 7400,
      // within the 2% tolerance of the raced distance
      course: { distanceM: HALF_M - 300 },
    })
    await seedLog(user.id, goalId, {
      weekStart: '2026-10-05',
      loggedOn: '2026-10-07',
      predictedSec: 7300,
      course: null,
    })
    await seedLog(user.id, goalId, {
      weekStart: '2026-10-12',
      loggedOn: '2026-10-14',
      predictedSec: 7200,
      // a hillier course: the climb counts as distance when both courses state it
      course: { distanceM: HALF_M, gainM: 100 },
    })

    const result = await save(user, goalId, finished({ gainM: 1500 }))
    expect(result.scoredPredictions).toBe(2)
    expect((await logRows(goalId)).map((r) => [r.loggedOn, r.actualSec])).toEqual([
      ['2026-09-23', null],
      ['2026-09-30', FINISH_SEC],
      ['2026-10-07', FINISH_SEC],
      ['2026-10-14', null],
    ])
    const record = await getRecord(user)
    expect(record.races[0]).toMatchObject({ unscoredCount: 2 })
    expect(record.races[0]!.points.map((p) => p.loggedOn)).toEqual(['2026-09-30', '2026-10-07'])
  })

  test('the raced distance in the body decides what is comparable', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    // the runner entered 10 km for a goal that says half marathon: nothing was predicted for that
    const result = await save(user, goalId, finished({ distanceM: 10_000 }))
    expect(result).toMatchObject({ distanceM: 10_000, scoredPredictions: 1 })
    // only the row from before course snapshots can be taken as comparable
    expect((await logRows(goalId)).map((r) => r.actualSec)).toEqual([
      FINISH_SEC,
      null,
      null,
      null,
      null,
      null,
    ])
  })

  test('the distance comes from the body, then the activity, then the goal', async () => {
    const { user, goalId } = await seedRunner()
    const activityId = await seedActivity(user, { distanceM: 21_150 })

    expect((await save(user, goalId, finished({ distanceM: 21_000, activityId }))).distanceM).toBe(
      21_000,
    )
    expect((await save(user, goalId, finished({ activityId }))).distanceM).toBe(21_150)
    expect((await save(user, goalId, finished({ activityId: null }))).distanceM).toBe(HALF_M)
  })
})

describe('PUT /api/goals/:id/result: a race not finished', () => {
  test('stores no time, scores nothing and clears the actualSec a finished result had set', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    await save(user, goalId)
    expect((await logRows(goalId)).filter((r) => r.actualSec !== null)).toHaveLength(5)

    // a time sent with a did-not-finish is dropped
    const res = await putResult(user, goalId, {
      outcome: 'did-not-finish',
      timeSec: FINISH_SEC,
      date: RACE_DAY,
      note: 'Stopped at the second aid station.',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      outcome: 'did-not-finish',
      timeSec: null,
      scoredPredictions: 0,
      note: 'Stopped at the second aid station.',
    })
    expect((await logRows(goalId)).every((r) => r.actualSec === null)).toBe(true)
    expect(await ctx.prisma.predictionLog.count({ where: { goalId } })).toBe(6)

    const record = await getRecord(user)
    // four weeks before race day (the week of 09-28 counts once) are shown unscored
    expect(record.races[0]).toMatchObject({
      outcome: 'did-not-finish',
      resultSec: null,
      points: [],
      headline: null,
      inside: null,
      unscoredCount: 4,
    })
    expect(record.summary.raceCount).toBe(0)
  })

  test('needs no finish time', async () => {
    const { user, goalId } = await seedRunner()
    const res = await putResult(user, goalId, { outcome: 'did-not-finish', date: RACE_DAY })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ outcome: 'did-not-finish', timeSec: null })
  })
})

describe('PUT /api/goals/:id/result: validation (400 with paths)', () => {
  test('a finished race needs a finish time', async () => {
    const { user, goalId } = await seedRunner()
    for (const body of [
      { outcome: 'finished', date: RACE_DAY },
      { outcome: 'finished', date: RACE_DAY, timeSec: null },
    ]) {
      const res = await putResult(user, goalId, body)
      expect(res.status).toBe(400)
      expect((res.body as { error: { code: string } }).error.code).toBe('validation')
      expect(issuePaths(res)).toEqual(['timeSec'])
    }
    expect(await ctx.prisma.raceResult.count()).toBe(0)
  })

  test('the date is a real day that has not come', async () => {
    const { user, goalId } = await seedRunner()
    const tomorrow = await putResult(user, goalId, finished({ date: '2026-10-22' }))
    expect(tomorrow.status).toBe(400)
    expect(issuePaths(tomorrow)).toEqual(['date'])
    for (const date of ['2026-02-30', 'yesterday', '18/10/2026', 20261018, null]) {
      const res = await putResult(user, goalId, finished({ date }))
      expect(res.status, String(date)).toBe(400)
      expect(issuePaths(res)).toEqual(['date'])
    }
    // today is fine
    expect((await putResult(user, goalId, finished({ date: TODAY }))).status).toBe(201)
  })

  test('reports every bad field at once, and rejects bad types and bounds', async () => {
    const { user, goalId } = await seedRunner()
    const res = await putResult(user, goalId, {
      outcome: 'won',
      timeSec: 0,
      date: 'soon',
      distanceM: -5,
      gainM: 99_999,
      activityId: '',
      note: 'x'.repeat(2001),
    })
    expect(res.status).toBe(400)
    expect(issuePaths(res)).toEqual(
      ['activityId', 'date', 'distanceM', 'gainM', 'note', 'outcome', 'timeSec'].sort(),
    )
    for (const timeSec of [1.5, '7260', 540_001]) {
      const bad = await putResult(user, goalId, finished({ timeSec }))
      expect(bad.status, String(timeSec)).toBe(400)
      expect(issuePaths(bad)).toEqual(['timeSec'])
    }
    expect((await putResult(user, goalId, [])).status).toBe(400)
    expect((await putResult(user, goalId, undefined)).status).toBe(400)
  })

  test('a distance has to come from the body, the activity or the goal', async () => {
    const { user, goalId } = await seedRunner({ distanceM: null })
    const none = await putResult(user, goalId, finished())
    expect(none.status).toBe(400)
    expect(issuePaths(none)).toEqual(['distanceM'])

    // an activity without a distance does not supply one
    const bare = await seedActivity(user, { distanceM: null })
    const withBare = await putResult(user, goalId, finished({ activityId: bare }))
    expect(withBare.status).toBe(400)
    expect(issuePaths(withBare)).toEqual(['distanceM'])

    expect((await putResult(user, goalId, finished({ distanceM: HALF_M }))).status).toBe(201)
  })

  test(`a linked activity is a run or a race within ${String(RESULT_ACTIVITY_WINDOW_DAYS)} days of the date`, async () => {
    const { user, goalId } = await seedRunner()
    const early = await seedActivity(user, { date: '2026-10-15' })
    const late = await seedActivity(user, { date: '2026-10-21' })
    const tooEarly = await seedActivity(user, { date: '2026-10-14' })
    const tooLate = await seedActivity(user, { date: '2026-10-22' })
    const strength = await seedActivity(user, { type: 'strength' })
    const cross = await seedActivity(user, { type: 'cross' })

    // exactly the window either side of the date is allowed
    expect((await putResult(user, goalId, finished({ activityId: early }))).status).toBe(201)
    expect((await putResult(user, goalId, finished({ activityId: late }))).status).toBe(200)
    for (const activityId of [tooEarly, tooLate, strength, cross]) {
      const res = await putResult(user, goalId, finished({ activityId }))
      expect(res.status, activityId).toBe(400)
      expect(issuePaths(res)).toEqual(['activityId'])
    }
    // a race activity is accepted as it is
    const race = await seedActivity(user, { type: 'race' })
    const res = await putResult(user, goalId, finished({ activityId: race }))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ activityId: race, activityMarkedAsRace: false })
  })

  test('nothing is written when validation fails', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    const activityId = await seedActivity(user, { date: '2026-09-01' })
    const version = (await dataVersionKey(ctx.prisma)).n
    const res = await putResult(user, goalId, finished({ activityId }))
    expect(res.status).toBe(400)
    expect(await ctx.prisma.raceResult.count()).toBe(0)
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })).type).toBe(
      'run',
    )
    expect((await logRows(goalId)).every((r) => r.actualSec === null)).toBe(true)
    expect((await dataVersionKey(ctx.prisma)).n).toBe(version)
  })
})

describe('PUT /api/goals/:id/result: who may write (401, 404, 409)', () => {
  test('answers 401 before it reads the body', async () => {
    const { goalId } = await seedRunner()
    const res = await client(ctx).put(`/api/goals/${goalId}/result`).send({ outcome: 'won' })
    expect(res.status).toBe(401)
    expect((await client(ctx).delete(`/api/goals/${goalId}/result`)).status).toBe(401)
    expect((await client(ctx).get('/api/predictions/record')).status).toBe(401)
  })

  test('answers 404 for a goal that is not the runner’s or does not exist', async () => {
    const mine = await seedRunner()
    const other = await seedRunner()
    const foreign = await putResult(mine.user, other.goalId, finished())
    expect(foreign.status).toBe(404)
    expect((foreign.body as { error: { code: string } }).error.code).toBe('not_found')
    expect((await putResult(mine.user, 'no-such-goal', finished())).status).toBe(404)
    expect(await ctx.prisma.raceResult.count()).toBe(0)
  })

  test('answers 404 for an activity that is not the runner’s', async () => {
    const mine = await seedRunner()
    const other = await seedRunner()
    const theirs = await seedActivity(other.user)
    const res = await putResult(mine.user, mine.goalId, finished({ activityId: theirs }))
    expect(res.status).toBe(404)
    expect((await putResult(mine.user, mine.goalId, finished({ activityId: 'nope' }))).status).toBe(
      404,
    )
    // the other runner's run is not retyped
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id: theirs } })).type).toBe(
      'run',
    )
  })

  test('answers 409 for an activity that is the result of another race, and changes nothing', async () => {
    const { user, goalId } = await seedRunner()
    const otherGoal = await seedGoal(user, { name: 'Synthetic ten', distanceM: 10_000 })
    const activityId = await seedActivity(user)
    await save(user, otherGoal, finished({ activityId, distanceM: 10_000 }))

    const res = await putResult(user, goalId, finished({ activityId }))
    expect(res.status).toBe(409)
    expect((res.body as { error: { code: string } }).error.code).toBe('conflict')
    expect(await ctx.prisma.raceResult.count({ where: { goalId } })).toBe(0)
    // the goal that owns the link may save it again
    const again = await putResult(user, otherGoal, finished({ activityId, distanceM: 10_000 }))
    expect(again.status).toBe(200)
  })
})

describe('PUT /api/goals/:id/result: linking an activity', () => {
  test('retypes the run to a race, says so once, and keeps the type when the link is removed', async () => {
    const { user, goalId } = await seedRunner()
    const activityId = await seedActivity(user)
    const typeOf = async () =>
      (await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })).type

    const first = await save(user, goalId, finished({ activityId }))
    expect(first).toMatchObject({ activityId, activityMarkedAsRace: true })
    expect(await typeOf()).toBe('race')

    // saved again: already a race, nothing was retyped by this save
    expect(await save(user, goalId, finished({ activityId }))).toMatchObject({
      activityId,
      activityMarkedAsRace: false,
    })

    // unlinked: the result no longer points at it, and the runner's activity stays what it is
    const unlinked = await save(user, goalId, finished({ activityId: null }))
    expect(unlinked).toMatchObject({ activityId: null, activityMarkedAsRace: false })
    expect(await typeOf()).toBe('race')
    expect((await ctx.prisma.raceResult.findUniqueOrThrow({ where: { goalId } })).activityId).toBe(
      null,
    )
  })

  test('moving the link to another activity frees the first one for another result', async () => {
    const { user, goalId } = await seedRunner()
    const first = await seedActivity(user)
    const second = await seedActivity(user, { date: '2026-10-17' })
    await save(user, goalId, finished({ activityId: first }))
    const moved = await save(user, goalId, finished({ activityId: second }))
    expect(moved).toMatchObject({ activityId: second, activityMarkedAsRace: true })

    const otherGoal = await seedGoal(user, { name: 'Synthetic ten' })
    expect((await putResult(user, otherGoal, finished({ activityId: first }))).status).toBe(201)
  })

  test('the linked activity is among the race anchors of the next engine input', async () => {
    const { user, goalId } = await seedRunner()
    const activityId = await seedActivity(user, { distanceM: 21_150, durationSec: 7270 })
    const anchors = async () => {
      const input = await gatherContextInput(ctx, { userId: user.id, today: TODAY, goalId })
      return estimateState(input).fitness.races
    }
    expect(await anchors()).toEqual([])

    await save(user, goalId, finished({ activityId }))
    expect(await anchors()).toEqual([{ date: RACE_DAY, distanceM: 21_150, timeSec: 7270 }])
  })

  test('matches the activity to the plan again once the result is committed', async () => {
    const { user, goalId } = await seedRunner()
    const activityId = await seedActivity(user)
    // the row is visible, and the run already a race, when the matcher is asked
    const seen: { results: number; type: string | undefined }[] = []
    vi.mocked(runExecutionQuietly).mockImplementationOnce(async () => {
      seen.push({
        results: await ctx.prisma.raceResult.count({ where: { goalId } }),
        type: (await ctx.prisma.activity.findUnique({ where: { id: activityId } }))?.type,
      })
    })
    await save(user, goalId, finished({ activityId }))
    expect(runExecutionQuietly).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runExecutionQuietly).mock.calls[0]![1]).toEqual({
      userId: user.id,
      activityId,
    })
    expect(seen).toEqual([{ results: 1, type: 'race' }])

    // a result with no activity has nothing to match, and neither does a failed save
    vi.mocked(runExecutionQuietly).mockClear()
    await save(user, goalId, finished())
    await putResult(user, goalId, finished({ date: 'soon', activityId }))
    expect(runExecutionQuietly).not.toHaveBeenCalled()
  })
})

describe('the data version', () => {
  test('a result raises it through the client, and the log alone does not', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    const start = (await dataVersionKey(ctx.prisma)).n

    await save(user, goalId)
    const afterSave = (await dataVersionKey(ctx.prisma)).n
    expect(afterSave).toBeGreaterThan(start)

    await client(ctx, user).delete(`/api/goals/${goalId}/result`)
    const afterDelete = (await dataVersionKey(ctx.prisma)).n
    expect(afterDelete).toBeGreaterThan(afterSave)

    // a log write alone (non-state) leaves the version where it was
    await ctx.prisma.predictionLog.updateMany({ where: { goalId }, data: { actualSec: 1 } })
    expect((await dataVersionKey(ctx.prisma)).n).toBe(afterDelete)
  })
})

describe('DELETE /api/goals/:id/result', () => {
  test('answers 204, clears every actualSec and keeps the log rows and the activity', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    const activityId = await seedActivity(user)
    await save(user, goalId, finished({ activityId }))
    const rows = await logRows(goalId)

    const res = await client(ctx, user).delete(`/api/goals/${goalId}/result`)
    expect(res.status).toBe(204)
    expect(await ctx.prisma.raceResult.count({ where: { goalId } })).toBe(0)
    const after = await logRows(goalId)
    expect(after.map((r) => r.id)).toEqual(rows.map((r) => r.id))
    expect(after.every((r) => r.actualSec === null)).toBe(true)
    expect((await ctx.prisma.activity.findUniqueOrThrow({ where: { id: activityId } })).type).toBe(
      'race',
    )
    expect((await getRecord(user)).races).toEqual([])
  })

  test('answers 404 for a goal without a result, another runner’s goal and an unknown goal', async () => {
    const mine = await seedRunner()
    const other = await seedRunner()
    await save(other.user, other.goalId)
    expect((await client(ctx, mine.user).delete(`/api/goals/${mine.goalId}/result`)).status).toBe(
      404,
    )
    expect((await client(ctx, mine.user).delete(`/api/goals/${other.goalId}/result`)).status).toBe(
      404,
    )
    expect((await client(ctx, mine.user).delete('/api/goals/nope/result')).status).toBe(404)
    // the other runner's result is still there
    expect(await ctx.prisma.raceResult.count({ where: { goalId: other.goalId } })).toBe(1)
  })

  test('the next save after a removal starts from the log again', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    await save(user, goalId)
    await client(ctx, user).delete(`/api/goals/${goalId}/result`)
    const again = await putResult(user, goalId, finished({ timeSec: 7000 }))
    expect(again.status).toBe(201)
    expect((again.body as RaceResultView).scoredPredictions).toBe(4)
    expect((await logRows(goalId)).map((r) => r.actualSec)).toEqual([
      7000,
      7000,
      7000,
      7000,
      7000,
      null,
    ])
  })
})

describe('cascades', () => {
  test('deleting the linked activity keeps the result and unlinks it', async () => {
    const { user, goalId } = await seedRunner()
    const activityId = await seedActivity(user)
    await save(user, goalId, finished({ activityId }))
    expect((await client(ctx, user).delete(`/api/activities/${activityId}`)).status).toBe(204)
    expect(await ctx.prisma.raceResult.findUniqueOrThrow({ where: { goalId } })).toMatchObject({
      activityId: null,
      timeSec: FINISH_SEC,
    })
    expect((await getRecord(user)).races[0]).toMatchObject({ goalId, activityId: null })
  })

  test('deleting the goal deletes its result and its log', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    await save(user, goalId)
    expect((await client(ctx, user).delete(`/api/goals/${goalId}`)).status).toBe(204)
    expect(await ctx.prisma.raceResult.count({ where: { goalId } })).toBe(0)
    expect(await ctx.prisma.predictionLog.count({ where: { goalId } })).toBe(0)
    expect((await getRecord(user)).races).toEqual([])
  })

  test('deleting the runner deletes the result', async () => {
    const { user, goalId } = await seedRunner()
    await save(user, goalId)
    await ctx.prisma.user.delete({ where: { id: user.id } })
    expect(await ctx.prisma.raceResult.count()).toBe(0)
  })
})

describe('GET /api/predictions?goalId after a result', () => {
  test('one entry per week, each with the finish time it was held against', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    await save(user, goalId)
    const res = await client(ctx, user).get(`/api/predictions?goalId=${goalId}`)
    expect(res.status).toBe(200)
    const log = (res.body as PredictionView).log
    expect(log.map((e) => [e.weekStart, e.loggedOn, e.predictedSec, e.actualSec])).toEqual([
      ['2026-10-19', '2026-10-20', 7100, null],
      ['2026-10-12', '2026-10-14', 7200, FINISH_SEC],
      ['2026-10-05', '2026-10-07', 7300, FINISH_SEC],
      ['2026-09-28', '2026-09-30', 7400, FINISH_SEC],
      ['2026-09-21', '2026-09-23', 7500, FINISH_SEC],
    ])
  })
})

describe('GET /api/predictions/record', () => {
  test('is empty before any result, and asks for three scored races', async () => {
    const { user } = await seedRunner()
    expect(await getRecord(user)).toEqual({
      races: [],
      summary: {
        raceCount: 0,
        insideCount: null,
        medianSignedPct: null,
        medianAbsPct: null,
        enough: false,
        needed: 3,
      },
    })
  })

  test('scores one prediction per week, oldest first, with the headline from the last week', async () => {
    const { user, goalId } = await seedRunner({ name: 'Synthetic half' })
    await seedStandardLog(user.id, goalId)
    const activityId = await seedActivity(user)
    await save(user, goalId, finished({ activityId, gainM: 120, note: 'Synthetic note' }))

    const record = await getRecord(user)
    expect(record.races).toHaveLength(1)
    const race = record.races[0]!
    expect(race).toMatchObject({
      goalId,
      goalName: 'Synthetic half',
      // the linked run is 40 m longer than the goal, and the run's distance is the one used
      distanceM: HALF_M + 40,
      gainM: 120,
      activityId,
      note: 'Synthetic note',
      date: RACE_DAY,
      outcome: 'finished',
      resultSec: FINISH_SEC,
      inside: true,
      unscoredCount: 0,
    })
    // the older row of the week of 09-28 (9999 s) is collapsed away before scoring
    expect(race.points.map((p) => [p.weekStart, p.loggedOn, p.predictedSec])).toEqual([
      ['2026-09-21', '2026-09-23', 7500],
      ['2026-09-28', '2026-09-30', 7400],
      ['2026-10-05', '2026-10-07', 7300],
      ['2026-10-12', '2026-10-14', 7200],
    ])
    expect(race.points.map((p) => p.weeksBefore)).toEqual([3, 2, 1, 0])
    expect(race.headline).toMatchObject({
      predictedSec: 7200,
      lowSec: 6900,
      highSec: 7500,
      daysBefore: 4,
      errorSec: 60,
      inside: true,
    })
    expect(race.headline!.errorPct).toBeCloseTo((60 / 7200) * 100, 10)
    expect(record.summary).toMatchObject({ raceCount: 1, enough: false, needed: 2 })
  })

  test('collapse prefers the newest row of a week whatever order the rows were written in', async () => {
    const { user, goalId } = await seedRunner()
    // written newest first and then an older day written later, so creation order cannot decide
    await seedLog(user.id, goalId, {
      weekStart: '2026-10-12',
      loggedOn: '2026-10-15',
      predictedSec: 7200,
      createdAt: new Date(2026, 9, 15, 9),
    })
    await seedLog(user.id, goalId, {
      weekStart: '2026-10-12',
      loggedOn: '2026-10-13',
      predictedSec: 9000,
      createdAt: new Date(2026, 9, 16, 9),
    })
    await save(user, goalId)
    const race = (await getRecord(user)).races[0]!
    expect(race.points.map((p) => [p.loggedOn, p.predictedSec])).toEqual([['2026-10-15', 7200]])
  })

  test('a race not finished is listed, unscored, and does not count toward the summary', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    await save(user, goalId, { outcome: 'did-not-finish', date: RACE_DAY })
    const record = await getRecord(user)
    expect(record.races).toHaveLength(1)
    expect(record.races[0]).toMatchObject({ outcome: 'did-not-finish', headline: null })
    expect(record.summary).toMatchObject({ raceCount: 0, enough: false, needed: 3 })
  })

  test('lists races newest first and shows the pattern only from three scored races', async () => {
    const { user } = await seedRunner()
    // each race: one prediction a few days before, a range of 300 s either side
    const races = [
      { name: 'Synthetic 3', date: '2026-03-14', predictedSec: 7500, finish: 7600 },
      { name: 'Synthetic 4', date: '2026-06-06', predictedSec: 7400, finish: 7200 },
      { name: 'Synthetic 5', date: '2026-09-12', predictedSec: 7300, finish: 8000 },
    ]
    for (const [index, race] of races.entries()) {
      const goalId = await seedGoal(user, { name: race.name, targetDate: race.date })
      await seedPredictionBefore(user.id, goalId, race.date, race.predictedSec)
      await save(user, goalId, finished({ date: race.date, timeSec: race.finish }))
      const { summary } = await getRecord(user)
      expect(summary.raceCount).toBe(index + 1)
      expect(summary.enough).toBe(index + 1 >= 3)
      expect(summary.needed).toBe(Math.max(0, 3 - (index + 1)))
    }
    const record = await getRecord(user)
    expect(record.races.map((r) => r.goalName)).toEqual([
      'Synthetic 5',
      'Synthetic 4',
      'Synthetic 3',
    ])
    // 7600 is inside 7500 +- 300 and 7200 inside 7400 +- 300; 8000 is outside 7300 +- 300
    expect(record.summary.insideCount).toBe(2)
    expect(record.summary.medianSignedPct).toBeCloseTo((100 / 7500) * 100, 10)
    expect(record.summary.medianAbsPct).toBeCloseTo((200 / 7400) * 100, 10)
  })

  test('a race not finished among two scored races leaves the summary one short', async () => {
    const { user } = await seedRunner()
    const races = [
      { name: 'Synthetic 3', date: '2026-03-14', time: 7500 },
      { name: 'Synthetic 4', date: '2026-06-06', time: 7500 },
      { name: 'Synthetic 5', date: '2026-09-12', time: null },
    ]
    for (const race of races) {
      const goalId = await seedGoal(user, { name: race.name, targetDate: race.date })
      await seedPredictionBefore(user.id, goalId, race.date, 7400)
      await save(
        user,
        goalId,
        race.time === null
          ? { outcome: 'did-not-finish', date: race.date }
          : finished({ date: race.date, timeSec: race.time }),
      )
    }
    const { summary, races: listed } = await getRecord(user)
    expect(listed).toHaveLength(3)
    expect(summary).toMatchObject({ raceCount: 2, insideCount: null, enough: false, needed: 1 })
  })

  test('shows a runner only their own races', async () => {
    const mine = await seedRunner({ name: 'Synthetic mine' })
    const other = await seedRunner({ name: 'Synthetic other' })
    await save(mine.user, mine.goalId)
    await save(other.user, other.goalId)
    expect((await getRecord(mine.user)).races.map((r) => r.goalName)).toEqual(['Synthetic mine'])
    expect((await getRecord(other.user)).races.map((r) => r.goalName)).toEqual(['Synthetic other'])
  })

  test('loads all of a goal’s rows in one query, with no page cut before the collapse', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    await save(user, goalId)
    const findMany = vi.spyOn(ctx.prisma.predictionLog, 'findMany')
    await getRecord(user)
    expect(findMany).toHaveBeenCalledTimes(1)
    const args = findMany.mock.calls[0]![0]!
    expect(args.where).toEqual({ userId: user.id, goalId: { in: [goalId] } })
    expect(args).not.toHaveProperty('take')
    expect(args).not.toHaveProperty('skip')
  })

  test('rejects a query it does not read', async () => {
    const { user } = await seedRunner()
    const res = await client(ctx, user).get('/api/predictions/record?goalId=x')
    expect(res.status).toBe(400)
    expect((res.body as { error: { code: string } }).error.code).toBe('validation')
  })

  test('is memoised by data version: no read on a repeat, a rebuild after a result changes', async () => {
    const { user, goalId } = await seedRunner()
    await seedStandardLog(user.id, goalId)
    await save(user, goalId)
    const findMany = vi.spyOn(ctx.prisma.raceResult, 'findMany')
    const memos = cacheSizes(ctx.prisma).memos

    const first = await getRecord(user)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(cacheSizes(ctx.prisma).memos).toBe(memos + 1)
    expect(await getRecord(user)).toEqual(first)
    expect(await getRecord(user)).toEqual(first)
    expect(findMany).toHaveBeenCalledTimes(1)

    // an edit is a state write: the record is built again and shows it
    await save(user, goalId, finished({ timeSec: 7500 }))
    findMany.mockClear()
    const edited = await getRecord(user)
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(edited.races[0]!.resultSec).toBe(7500)
    await getRecord(user)
    expect(findMany).toHaveBeenCalledTimes(1)

    // so is a removal
    await client(ctx, user).delete(`/api/goals/${goalId}/result`)
    findMany.mockClear()
    expect((await getRecord(user)).races).toEqual([])
    expect(findMany).toHaveBeenCalledTimes(1)
  })

  test('the memo is per runner', async () => {
    const mine = await seedRunner()
    const other = await seedRunner()
    await save(mine.user, mine.goalId)
    expect((await getRecord(mine.user)).races).toHaveLength(1)
    expect((await getRecord(other.user)).races).toHaveLength(0)
  })
})
