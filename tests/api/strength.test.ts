import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { strengthTypeLockedMessage } from '../../shared/copy/strengthTemplates.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { EXERCISES } from '../../shared/domain/strengthLibrary.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { memoByVersion } from '../../server/services/athleteState.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import type {
  Activity,
  EquipmentConfig,
  ParsedActivity,
  StrengthLift,
  StrengthLog,
  StrengthLogResult,
  StrengthSettings,
  StrengthSnapshot,
} from '../../shared/types.ts'
import { days, only, planFixture, type Fixture } from './adjustFixture.ts'
import {
  client,
  createTestCtx,
  expectNoRefusedFetches,
  seedUser,
  type TestCtx,
  type TestUser,
} from './helpers.ts'

// The write side of the strength API (strength design 9.4 and 9.5): the setup, the starting points
// and the idempotent log save. The read side is task E14-6.

let ctx: TestCtx
let seeded = 0
let fixture: Fixture

beforeAll(async () => {
  ctx = await createTestCtx()
  fixture = await planFixture(ctx, 'planned@example.com')
})

afterEach(() => {
  expectNoRefusedFetches(ctx)
})

afterAll(async () => {
  await ctx.close()
})

/** A runner of their own, so that one test's rows never reach another's. */
function newUser(): Promise<TestUser> {
  seeded += 1
  return seedUser(ctx, { email: `lifter${String(seeded)}@example.com` })
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

interface ErrorBody {
  error: {
    code: string
    message: string
    details?: { issues?: Array<{ path: string }>; logId?: string }
  }
}
const errorOf = (res: { body: unknown }) => (res.body as ErrorBody).error
const issuePaths = (res: { body: unknown }) =>
  (errorOf(res).details?.issues ?? []).map((issue) => issue.path)

// ---------------------------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------------------------

const BARBELL: EquipmentConfig = { kind: 'barbell', barG: 20_412, jumpG: 2268 }
const DUMBBELLS: EquipmentConfig = {
  kind: 'dumbbells',
  loads: { minG: 4536, stepG: 2268, maxG: 45_359 },
}

function snapshot(over: Partial<StrengthSnapshot> = {}): StrengthSnapshot {
  return {
    template: 'heavy',
    variant: 'A',
    week: 4,
    mode: 'normal',
    lifts: [
      {
        exerciseId: 'back-squat',
        implement: 'barbell',
        sets: 3,
        range: { min: 3, max: 6 },
        rir: { min: 1, max: 3 },
        baseLoadG: 61_235,
        shownLoadG: 61_235,
        change: 'increase',
        basis: {
          rule: 'F8',
          facts: [
            {
              template: 'strength.reason.example',
              slots: { load: { kind: 'load', g: 61_235 }, note: 'text' },
            },
          ],
        },
      },
      {
        exerciseId: 'standing-calf-raise',
        implement: null,
        sets: 2,
        range: { min: 8, max: 15 },
        rir: null,
        baseLoadG: null,
        shownLoadG: null,
        change: 'start',
        basis: { rule: 'F8', facts: [] },
      },
    ],
    ...over,
  }
}

const SETS = [
  { exerciseId: 'back-squat', loadG: 61_235, count: 5, rir: 2 },
  { exerciseId: 'back-squat', loadG: 61_235, count: 5, rir: 1 },
  { exerciseId: 'standing-calf-raise', loadG: null, count: 12, rir: null },
]

function logBody(over: Record<string, unknown> = {}) {
  return {
    date: todayIso(),
    durationMin: 40,
    rpe: 6,
    pain: 0,
    notes: 'Felt strong.',
    prescribed: snapshot(),
    sets: SETS,
    ...over,
  }
}

const putLog = (user: TestUser, logId: string, body: Record<string, unknown> = logBody()) =>
  client(ctx, user).put(`/api/strength/logs/${logId}`).send(body)

const resultOf = (res: { body: unknown }) => res.body as StrengthLogResult

/** A strength activity that arrived by import: it has a start instant and its own numbers. */
function importedStrength(user: TestUser, over: Record<string, unknown> = {}) {
  seeded += 1
  // An hour apart from the last one, so that two of them are two sessions to the duplicate pass.
  const hour = String(2 + (seeded % 20)).padStart(2, '0')
  return ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: todayIso(),
      type: 'strength',
      durationSec: 2700,
      rpe: 7,
      notes: 'From the watch.',
      source: 'garmin',
      providerKey: `garmin-${String(seeded)}`,
      startUtc: `${todayIso()}T${hour}:00:00Z`,
      ...over,
    },
  })
}

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

describe('access', () => {
  test.each([
    ['put', '/api/strength/settings'],
    ['put', '/api/strength/lifts/back-squat'],
    ['delete', '/api/strength/lifts/back-squat'],
    ['get', '/api/strength/logs?activityId=x'],
    ['put', `/api/strength/logs/${uuid(1)}`],
    ['delete', `/api/strength/logs/${uuid(1)}`],
  ] as const)('%s %s needs a session', async (method, url) => {
    const res = await client(ctx)[method](url).send({})
    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------------
// The setup
// ---------------------------------------------------------------------------------------------

describe('PUT /api/strength/settings', () => {
  test('keeps what was sent, answers with it and sets savedAt on the first save only', async () => {
    const user = await newUser()
    expect(await ctx.prisma.strengthSettings.count({ where: { userId: user.id } })).toBe(0)

    const first = await client(ctx, user)
      .put('/api/strength/settings')
      .send({
        equipment: [BARBELL, DUMBBELLS, { kind: 'bands' }, { kind: 'step' }],
        level: 'some',
        currentlyLifting: true,
        avoid: ['split-squat'],
        pinned: { knee: 'goblet-squat', calf: 'standing-calf-raise' },
        note: '  Home gym.  ',
      })
    expect(first.status).toBe(200)
    const saved = first.body as StrengthSettings
    expect(saved).toEqual({
      equipment: [BARBELL, DUMBBELLS, { kind: 'bands' }, { kind: 'step' }],
      level: 'some',
      currentlyLifting: true,
      avoid: ['split-squat'],
      pinned: { knee: 'goblet-squat', calf: 'standing-calf-raise' },
      note: 'Home gym.',
      savedAt: expect.any(String) as string,
    })
    const row = await ctx.prisma.strengthSettings.findUniqueOrThrow({ where: { userId: user.id } })
    expect(row.savedAt?.toISOString()).toBe(saved.savedAt)

    // A part that is left out keeps its value; the note clears with null; savedAt stays.
    const second = await client(ctx, user)
      .put('/api/strength/settings')
      .send({ level: 'experienced', note: null })
    expect(second.body).toEqual({ ...saved, level: 'experienced', note: null })
    const again = await client(ctx, user)
      .put('/api/strength/settings')
      .send({ level: 'experienced', note: null })
    expect(again.body).toEqual(second.body)
    expect(await ctx.prisma.strengthSettings.count({ where: { userId: user.id } })).toBe(1)
  })

  test('an empty change is a save: it ends the offer to set up, with every default', async () => {
    const user = await newUser()
    const res = await client(ctx, user).put('/api/strength/settings').send({})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      equipment: [],
      level: 'new',
      currentlyLifting: false,
      avoid: [],
      pinned: {},
      note: null,
      savedAt: expect.any(String) as string,
    })
  })

  test("one runner's setup is not another's", async () => {
    const a = await newUser()
    const b = await newUser()
    await client(ctx, a)
      .put('/api/strength/settings')
      .send({ equipment: [BARBELL] })
    const other = await client(ctx, b).put('/api/strength/settings').send({ level: 'some' })
    expect((other.body as StrengthSettings).equipment).toEqual([])
    const stored = await ctx.prisma.strengthSettings.findUniqueOrThrow({ where: { userId: a.id } })
    expect(JSON.parse(stored.equipment)).toEqual([BARBELL])
    expect(stored.level).toBe('new')
  })

  test.each([
    ['an unknown key', { weightUnit: 'kg' }, ['']],
    ['an unknown level', { level: 'expert' }, ['level']],
    ['equipment that is not a list', { equipment: BARBELL }, ['equipment']],
    ['an unknown kind of equipment', { equipment: [{ kind: 'sled' }] }, ['equipment.0.kind']],
    ['a kind listed twice', { equipment: [{ kind: 'bands' }, { kind: 'bands' }] }, ['equipment']],
    [
      'a barbell with no jump',
      { equipment: [{ kind: 'barbell', barG: 20_412, jumpG: 0 }] },
      ['equipment.0.jumpG'],
    ],
    [
      'a load that is not whole grams',
      { equipment: [{ kind: 'barbell', barG: 20_412.5, jumpG: 2268 }] },
      ['equipment.0.barG'],
    ],
    [
      'a load above the largest the API stores',
      { equipment: [{ kind: 'barbell', barG: 1_000_001, jumpG: 2268 }] },
      ['equipment.0.barG'],
    ],
    [
      'a machine whose top is below its step',
      { equipment: [{ kind: 'leg-press', stepG: 4536, maxG: 2268 }] },
      ['equipment.0.maxG'],
    ],
    [
      'a ladder whose top is below its first load',
      { equipment: [{ kind: 'dumbbells', loads: { minG: 9072, stepG: 2268, maxG: 4536 } }] },
      ['equipment.0.loads.maxG'],
    ],
    [
      'an empty list of dumbbell weights',
      { equipment: [{ kind: 'dumbbells', loads: { loadsG: [] } }] },
      ['equipment.0.loads.loadsG'],
    ],
    [
      'bands that carry a weight',
      { equipment: [{ kind: 'bands', loads: { loadsG: [100] } }] },
      ['equipment.0'],
    ],
    ['an exercise left out that is not in the catalogue', { avoid: ['bench-press'] }, ['avoid.0']],
    ['an exercise left out twice', { avoid: ['split-squat', 'split-squat'] }, ['avoid']],
    ['a pinned slot that does not exist', { pinned: { plyo: 'pogo-hop' } }, ['pinned']],
    [
      'a pinned exercise from another slot',
      { pinned: { knee: 'standing-calf-raise' } },
      ['pinned.knee'],
    ],
    ['a note that is too long', { note: 'x'.repeat(2001) }, ['note']],
  ] as const)('refuses %s with a path per field', async (_name, body, paths) => {
    const user = await newUser()
    const res = await client(ctx, user).put('/api/strength/settings').send(body)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('validation')
    expect(issuePaths(res)).toEqual(paths)
    expect(await ctx.prisma.strengthSettings.count({ where: { userId: user.id } })).toBe(0)
  })

  test('accepts both shapes of a dumbbell range and every machine', async () => {
    const user = await newUser()
    const equipment: EquipmentConfig[] = [
      { kind: 'dumbbells', loads: { loadsG: [4536, 6804, 9072] } },
      { kind: 'kettlebells', loads: { minG: 8000, stepG: 4000, maxG: null } },
      { kind: 'leg-press', stepG: 4536, maxG: 181_437 },
      { kind: 'calf-machine', stepG: 4536, maxG: 90_718 },
      { kind: 'leg-curl', stepG: 4536, maxG: 90_718 },
    ]
    const res = await client(ctx, user).put('/api/strength/settings').send({ equipment })
    expect(res.status).toBe(200)
    expect((res.body as StrengthSettings).equipment).toEqual(equipment)
  })
})

// ---------------------------------------------------------------------------------------------
// Starting points
// ---------------------------------------------------------------------------------------------

describe('starting points', () => {
  test('a set and a maximum are stored per exercise, and a new entry replaces the old', async () => {
    const user = await newUser()
    const set = await client(ctx, user)
      .put('/api/strength/lifts/back-squat')
      .send({ kind: 'set', loadG: 61_235, reps: 5, rir: 2, asOf: '2026-10-01' })
    expect(set.status).toBe(200)
    expect(set.body).toEqual({
      exerciseId: 'back-squat',
      kind: 'set',
      loadG: 61_235,
      reps: 5,
      rir: 2,
      asOf: '2026-10-01',
    } satisfies StrengthLift)

    // A set with no count of reps left stores null, and the day is today when left out.
    const noRir = await client(ctx, user)
      .put('/api/strength/lifts/goblet-squat')
      .send({ kind: 'set', loadG: 18_144, reps: 8 })
    expect(noRir.body).toMatchObject({ rir: null, asOf: todayIso() })

    const max = await client(ctx, user)
      .put('/api/strength/lifts/back-squat')
      .send({ kind: 'max', loadG: 100_000, asOf: '2026-10-02' })
    expect(max.body).toEqual({
      exerciseId: 'back-squat',
      kind: 'max',
      loadG: 100_000,
      reps: 1,
      rir: null,
      asOf: '2026-10-02',
    })
    const rows = await ctx.prisma.strengthLift.findMany({ where: { userId: user.id } })
    expect(rows.map((row) => [row.exerciseId, row.kind]).sort()).toEqual([
      ['back-squat', 'max'],
      ['goblet-squat', 'set'],
    ])
  })

  test('DELETE removes it, once, and another runner has none to remove', async () => {
    const user = await newUser()
    const other = await newUser()
    await client(ctx, user)
      .put('/api/strength/lifts/hip-thrust')
      .send({ kind: 'max', loadG: 80_000 })
    expect((await client(ctx, other).delete('/api/strength/lifts/hip-thrust')).status).toBe(404)
    expect(await ctx.prisma.strengthLift.count({ where: { userId: user.id } })).toBe(1)

    expect((await client(ctx, user).delete('/api/strength/lifts/hip-thrust')).status).toBe(204)
    expect(await ctx.prisma.strengthLift.count({ where: { userId: user.id } })).toBe(0)
    expect((await client(ctx, user).delete('/api/strength/lifts/hip-thrust')).status).toBe(404)
    expect((await client(ctx, user).delete('/api/strength/lifts/not-an-exercise')).status).toBe(404)
  })

  test.each([
    [
      'an exercise outside the catalogue',
      'bench-press',
      { kind: 'max', loadG: 1000 },
      ['exerciseId'],
    ],
    ['a set with no reps', 'back-squat', { kind: 'set', loadG: 1000 }, ['reps']],
    [
      'a maximum of more than one rep',
      'back-squat',
      { kind: 'max', loadG: 1000, reps: 3 },
      ['reps'],
    ],
    ['a maximum with reps left', 'back-squat', { kind: 'max', loadG: 1000, rir: 1 }, ['rir']],
    ['no load', 'back-squat', { kind: 'max', loadG: 0 }, ['loadG']],
    ['a load in pounds with a fraction', 'back-squat', { kind: 'max', loadG: 100.5 }, ['loadG']],
    [
      'more than five reps left',
      'back-squat',
      { kind: 'set', loadG: 1000, reps: 5, rir: 6 },
      ['rir'],
    ],
    [
      'a day that has not come',
      'back-squat',
      { kind: 'max', loadG: 1000, asOf: '2999-01-01' },
      ['asOf'],
    ],
    [
      'a day that is not real',
      'back-squat',
      { kind: 'max', loadG: 1000, asOf: '2026-02-30' },
      ['asOf'],
    ],
    ['an unknown key', 'back-squat', { kind: 'max', loadG: 1000, unit: 'kg' }, ['']],
  ] as const)('refuses %s', async (_name, exercise, body, paths) => {
    const user = await newUser()
    const res = await client(ctx, user).put(`/api/strength/lifts/${exercise}`).send(body)
    expect(res.status).toBe(400)
    expect(issuePaths(res)).toEqual(paths)
    expect(await ctx.prisma.strengthLift.count({ where: { userId: user.id } })).toBe(0)
  })
})

// ---------------------------------------------------------------------------------------------
// Saving a log
// ---------------------------------------------------------------------------------------------

describe('PUT /api/strength/logs/:logId, a new session', () => {
  test('stores a manual strength activity and the log with its sets in order', async () => {
    const user = await newUser()
    const res = await putLog(user, uuid(10))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const { log, activity, next } = resultOf(res)

    expect(activity).toMatchObject({
      type: 'strength',
      source: 'manual',
      date: todayIso(),
      durationSec: 2400,
      distanceM: null,
      rpe: 6,
      pain: 0,
      notes: 'Felt strong.',
      duplicateStatus: 'none',
    })
    expect(log).toMatchObject({
      id: uuid(10),
      activityId: activity.id,
      date: todayIso(),
      durationMin: 40,
      rpe: 6,
      pain: 0,
      notes: 'Felt strong.',
      prescribed: snapshot(),
    })
    expect(log.sets).toEqual(SETS.map((set, position) => ({ ...set, position })))
    // The read side fills the suggestions (E14-6); the save has none to give yet.
    expect(next).toEqual([])

    expect(await ctx.prisma.activity.count({ where: { userId: user.id } })).toBe(1)
    const sets = await ctx.prisma.strengthSet.findMany({
      where: { logId: uuid(10) },
      orderBy: { position: 'asc' },
    })
    expect(sets.map((set) => set.userId)).toEqual([user.id, user.id, user.id])
    // The activity is an ordinary one: the activity routes read it.
    const read = await client(ctx, user).get(`/api/activities/${activity.id}`)
    expect(read.status).toBe(200)
    expect(read.body).toMatchObject({ id: activity.id, type: 'strength' })
  })

  test('a save without sets keeps the minutes and the effort only', async () => {
    const user = await newUser()
    const res = await putLog(
      user,
      uuid(11),
      logBody({ sets: [], rpe: undefined, notes: undefined }),
    )
    expect(res.status).toBe(201)
    expect(resultOf(res).log.sets).toEqual([])
    expect(resultOf(res).activity).toMatchObject({ rpe: null, pain: 0, notes: null })
  })

  test('a bodyweight movement may carry an added load, and a set may leave the reps left empty', async () => {
    const user = await newUser()
    const res = await putLog(
      user,
      uuid(12),
      logBody({
        sets: [
          { exerciseId: 'single-leg-calf-raise', loadG: 9072, count: 12 },
          { exerciseId: 'dead-bug', count: 10, rir: null },
        ],
      }),
    )
    expect(res.status).toBe(201)
    expect(resultOf(res).log.sets).toEqual([
      { exerciseId: 'single-leg-calf-raise', position: 0, loadG: 9072, count: 12, rir: null },
      { exerciseId: 'dead-bug', position: 1, loadG: null, count: 10, rir: null },
    ])
  })

  test('the same save again replaces the sets and leaves one activity and one log', async () => {
    const user = await newUser()
    const first = await putLog(user, uuid(13))
    const replay = await putLog(user, uuid(13))
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(resultOf(replay).log.sets).toEqual(resultOf(first).log.sets)
    expect(resultOf(replay).activity.id).toBe(resultOf(first).activity.id)

    // A changed save under the same id replaces the sets, the snapshot and the activity's numbers.
    const changed = await putLog(
      user,
      uuid(13),
      logBody({
        date: addDays(todayIso(), -1),
        durationMin: 55,
        rpe: null,
        notes: null,
        sets: [SETS[0]],
        prescribed: snapshot({ mode: 'lighter-day' }),
      }),
    )
    expect(changed.status).toBe(200)
    expect(resultOf(changed).log).toMatchObject({
      date: addDays(todayIso(), -1),
      durationMin: 55,
      rpe: null,
      notes: null,
      pain: 0,
    })
    expect(resultOf(changed).log.prescribed.mode).toBe('lighter-day')
    expect(resultOf(changed).log.sets).toHaveLength(1)

    expect(await ctx.prisma.activity.count({ where: { userId: user.id } })).toBe(1)
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(1)
    expect(await ctx.prisma.strengthSet.count({ where: { userId: user.id } })).toBe(1)
    const row = await ctx.prisma.activity.findUniqueOrThrow({
      where: { id: resultOf(first).activity.id },
    })
    expect(row).toMatchObject({ date: addDays(todayIso(), -1), durationSec: 3300, rpe: null })
  })

  test('two sends of one save at once leave one activity and one log', async () => {
    const user = await newUser()
    const [a, b] = await Promise.all([putLog(user, uuid(14)), putLog(user, uuid(14))])
    expect([a.status, b.status].sort()).toEqual([200, 201])
    expect(resultOf(a).activity.id).toBe(resultOf(b).activity.id)
    expect(await ctx.prisma.activity.count({ where: { userId: user.id } })).toBe(1)
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(1)
    expect(await ctx.prisma.strengthSet.count({ where: { userId: user.id } })).toBe(3)
  })

  test('two sends that both find no log: the loser rolls back and replaces the winner’s', async () => {
    const user = await newUser()
    const logs = ctx.prisma.strengthLog
    const find = logs.findUnique.bind(logs)
    // Hold both sends at their first look for the log, so that both find none and both go on to
    // store one; the loser's activity must not outlive its refused log.
    let looks = 0
    let open!: () => void
    const gate = new Promise<void>((resolve) => {
      open = resolve
    })
    const spy = vi.spyOn(logs, 'findUnique').mockImplementation(((args: never) => {
      looks += 1
      if (looks === 2) open()
      return gate.then(() => find(args))
    }) as never)
    try {
      const [a, b] = await Promise.all([putLog(user, uuid(16)), putLog(user, uuid(16))])
      expect([a.status, b.status].sort()).toEqual([200, 201])
      expect(resultOf(a).activity.id).toBe(resultOf(b).activity.id)
      expect(looks, 'two first looks and the loser’s second try').toBe(3)
    } finally {
      spy.mockRestore()
    }
    expect(await ctx.prisma.activity.count({ where: { userId: user.id } })).toBe(1)
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(1)
    expect(await ctx.prisma.strengthSet.count({ where: { userId: user.id } })).toBe(3)
  })

  test('the id of a log is one runner’s: another runner’s id is not found', async () => {
    const owner = await newUser()
    const other = await newUser()
    await putLog(owner, uuid(15))
    const res = await putLog(other, uuid(15))
    expect(res.status).toBe(404)
    expect(await ctx.prisma.activity.count({ where: { userId: other.id } })).toBe(0)
    expect(await ctx.prisma.strengthSet.count({ where: { logId: uuid(15) } })).toBe(3)
  })
})

describe('PUT /api/strength/logs/:logId, an activity that exists', () => {
  test('attaches to an imported strength activity and keeps the numbers the body leaves out', async () => {
    const user = await newUser()
    const imported = await importedStrength(user)
    const res = await putLog(
      user,
      uuid(20),
      logBody({ activityId: imported.id, rpe: undefined, pain: undefined, notes: undefined }),
    )
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(resultOf(res).activity).toMatchObject({
      id: imported.id,
      source: 'garmin',
      rpe: 7,
      notes: 'From the watch.',
      durationSec: 2400,
    })
    expect(resultOf(res).log.activityId).toBe(imported.id)
    expect(await ctx.prisma.activity.count({ where: { userId: user.id } })).toBe(1)

    // Null clears a number that the import brought; the replay is a replacement.
    const cleared = await putLog(
      user,
      uuid(20),
      logBody({ activityId: imported.id, rpe: null, notes: null }),
    )
    expect(cleared.status).toBe(200)
    expect(resultOf(cleared).activity).toMatchObject({ rpe: null, notes: null })
  })

  test('replays without the activity id once the log exists', async () => {
    const user = await newUser()
    const imported = await importedStrength(user)
    await putLog(user, uuid(21), logBody({ activityId: imported.id }))
    const replay = await putLog(user, uuid(21), logBody({ sets: [SETS[0]] }))
    expect(replay.status).toBe(200)
    expect(resultOf(replay).log.activityId).toBe(imported.id)
    expect(resultOf(replay).log.sets).toHaveLength(1)
  })

  test('refuses an activity that is not a strength activity, and writes nothing', async () => {
    const user = await newUser()
    const run = await ctx.prisma.activity.create({
      data: { userId: user.id, date: todayIso(), type: 'run', durationSec: 1800, distanceM: 5000 },
    })
    const res = await putLog(user, uuid(22), logBody({ activityId: run.id }))
    expect(res.status).toBe(409)
    expect(errorOf(res).code).toBe('conflict')
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(0)
    expect(await ctx.prisma.activity.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      durationSec: 1800,
    })
  })

  test('refuses a second log for an activity under another id, naming the first', async () => {
    const user = await newUser()
    const imported = await importedStrength(user)
    expect((await putLog(user, uuid(23), logBody({ activityId: imported.id }))).status).toBe(201)
    const second = await putLog(user, uuid(24), logBody({ activityId: imported.id }))
    expect(second.status).toBe(409)
    expect(errorOf(second).details?.logId).toBe(uuid(23))
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(1)
    expect(await ctx.prisma.strengthLog.findUnique({ where: { id: uuid(24) } })).toBeNull()
  })

  test('refuses to move a log to another activity', async () => {
    const user = await newUser()
    const first = await importedStrength(user)
    const second = await importedStrength(user)
    await putLog(user, uuid(25), logBody({ activityId: first.id }))
    const res = await putLog(user, uuid(25), logBody({ activityId: second.id }))
    expect(res.status).toBe(409)
    expect(errorOf(res).details?.logId).toBe(uuid(25))
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(25) } })).activityId,
    ).toBe(first.id)
  })

  test("another runner's activity, and one that does not exist, are not found", async () => {
    const user = await newUser()
    const other = await newUser()
    const theirs = await importedStrength(other)
    expect((await putLog(user, uuid(26), logBody({ activityId: theirs.id }))).status).toBe(404)
    expect((await putLog(user, uuid(27), logBody({ activityId: 'missing' }))).status).toBe(404)
    expect(
      await ctx.prisma.strengthLog.count({ where: { userId: { in: [user.id, other.id] } } }),
    ).toBe(0)
  })
})

describe('PUT /api/strength/logs/:logId, the planned session', () => {
  test('links the new activity to the session as the owner’s choice', async () => {
    const session = only(fixture, 'strength')
    const res = await putLog(fixture.u, uuid(30), logBody({ sessionId: session.id }))
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })
    expect(row).toMatchObject({ activityId: resultOf(res).activity.id, linkSource: 'owner' })
    expect(row.status).not.toBe('planned')

    // The same save again links nothing new and leaves the session where it was.
    const replay = await putLog(fixture.u, uuid(30), logBody({ sessionId: session.id }))
    expect(replay.status).toBe(200)
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })).activityId,
    ).toBe(resultOf(res).activity.id)
  })

  test('without a session, the matcher ties a session of the day to the activity', async () => {
    const { today } = days()
    const sessions = await ctx.prisma.planSession.findMany({
      where: { planId: fixture.plan.id, kind: 'strength', activityId: null },
      orderBy: { date: 'asc' },
    })
    const target = sessions.at(-1)
    expect(target, 'a free strength session in the fixture plan').toBeDefined()
    await ctx.prisma.planSession.update({
      where: { id: target!.id },
      data: { date: today, weekStart: mondayOf(today) },
    })
    const res = await putLog(fixture.u, uuid(31), logBody({ date: today }))
    expect(res.status).toBe(201)
    const row = await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: target!.id } })
    expect(row.activityId).toBe(resultOf(res).activity.id)
    expect(row.linkSource).toBe('auto')
  })

  test('attaches an imported activity to a session', async () => {
    const free = await ctx.prisma.planSession.findFirstOrThrow({
      where: { planId: fixture.plan.id, kind: 'strength', activityId: null },
      orderBy: { date: 'desc' },
    })
    const imported = await importedStrength(fixture.u)
    const res = await putLog(
      fixture.u,
      uuid(32),
      logBody({ activityId: imported.id, sessionId: free.id }),
    )
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: free.id } })).activityId,
    ).toBe(imported.id)
  })

  test('refuses a session that is not found, another runner’s or one for runs, and writes nothing', async () => {
    const user = await newUser()
    const mine = only(fixture, 'strength')
    const run = only(fixture, 'easy')
    const before = await ctx.prisma.activity.count()

    const unknown = await putLog(fixture.u, uuid(33), logBody({ sessionId: 'missing' }))
    expect(unknown.status).toBe(404)
    // The session is the planned runner's; this runner has none.
    const notTheirs = await putLog(user, uuid(34), logBody({ sessionId: mine.id }))
    expect(notTheirs.status).toBe(404)
    const wrongKind = await putLog(fixture.u, uuid(35), logBody({ sessionId: run.id }))
    expect(wrongKind.status).toBe(409)
    expect(errorOf(wrongKind).message).toMatch(/cannot fulfil/)

    expect(await ctx.prisma.activity.count()).toBe(before)
    expect(
      await ctx.prisma.strengthLog.count({ where: { id: { in: [uuid(33), uuid(34), uuid(35)] } } }),
    ).toBe(0)
  })

  test('refuses a second session for an activity that already fulfils one', async () => {
    const sessions = await ctx.prisma.planSession.findMany({
      where: { planId: fixture.plan.id, kind: 'strength', activityId: null },
      orderBy: { date: 'desc' },
      take: 2,
    })
    const [one, two] = sessions
    expect(two, 'two free strength sessions in the fixture plan').toBeDefined()
    const imported = await importedStrength(fixture.u)
    expect(
      (await putLog(fixture.u, uuid(36), logBody({ activityId: imported.id, sessionId: one!.id })))
        .status,
    ).toBe(201)
    const res = await putLog(
      fixture.u,
      uuid(36),
      logBody({ activityId: imported.id, sessionId: two!.id }),
    )
    expect(res.status).toBe(409)
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: two!.id } })).activityId,
    ).toBeNull()
  })
})

describe('PUT /api/strength/logs/:logId, validation', () => {
  const day = (offset: number) => addDays(todayIso(), offset)

  test.each([
    [
      'an exercise outside the catalogue',
      { sets: [{ exerciseId: 'bench-press', count: 5 }] },
      ['sets.0.exerciseId'],
    ],
    ['a date that has not come', { date: day(1) }, ['date']],
    ['a date a year and a day back', { date: day(-366) }, ['date']],
    ['a date that is not real', { date: '2026-02-30' }, ['date']],
    ['no minutes', { durationMin: 0 }, ['durationMin']],
    ['more than 300 minutes', { durationMin: 301 }, ['durationMin']],
    ['minutes with a fraction', { durationMin: 40.5 }, ['durationMin']],
    ['an effort of 0', { rpe: 0 }, ['rpe']],
    ['an effort above 10', { rpe: 11 }, ['rpe']],
    ['pain below 0', { pain: -1 }, ['pain']],
    ['pain above 10', { pain: 11 }, ['pain']],
    ['a note that is too long', { notes: 'x'.repeat(2001) }, ['notes']],
    ['a set with no count', { sets: [{ exerciseId: 'back-squat', count: 0 }] }, ['sets.0.count']],
    ['a count above 500', { sets: [{ exerciseId: 'pogo-hop', count: 501 }] }, ['sets.0.count']],
    [
      'reps left above 5',
      { sets: [{ exerciseId: 'back-squat', count: 5, rir: 6 }] },
      ['sets.0.rir'],
    ],
    [
      'a negative load',
      { sets: [{ exerciseId: 'back-squat', count: 5, loadG: -1 }] },
      ['sets.0.loadG'],
    ],
    [
      'a load above the largest the API stores',
      { sets: [{ exerciseId: 'back-squat', count: 5, loadG: 1_000_001 }] },
      ['sets.0.loadG'],
    ],
    [
      'more than 80 sets',
      { sets: Array.from({ length: 81 }, () => ({ exerciseId: 'dead-bug', count: 10 })) },
      ['sets'],
    ],
    ['sets that are not a list', { sets: 'none' }, ['sets']],
    ['a key the save does not know', { weightUnit: 'kg' }, ['']],
    [
      'a snapshot with an unknown template',
      { prescribed: { ...snapshot(), template: 'max' } },
      ['prescribed.template'],
    ],
    [
      'a snapshot with a key it does not know',
      { prescribed: { ...snapshot(), extra: 1 } },
      ['prescribed'],
    ],
    [
      'a snapshot lift outside the catalogue',
      { prescribed: snapshot({ lifts: [{ ...snapshot().lifts[0]!, exerciseId: 'bench-press' }] }) },
      ['prescribed.lifts.0.exerciseId'],
    ],
    [
      'a snapshot slot that is not a quantity',
      {
        prescribed: snapshot({
          lifts: [
            {
              ...snapshot().lifts[0]!,
              basis: {
                rule: 'F8',
                facts: [{ template: 't', slots: { load: { kind: 'load', g: -5 } } }],
              },
            },
          ],
        }),
      },
      ['prescribed.lifts.0.basis.facts.0.slots.load'],
    ],
    [
      'a snapshot with an unknown mode',
      { prescribed: { ...snapshot(), mode: 'light' } },
      ['prescribed.mode'],
    ],
  ] as const)('refuses %s with a path per field', async (_name, over, paths) => {
    const user = await newUser()
    const res = await putLog(user, uuid(40), logBody(over))
    expect(res.status, JSON.stringify(res.body)).toBe(400)
    expect(errorOf(res).code).toBe('validation')
    expect(issuePaths(res)).toEqual(paths)
    expect(await ctx.prisma.activity.count({ where: { userId: user.id } })).toBe(0)
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(0)
  })

  test('refuses a snapshot above 16 KB, with the issue on the snapshot', async () => {
    const user = await newUser()
    const fact = {
      template: 'strength.reason.example',
      slots: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [`slot${String(i)}`, 'x'.repeat(80)]),
      ),
    }
    const lift = {
      ...snapshot().lifts[0]!,
      basis: { rule: 'F8' as const, facts: Array.from({ length: 8 }, () => fact) },
    }
    const big = snapshot({ lifts: Array.from({ length: 6 }, () => lift) })
    expect(JSON.stringify(big).length).toBeGreaterThan(16_384)
    const res = await putLog(user, uuid(41), logBody({ prescribed: big }))
    expect(res.status).toBe(400)
    expect(issuePaths(res)).toEqual(['prescribed'])

    // A snapshot just under the cap is kept as sent.
    const ok = snapshot({ lifts: Array.from({ length: 2 }, () => lift) })
    expect(JSON.stringify(ok).length).toBeLessThan(16_384)
    expect((await putLog(user, uuid(41), logBody({ prescribed: ok }))).status).toBe(201)
  })

  test('takes a year of back-dating and a full session of 80 sets', async () => {
    const user = await newUser()
    const sets = Array.from({ length: 80 }, () => ({ exerciseId: 'dead-bug', count: 10 }))
    const res = await putLog(user, uuid(42), logBody({ date: day(-365), sets }))
    expect(res.status).toBe(201)
    expect(resultOf(res).log.sets).toHaveLength(80)
    expect(resultOf(res).log.sets.at(-1)?.position).toBe(79)
  })

  test('the id of a log is 8 to 64 letters, digits, - or _, as the outbox route reads it', async () => {
    const user = await newUser()
    expect((await putLog(user, 'short')).status).toBe(400)
    expect((await putLog(user, 'x'.repeat(65))).status).toBe(400)
    expect((await putLog(user, 'a-valid_id-1234')).status).toBe(201)
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Deleting, reading and the data version
// ---------------------------------------------------------------------------------------------

describe('DELETE /api/strength/logs/:logId', () => {
  test('removes the log and its sets and leaves the activity and its session', async () => {
    const session = await ctx.prisma.planSession.findFirstOrThrow({
      where: { planId: fixture.plan.id, kind: 'strength', activityId: null },
      orderBy: { date: 'desc' },
    })
    const saved = await putLog(fixture.u, uuid(50), logBody({ sessionId: session.id }))
    const activityId = resultOf(saved).activity.id

    const res = await client(ctx, fixture.u).delete(`/api/strength/logs/${uuid(50)}`)
    expect(res.status).toBe(204)
    expect(await ctx.prisma.strengthLog.count({ where: { id: uuid(50) } })).toBe(0)
    expect(await ctx.prisma.strengthSet.count({ where: { logId: uuid(50) } })).toBe(0)
    expect(await ctx.prisma.activity.count({ where: { id: activityId } })).toBe(1)
    expect(
      (await ctx.prisma.planSession.findUniqueOrThrow({ where: { id: session.id } })).activityId,
    ).toBe(activityId)
    expect((await client(ctx, fixture.u).delete(`/api/strength/logs/${uuid(50)}`)).status).toBe(404)
  })

  test('the activity can take the same log again after it is deleted', async () => {
    const user = await newUser()
    const first = await putLog(user, uuid(51))
    const activityId = resultOf(first).activity.id
    await client(ctx, user).delete(`/api/strength/logs/${uuid(51)}`)
    const again = await putLog(user, uuid(52), logBody({ activityId }))
    expect(again.status).toBe(201)
    expect(resultOf(again).log.activityId).toBe(activityId)
  })

  test("another runner's log is not found and stays", async () => {
    const owner = await newUser()
    const other = await newUser()
    await putLog(owner, uuid(53))
    expect((await client(ctx, other).delete(`/api/strength/logs/${uuid(53)}`)).status).toBe(404)
    expect(await ctx.prisma.strengthLog.count({ where: { id: uuid(53) } })).toBe(1)
    expect(await ctx.prisma.strengthSet.count({ where: { logId: uuid(53) } })).toBe(3)
  })

  test('deleting the activity deletes its log and sets', async () => {
    const user = await newUser()
    const saved = await putLog(user, uuid(54))
    const res = await client(ctx, user).delete(`/api/activities/${resultOf(saved).activity.id}`)
    expect(res.status).toBe(204)
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(0)
    expect(await ctx.prisma.strengthSet.count({ where: { userId: user.id } })).toBe(0)
  })
})

describe('GET /api/strength/logs', () => {
  test('lists the log of one activity, and the logs of a span of days newest first', async () => {
    const user = await newUser()
    const day = (offset: number) => addDays(todayIso(), offset)
    const a = await putLog(user, uuid(60), logBody({ date: day(-3), sets: [SETS[0]] }))
    const b = await putLog(user, uuid(61), logBody({ date: day(-1) }))
    await putLog(user, uuid(62), logBody({ date: day(-10) }))

    const one = await client(ctx, user).get(
      `/api/strength/logs?activityId=${resultOf(a).activity.id}`,
    )
    expect(one.status).toBe(200)
    expect((one.body as StrengthLog[]).map((log) => log.id)).toEqual([uuid(60)])
    expect((one.body as StrengthLog[])[0]?.sets).toHaveLength(1)

    const span = await client(ctx, user).get(`/api/strength/logs?from=${day(-5)}&to=${day(0)}`)
    expect(span.status).toBe(200)
    const logs = span.body as StrengthLog[]
    expect(logs.map((log) => log.id)).toEqual([uuid(61), uuid(60)])
    expect(logs[0]).toEqual(resultOf(b).log)
    expect(logs[0]?.sets.map((set) => set.position)).toEqual([0, 1, 2])
  })

  test('an activity with no log answers with an empty list; another runner’s activity is not found', async () => {
    const user = await newUser()
    const other = await newUser()
    const imported = await importedStrength(user)
    const empty = await client(ctx, user).get(`/api/strength/logs?activityId=${imported.id}`)
    expect(empty.status).toBe(200)
    expect(empty.body).toEqual([])
    await putLog(user, uuid(63), logBody({ activityId: imported.id }))
    expect(
      (await client(ctx, other).get(`/api/strength/logs?activityId=${imported.id}`)).status,
    ).toBe(404)
    const span = await client(ctx, other).get(
      `/api/strength/logs?from=${addDays(todayIso(), -5)}&to=${todayIso()}`,
    )
    expect(span.body).toEqual([])
  })

  test.each([
    ['no filter', '', ['from']],
    ['only a start', 'from=2026-10-01', ['from']],
    ['an activity and a span', 'activityId=x&from=2026-10-01&to=2026-10-02', ['activityId']],
    ['a start after the end', 'from=2026-10-05&to=2026-10-01', ['from']],
    ['a span of more than 366 days', 'from=2025-01-01&to=2026-10-01', ['to']],
    ['a day that is not real', 'from=2026-13-01&to=2026-12-01', ['from']],
  ] as const)('refuses %s', async (_name, query, paths) => {
    const user = await newUser()
    const res = await client(ctx, user).get(`/api/strength/logs?${query}`)
    expect(res.status).toBe(400)
    expect(issuePaths(res)).toEqual(paths)
  })
})

describe('the data version', () => {
  test('moves on every write, so a memo of the strength state drops', async () => {
    const user = await newUser()
    let computed = 0
    const read = () =>
      memoByVersion(ctx, { userId: user.id, name: 'strength.state', today: todayIso() }, () => {
        computed += 1
        return computed
      })
    const writes: Array<[string, () => Promise<unknown>]> = [
      ['the setup', () => client(ctx, user).put('/api/strength/settings').send({ level: 'some' })],
      [
        'a starting point',
        () =>
          client(ctx, user)
            .put('/api/strength/lifts/back-squat')
            .send({ kind: 'max', loadG: 90_000 }),
      ],
      ['a log', () => putLog(user, uuid(70))],
      ['the same log again', () => putLog(user, uuid(70), logBody({ sets: [] }))],
      ['a deleted log', () => client(ctx, user).delete(`/api/strength/logs/${uuid(70)}`)],
      [
        'a deleted starting point',
        () => client(ctx, user).delete('/api/strength/lifts/back-squat'),
      ],
      ['the weight unit', () => client(ctx, user).put('/api/settings').send({ weightUnit: 'kg' })],
    ]
    let seen = await read()
    for (const [name, write] of writes) {
      const before = (await dataVersionKey(ctx.prisma)).key
      const res = (await write()) as { status: number }
      expect(res.status, name).toBeLessThan(300)
      expect((await dataVersionKey(ctx.prisma)).key, name).not.toBe(before)
      const next = await read()
      expect(next, `${name} drops the memo`).toBeGreaterThan(seen)
      seen = next
    }
    // Nothing moved between two reads: the memo holds.
    expect(await read()).toBe(seen)
  })

  test('a refused save leaves the memo alone', async () => {
    const user = await newUser()
    const before = (await dataVersionKey(ctx.prisma)).key
    expect((await putLog(user, uuid(71), logBody({ durationMin: 0 }))).status).toBe(400)
    expect((await dataVersionKey(ctx.prisma)).key).toBe(before)
  })
})

/** A strength session as a watch export reports it: a start instant, a duration, no distance. */
function parsedStrength(over: Partial<ParsedActivity> = {}): ParsedActivity {
  return {
    providerKey: `fit:strength-${String(seeded)}`,
    startUtc: `${todayIso()}T12:00:00.000Z`,
    utcOffsetMin: 0,
    type: 'strength',
    subtype: null,
    elapsedSec: 2450,
    movingSec: null,
    distanceM: null,
    elevationGainM: null,
    elevationLossM: null,
    avgHr: 118,
    maxHr: 150,
    avgCadence: null,
    avgPowerW: null,
    deviceName: 'Test Watch',
    startLat: null,
    startLng: null,
    samples: { t: [0, 60, 120], d: null, hr: [110, 120, 130], alt: null, cad: null, pwr: null },
    laps: [],
    ...over,
  }
}

/** The import path: one stored export, as `storeParsed` stores it and flags its duplicates. */
async function importStrength(
  user: TestUser,
  over: Partial<ParsedActivity> = {},
  source = 'file',
): Promise<string> {
  seeded += 1
  const stored = await storeParsed(
    ctx,
    user.id,
    parsedStrength({ ...over, providerKey: `${source}:${String(seeded)}` }),
    {
      source,
      importBatchId: null,
      channel: 'upload',
    },
  )
  return stored.activityId
}

const reloadActivity = (id: string) => ctx.prisma.activity.findUniqueOrThrow({ where: { id } })
const confirm = (user: TestUser, id: string, status: 'confirmed' | 'dismissed') =>
  client(ctx, user).post(`/api/activities/${id}/duplicate`).send({ status })

describe('a strength session entered by hand and imported too', () => {
  /** A saved log on a hand-entered session (40 minutes), then an export of the same session. */
  async function pair(user: TestUser, logId: string) {
    const saved = await putLog(
      user,
      logId,
      logBody({ durationMin: 40, rpe: 6, pain: 1, notes: 'Felt strong.' }),
    )
    expect(saved.status, JSON.stringify(saved.body)).toBe(201)
    const copyId = resultOf(saved).activity.id
    const originalId = await importStrength(user)
    return { copyId, originalId }
  }

  test('the import path flags the hand-entered session as a possible duplicate of the export', async () => {
    const user = await newUser()
    const { copyId, originalId } = await pair(user, uuid(100))
    expect(await reloadActivity(copyId)).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: originalId,
    })
    expect(await reloadActivity(originalId)).toMatchObject({
      type: 'strength',
      source: 'file',
      duplicateStatus: 'none',
      duplicateOfId: null,
    })
    // Nothing moves until the runner decides.
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(100) } })).activityId,
    ).toBe(copyId)
  })

  test('confirming moves the log with its sets to the export, and copies the effort, pain and note it lacks', async () => {
    const user = await newUser()
    const { copyId, originalId } = await pair(user, uuid(101))
    const res = await confirm(user, copyId, 'confirmed')
    expect(res.status).toBe(200)

    const log = await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(101) } })
    expect(log.activityId).toBe(originalId)
    expect(await ctx.prisma.strengthSet.count({ where: { logId: uuid(101) } })).toBe(3)
    expect(await reloadActivity(originalId)).toMatchObject({
      rpe: 6,
      pain: 1,
      notes: 'Felt strong.',
      duplicateStatus: 'none',
    })
    // The copy keeps what it had, and stays the confirmed duplicate that totals leave out.
    expect(await reloadActivity(copyId)).toMatchObject({
      rpe: 6,
      pain: 1,
      duplicateStatus: 'confirmed',
      duplicateOfId: originalId,
    })

    // The log is read from the export now.
    const read = await client(ctx, user).get(`/api/strength/logs?activityId=${originalId}`)
    expect((read.body as StrengthLog[]).map((l) => l.id)).toEqual([uuid(101)])
    const old = await client(ctx, user).get(`/api/strength/logs?activityId=${copyId}`)
    expect(old.body).toEqual([])

    // The same log can still be saved, and it stays on the export.
    const again = await putLog(user, uuid(101), logBody({ durationMin: 41, sets: [SETS[0]] }))
    expect(again.status).toBe(200)
    expect(resultOf(again).log.activityId).toBe(originalId)
  })

  test('confirming keeps the effort, pain and note that the export already has', async () => {
    const user = await newUser()
    const { copyId, originalId } = await pair(user, uuid(102))
    await ctx.prisma.activity.update({
      where: { id: originalId },
      data: { rpe: 8, notes: 'From the watch.' },
    })
    expect((await confirm(user, copyId, 'confirmed')).status).toBe(200)
    expect(await reloadActivity(originalId)).toMatchObject({
      rpe: 8,
      notes: 'From the watch.',
      pain: 1,
    })
  })

  test('dismissing moves nothing and copies nothing', async () => {
    const user = await newUser()
    const { copyId, originalId } = await pair(user, uuid(103))
    expect((await confirm(user, copyId, 'dismissed')).status).toBe(200)
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(103) } })).activityId,
    ).toBe(copyId)
    expect(await reloadActivity(originalId)).toMatchObject({ rpe: null, pain: null, notes: null })
    expect(await reloadActivity(copyId)).toMatchObject({ duplicateStatus: 'dismissed' })
  })

  test('the export keeps its own log when it has one, and the copy’s stays where it is', async () => {
    const user = await newUser()
    const { copyId, originalId } = await pair(user, uuid(104))
    // 41 minutes is what the export shows, so the save leaves its duration and flags alone.
    const own = await putLog(
      user,
      uuid(105),
      logBody({ activityId: originalId, durationMin: 41, rpe: 9, notes: 'Hard.' }),
    )
    expect(own.status, JSON.stringify(own.body)).toBe(201)
    expect((await confirm(user, copyId, 'confirmed')).status).toBe(200)
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(104) } })).activityId,
    ).toBe(copyId)
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(105) } })).activityId,
    ).toBe(originalId)
    expect(await reloadActivity(originalId)).toMatchObject({ rpe: 9, notes: 'Hard.', pain: 0 })
  })

  test('two exports that start within two minutes are confirmed at once, and the log goes to the richer one', async () => {
    const user = await newUser()
    const strava = await importStrength(user, {}, 'strava')
    const saved = await putLog(
      user,
      uuid(106),
      logBody({ activityId: strava, durationMin: 41, rpe: 5, pain: null, notes: 'Easy day.' }),
    )
    expect(saved.status, JSON.stringify(saved.body)).toBe(201)

    const file = await importStrength(
      user,
      { startUtc: `${todayIso()}T12:00:45.000Z`, elapsedSec: 2700 },
      'file',
    )
    expect(await reloadActivity(strava)).toMatchObject({
      duplicateStatus: 'confirmed',
      duplicateOfId: file,
    })
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(106) } })).activityId,
    ).toBe(file)
    expect(await reloadActivity(file)).toMatchObject({ rpe: 5, notes: 'Easy day.' })
  })

  test('a strength log is never handed to an activity that is not a strength activity', async () => {
    // Not a pair the pass can make, and the type of a logged activity is locked, so the rows are
    // written by hand: a run flagged as the original of a strength activity that holds a log.
    const user = await newUser()
    const original = await ctx.prisma.activity.create({
      data: { userId: user.id, date: todayIso(), type: 'run', durationSec: 2400, distanceM: 5000 },
    })
    const copy = await ctx.prisma.activity.create({
      data: {
        userId: user.id,
        date: todayIso(),
        type: 'strength',
        durationSec: 2400,
        rpe: 6,
        notes: 'Felt strong.',
        duplicateStatus: 'possible',
        duplicateOfId: original.id,
      },
    })
    await ctx.prisma.strengthLog.create({
      data: {
        id: uuid(111),
        userId: user.id,
        activityId: copy.id,
        prescribed: JSON.stringify(snapshot()),
      },
    })
    expect((await confirm(user, copy.id, 'confirmed')).status).toBe(200)
    expect(
      (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(111) } })).activityId,
    ).toBe(copy.id)
    expect(await reloadActivity(original.id)).toMatchObject({ rpe: null, notes: null })
  })

  test('a run of the same day and length is never paired with a strength session', async () => {
    const user = await newUser()
    const saved = await putLog(user, uuid(107), logBody({ durationMin: 41 }))
    const strengthId = resultOf(saved).activity.id
    const runId = await importStrength(user, { type: 'run', subtype: 'road', distanceM: 5000 })
    expect(await reloadActivity(strengthId)).toMatchObject({
      duplicateStatus: 'none',
      duplicateOfId: null,
    })
    expect(await reloadActivity(runId)).toMatchObject({ type: 'run', duplicateStatus: 'none' })
  })

  test('two hand-entered sessions on one day stay two', async () => {
    const user = await newUser()
    const first = await putLog(user, uuid(108), logBody({ durationMin: 40 }))
    const second = await putLog(user, uuid(109), logBody({ durationMin: 40 }))
    for (const saved of [first, second]) {
      expect(await reloadActivity(resultOf(saved).activity.id)).toMatchObject({
        duplicateStatus: 'none',
      })
    }
  })

  test('saving the log again with new minutes pairs the session, or releases the pair', async () => {
    const user = await newUser()
    const originalId = await importStrength(user, { elapsedSec: 2700 })
    // 40 minutes against 45 is further apart than 5%.
    const saved = await putLog(user, uuid(110), logBody({ durationMin: 40 }))
    const copyId = resultOf(saved).activity.id
    expect((await reloadActivity(copyId)).duplicateStatus).toBe('none')

    expect((await putLog(user, uuid(110), logBody({ durationMin: 44 }))).status).toBe(200)
    expect(await reloadActivity(copyId)).toMatchObject({
      durationSec: 2640,
      duplicateStatus: 'possible',
      duplicateOfId: originalId,
    })

    expect((await putLog(user, uuid(110), logBody({ durationMin: 30 }))).status).toBe(200)
    expect(await reloadActivity(copyId)).toMatchObject({
      duplicateStatus: 'none',
      duplicateOfId: null,
    })
  })

  test('editing the duration of a strength activity pairs it too', async () => {
    const user = await newUser()
    const originalId = await importStrength(user, { elapsedSec: 2700 })
    const created = await client(ctx, user)
      .post('/api/activities')
      .send({ date: todayIso(), type: 'strength', durationSec: 1800 })
    const copyId = (created.body as Activity).id
    expect((await reloadActivity(copyId)).duplicateStatus).toBe('none')

    const edited = await client(ctx, user)
      .put(`/api/activities/${copyId}`)
      .send({ date: todayIso(), type: 'strength', durationSec: 2640 })
    expect(edited.status).toBe(200)
    expect(await reloadActivity(copyId)).toMatchObject({
      duplicateStatus: 'possible',
      duplicateOfId: originalId,
    })
  })
})

describe('PUT /api/activities/:id on a strength activity that has a log', () => {
  const edit = (user: TestUser, id: string, body: Record<string, unknown>) =>
    client(ctx, user)
      .put(`/api/activities/${id}`)
      .send({ date: todayIso(), durationSec: 2400, ...body })

  test('refuses a change of type, names the log and leaves the activity as it was', async () => {
    const user = await newUser()
    const saved = await putLog(user, uuid(120))
    const id = resultOf(saved).activity.id
    for (const type of ['run', 'race', 'cross']) {
      const res = await edit(user, id, { type, distanceM: type === 'cross' ? undefined : 5000 })
      expect(res.status, type).toBe(409)
      expect(errorOf(res).code).toBe('conflict')
      expect(errorOf(res).message).toBe(strengthTypeLockedMessage())
      expect(errorOf(res).details?.logId).toBe(uuid(120))
    }
    expect(await reloadActivity(id)).toMatchObject({ type: 'strength', distanceM: null })
    expect(await ctx.prisma.strengthLog.count({ where: { id: uuid(120) } })).toBe(1)
  })

  test('allows an edit that keeps the type, and a change of type once the log is removed', async () => {
    const user = await newUser()
    const saved = await putLog(user, uuid(121))
    const id = resultOf(saved).activity.id
    const kept = await edit(user, id, { type: 'strength', notes: 'Edited.' })
    expect(kept.status).toBe(200)
    expect(kept.body).toMatchObject({ type: 'strength', notes: 'Edited.' })

    expect((await client(ctx, user).delete(`/api/strength/logs/${uuid(121)}`)).status).toBe(204)
    const changed = await edit(user, id, { type: 'run', distanceM: 5000 })
    expect(changed.status).toBe(200)
    expect(changed.body).toMatchObject({ type: 'run', distanceM: 5000 })
  })

  test('a strength activity with no log, and a run, change type as before', async () => {
    const user = await newUser()
    const plain = await client(ctx, user)
      .post('/api/activities')
      .send({ date: todayIso(), type: 'strength', durationSec: 1800 })
    const id = (plain.body as Activity).id
    expect((await edit(user, id, { type: 'cross', durationSec: 1800 })).status).toBe(200)
    expect((await edit(user, id, { type: 'strength', durationSec: 1800 })).status).toBe(200)
  })

  test('the message says it in the app’s own words', () => {
    const message = strengthTypeLockedMessage()
    expect(message).toBe(
      'This activity has sets logged, so its type stays strength. Remove the sets to change it.',
    )
    expect(message.length).toBeLessThanOrEqual(160)
  })
})

describe('POST /api/activities', () => {
  test('still stores a strength entry as an activity with no log', async () => {
    const user = await newUser()
    const res = await client(ctx, user)
      .post('/api/activities')
      .send({ date: todayIso(), type: 'strength', durationSec: 1800, notes: ' Done sheet. ' })
    expect(res.status).toBe(201)
    const activity = res.body as Activity
    expect(activity).toMatchObject({ type: 'strength', source: 'manual', notes: 'Done sheet.' })
    expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(0)

    // The sets attach to it afterwards: the old path stays, and "Add the sets" completes it.
    const attached = await putLog(user, uuid(90), logBody({ activityId: activity.id }))
    expect(attached.status).toBe(201)
    expect(resultOf(attached).activity.id).toBe(activity.id)
  })
})

describe('the catalogue and the API agree', () => {
  test('every exercise of the catalogue can be logged and given a starting point', async () => {
    const user = await newUser()
    const sets = EXERCISES.slice(0, 80).map((exercise) => ({ exerciseId: exercise.id, count: 5 }))
    expect((await putLog(user, uuid(95), logBody({ sets }))).status).toBe(201)
    for (const exercise of EXERCISES) {
      const res = await client(ctx, user)
        .put(`/api/strength/lifts/${exercise.id}`)
        .send({ kind: 'max', loadG: 1000 })
      expect(res.status, exercise.id).toBe(200)
    }
  })
})
