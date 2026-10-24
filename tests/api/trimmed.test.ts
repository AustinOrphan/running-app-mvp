import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import * as domain from '../../shared/domain/sessionStatus.ts'
import type { SessionSpec } from '../../shared/engine/types.ts'
import type { PlanWithSessions } from '../../shared/types.ts'
import { runExecutionForActivity } from '../../server/services/execution.ts'
import { sessionRow } from '../../server/services/planEngine.ts'
import { isTrimmed } from '../../server/serialize.ts'
import { client, createTestCtx, seedUser, type TestCtx } from './helpers.ts'

// Session identity and the trim flag. `externalId` is the identity of a session outside the
// database (spec 4.1); `trimmed` is the indexed form of "rules holds design-4.3" (spec 5.3).
// A Wednesday. Only Date is faked; timers and promises keep working.
vi.useFakeTimers({ toFake: ['Date'] })
vi.setSystemTime(new Date(2026, 9, 21, 12))

const today = todayIso()
const thisMonday = mondayOf(today)
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})

afterAll(async () => {
  await ctx.close()
})

afterEach(() => {
  vi.setSystemTime(new Date(2026, 9, 21, 12))
})

const TARGET = JSON.stringify({
  zone: 'z1',
  rpe: [2, 3],
  hr: null,
  paceSecPerKm: null,
  heatNote: null,
})
const WORK = JSON.stringify([
  { kind: 'warmup', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
  { kind: 'work', reps: 4, durationSec: 300, distanceM: null, zone: 'z3' },
  { kind: 'recover', reps: 4, durationSec: 120, distanceM: null, zone: 'z1' },
  { kind: 'cooldown', reps: 1, durationSec: 600, distanceM: null, zone: 'z1' },
])

const spec = (over: Partial<SessionSpec> = {}): SessionSpec => ({
  date: addDays(thisMonday, 2),
  order: 0,
  kind: 'threshold',
  title: 'Threshold intervals',
  durationMin: 50,
  distanceM: null,
  gainM: null,
  structure: [],
  target: JSON.parse(TARGET) as SessionSpec['target'],
  purpose: 'Synthetic.',
  rules: ['f-1'],
  flags: [],
  ...over,
})

describe('isTrimmed', () => {
  test('is true exactly when the rule id design-4.3 is in the list', () => {
    expect(isTrimmed(['design-4.3'])).toBe(true)
    expect(isTrimmed(['C8', 'design-4.3'])).toBe(true)
    expect(isTrimmed(['n-4', 'J5', 'design-4.3', 'F1'])).toBe(true)
    expect(isTrimmed([])).toBe(false)
    expect(isTrimmed(['design-4.1', 'design-4.2'])).toBe(false)
    expect(isTrimmed(['design-4.30'])).toBe(false)
    expect(isTrimmed(['xdesign-4.3'])).toBe(false)
  })
})

describe('the one derivation of a trim', () => {
  test('the server and the engine ask the same function', () => {
    expect(isTrimmed).toBe(domain.isTrimmed)
  })

  test('no other file names the trim rule id', () => {
    // The rule id is written once, in `domain/sessionStatus.ts`. The parameters cite it as a rule
    // and the Why drawer lists it as a rule with no figure of its own; neither detects a trim.
    const allowed = new Set(['shared/domain/sessionStatus.ts', 'shared/engine/explainInputs.ts'])
    const files = ['server', 'shared']
      .flatMap((dir) =>
        readdirSync(join(process.cwd(), dir), { recursive: true, encoding: 'utf8' }).map((path) =>
          join(dir, path),
        ),
      )
      .filter(
        (path) => path.endsWith('.ts') && !path.startsWith(join('shared', 'engine', 'params')),
      )
    expect(files.length).toBeGreaterThan(50)
    const offenders = files.filter(
      (file) =>
        !allowed.has(file) &&
        /['"`]design-4\.3['"`]/.test(readFileSync(join(process.cwd(), file), 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})

describe('sessionRow', () => {
  test('gives each new row a fresh uuid unless one is carried', () => {
    const a = sessionRow('p1', spec())
    const b = sessionRow('p1', spec())
    expect(a.externalId).toMatch(UUID_V4)
    expect(b.externalId).toMatch(UUID_V4)
    expect(a.externalId).not.toBe(b.externalId)
    const carried = randomUUID()
    expect(sessionRow('p1', spec(), carried).externalId).toBe(carried)
  })

  test('derives trimmed and the downgraded status from the rules through isTrimmed', () => {
    expect(sessionRow('p1', spec({ rules: ['f-1'] }))).toMatchObject({
      trimmed: false,
      status: 'planned',
    })
    expect(sessionRow('p1', spec({ rules: ['C8', 'design-4.3'] }))).toMatchObject({
      trimmed: true,
      status: 'downgraded',
    })
    expect(sessionRow('p1', spec({ rules: ['design-4.30'] }))).toMatchObject({
      trimmed: false,
      status: 'planned',
    })
  })
})

/** A version-2 plan with hand-made sessions; `rules` marks the ones the engine or a trim eased. */
async function planWith(
  email: string,
  sessions: Array<{
    date: string
    kind: string
    min: number
    rules?: string[]
    /** Overrides the flag that `isTrimmed(rules)` would give. */
    trimmed?: boolean
    status?: string
    structure?: string
  }>,
) {
  const u = await seedUser(ctx, { email })
  const goal = await ctx.prisma.goal.create({
    data: {
      userId: u.id,
      name: 'Synthetic half',
      priority: 'A',
      targetDate: addDays(thisMonday, 7 * 12 + 5),
      distanceM: 21_097,
    },
  })
  const plan = await ctx.prisma.plan.create({
    data: {
      userId: u.id,
      goalId: goal.id,
      name: goal.name,
      startDate: thisMonday,
      raceWeekStart: mondayOf(goal.targetDate),
      generatorVersion: 2,
      weeks: {
        create: [
          {
            weekStart: thisMonday,
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
  const rows = []
  for (const [i, s] of sessions.entries()) {
    const rules = s.rules ?? []
    rows.push(
      await ctx.prisma.planSession.create({
        data: {
          planId: plan.id,
          externalId: randomUUID(),
          weekStart: mondayOf(s.date),
          date: s.date,
          order: i,
          kind: s.kind,
          title: `${s.kind} run`,
          durationMin: s.min,
          structure: s.structure ?? '[]',
          target: TARGET,
          purpose: 'Synthetic.',
          rules: JSON.stringify(rules),
          trimmed: s.trimmed ?? isTrimmed(rules),
          status: s.status ?? 'planned',
        },
      }),
    )
  }
  return { u, plan, rows }
}

const row = (id: string) => ctx.prisma.planSession.findUniqueOrThrow({ where: { id } })

describe('a generated plan', () => {
  test('stores a distinct uuid for every session and serves it as externalId', async () => {
    const u = await seedUser(ctx, { email: 'generate@example.com' })
    // Twelve weeks of four runs, so the engine has a history to build on.
    const runs = []
    for (let w = 1; w <= 12; w += 1) {
      for (const [dow, min] of [
        [1, 40],
        [3, 45],
        [5, 35],
        [6, 70],
      ] as const) {
        runs.push({
          userId: u.id,
          date: addDays(thisMonday, -7 * w + dow),
          type: 'run',
          durationSec: min * 60,
          movingSec: min * 60,
          distanceM: min * 160,
          rpe: 3,
          source: 'manual',
        })
      }
    }
    await ctx.prisma.activity.createMany({ data: runs })
    const goal = await ctx.prisma.goal.create({
      data: {
        userId: u.id,
        name: 'Synthetic half',
        priority: 'A',
        targetDate: addDays(thisMonday, 7 * 14 + 5),
        distanceM: 21_097,
        goalType: 'finish',
      },
    })
    const res = await client(ctx, u).post('/api/plan/generate').send({ goalId: goal.id })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    const plan = res.body as PlanWithSessions

    const rows = await ctx.prisma.planSession.findMany({ where: { planId: plan.id } })
    expect(rows.length).toBeGreaterThan(20)
    expect(new Set(rows.map((r) => r.externalId)).size).toBe(rows.length)
    for (const r of rows) {
      expect(r.externalId).toMatch(UUID_V4)
      expect(r.trimmed).toBe(isTrimmed(JSON.parse(r.rules) as string[]))
    }
    const byId = new Map(rows.map((r) => [r.id, r.externalId]))
    for (const s of plan.sessions) expect(s.externalId).toBe(byId.get(s.id))

    const fetched = await client(ctx, u).get('/api/plan')
    expect(fetched.status).toBe(200)
    const served = (fetched.body as PlanWithSessions).sessions
    expect(served.map((s) => s.externalId).sort()).toEqual([...byId.values()].sort())
  })
})

describe('the execution trim', () => {
  const deps = () => ({ prisma: ctx.prisma, config: ctx.config })

  test('marks the trimmed session, and a second trim in the week is refused through the column', async () => {
    const { u, rows } = await planWith('trim-flag@example.com', [
      { date: addDays(today, -2), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, -1), kind: 'intervals', min: 50, structure: WORK },
      { date: addDays(today, 1), kind: 'hills', min: 50, structure: WORK },
    ])
    const hard = (date: string, min: number) =>
      ctx.prisma.activity.create({
        data: {
          userId: u.id,
          date,
          type: 'run',
          durationSec: min * 60,
          movingSec: min * 60,
          distanceM: 9000,
          rpe: 10,
          feel: 2,
          source: 'manual',
        },
      })
    const first = await hard(addDays(today, -2), 50)
    await runExecutionForActivity(deps(), { userId: u.id, activityId: first.id })
    expect(await row(rows[1]!.id)).toMatchObject({ status: 'downgraded', trimmed: true })
    expect(JSON.parse((await row(rows[1]!.id)).rules) as string[]).toContain('design-4.3')
    expect(await row(rows[0]!.id)).toMatchObject({ trimmed: false })
    expect(await row(rows[2]!.id)).toMatchObject({ status: 'planned', trimmed: false })

    // The trimmed session is run and scores +2 as well: it is completed and stays trimmed, so the
    // week's one trim is still spent and the next quality session is left as planned.
    const second = await hard(addDays(today, -1), 45)
    await runExecutionForActivity(deps(), { userId: u.id, activityId: second.id })
    expect(await row(rows[1]!.id)).toMatchObject({ status: 'completed', trimmed: true })
    expect(await row(rows[2]!.id)).toMatchObject({ status: 'planned', trimmed: false })
  })

  test('counts the trims of the week from the flag, not from a scan of the rules', async () => {
    // The week already holds one trim, recorded only in the flag: the rules are empty, so a scan of
    // the rules would find none and trim the hills session as well.
    const { u, rows } = await planWith('trim-count@example.com', [
      { date: addDays(today, -1), kind: 'threshold', min: 50, structure: WORK },
      { date: addDays(today, 1), kind: 'intervals', min: 35, status: 'downgraded', trimmed: true },
      { date: addDays(today, 2), kind: 'hills', min: 50, structure: WORK },
    ])
    expect(await row(rows[1]!.id)).toMatchObject({ rules: '[]', trimmed: true })
    const run = await ctx.prisma.activity.create({
      data: {
        userId: u.id,
        date: addDays(today, -1),
        type: 'run',
        durationSec: 3000,
        movingSec: 3000,
        distanceM: 9000,
        rpe: 10,
        feel: 2,
        source: 'manual',
      },
    })
    await runExecutionForActivity(deps(), { userId: u.id, activityId: run.id })
    expect(await row(rows[0]!.id)).toMatchObject({ status: 'completed' })
    expect(await row(rows[2]!.id)).toMatchObject({ status: 'planned', trimmed: false })
  })
})

describe('an owner swap', () => {
  test('moves trimmed with the rules, while each row keeps its own externalId', async () => {
    const nextMonday = addDays(thisMonday, 7)
    const { u, rows } = await planWith('swap-flag@example.com', [
      { date: addDays(nextMonday, 1), kind: 'easy', min: 40 },
      {
        date: addDays(nextMonday, 3),
        kind: 'threshold',
        min: 40,
        structure: WORK,
        rules: ['C8', 'design-4.3'],
        status: 'downgraded',
      },
      { date: addDays(nextMonday, 5), kind: 'long', min: 90 },
    ])
    const before = await Promise.all(rows.map((r) => row(r.id)))

    const res = await client(ctx, u)
      .put(`/api/plan/sessions/${rows[0]!.id}`)
      .send({ kind: 'threshold' })
    expect(res.status, JSON.stringify(res.body)).toBe(200)

    const [first, second] = await Promise.all([row(rows[0]!.id), row(rows[1]!.id)])
    expect(first).toMatchObject({ kind: 'threshold', trimmed: true })
    expect(JSON.parse(first.rules) as string[]).toContain('design-4.3')
    expect(second).toMatchObject({ kind: 'easy', trimmed: false })
    expect(first.externalId).toBe(before[0]!.externalId)
    expect(second.externalId).toBe(before[1]!.externalId)
    expect(first.externalId).not.toBe(second.externalId)
  })
})
