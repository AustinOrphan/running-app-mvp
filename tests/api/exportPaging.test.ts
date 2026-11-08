import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { exportTables } from '../../server/services/exportArchive.ts'
import { createTestCtx, seedUser, type TestCtx } from './helpers.ts'

let ctx: TestCtx

beforeAll(async () => {
  ctx = await createTestCtx()
})
afterAll(async () => {
  await ctx.close()
})

// The export reads a table a page at a time. A cursor on the last row read would return an empty
// page, and end the table early, when that row is deleted before the next page (a re-plan, a
// sync prune, the runner deleting an activity). Paging by key must carry on.
describe('export paging survives a row deleted between two page reads', () => {
  test('activities (by date and id) and goals (by id) continue after a deleted boundary row', async () => {
    const runner = await seedUser(ctx, { email: 'paging@example.com' })
    const days = ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05']
    const activities = []
    for (const date of days) {
      activities.push(
        await ctx.prisma.activity.create({
          data: { userId: runner.id, date, type: 'run', durationSec: 60 },
        }),
      )
    }
    const goals = []
    for (let i = 0; i < 5; i++) {
      goals.push(
        await ctx.prisma.goal.create({
          data: { userId: runner.id, name: `G${i}`, priority: 'A', targetDate: '2026-09-12' },
        }),
      )
    }
    const tables = exportTables(ctx.prisma, runner.id)
    const table = (file: string) => {
      const found = tables.find((t) => t.file === file)
      if (!found) throw new Error(file)
      return found
    }

    const activitiesTable = table('activities.json')
    const first = await activitiesTable.find(2, undefined)
    expect(first.map((r) => r['date'])).toEqual([days[0], days[1]])
    await ctx.prisma.activity.delete({ where: { id: activities[1]!.id } })
    const second = await activitiesTable.find(2, first[1])
    expect(second.map((r) => r['date'])).toEqual([days[2], days[3]])

    const goalsTable = table('goals.json')
    const g1 = await goalsTable.find(2, undefined)
    await ctx.prisma.goal.delete({ where: { id: goals.map((g) => g.id).sort()[1]! } })
    const g2 = await goalsTable.find(2, g1[1])
    expect(g2.map((r) => r['name'])).toEqual(
      goals
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(2, 4)
        .map((g) => g.name),
    )
  })
})
