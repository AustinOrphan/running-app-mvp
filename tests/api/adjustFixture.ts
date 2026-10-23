// What the adjust tests (`adjust.test.ts`, `adjusted.test.ts`) stand on: a runner with a history, a
// half marathon 14 weeks out and the plan the engine builds for it, read through the API.
import { expect } from 'vitest'
import { addDays, mondayOf, todayIso } from '../../shared/dates.ts'
import type { PlanSession, PlanWithSessions } from '../../shared/types.ts'
import type { PlanSession as PlanSessionRow } from '../../server/db.ts'
import { client, seedUser, type TestCtx, type TestUser } from './helpers.ts'

export interface Fixture {
  u: TestUser
  plan: PlanWithSessions
}

/** The days the tests reason about. Read when called, because the tests fake the clock after import. */
export function days() {
  const today = todayIso()
  const thisMonday = mondayOf(today)
  return { today, thisMonday, nextMonday: addDays(thisMonday, 7) }
}

/** Twelve weeks of four runs, a half marathon 14 weeks out, and the plan the engine builds. */
export async function planFixture(ctx: TestCtx, email: string): Promise<Fixture> {
  const { thisMonday } = days()
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
  return { u, plan: res.body as PlanWithSessions }
}

export function rowsOf(ctx: TestCtx, planId: string): Promise<PlanSessionRow[]> {
  return ctx.prisma.planSession.findMany({
    where: { planId },
    orderBy: [{ date: 'asc' }, { order: 'asc' }, { id: 'asc' }],
  })
}

/** The rows without the time they were written: what an edit changes and an undo restores. */
export const content = (rows: PlanSessionRow[]) =>
  rows.map(({ updatedAt: _updatedAt, ...row }) => row)

export const errorOf = (res: { body: unknown }) =>
  (res.body as { error: { code: string; message: string; details?: Record<string, unknown> } })
    .error

/** The sessions of next week of one kind, in date order. */
export function nextWeek(f: Fixture, kind: PlanSession['kind']): PlanSession[] {
  const { nextMonday } = days()
  return f.plan.sessions.filter((s) => s.weekStart === nextMonday && s.kind === kind)
}

export function only(f: Fixture, kind: PlanSession['kind'], index = 0): PlanSession {
  const found = nextWeek(f, kind)[index]
  expect(found, `${kind} ${String(index)} of next week`).toBeDefined()
  return found!
}

export const adjustAt = (ctx: TestCtx, f: Fixture, id: string, body: object) =>
  client(ctx, f.u).post(`/api/plan/sessions/${id}/adjust`).send(body)

export const postTo = (ctx: TestCtx, f: Fixture, url: string, body: object = {}) =>
  client(ctx, f.u).post(url).send(body)
