import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { strengthTypeLockedMessage } from '../../shared/copy/strengthTemplates.ts'
import { renderFact } from '../../shared/copy/templates.ts'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import { EXERCISES } from '../../shared/domain/strengthLibrary.ts'
import { P } from '../../shared/engine/params/index.ts'
import { structuresFor } from '../../shared/engine/strength.ts'
import { dataVersionKey } from '../../server/dataVersion.ts'
import { loadAthleteContext } from '../../server/services/athleteState.ts'
import { storeParsed } from '../../server/services/activityStore.ts'
import { loadStrengthContext, loadStrengthState } from '../../server/services/strength.ts'
import type {
  Activity,
  EquipmentConfig,
  ParsedActivity,
  StrengthLift,
  StrengthLog,
  StrengthLogResult,
  StrengthDayWorkout,
  StrengthExerciseView,
  StrengthSettings,
  StrengthSnapshot,
  StrengthView,
  StrengthWorkout,
  TodayView,
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

// The strength API (strength design 9.4 and 9.5): the setup, the starting points, the idempotent log
// save, and the read side (E14-6): the strength state, the workouts, the page view, one lift's
// history, the Today slot and the suggestions after a save.

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
    // The suggestions for the next session have their own tests (`the suggestions after a save`).
    // No barbell is saved, so the squat is not one the rules can suggest; the calf raise is.
    expect(next.map((entry) => entry.exerciseId)).toEqual(['standing-calf-raise'])

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
  test('moves on every write, so the memo of the strength state drops', async () => {
    const user = await newUser()
    // The state is one object per version: a read that finds the memo returns the same one.
    const read = () => loadStrengthState(ctx, { userId: user.id, today: todayIso() })
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
      expect(next, `${name} drops the memo`).not.toBe(seen)
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

// ---------------------------------------------------------------------------------------------
// The read side (E14-6): the strength state, the workouts, the page view and one lift's history
// ---------------------------------------------------------------------------------------------

const PLAN_TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})
const STRENGTH_RULES = ['F-lib', 'F4', 'E5', 'F7']

interface SeedSession {
  date: string
  kind?: string
  min?: number
  status?: string
  rules?: string[]
  activityId?: string
}

/**
 * A version-2 plan of 16 weeks (six behind this one, nine ahead) with hand-made sessions, so each
 * test controls what is planned. The first `block` weeks carry the strength block flag: the current
 * week is week 7 of 12 by default, after a ramp-in of three weeks, so its template is `heavy`.
 */
async function seedPlan(
  user: TestUser,
  sessions: SeedSession[],
  seed: { block?: number; distanceM?: number; targetTimeSec?: number } = {},
) {
  const { thisMonday } = days()
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: user.id,
      name: 'Synthetic race',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 14 + 5),
      distanceM: seed.distanceM ?? 21_097,
      ...(seed.targetTimeSec === undefined
        ? {}
        : { goalType: 'time', targetTimeSec: seed.targetTimeSec }),
    },
  })
  const starts = Array.from({ length: 16 }, (_, i) => addDays(thisMonday, 7 * (i - 6)))
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: user.id,
      goalId: goal.id,
      name: goal.name,
      startDate: starts[0]!,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: starts.map((weekStart, index) => ({
          weekStart,
          index,
          phase: 'build',
          baselineRunMin: 200,
          targetRunMin: 200,
          longRunMin: 70,
          runDays: 4,
          strengthSessions: 2,
          flags: JSON.stringify(index < (seed.block ?? 12) ? ['strength-block'] : []),
        })),
      },
    },
  })
  const rows = []
  for (const [i, s] of sessions.entries()) {
    const kind = s.kind ?? 'strength'
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: randomUUID(),
          weekStart: mondayOf(s.date),
          date: s.date,
          order: i,
          kind,
          title: kind === 'strength' ? 'Strength' : `${kind} session`,
          durationMin: s.min ?? (kind === 'strength' ? 40 : 45),
          structure: '[]',
          target: PLAN_TARGET,
          purpose: 'Synthetic.',
          rules: JSON.stringify(s.rules ?? (kind === 'strength' ? STRENGTH_RULES : [])),
          status: s.status ?? 'planned',
          activityId: s.activityId ?? null,
        },
      }),
    )
  }
  return { plan, goal, rows }
}

/** The runner's profile: a body weight and a birth year, as the first load and the age read them. */
const seedProfile = (user: TestUser, over: Record<string, unknown> = {}) =>
  ctx.prisma.athleteProfile.create({
    data: { userId: user.id, weightKg: 70, birthYear: 1988, timezone: 'UTC', ...over },
  })

const setup = (user: TestUser, body: Record<string, unknown>) =>
  client(ctx, user)
    .put('/api/strength/settings')
    .send(body)
    .then((res) => {
      expect(res.status, JSON.stringify(res.body)).toBe(200)
      return res
    })

/** One set of a seeded log: exercise, load in grams, count, reps left. */
type SeedSet = readonly [
  exerciseId: string,
  loadG: number | null,
  count: number,
  rir: number | null,
]

interface SeedLog {
  id: string
  date: string
  sets: readonly SeedSet[]
  mode?: StrengthSnapshot['mode']
  template?: StrengthSnapshot['template']
  /** The implement each exercise was done with; bodyweight when absent. */
  implement?: Record<string, 'barbell' | 'dumbbells' | 'leg-press' | null>
  activity?: Record<string, unknown>
}

/** A log on a new strength activity, written straight to the tables (the data version still moves). */
async function seedLog(user: TestUser, log: SeedLog) {
  const activity = await ctx.prisma.activity.create({
    data: {
      userId: user.id,
      date: log.date,
      type: 'strength',
      durationSec: 2400,
      source: 'manual',
      ...log.activity,
    },
  })
  const exercises = [...new Set(log.sets.map(([id]) => id))]
  const prescribed: StrengthSnapshot = {
    template: log.template ?? 'heavy',
    variant: 'A',
    week: 4,
    mode: log.mode ?? 'normal',
    lifts: exercises.map((exerciseId) => {
      const own = log.sets.filter(([id]) => id === exerciseId)
      const load = own[0]?.[1] ?? null
      return {
        exerciseId,
        implement: log.implement?.[exerciseId] ?? null,
        sets: own.length,
        range: { min: 3, max: 6 },
        rir: { min: 1, max: 3 },
        baseLoadG: load,
        shownLoadG: load,
        change: 'hold' as const,
        basis: { rule: 'F8' as const, facts: [] },
      }
    }),
  }
  await ctx.prisma.strengthLog.create({
    data: {
      id: log.id,
      userId: user.id,
      activityId: activity.id,
      prescribed: JSON.stringify(prescribed),
      sets: {
        create: log.sets.map(([exerciseId, loadG, count, rir], position) => ({
          userId: user.id,
          exerciseId,
          position,
          loadG,
          count,
          rir,
        })),
      },
    },
  })
  return activity
}

/** Back squat, 110 lb for the given counts, 4 sets of 6 with 2 reps left by default. */
const squat = (counts: number[] = [6, 6, 6, 6], rir: number | null = 2): SeedSet[] =>
  counts.map((count) => ['back-squat', LB(110), count, rir] as const)
const LB = (pounds: number) => Math.round(pounds * 453.59237)

const strengthState = (user: TestUser, today = todayIso()) =>
  loadStrengthState(ctx, { userId: user.id, today })

describe('the strength state', () => {
  test('carries the setup, the starting points, the logs, the plan and the readiness the engine reads', async () => {
    const user = await newUser()
    const { today, thisMonday } = days()
    await seedProfile(user)
    await setup(user, {
      equipment: [BARBELL, DUMBBELLS],
      level: 'some',
      currentlyLifting: true,
      avoid: ['split-squat'],
      pinned: { calf: 'standing-calf-raise' },
    })
    await client(ctx, user)
      .put('/api/strength/lifts/back-squat')
      .send({ kind: 'max', loadG: 100_000 })
    await client(ctx, user).put('/api/settings').send({ weightUnit: 'kg' })
    const { rows } = await seedPlan(user, [
      { date: today },
      { date: addDays(today, 2) },
      { date: addDays(today, 1), kind: 'easy' },
    ])
    // Two runs of 60 minutes last week: the minutes of a finished week, from the history.
    await ctx.prisma.activity.createMany({
      data: [1, 3].map((offset) => ({
        userId: user.id,
        date: addDays(thisMonday, -7 + offset),
        type: 'run',
        durationSec: 3600,
        distanceM: 10_000,
        source: 'manual',
      })),
    })
    await seedLog(user, {
      id: uuid(200),
      date: addDays(today, -5),
      sets: [...squat(), ['standing-calf-raise', null, 12, null]],
      implement: { 'back-squat': 'barbell' },
    })
    await seedLog(user, {
      id: uuid(201),
      date: addDays(today, -2),
      sets: squat([6, 5]),
      mode: 'lighter-day',
      template: 'lighter-week',
      implement: { 'back-squat': 'barbell' },
    })

    const context = await loadStrengthContext(ctx, { userId: user.id, today })

    expect(context.today).toBe(today)
    expect(context.weightUnit).toBe('kg')
    expect(context.setup).toEqual({
      saved: true,
      equipment: [BARBELL, DUMBBELLS],
      level: 'some',
      currentlyLifting: true,
      avoid: ['split-squat'],
      pinned: { calf: 'standing-calf-raise' },
    })
    expect(context.anchors).toEqual([
      { exerciseId: 'back-squat', kind: 'max', loadG: 100_000, reps: 1, rir: null, asOf: today },
    ])
    // Newest first, with the mode and the template the sheet recorded and each lift's implement.
    expect(context.logs.map((l) => [l.id, l.date, l.mode, l.template])).toEqual([
      [uuid(201), addDays(today, -2), 'lighter-day', 'lighter-week'],
      [uuid(200), addDays(today, -5), 'normal', 'heavy'],
    ])
    expect(context.logs[1]).toMatchObject({
      sets: [
        { exerciseId: 'back-squat', position: 0, loadG: LB(110), count: 6, rir: 2 },
        { exerciseId: 'back-squat', position: 1, loadG: LB(110), count: 6, rir: 2 },
        { exerciseId: 'back-squat', position: 2, loadG: LB(110), count: 6, rir: 2 },
        { exerciseId: 'back-squat', position: 3, loadG: LB(110), count: 6, rir: 2 },
        { exerciseId: 'standing-calf-raise', position: 4, loadG: null, count: 12, rir: null },
      ],
      lifts: [
        { exerciseId: 'back-squat', implement: 'barbell', baseLoadG: LB(110) },
        { exerciseId: 'standing-calf-raise', implement: null, baseLoadG: null },
      ],
    })
    // The plan: the weeks with their flags and minutes, and only the strength sessions.
    expect(context.weeks).toHaveLength(16)
    expect(context.weeks.filter((w) => w.flags.includes('strength-block'))).toHaveLength(12)
    expect(context.weeks.find((w) => w.weekStart === addDays(thisMonday, -7))).toMatchObject({
      plannedRunMin: 200,
      runMin: 120,
    })
    expect(context.weeks.find((w) => w.weekStart === thisMonday)).toMatchObject({ runMin: 0 })
    expect(context.sessions.map((s) => s.id)).toEqual([rows[0]!.id, rows[1]!.id])
    expect(context.athlete).toEqual({
      age: Number(today.slice(0, 4)) - 1988,
      weightKg: 70,
      risk: { priorBsi: false, recentInjury: false },
    })
    expect(context.goal.paceKmh).toBeGreaterThan(0)
    expect(context.readiness).toEqual({
      date: today,
      state: 'normal',
      pain: null,
      illness: 'clear',
    })
    // Memoised values are shared, so the whole of it is frozen.
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.logs)).toBe(true)
  })

  test('reads a runner with nothing saved as the defaults: bodyweight, no logs, no plan', async () => {
    const user = await newUser()
    const context = await loadStrengthContext(ctx, { userId: user.id, today: todayIso() })
    expect(context.setup).toEqual({
      saved: false,
      equipment: [],
      level: 'new',
      currentlyLifting: false,
      avoid: [],
      pinned: {},
    })
    expect(context).toMatchObject({
      weightUnit: 'lb',
      anchors: [],
      logs: [],
      weeks: [],
      sessions: [],
      athlete: { age: null, weightKg: null },
      goal: { paceKmh: null },
    })
  })

  test('takes the goal pace from a time goal: its distance over its time', async () => {
    const user = await newUser()
    await seedPlan(user, [], { distanceM: 10_000, targetTimeSec: 3000 })
    const context = await loadStrengthContext(ctx, { userId: user.id, today: todayIso() })
    // 10 km in 50 minutes is 12 km/h
    expect(context.goal.paceKmh).toBeCloseTo(12, 5)
  })

  test('reads the readiness of today: the pain reported and the illness phase', async () => {
    const user = await newUser()
    const { today } = days()
    await client(ctx, user)
      .put(`/api/checkins/${today}`)
      .send({ painScore: P.pain.flagScore.value + 1 })
    expect((await loadStrengthContext(ctx, { userId: user.id, today })).readiness).toMatchObject({
      date: today,
      pain: P.pain.flagScore.value + 1,
      illness: 'clear',
    })
    const ill = await newUser()
    await client(ctx, ill).put(`/api/checkins/${today}`).send({ illness: true })
    expect((await loadStrengthContext(ctx, { userId: ill.id, today })).readiness).toMatchObject({
      illness: 'rest',
    })
  })

  test('reads the weeks of logs from 26 back, not one day earlier', async () => {
    const user = await newUser()
    const { today } = days()
    const edge = addDays(today, -7 * 26)
    await seedLog(user, { id: uuid(210), date: edge, sets: squat() })
    await seedLog(user, { id: uuid(211), date: addDays(edge, -1), sets: squat() })
    const state = await strengthState(user)
    expect(state.logs.map((log) => log.id)).toEqual([uuid(210)])
    expect(state.context.logs.map((log) => log.id)).toEqual([uuid(210)])
  })

  describe('the queries', () => {
    type Delegate = Record<string, (...args: unknown[]) => PromiseLike<unknown>>
    const watched = [
      ['user', 'findUnique'],
      ['strengthSettings', 'findUnique'],
      ['strengthLift', 'findMany'],
      ['strengthLog', 'findMany'],
    ] as const
    // The snapshot's own reads: the strength state adds none of them.
    const athleteReads = [
      ['activity', 'findMany'],
      ['wellnessDay', 'findMany'],
      ['weeklyReview', 'findMany'],
      ['plan', 'findFirst'],
      ['athleteProfile', 'findUnique'],
    ] as const

    function watch(models: ReadonlyArray<readonly [string, string]>) {
      const events: string[] = []
      for (const [model, method] of models) {
        const delegate = (ctx.prisma as unknown as Record<string, Delegate>)[model]!
        const original = delegate[method]!.bind(delegate)
        vi.spyOn(delegate, method).mockImplementation((...args: unknown[]) => {
          const name = `${model}.${method}`
          events.push(`start ${name}`)
          const result = original(...args)
          void Promise.resolve(result).then(() => events.push(`end ${name}`))
          return result
        })
      }
      return events
    }
    afterEach(() => {
      vi.restoreAllMocks()
    })

    test('is one round of four reads, started together, once per data version and day', async () => {
      const user = await newUser()
      const { today } = days()
      await seedPlan(user, [{ date: today }])
      await seedLog(user, { id: uuid(220), date: addDays(today, -3), sets: squat() })
      // The snapshot is built first, so what is left for the state is its own round.
      await loadAthleteContext(ctx, { userId: user.id, today })
      const events = watch(watched)

      const first = await strengthState(user)
      const starts = events.filter((event) => event.startsWith('start')).sort()
      expect(starts).toEqual(watched.map(([model, method]) => `start ${model}.${method}`).sort())
      // Every read is started before the first one finishes: no read waits for another.
      const firstEnd = events.findIndex((event) => event.startsWith('end'))
      expect(events.slice(0, firstEnd).filter((event) => event.startsWith('start'))).toHaveLength(
        watched.length,
      )

      // The same version and day: the memo answers, with the one object and no query.
      events.length = 0
      expect(await strengthState(user)).toBe(first)
      expect(await loadStrengthContext(ctx, { userId: user.id, today })).toBe(first.context)
      expect(events).toEqual([])

      // Another day is another memo (the window moves with it), and so is a write.
      await strengthState(user, addDays(today, 1))
      expect(events.filter((event) => event.startsWith('start'))).toHaveLength(watched.length)
      await setup(user, { level: 'some' })
      events.length = 0
      const after = await strengthState(user)
      expect(after).not.toBe(first)
      expect(events.filter((event) => event.startsWith('start'))).toHaveLength(watched.length)
    })

    test('reads no row of the history window or of the stored plan itself', async () => {
      const user = await newUser()
      const { today } = days()
      await seedPlan(user, [{ date: today }])
      await loadAthleteContext(ctx, { userId: user.id, today })
      const events = watch(athleteReads)
      await strengthState(user)
      expect(events).toEqual([])
    })
  })

  describe('a session that two activities stand for', () => {
    const stateIds = async (user: TestUser) => (await strengthState(user)).logs.map((l) => l.id)

    test('is counted once: a confirmed copy’s log is left out, the original’s stands', async () => {
      const user = await newUser()
      const { copyId, originalId } = await (async () => {
        const saved = await putLog(user, uuid(230), logBody())
        const copy = resultOf(saved).activity.id
        const original = await importStrength(user)
        return { copyId: copy, originalId: original }
      })()
      // Possible: nothing is decided, and the one log stands.
      expect(await reloadActivity(copyId)).toMatchObject({ duplicateStatus: 'possible' })
      expect(await stateIds(user)).toEqual([uuid(230)])

      // Confirmed: the log moves to the original, and is counted there once.
      expect((await confirm(user, copyId, 'confirmed')).status).toBe(200)
      expect(
        (await ctx.prisma.strengthLog.findUniqueOrThrow({ where: { id: uuid(230) } })).activityId,
      ).toBe(originalId)
      expect(await stateIds(user)).toEqual([uuid(230)])
    })

    test('a confirmed copy that keeps a log because the original has its own is skipped', async () => {
      const user = await newUser()
      const saved = await putLog(user, uuid(231), logBody())
      const copyId = resultOf(saved).activity.id
      const originalId = await importStrength(user)
      await putLog(user, uuid(232), logBody({ activityId: originalId }))
      expect((await confirm(user, copyId, 'confirmed')).status).toBe(200)
      // Both logs are still stored, on their own activities; the copy's is not a second session.
      expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(2)
      expect(await stateIds(user)).toEqual([uuid(232)])
    })

    test('a log is kept when nothing else stands for its session: a copy of an activity that is not a strength session', async () => {
      const user = await newUser()
      const original = await ctx.prisma.activity.create({
        data: {
          userId: user.id,
          date: todayIso(),
          type: 'run',
          durationSec: 2400,
          distanceM: 5000,
        },
      })
      const activity = await seedLog(user, {
        id: uuid(235),
        date: todayIso(),
        sets: squat(),
        activity: { duplicateStatus: 'confirmed', duplicateOfId: original.id },
      })
      expect(activity.duplicateStatus).toBe('confirmed')
      expect(await stateIds(user)).toEqual([uuid(235)])
    })

    test('a possible copy is counted when the original has no log, and skipped when it has one', async () => {
      const user = await newUser()
      const saved = await putLog(user, uuid(233), logBody())
      const copyId = resultOf(saved).activity.id
      const originalId = await importStrength(user)
      expect(await reloadActivity(copyId)).toMatchObject({
        duplicateStatus: 'possible',
        duplicateOfId: originalId,
      })
      expect(await stateIds(user)).toEqual([uuid(233)])
      // The runner adds the sets to the export as well: one session, one count.
      await putLog(user, uuid(234), logBody({ activityId: originalId }))
      expect(await ctx.prisma.strengthLog.count({ where: { userId: user.id } })).toBe(2)
      expect(await stateIds(user)).toEqual([uuid(234)])
      // Dismissed, they are two sessions again.
      expect((await confirm(user, copyId, 'dismissed')).status).toBe(200)
      expect((await stateIds(user)).sort()).toEqual([uuid(233), uuid(234)])
    })
  })
})

describe('GET /api/strength/workouts', () => {
  const workoutsOf = async (user: TestUser, from: string, to: string) => {
    const res = await client(ctx, user).get(`/api/strength/workouts?from=${from}&to=${to}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body as StrengthWorkout[]
  }

  test('derives the workout of each strength session of the span, by date', async () => {
    const user = await newUser()
    const { thisMonday, nextMonday } = days()
    await seedProfile(user)
    await setup(user, { equipment: [BARBELL, DUMBBELLS, { kind: 'step' }], level: 'some' })
    // Next week is week 8 of the block of 12, whatever day it is today.
    const tuesday = addDays(nextMonday, 1)
    const thursday = addDays(nextMonday, 3)
    const { rows } = await seedPlan(user, [
      { date: thursday },
      { date: tuesday },
      { date: addDays(nextMonday, 2), kind: 'easy' },
      { date: addDays(nextMonday, 40) },
    ])
    const out = await workoutsOf(user, thisMonday, addDays(nextMonday, 30))
    expect(out.map((w) => w.sessionId)).toEqual([rows[1]!.id, rows[0]!.id])
    expect(out.map((w) => w.date)).toEqual([tuesday, thursday])
    const [first] = out
    expect(first).toMatchObject({
      template: 'heavy',
      block: { week: 8, of: 12, rampInWeeks: 3 },
      budgetMin: 40,
      setupSaved: true,
      rules: STRENGTH_RULES,
    })
    expect(first!.lifts.length).toBeGreaterThan(0)
    // Loads are whole grams on the rungs the equipment makes, never prose.
    for (const lift of first!.lifts) {
      if (lift.loadG !== null) expect(Number.isInteger(lift.loadG)).toBe(true)
      expect(lift.basis.facts.every((f) => typeof f.template === 'string')).toBe(true)
    }
    expect(first!.lifts.some((lift) => lift.implement === 'barbell')).toBe(true)
  })

  test('is the workout as of today: a log moves the next session’s load, a change of equipment moves its lifts', async () => {
    const user = await newUser()
    const { today, thisMonday, nextMonday } = days()
    await seedProfile(user)
    await setup(user, { equipment: [BARBELL], level: 'some' })
    await seedPlan(user, [{ date: addDays(nextMonday, 1) }])
    const span = [thisMonday, addDays(nextMonday, 7)] as const
    const before = (await workoutsOf(user, ...span))[0]!
    const lead = before.lifts.find((lift) => lift.exerciseId === 'back-squat')!
    expect(lead.loadG).not.toBeNull()

    // A session at the top of the range with reps left moves the load up (rule F8.5).
    await seedLog(user, {
      id: uuid(240),
      date: addDays(today, -3),
      sets: squat([6, 6, 6, 6], 2).map(([id, , count, rir]): SeedSet => [
        id,
        lead.loadG,
        count,
        rir,
      ]),
      implement: { 'back-squat': 'barbell' },
    })
    const after = (await workoutsOf(user, ...span))[0]!
    const moved = after.lifts.find((lift) => lift.exerciseId === 'back-squat')!
    expect(moved.change).toBe('increase')
    expect(moved.loadG).toBeGreaterThan(lead.loadG!)
    // The block position is the plan's, so equipment does not move it.
    await setup(user, { equipment: [DUMBBELLS, { kind: 'step' }] })
    const swapped = (await workoutsOf(user, ...span))[0]!
    expect(swapped.block).toEqual(before.block)
    expect(swapped.lifts.some((lift) => lift.implement === 'barbell')).toBe(false)
  })

  test('is bodyweight only until the setup is saved', async () => {
    const user = await newUser()
    const { today } = days()
    await seedPlan(user, [{ date: today }])
    const [workout] = await workoutsOf(user, today, today)
    expect(workout).toMatchObject({ setupSaved: false })
    expect(workout!.lifts.every((lift) => lift.loadG === null && lift.implement === null)).toBe(
      true,
    )
  })

  test('is empty without a plan, and never shows another runner’s sessions', async () => {
    const planned = await newUser()
    const other = await newUser()
    const { today } = days()
    await seedPlan(planned, [{ date: today }])
    expect(await workoutsOf(planned, today, today)).toHaveLength(1)
    expect(await workoutsOf(other, today, addDays(today, 30))).toEqual([])
  })

  test.each([
    ['no span', ''],
    ['no end', '?from=2026-01-01'],
    ['an end before the start', '?from=2026-02-01&to=2026-01-01'],
    ['a span of 63 days', '?from=2026-01-01&to=2026-03-05'],
    ['a date that is not a day', '?from=2026-02-30&to=2026-03-01'],
    ['an unknown parameter', '?from=2026-01-01&to=2026-01-02&units=lb'],
  ])('refuses %s with the issue', async (_name, query) => {
    const user = await newUser()
    const res = await client(ctx, user).get(`/api/strength/workouts${query}`)
    expect(res.status).toBe(400)
    expect(issuePaths(res).length).toBeGreaterThan(0)
  })

  test('takes a span of 62 days and no more', async () => {
    const user = await newUser()
    const res = await client(ctx, user).get('/api/strength/workouts?from=2026-01-01&to=2026-03-04')
    expect(res.status).toBe(200)
  })
})

describe('GET /api/strength/workout', () => {
  const dayQuery = (date: string, extra: Record<string, string> = {}) =>
    new URLSearchParams({ date, ...extra }).toString()
  const dayOf = async (user: TestUser, date: string, extra: Record<string, string> = {}) => {
    const res = await client(ctx, user).get(`/api/strength/workout?${dayQuery(date, extra)}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body as StrengthDayWorkout
  }

  /** A runner with a bar and dumbbells, in week 7 of a block of 12 (a heavy week). */
  const lifter = async (sessions: SeedSession[], seed: { block?: number } = {}) => {
    const user = await newUser()
    await seedProfile(user)
    await setup(user, { equipment: [BARBELL, DUMBBELLS, { kind: 'step' }], level: 'some' })
    const { rows } = await seedPlan(user, sessions, seed)
    return { user, rows }
  }

  describe('a day with a planned session', () => {
    test('answers its workout as the other reads give it: one function, one object', async () => {
      const { today } = days()
      const { user, rows } = await lifter([{ date: today }])
      const day = await dayOf(user, today)
      expect(day.source).toBe('planned')
      expect(day.lift).toBeNull()
      expect(day.workout).toMatchObject({ sessionId: rows[0]!.id, date: today, template: 'heavy' })
      const slot = (await todayView(user)).coach.slots.strength
      expect(day.workout).toEqual(slot)
      const list = await client(ctx, user).get(`/api/strength/workouts?from=${today}&to=${today}`)
      expect(list.body).toEqual([day.workout])
    })

    test('is the workout of a day that is over, whatever became of its session', async () => {
      const { today } = days()
      const past = addDays(today, -2)
      const { user, rows } = await lifter([{ date: past, status: 'completed' }])
      const day = await dayOf(user, past)
      expect(day.source).toBe('planned')
      expect(day.workout.sessionId).toBe(rows[0]!.id)
    })

    test('takes the session that is still to be done when the day has two, and sessionId names the other', async () => {
      const { today } = days()
      const { user, rows } = await lifter([
        { date: today, status: 'completed' },
        { date: today, min: 25 },
      ])
      const day = await dayOf(user, today)
      expect(day.workout).toMatchObject({ sessionId: rows[1]!.id, budgetMin: 25 })
      const named = await dayOf(user, today, { sessionId: rows[0]!.id })
      expect(named.source).toBe('planned')
      expect(named.workout).toMatchObject({ sessionId: rows[0]!.id, budgetMin: 40 })
    })

    test('derives the same workout for a session of a coming day, as of today', async () => {
      const { today } = days()
      const later = addDays(today, 3)
      const { user, rows } = await lifter([{ date: later }])
      const day = await dayOf(user, later, { sessionId: rows[0]!.id })
      const list = await client(ctx, user).get(`/api/strength/workouts?from=${later}&to=${later}`)
      expect(day.workout).toEqual((list.body as StrengthWorkout[])[0])
    })
  })

  describe('a day with no planned session', () => {
    test('starts from the next planned session still to be done, with that session’s id and day', async () => {
      const { today } = days()
      const { user, rows } = await lifter([
        { date: addDays(today, -1), status: 'completed' },
        { date: addDays(today, 2), status: 'completed' },
        { date: addDays(today, 3) },
        { date: addDays(today, 5) },
      ])
      const day = await dayOf(user, today)
      expect(day.source).toBe('next-planned')
      expect(day.workout).toMatchObject({ sessionId: rows[2]!.id, date: addDays(today, 3) })
      const list = await client(ctx, user).get(
        `/api/strength/workouts?from=${addDays(today, 3)}&to=${addDays(today, 3)}`,
      )
      expect(day.workout).toEqual((list.body as StrengthWorkout[])[0])
    })

    test('starts a past day from the next session still ahead, not from a session already over', async () => {
      const { today } = days()
      const { user, rows } = await lifter([
        { date: addDays(today, -3), status: 'completed' },
        { date: addDays(today, 1) },
      ])
      const day = await dayOf(user, addDays(today, -6))
      expect(day.source).toBe('next-planned')
      expect(day.workout.sessionId).toBe(rows[1]!.id)
    })

    test('starts from the maintenance session of that week when none is planned from then on', async () => {
      const { today } = days()
      const { user } = await lifter([{ date: addDays(today, -4), status: 'completed' }], {
        block: 0,
      })
      const day = await dayOf(user, today)
      expect(day.source).toBe('maintenance')
      expect(day.workout).toMatchObject({
        sessionId: `maintenance-${today}`,
        date: today,
        template: 'maintenance',
        block: null,
        budgetMin: P.f7.maintenanceSessionMin.value,
        setupSaved: true,
        rules: [],
      })
      expect(day.workout.lifts.length).toBeGreaterThan(0)
      expect(day.workout.lifts.every((lift) => lift.sets === P.f7.maintenanceSets.value)).toBe(true)
    })

    test('is the maintenance session for a runner with no plan at all, and bodyweight only before the setup', async () => {
      const user = await newUser()
      const { today } = days()
      const day = await dayOf(user, today)
      expect(day.source).toBe('maintenance')
      expect(day.workout).toMatchObject({ template: 'maintenance', setupSaved: false })
      expect(
        day.workout.lifts.every((lift) => lift.implement === null && lift.loadG === null),
      ).toBe(true)
    })

    test('reads its loads from the history, as of today', async () => {
      const { today } = days()
      const { user } = await lifter([], { block: 0 })
      const before = (await dayOf(user, today)).workout.lifts.find((lift) => lift.slot === 'knee')!
      expect(before.evidence.latest).toBeNull()
      await seedLog(user, {
        id: uuid(9001),
        date: addDays(today, -3),
        sets: Array.from({ length: 4 }, (): SeedSet => [before.exerciseId, LB(30), 6, 2]),
        implement: { [before.exerciseId]: before.implement as 'dumbbells' },
      })
      const after = (await dayOf(user, today)).workout.lifts.find((lift) => lift.slot === 'knee')!
      expect(after.exerciseId).toBe(before.exerciseId)
      expect(after.evidence.latest).toMatchObject({ logId: uuid(9001), sets: 4 })
    })
  })

  describe('with swap', () => {
    const FIRST = structuresFor('heavy', 'other', 7).first

    test('puts an exercise with no history in as its first session: the ramp-in sets and counts, the lightest load', async () => {
      const { today } = days()
      const { user } = await lifter([{ date: today }])
      const day = await dayOf(user, today, { swap: 'goblet-squat' })
      const lift = day.lift!
      expect(lift).toMatchObject({
        exerciseId: 'goblet-squat',
        slot: 'knee',
        implement: 'dumbbells',
        change: 'start',
        sets: FIRST.loaded.sets,
        range: FIRST.loaded.range,
        rir: FIRST.loaded.rir,
        evidence: { latest: null, judged: null },
      })
      // a rung of the dumbbells the setup holds: 10 lb and then 5 lb more
      expect(lift.loadG).toBeGreaterThanOrEqual(4536)
      expect((lift.loadG! - 4536) % 2268).toBe(0)
      expect(lift.basis.facts.length).toBeGreaterThan(0)
      expect(lift.basis.facts.every((fact) => typeof fact.template === 'string')).toBe(true)
      // the workout is the day’s own: a swap changes nothing in it
      expect(day.workout).toEqual((await dayOf(user, today)).workout)
    })

    test('uses the template of the week for an exercise with a history and the first-session structure for one without', async () => {
      const { today } = days()
      const { user } = await lifter([{ date: today }])
      await seedLog(user, {
        id: uuid(9002),
        date: addDays(today, -4),
        sets: Array.from({ length: 4 }, (): SeedSet => ['goblet-squat', LB(30), 6, 2]),
        implement: { 'goblet-squat': 'dumbbells' },
      })
      const known = (await dayOf(user, today, { swap: 'goblet-squat' })).lift!
      const fresh = (await dayOf(user, today, { swap: 'split-squat' })).lift!
      const heavy = structuresFor('heavy', 'other', 7).template.loaded
      expect(heavy.range).not.toEqual(FIRST.loaded.range)
      expect(known.range).toEqual(heavy.range)
      expect(fresh).toMatchObject({ change: 'start', range: FIRST.loaded.range })
    })

    test('gives an exercise with a history its own load and its own sessions as the evidence', async () => {
      const { today } = days()
      const { user } = await lifter([{ date: today }])
      await seedLog(user, {
        id: uuid(9003),
        date: addDays(today, -4),
        sets: Array.from({ length: 4 }, (): SeedSet => ['goblet-squat', LB(30), 6, 2]),
        implement: { 'goblet-squat': 'dumbbells' },
      })
      const lift = (await dayOf(user, today, { swap: 'goblet-squat' })).lift!
      expect(lift.change).not.toBe('start')
      expect(lift.evidence.judged).toMatchObject({ logId: uuid(9003), sets: 4 })
      // never below the 30 lb it was logged at: the rules hold it or move it up
      expect(lift.loadG).toBeGreaterThanOrEqual(LB(30))
    })

    test('starts a movement with no added load with none, and a trunk exercise as a trunk lift', async () => {
      const { today } = days()
      const { user } = await lifter([{ date: today }])
      const tempo = (await dayOf(user, today, { swap: 'tempo-squat' })).lift!
      expect(tempo).toMatchObject({ implement: null, loadG: null, steps: null, change: 'start' })
      expect(tempo.range).toEqual(FIRST.unloaded.range)
      const trunk = (await dayOf(user, today, { swap: 'dead-bug' })).lift!
      expect(trunk).toMatchObject({ slot: 'trunk', loadG: null })
    })

    test('reads the exercise in the place of the session the answer is for', async () => {
      const { today } = days()
      const { user, rows } = await lifter([{ date: addDays(today, 2) }])
      const off = await dayOf(user, today, { swap: 'goblet-squat' })
      expect(off.source).toBe('next-planned')
      expect(off.workout.sessionId).toBe(rows[0]!.id)
      // the same lift as the planned session’s own day gives
      const own = await dayOf(user, addDays(today, 2), {
        sessionId: rows[0]!.id,
        swap: 'goblet-squat',
      })
      expect(off.lift).toEqual(own.lift)
      expect(off.lift).toMatchObject({ exerciseId: 'goblet-squat', change: 'start' })
    })

    test('is null for an exercise the saved equipment cannot make and for a jump', async () => {
      const { today } = days()
      const { user } = await lifter([{ date: today }])
      expect((await dayOf(user, today, { swap: 'leg-press' })).lift).toBeNull()
      expect((await dayOf(user, today, { swap: 'pogo-hop' })).lift).toBeNull()
    })
  })

  test('writes nothing and reads the memoised state: a second read runs no query of the history or the plan', async () => {
    const { today } = days()
    const { user } = await lifter([{ date: today }])
    await dayOf(user, today)
    const before = await dataVersionKey(ctx.prisma)
    const watched = [
      ['activity', 'findMany'],
      ['wellnessDay', 'findMany'],
      ['weeklyReview', 'findMany'],
      ['plan', 'findFirst'],
      ['strengthLog', 'findMany'],
      ['strengthSettings', 'findUnique'],
    ] as const
    type Delegate = Record<string, (...args: unknown[]) => PromiseLike<unknown>>
    const spies = watched.map(([model, method]) =>
      vi.spyOn((ctx.prisma as unknown as Record<string, Delegate>)[model]!, method),
    )
    try {
      await dayOf(user, today, { swap: 'goblet-squat' })
      await dayOf(user, addDays(today, 9))
      expect(spies.map((spy) => spy.mock.calls.length)).toEqual(watched.map(() => 0))
      expect(await dataVersionKey(ctx.prisma)).toEqual(before)
      // the spies are live: a write drops the memo, and the next read runs the queries again
      await setup(user, { level: 'experienced' })
      await dayOf(user, today)
      expect(spies.every((spy) => spy.mock.calls.length > 0)).toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
  })

  test.each([
    ['no date', ''],
    ['a date that is not a day', 'date=2026-02-30'],
    ['a date in another shape', 'date=18-03-2026'],
    ['an unknown parameter', 'date=2026-03-18&units=lb'],
    ['an exercise that is not in the catalogue', 'date=2026-03-18&swap=nothing'],
    ['an empty session id', 'date=2026-03-18&sessionId='],
    ['two dates', 'date=2026-03-18&date=2026-03-19'],
  ])('refuses %s with the issue', async (_name, query) => {
    const user = await newUser()
    const res = await client(ctx, user).get(`/api/strength/workout?${query}`)
    expect(res.status).toBe(400)
    expect(errorOf(res).code).toBe('validation')
    expect(issuePaths(res).length).toBeGreaterThan(0)
  })

  test('is 404 for a session id that is a run, another runner’s, or a strength session of another day', async () => {
    const { today } = days()
    const { user, rows } = await lifter([
      { date: today, kind: 'easy' },
      { date: addDays(today, 2) },
    ])
    const other = await lifter([{ date: today }])
    const refuse = async (sessionId: string, date = today) => {
      const res = await client(ctx, user).get(
        `/api/strength/workout?${dayQuery(date, { sessionId })}`,
      )
      expect(res.status, JSON.stringify(res.body)).toBe(404)
      expect(errorOf(res).code).toBe('not_found')
    }
    await refuse(rows[0]!.id)
    await refuse(other.rows[0]!.id)
    await refuse(rows[1]!.id)
    await refuse(randomUUID())
    // and the right day answers
    expect((await dayOf(user, addDays(today, 2), { sessionId: rows[1]!.id })).source).toBe(
      'planned',
    )
  })
})

describe('GET /api/strength', () => {
  const view = async (user: TestUser) => {
    const res = await client(ctx, user).get('/api/strength')
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body as StrengthView
  }

  test('is the empty page for a runner with nothing saved', async () => {
    const user = await newUser()
    const body = await view(user)
    expect(body).toMatchObject({
      asOf: todayIso(),
      setupSaved: false,
      block: null,
      next: [],
      recent: [],
      lifts: [],
      weeks: [],
      anchors: [],
      lowCountWeeks: 0,
      countPrompt: false,
    })
    expect(body.settings).toMatchObject({ equipment: [], level: 'new', savedAt: null })
  })

  test('names the setup, the starting points, the block, the next sessions and the lifts', async () => {
    const user = await newUser()
    const { today } = days()
    await seedProfile(user)
    await setup(user, { equipment: [BARBELL], level: 'some' })
    await client(ctx, user)
      .put('/api/strength/lifts/back-squat')
      .send({ kind: 'max', loadG: 100_000 })
    const { rows } = await seedPlan(user, [
      { date: addDays(today, -1), status: 'completed' },
      { date: addDays(today, 1) },
      { date: addDays(today, 3) },
      { date: addDays(today, 5) },
      { date: addDays(today, 7) },
    ])
    await seedLog(user, {
      id: uuid(250),
      date: addDays(today, -8),
      sets: squat([6, 6, 5, 5]),
      implement: { 'back-squat': 'barbell' },
    })
    await seedLog(user, {
      id: uuid(251),
      date: addDays(today, -1),
      sets: squat([6, 6, 6, 6]),
      implement: { 'back-squat': 'barbell' },
    })

    const body = await view(user)
    expect(body.setupSaved).toBe(true)
    expect(body.settings).toMatchObject({ equipment: [BARBELL], level: 'some' })
    expect(body.anchors).toEqual([
      { exerciseId: 'back-squat', kind: 'max', loadG: 100_000, reps: 1, rir: null, asOf: today },
    ])
    expect(body.block).toEqual({ week: 7, of: 12, rampInWeeks: 3, template: 'heavy' })
    // Today's, then the ones after it that are still to do, at most three, never the settled one.
    expect(body.next.map((w) => w.sessionId)).toEqual([rows[1]!.id, rows[2]!.id, rows[3]!.id])
    expect(body.recent.map((log) => log.id)).toEqual([uuid(251), uuid(250)])
    expect(body.recent[0]).toMatchObject({ date: addDays(today, -1), durationMin: 40 })
    expect(body.recent[0]!.sets).toHaveLength(4)
    expect(body.lifts).toEqual([
      {
        exerciseId: 'back-squat',
        lastDate: addDays(today, -1),
        gapDays: 1,
        workingLoadG: LB(110),
        estimateG: expect.any(Number) as number,
        lastChange: null,
        sessionCount: 2,
      },
    ])
    expect(body.facts.map((fact) => fact.template)).toEqual([
      'strength.benefit',
      'strength.separation',
    ])
    const [lo, hi] = P.f7.expectedBenefitPct.value
    expect(renderFact(body.facts[0]!, 'km')).toBe(
      `Strength work may lower the oxygen cost of running by about ${String(lo)} to ${String(hi)}% after a full block. That is small, and it says nothing about race time.`,
    )
    expect(renderFact(body.facts[1]!, 'mi')).toBe(
      `Lift at least ${String(P.f4.strengthSeparationHours.value)} hours before or after a run.`,
    )
  })

  test('lists the weeks of the last twelve with the sessions planned and logged, the sets and the lifts that moved', async () => {
    const user = await newUser()
    const { thisMonday } = days()
    await seedProfile(user)
    await setup(user, { equipment: [BARBELL], level: 'some' })
    // Two a week for the last four weeks, none logged in the last three: a run of low weeks.
    const sessions = [-4, -3, -2, -1].flatMap((w) => [
      { date: addDays(thisMonday, 7 * w + 1) },
      { date: addDays(thisMonday, 7 * w + 4) },
    ])
    await seedPlan(user, sessions)
    await seedLog(user, {
      id: uuid(260),
      date: addDays(thisMonday, -28 + 1),
      sets: squat([6, 6, 6, 6]),
      implement: { 'back-squat': 'barbell' },
    })
    await seedLog(user, {
      id: uuid(261),
      date: addDays(thisMonday, -28 + 4),
      sets: squat([6, 6, 6, 6]).map(([id, , count, rir]): SeedSet => [id, LB(115), count, rir]),
      implement: { 'back-squat': 'barbell' },
    })
    // A log from 14 weeks back is in the state, where the move of the load starts from, but it is
    // not in the twelve weeks of the view.
    await seedLog(user, {
      id: uuid(262),
      date: addDays(thisMonday, -7 * 14),
      sets: squat(),
      implement: { 'back-squat': 'barbell' },
    })

    const body = await view(user)
    // The weeks that hold a planned or a logged session, from 11 weeks back to this one.
    expect(body.weeks.map((w) => w.weekStart)).toEqual(
      [-4, -3, -2, -1].map((w) => addDays(thisMonday, 7 * w)),
    )
    expect(body.weeks[0]).toMatchObject({
      weekStart: addDays(thisMonday, -28),
      planned: 2,
      logged: 2,
      sets: 8,
      moved: [{ exerciseId: 'back-squat', fromG: LB(110), toG: LB(115) }],
    })
    expect(body.weeks[1]).toMatchObject({ planned: 2, logged: 0, sets: 0, moved: [] })
    expect(body.lowCountWeeks).toBe(3)
    expect(body.countPrompt).toBe(true)
  })

  test('lists the last 30 sessions of the state, newest first', async () => {
    const user = await newUser()
    const { today } = days()
    const stamps = Array.from({ length: 32 }, (_, i) => i)
    for (const i of stamps) {
      await seedLog(user, {
        id: uuid(300 + i),
        date: addDays(today, -i * 5),
        sets: [['standing-calf-raise', null, 10, null]],
      })
    }
    const body = await view(user)
    // 32 logs, one every five days, all inside the 26 weeks the state reads: the newest 30 are listed.
    expect(body.recent).toHaveLength(30)
    expect(body.recent.map((log) => log.date)).toEqual(
      stamps.slice(0, 30).map((i) => addDays(today, -i * 5)),
    )
  })

  test('never shows another runner’s logs', async () => {
    const mine = await newUser()
    const theirs = await newUser()
    await seedLog(theirs, { id: uuid(340), date: todayIso(), sets: squat() })
    const body = await view(mine)
    expect(body.recent).toEqual([])
    expect(body.lifts).toEqual([])
  })

  test('refuses a query parameter', async () => {
    const user = await newUser()
    expect((await client(ctx, user).get('/api/strength?week=1')).status).toBe(400)
  })
})

describe('GET /api/strength/exercises/:exerciseId', () => {
  const history = async (user: TestUser, id: string) => {
    const res = await client(ctx, user).get(`/api/strength/exercises/${id}`)
    expect(res.status, JSON.stringify(res.body)).toBe(200)
    return res.body as StrengthExerciseView
  }

  test('lists every session of the exercise, newest first, with its sets and estimated maximum', async () => {
    const user = await newUser()
    const { today } = days()
    await client(ctx, user)
      .put('/api/strength/lifts/back-squat')
      .send({ kind: 'max', loadG: 100_000 })
    await seedLog(user, {
      id: uuid(350),
      date: addDays(today, -10),
      sets: squat([6, 5, 5]),
      implement: { 'back-squat': 'barbell' },
    })
    await seedLog(user, {
      id: uuid(351),
      date: addDays(today, -3),
      sets: [...squat([6, 6, 6, 6]), ['standing-calf-raise', null, 12, null]],
      implement: { 'back-squat': 'barbell' },
    })
    const body = await history(user, 'back-squat')
    expect(body.exerciseId).toBe('back-squat')
    expect(body.anchor).toMatchObject({ kind: 'max', loadG: 100_000 })
    expect(body.summary).toMatchObject({ lastDate: addDays(today, -3), sessionCount: 2 })
    expect(body.sessions.map((s) => [s.logId, s.date, s.mode])).toEqual([
      [uuid(351), addDays(today, -3), 'normal'],
      [uuid(350), addDays(today, -10), 'normal'],
    ])
    // Only the exercise's own sets, in order, with the load as grams.
    expect(body.sessions[0]!.sets).toEqual(
      [0, 1, 2, 3].map((position) => ({
        position,
        loadG: LB(110),
        count: 6,
        rir: 2,
      })),
    )
    expect(body.sessions[0]).toMatchObject({
      heaviest: { loadG: LB(110), count: 6 },
      workingLoadG: LB(110),
    })
    expect(body.sessions[0]!.estimateG).toBeGreaterThan(LB(110))
  })

  test('is empty for an exercise with no sets, with the starting point if there is one', async () => {
    const user = await newUser()
    await client(ctx, user)
      .put('/api/strength/lifts/goblet-squat')
      .send({ kind: 'set', loadG: 20_000, reps: 8, rir: 2 })
    const body = await history(user, 'goblet-squat')
    expect(body).toMatchObject({ summary: null, sessions: [] })
    expect(body.anchor).toMatchObject({ exerciseId: 'goblet-squat', loadG: 20_000 })
    expect(await history(user, 'back-squat')).toMatchObject({ anchor: null, sessions: [] })
  })

  test('lists at most 60 sessions', async () => {
    const user = await newUser()
    const { today } = days()
    const logs = Array.from({ length: 62 }, (_, i) => i)
    const activities = logs.map((i) => ({
      id: `act-limit-${String(user.id)}-${String(i)}`,
      userId: user.id,
      date: addDays(today, -i * 2),
      type: 'strength',
      durationSec: 1800,
      source: 'manual',
    }))
    await ctx.prisma.activity.createMany({ data: activities })
    await ctx.prisma.strengthLog.createMany({
      data: logs.map((i) => ({
        id: uuid(400 + i),
        userId: user.id,
        activityId: activities[i]!.id,
        prescribed: JSON.stringify(snapshot({ lifts: [] })),
      })),
    })
    await ctx.prisma.strengthSet.createMany({
      data: logs.map((i) => ({
        logId: uuid(400 + i),
        userId: user.id,
        exerciseId: 'standing-calf-raise',
        position: 0,
        loadG: null,
        count: 10,
        rir: null,
      })),
    })
    const body = await history(user, 'standing-calf-raise')
    expect(body.summary?.sessionCount).toBe(62)
    expect(body.sessions).toHaveLength(60)
    expect(body.sessions[0]!.date).toBe(today)
  })

  test('refuses an exercise outside the catalogue and a query parameter', async () => {
    const user = await newUser()
    expect((await client(ctx, user).get('/api/strength/exercises/bench-press')).status).toBe(400)
    expect((await client(ctx, user).get('/api/strength/exercises/back-squat?limit=3')).status).toBe(
      400,
    )
  })
})

describe('the reads need a session', () => {
  test.each([
    '/api/strength',
    '/api/strength/workouts?from=2026-01-01&to=2026-01-02',
    '/api/strength/workout?date=2026-01-01',
    '/api/strength/exercises/back-squat',
  ])('get %s', async (url) => {
    expect((await client(ctx).get(url)).status).toBe(401)
  })
})

// ---------------------------------------------------------------------------------------------
// The Today slot
// ---------------------------------------------------------------------------------------------

/** A runner with a barbell, dumbbells and a step, in week 7 of a strength block of 12. */
async function liftingUser(sessions: SeedSession[]) {
  const user = await newUser()
  await seedProfile(user)
  await setup(user, { equipment: [BARBELL, DUMBBELLS, { kind: 'step' }], level: 'some' })
  const { rows } = await seedPlan(user, sessions)
  return { user, rows }
}

const todayView = async (user: TestUser, query = '') => {
  const res = await client(ctx, user).get(`/api/today${query}`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body as TodayView
}

const painDay = () => ({ painScore: P.pain.flagScore.value + 1 })

describe('GET /api/today: coach.slots.strength', () => {
  test('a day whose only session is strength: the hero is the session and the slot its workout', async () => {
    const { today } = days()
    const { user, rows } = await liftingUser([{ date: today }])
    const body = await todayView(user)
    const slot = body.coach.slots.strength
    expect(body.coach.hero?.session).toMatchObject({ id: rows[0]!.id, kind: 'strength' })
    expect(slot).toMatchObject({
      sessionId: rows[0]!.id,
      date: today,
      template: 'heavy',
      block: { week: 7, of: 12, rampInWeeks: 3 },
      budgetMin: 40,
      setupSaved: true,
      rules: STRENGTH_RULES,
    })
    expect(slot!.lifts.length).toBeGreaterThan(0)
    expect(slot!.lifts.every((lift) => lift.change !== 'lighter-day')).toBe(true)
    // The workout of the Plan page and the sheet is this one: one function, one object.
    const res = await client(ctx, user).get(`/api/strength/workouts?from=${today}&to=${today}`)
    expect(res.body).toEqual([slot])
  })

  test('a run day with a double: the hero is the run, and the slot carries the workout of the lift', async () => {
    const { today } = days()
    const { user, rows } = await liftingUser([
      { date: today, kind: 'easy', min: 40 },
      { date: today },
    ])
    const body = await todayView(user)
    expect(body.coach.hero?.session).toMatchObject({ id: rows[0]!.id, kind: 'easy' })
    expect(body.coach.hero?.others.map((s) => s.id)).toEqual([rows[1]!.id])
    expect(body.coach.slots.strength).toMatchObject({ sessionId: rows[1]!.id, date: today })
  })

  test('a preview day shows the workout read-only, as of today, and no day without a lift has one', async () => {
    const { today } = days()
    const tomorrow = addDays(today, 1)
    const { user, rows } = await liftingUser([{ date: tomorrow }])
    // today's readiness is low; tomorrow has no read, so no lighter day
    await client(ctx, user).put(`/api/checkins/${today}`).send(painDay())

    const preview = await todayView(user, `?date=${tomorrow}`)
    expect(preview.coach.preview).toBe(true)
    expect(preview.coach.slots.strength).toMatchObject({ sessionId: rows[0]!.id, date: tomorrow })
    expect(preview.coach.slots.strength!.lifts.every((lift) => lift.change !== 'lighter-day')).toBe(
      true,
    )
    const res = await client(ctx, user).get(
      `/api/strength/workouts?from=${tomorrow}&to=${tomorrow}`,
    )
    expect(res.body).toEqual([preview.coach.slots.strength])

    expect((await todayView(user)).coach.slots.strength).toBeNull()
    expect((await todayView(user, `?date=${addDays(today, 2)}`)).coach.slots.strength).toBeNull()
  })

  test('a day whose run is eased gets the lighter lifts: one set fewer, the usual load kept', async () => {
    const { today } = days()
    const sessions: SeedSession[] = [{ date: today, kind: 'threshold', min: 50 }, { date: today }]
    const usual = await liftingUser(sessions)
    const eased = await liftingUser(sessions)
    await client(ctx, eased.user).put(`/api/checkins/${today}`).send(painDay())

    const base = (await todayView(usual.user)).coach.slots.strength!
    const body = await todayView(eased.user)
    expect(body.coach.hero).toMatchObject({ advice: 'downgrade-easy' })
    const lighter = body.coach.slots.strength!

    expect(base.lifts.every((lift) => lift.change !== 'lighter-day')).toBe(true)
    expect(lighter.lifts.map((l) => l.exerciseId)).toEqual(base.lifts.map((l) => l.exerciseId))
    expect(lighter.lifts.some((lift) => lift.change === 'lighter-day')).toBe(true)
    lighter.lifts.forEach((lift, i) => {
      const usualLift = base.lifts[i]!
      // one set fewer, and never fewer than the two that stay
      expect(lift.sets).toBe(
        Math.max(usualLift.sets - P.f9.lowReadinessSetsCut.value, Math.min(usualLift.sets, 2)),
      )
      if (lift.change === 'lighter-day') {
        expect(lift.basis.rule).toBe('F9')
        expect(lift.loadG === null ? 0 : lift.loadG).toBeLessThanOrEqual(usualLift.loadG ?? 0)
      }
      // readiness never adds load
      expect(lift.loadG ?? 0).toBeLessThanOrEqual(usualLift.loadG ?? 0)
    })
    // the load the rules asked for stays on the lift, for the tap that restores it
    const cut = lighter.lifts.find((lift) => lift.usualLoadG !== null)
    if (cut !== undefined) {
      const same = base.lifts.find((lift) => lift.exerciseId === cut.exerciseId)
      expect(cut.usualLoadG).toBe(same!.loadG)
    }
  })

  test('the illness rest phase withdraws the session, as it does a run', async () => {
    const { today } = days()
    const { user } = await liftingUser([{ date: today }])
    expect((await todayView(user)).coach.slots.strength).not.toBeNull()
    await client(ctx, user).put(`/api/checkins/${today}`).send({ illness: true })
    const body = await todayView(user)
    expect(body.coach.hero?.advice).toBe('rest')
    expect(body.coach.slots.strength).toBeNull()
  })

  test('is null for a runner with no plan', async () => {
    const user = await newUser()
    expect((await todayView(user)).coach.slots.strength).toBeNull()
  })

  test('a strength session already logged still has its workout, as the rules gave it', async () => {
    const { today } = days()
    const { user, rows } = await liftingUser([{ date: today }])
    const before = (await todayView(user)).coach.slots.strength!
    const saved = await putLog(user, uuid(500), logBody({ sessionId: rows[0]!.id }))
    expect(saved.status, JSON.stringify(saved.body)).toBe(201)
    // The log of the day is not history for the day itself, so the workout reads the same.
    const after = await todayView(user)
    expect(after.coach.hero?.session.status).not.toBe('planned')
    expect(after.coach.slots.strength).toEqual(before)
  })
})

describe('GET /api/today: the tag follows the strength state', () => {
  const tagOf = (res: { headers: Record<string, unknown> }) => String(res.headers.etag)
  const get = (user: TestUser, tag?: string) => {
    const req = client(ctx, user).get('/api/today')
    return tag === undefined ? req : req.set('If-None-Match', tag)
  }

  test('changes with a log, a change of equipment and of the unit, and with nothing else', async () => {
    const { today } = days()
    const { user } = await liftingUser([{ date: today }])
    let tag = tagOf(await get(user))
    expect((await get(user, tag)).status).toBe(304)

    // Reads of the strength API change nothing.
    expect((await client(ctx, user).get('/api/strength')).status).toBe(200)
    expect(
      (await client(ctx, user).get(`/api/strength/workouts?from=${today}&to=${today}`)).status,
    ).toBe(200)
    expect((await get(user, tag)).status).toBe(304)

    const writes: Array<[string, () => Promise<unknown>]> = [
      ['a log', () => putLog(user, uuid(510), logBody())],
      ['the same log with other sets', () => putLog(user, uuid(510), logBody({ sets: [SETS[0]] }))],
      ['the equipment', () => setup(user, { equipment: [DUMBBELLS] })],
      [
        'a starting point',
        () =>
          client(ctx, user)
            .put('/api/strength/lifts/back-squat')
            .send({ kind: 'max', loadG: 90_000 }),
      ],
      ['the weight unit', () => client(ctx, user).put('/api/settings').send({ weightUnit: 'kg' })],
      ['a deleted log', () => client(ctx, user).delete(`/api/strength/logs/${uuid(510)}`)],
    ]
    for (const [name, write] of writes) {
      const res = (await write()) as { status: number }
      expect(res.status, name).toBeLessThan(300)
      const changed = await get(user, tag)
      expect(changed.status, `${name} changes the tag`).toBe(200)
      expect(tagOf(changed), name).not.toBe(tag)
      tag = tagOf(changed)
      // and the new tag holds until the next write
      expect((await get(user, tag)).status, name).toBe(304)
    }
  })

  test('is the same for a refused save', async () => {
    const { user } = await liftingUser([{ date: days().today }])
    const tag = tagOf(await get(user))
    expect((await putLog(user, uuid(511), logBody({ durationMin: 0 }))).status).toBe(400)
    expect((await get(user, tag)).status).toBe(304)
  })
})

// ---------------------------------------------------------------------------------------------
// The suggestions after a save
// ---------------------------------------------------------------------------------------------

describe('PUT /api/strength/logs/:logId: next', () => {
  /** A runner with a barbell and two lifts planned next week, and the workout the first shows. */
  async function readyToLift() {
    const { nextMonday, thisMonday } = days()
    const user = await newUser()
    await seedProfile(user)
    await setup(user, { equipment: [BARBELL, DUMBBELLS, { kind: 'step' }], level: 'some' })
    const { rows } = await seedPlan(user, [
      { date: addDays(nextMonday, 1) },
      { date: addDays(nextMonday, 3) },
    ])
    const workouts = async () =>
      (
        await client(ctx, user).get(
          `/api/strength/workouts?from=${thisMonday}&to=${addDays(nextMonday, 7)}`,
        )
      ).body as StrengthWorkout[]
    return { user, rows, workouts }
  }

  const squatLift = (workout: StrengthWorkout) =>
    workout.lifts.find((lift) => lift.exerciseId === 'back-squat')!

  type SetBody = Array<{
    exerciseId: string
    loadG: number | null
    count: number
    rir: number | null
  }>
  const save = (user: TestUser, id: number, sets: SetBody, over: Record<string, unknown> = {}) =>
    putLog(user, uuid(id), logBody({ prescribed: snapshot({ lifts: [] }), sets, ...over }))

  test('a session at the top of the range with reps left raises the load, as the next workout will show', async () => {
    const { user, workouts } = await readyToLift()
    const lead = squatLift((await workouts())[0]!)
    const sets = Array.from({ length: lead.sets }, () => ({
      exerciseId: 'back-squat',
      loadG: lead.loadG,
      count: lead.range.max,
      rir: 2,
    }))
    const res = await save(user, 600, sets)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const entry = resultOf(res).next.find((next) => next.exerciseId === 'back-squat')!
    expect(entry.change).toBe('increase')
    expect(entry.loadG).toBeGreaterThan(lead.loadG!)

    // The suggestion is the load the next planned session asks for now.
    const next = squatLift((await workouts())[0]!)
    expect(next).toMatchObject({ change: 'increase', loadG: entry.loadG })
  })

  test('a set short of the range lowers the load', async () => {
    const { user, workouts } = await readyToLift()
    // 60 kg is well above the empty bar, so there is a step to come down to.
    const loadG = 60_000
    const [lo, hi] = P.flib.heavyReps.range!
    const counts = [hi, hi, lo - 1]
    const res = await save(
      user,
      601,
      counts.map((count) => ({ exerciseId: 'back-squat', loadG, count, rir: 1 })),
    )
    const entry = resultOf(res).next.find((next) => next.exerciseId === 'back-squat')!
    expect(entry.change).toBe('reduce')
    expect(entry.loadG).toBeLessThan(loadG)
    expect(squatLift((await workouts())[0]!)).toMatchObject({
      change: 'reduce',
      loadG: entry.loadG,
    })
  })

  test('names each exercise of the log once, in the order of its sets, and leaves out the jumps', async () => {
    const { user } = await readyToLift()
    const res = await save(user, 602, [
      { exerciseId: 'standing-calf-raise', loadG: null, count: 12, rir: 3 },
      { exerciseId: 'back-squat', loadG: 40_000, count: 5, rir: 2 },
      { exerciseId: 'pogo-hop', loadG: null, count: 40, rir: null },
      { exerciseId: 'standing-calf-raise', loadG: null, count: 12, rir: 3 },
      { exerciseId: 'back-squat', loadG: 40_000, count: 5, rir: 2 },
    ])
    expect(resultOf(res).next.map((next) => next.exerciseId)).toEqual([
      'standing-calf-raise',
      'back-squat',
    ])
  })

  test('without a planned session ahead, reads the maintenance of the day after', async () => {
    const user = await newUser()
    await setup(user, { equipment: [BARBELL], level: 'some' })
    const res = await save(user, 603, [
      { exerciseId: 'back-squat', loadG: 40_000, count: 5, rir: 2 },
    ])
    const [entry] = resultOf(res).next
    expect(entry).toMatchObject({ exerciseId: 'back-squat' })
    expect(entry!.loadG).not.toBeNull()
  })

  test('a session logged for an earlier day suggests for the next session still to do', async () => {
    const { user, workouts } = await readyToLift()
    const lead = squatLift((await workouts())[0]!)
    const res = await save(
      user,
      604,
      Array.from({ length: lead.sets }, () => ({
        exerciseId: 'back-squat',
        loadG: lead.loadG,
        count: lead.range.max,
        rir: 3,
      })),
      { date: addDays(todayIso(), -20) },
    )
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const entry = resultOf(res).next.find((next) => next.exerciseId === 'back-squat')!
    expect(entry.loadG).toBe(squatLift((await workouts())[0]!).loadG)
  })

  test('a save without sets has none, and a replay gives the same as the first', async () => {
    const { user, workouts } = await readyToLift()
    expect(resultOf(await save(user, 605, [])).next).toEqual([])
    const lead = squatLift((await workouts())[0]!)
    const sets = [{ exerciseId: 'back-squat', loadG: lead.loadG, count: lead.range.min, rir: 2 }]
    const first = await save(user, 606, sets)
    const replay = await save(user, 606, sets)
    expect(first.status).toBe(201)
    expect(replay.status).toBe(200)
    expect(resultOf(replay).next).toEqual(resultOf(first).next)
    expect(resultOf(first).next.length).toBeGreaterThan(0)
  })

  test('is empty, and the save stands, when the suggestions cannot be worked out', async () => {
    const { user } = await readyToLift()
    const broken = vi
      .spyOn(ctx.prisma.strengthLift, 'findMany')
      .mockRejectedValueOnce(new Error('the lifts could not be read'))
    const res = await save(user, 607, SETS)
    broken.mockRestore()
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(resultOf(res).next).toEqual([])
    expect(await ctx.prisma.strengthLog.count({ where: { id: uuid(607) } })).toBe(1)
    // The next save has them again.
    expect(resultOf(await save(user, 607, SETS)).next.length).toBeGreaterThan(0)
  })
})

describe('PUT /api/strength/logs/:logId: next, a harder movement', () => {
  const DUMBBELL_LIST = {
    kind: 'dumbbells',
    // 50 lb to 60 lb is a fifth of the load in a list that also has 5 lb gaps: no usable step
    loads: { loadsG: [30, 35, 50, 60].map(LB) },
  }

  test('names the harder movement and the variation when the load has stalled at the ceiling', async () => {
    const { nextMonday } = days()
    const user = await newUser()
    await seedProfile(user)
    await setup(user, { equipment: [DUMBBELL_LIST, { kind: 'step' }], level: 'some' })
    // two lifts next week, so the first is session A, which leads with the knee lift
    await seedPlan(user, [{ date: addDays(nextMonday, 1) }, { date: addDays(nextMonday, 3) }])
    // two sessions at the top of the range with a rep left, 50 lb, on the dumbbells
    for (const [i, back] of [15, 8].entries()) {
      await seedLog(user, {
        id: uuid(700 + i),
        date: addDays(todayIso(), -back),
        sets: [0, 1, 2].map(() => ['goblet-squat', LB(50), 6, 1] as const),
        implement: { 'goblet-squat': 'dumbbells' },
      })
    }
    // the third, saved now: the load has no usable step for three sessions in a row
    const res = await putLog(
      user,
      uuid(702),
      logBody({
        prescribed: snapshot({ lifts: [] }),
        sets: [0, 1, 2].map(() => ({
          exerciseId: 'goblet-squat',
          loadG: LB(50),
          count: 6,
          rir: 1,
        })),
      }),
    )
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const { next } = resultOf(res)
    expect(next).toHaveLength(1)
    // the lift the rules move on to, not the one that was logged
    expect(next[0]).toMatchObject({ exerciseId: 'split-squat', change: 'variation' })
    expect(next[0]!.loadG).not.toBeNull()

    // and the next planned session shows the same movement
    const tuesday = addDays(nextMonday, 1)
    const workouts = await client(ctx, user).get(
      `/api/strength/workouts?from=${tuesday}&to=${tuesday}`,
    )
    const lift = (workouts.body as StrengthWorkout[])[0]!.lifts.find(
      (l) => l.exerciseId === 'split-squat',
    )
    expect(lift).toMatchObject({ change: 'variation', loadG: next[0]!.loadG })
  })

  test('a lift with a usable step moves up and keeps its own name', async () => {
    const { nextMonday } = days()
    const user = await newUser()
    await seedProfile(user)
    await setup(user, {
      equipment: [
        { kind: 'dumbbells', loads: { loadsG: [30, 35, 40, 45, 50, 55, 60].map(LB) } },
        { kind: 'step' },
      ],
      level: 'some',
    })
    await seedPlan(user, [{ date: addDays(nextMonday, 1) }, { date: addDays(nextMonday, 3) }])
    const res = await putLog(
      user,
      uuid(703),
      logBody({
        prescribed: snapshot({ lifts: [] }),
        sets: [0, 1, 2].map(() => ({
          exerciseId: 'goblet-squat',
          loadG: LB(50),
          count: 6,
          rir: 1,
        })),
      }),
    )
    expect(resultOf(res).next).toEqual([
      { exerciseId: 'goblet-squat', change: 'increase', loadG: LB(55) },
    ])
  })
})
