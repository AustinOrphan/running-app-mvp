// A plan built on a weekend: the part of the current week still ahead is not a ramp baseline [rules g-2].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import type { SessionSpec } from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'

const IDS = ['novice-5k', 'returning', 'sparse-100-mile', 'prior-bsi', 'half']

const minutesOf = (sessions: SessionSpec[], weekStart: string) =>
  sessions
    .filter((s) => mondayOf(s.date) === weekStart && s.kind !== 'race' && s.kind !== 'hike')
    .reduce((n, s) => n + s.durationMin, 0)

describe('buildPlan on a weekend', () => {
  for (const day of ['2026-10-24', '2026-10-25']) {
    it.each(IDS)(`%s planned on ${day} passes the checklist`, (id) => {
      const a = athletes().find((x) => x.id === id)!
      const plan = buildPlan({ ...a.input, today: day })
      const failed = plan.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`)
      expect(failed).toEqual([])
    })

    // The sparse athlete ran nothing in the two weeks before, so its weeks stay held to that
    // history; every other athlete keeps the weeks after the part week at their targets.
    it.each(IDS.filter((id) => id !== 'sparse-100-mile'))(
      `%s planned on ${day} keeps the weeks after the part week at their targets`,
      (id) => {
        const a = athletes().find((x) => x.id === id)!
        const plan = buildPlan({ ...a.input, today: day })
        const ahead = plan.weeks.filter((w) => w.weekStart > mondayOf(day)).slice(0, 4)
        expect(ahead.length).toBe(4)
        for (const w of ahead) {
          expect(minutesOf(plan.sessions, w.weekStart)).toBeGreaterThanOrEqual(w.targetRunMin * 0.9)
        }
        expect(addDays(ahead[0]!.weekStart, 0)).toBe(addDays(mondayOf(day), 7))
      },
    )
  }
})
