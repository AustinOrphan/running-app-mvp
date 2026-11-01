// BY HAND: the grids of the third review of RF2 (2026-11-01), too heavy for `npm run check`, which
// runs a sample of each (`disruption-integration.test.ts`). Run them at each `PARAMS_VERSION` bump,
// beside `npm run plan:report`:
//
//   WINDOW_GRIDS_FULL=1 npx vitest run tests/unit/engine/window-grids
//
// Without the variable the file is skipped. Each test prints the counts of its grid.
//
// 1. The taper grid: 12 matrix athletes; a niggle of 14, 21 or 28 days that opens on the Saturday
//    before the Monday 3 to 8 weeks before the taper (a hold earlier in the plan that holds the
//    build back, so that its loading weeks still climb into the taper); a travel window of 1 or 3
//    days at offset 0, 2 or 4 of the last loading week. 1,296 plans, each of which passes its
//    checklist: the taper item reads the fall from the last week no window touched.
import { describe, expect, it, vi } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { buildPlan } from '../../../shared/engine/index.ts'
import { windowOf, withWindows } from './disruption-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

vi.setConfig({ testTimeout: 900_000 })

const byHand = describe.skipIf(process.env.WINDOW_GRIDS_FULL === undefined)

byHand('the grids of the third review of RF2 (by hand)', () => {
  it('passes the checklist in every plan of the taper grid', () => {
    let plans = 0
    const failures: string[] = []
    for (const athlete of athletes()) {
      const base = buildPlan(athlete.input)
      const first = base.weeks.find((w) => w.isTaper)
      if (first === undefined) continue
      const lastLoading = base.weeks
        .filter((w) => w.weekStart < first.weekStart && !w.isRecovery && !w.isTaper)
        .at(-1)!
      for (const hold of [14, 21, 28]) {
        for (let weeksBefore = 3; weeksBefore <= 8; weeksBefore += 1) {
          const start = addDays(first.weekStart, -7 * weeksBefore - 2)
          const niggle = windowOf({
            id: 'a',
            reason: 'niggle',
            startDate: start,
            endDate: addDays(start, hold - 1),
            pain: 0,
          })
          for (const length of [1, 3]) {
            for (const offset of [0, 2, 4]) {
              const from = addDays(lastLoading.weekStart, offset)
              const travel = windowOf({
                id: 'b',
                reason: 'travel',
                startDate: from,
                endDate: addDays(from, length - 1),
              })
              plans += 1
              const plan = buildPlan(withWindows(athlete, niggle, travel))
              for (const item of plan.checklist.filter((c) => !c.ok)) {
                failures.push(
                  `${athlete.id}, niggle ${hold} days ${weeksBefore} weeks before the taper, travel ${length} days at +${offset}: ${item.id}: ${item.detail}`,
                )
              }
            }
          }
        }
      }
    }
    console.log(`taper grid: ${plans} plans, ${failures.length} failed checklist items`)
    expect(plans).toBe(1296)
    expect(failures).toEqual([])
  })
})
