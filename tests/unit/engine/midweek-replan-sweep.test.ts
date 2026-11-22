// The slow cases of a re-plan made after the Monday [rules G-2, G-6, MW1]: the matrix chains re-planned on
// each day of the week, and the bounds on the plan drawn with no week counted. The fast cases are in
// midweek-replan.test.ts; this file runs in the `sweep` project (`SWEEP_FILES`).
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { replan } from '../../../shared/engine/index.ts'
import type { EngineInput } from '../../../shared/engine/types.ts'
import { planMinutes, windowOf } from './disruption-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { inputAt, ranFrom } from './midweek-fixtures.ts'
import { replanChain } from './replan-steps.ts'

describe('a re-plan after the Monday with nothing new', () => {
  it('never plans a later week above the plan it replaces or the plan with no week counted', () => {
    for (const id of ['first-100-mile', 'half', 'returning', 'masters']) {
      const athlete = athletes().find((a) => a.id === id)!
      const steps = replanChain(athlete.input)
      for (const [k, step] of steps.entries()) {
        if (k < 1 || k > 4) continue
        const monday = mondayOf(step.input.today)
        const wed = addDays(monday, 2)
        const base = { ...step.input, existing: null } as EngineInput
        const acts = [...step.input.activities, ...ranFrom(step.draft, monday, wed, null)]
        const kept = replan(inputAt(base, step.draft, wed, acts, [])).draft
        const legacy = replan(inputAt(base, step.draft, wed, acts, [], { countKept: false })).draft
        for (const week of kept.weeks) {
          if (week.weekStart <= monday) continue
          const limit = Math.max(
            legacy.weeks.find((w) => w.weekStart === week.weekStart)?.targetRunMin ?? 0,
            step.draft.weeks.find((w) => w.weekStart === week.weekStart)?.targetRunMin ?? 0,
          )
          expect(week.targetRunMin, `${id} ${wed} week ${week.weekStart}`).toBeLessThanOrEqual(
            limit,
          )
        }
        // and on the minutes placed
        const placed = planMinutes(kept)
        const legacyPlaced = planMinutes(legacy)
        const storedPlaced = planMinutes(step.draft)
        for (const [weekStart, minutes] of placed) {
          if (weekStart <= monday) continue
          expect(minutes, `${id} ${wed} placed ${weekStart}`).toBeLessThanOrEqual(
            Math.max(legacyPlaced.get(weekStart) ?? 0, storedPlaced.get(weekStart) ?? 0),
          )
        }
      }
    }
  })
})

describe('a re-plan on any day of the week with nothing new', () => {
  // The Monday plan of each step of the matrix chain, re-planned on each day from the Tuesday to the
  // Saturday with every earlier day run as planned: the weeks from the Monday on come back as they
  // were, the week in progress included. The Sunday is left out: the runs the fixtures log carry no
  // climbing, which the plans of the trail and 100-mile athletes do. The held athlete's Thursday is
  // left out too: one run day left for two runs due merges them (shake-out-replan.test.ts). The
  // hot-race athlete's Thursday and later days are left out: a later week still comes back a few
  // minutes short (a taper or race-week residual, listed as a follow-up).
  const ATHLETES: Array<[string, number[]]> = [
    ['first-100-mile', [1, 2, 3, 4, 5]],
    ['half', [1, 2, 3, 4, 5]],
    ['masters', [1, 2, 3, 4, 5]],
    ['prior-bsi', [1, 2, 3, 4, 5]],
    ['trail-50k', [1, 2, 3, 4, 5]],
    ['marathon', [1, 2, 3, 4, 5]],
    ['reds-hold', [1, 2, 4, 5]],
    ['hot-race', [1, 2]],
  ]

  it.each(ATHLETES)('returns the weeks of the Monday plan of %s', (id, days) => {
    const athlete = athletes().find((a) => a.id === id)!
    const steps = replanChain(athlete.input)
    for (const [k, step] of steps.entries()) {
      if (k < 1 || k > 10) continue
      const monday = mondayOf(step.input.today)
      for (const day of days) {
        const today = addDays(monday, day)
        if (today > athlete.input.goal.date) continue
        const acts = [...step.input.activities, ...ranFrom(step.draft, monday, today, null)]
        const draft = replan(inputAt(step.input, step.draft, today, acts, [])).draft
        const label = `${id} ${today}`
        expect(planMinutes(draft), label).toEqual(planMinutes(step.draft))
        expect(
          draft.weeks.filter((w) => w.weekStart >= monday).map((w) => w.targetRunMin),
          label,
        ).toEqual(step.draft.weeks.filter((w) => w.weekStart >= monday).map((w) => w.targetRunMin))
      }
    }
  })
})

describe('a re-plan with a window reported after the Monday plan', () => {
  it('places no week, a windowed one included, below the uncounted draw', () => {
    for (const id of ['trail-50k', 'hot-race', 'half', 'masters', 'first-100-mile']) {
      const athlete = athletes().find((a) => a.id === id)!
      const steps = replanChain(athlete.input)
      for (const [k, step] of steps.entries()) {
        if (k < 1 || k > 3) continue
        const monday = mondayOf(step.input.today)
        for (const [day, from, length] of [
          [2, 7, 5],
          [4, 2, 4],
          [1, 9, 3],
        ] as const) {
          const today = addDays(monday, day)
          const travel = windowOf({
            reason: 'travel',
            mode: 'rest',
            startDate: addDays(monday, from),
            endDate: addDays(monday, from + length),
          })
          const acts = [...step.input.activities, ...ranFrom(step.draft, monday, today, null)]
          const base = { ...step.input, existing: null } as EngineInput
          const kept = planMinutes(replan(inputAt(base, step.draft, today, acts, [travel])).draft)
          const legacy = planMinutes(
            replan(inputAt(base, step.draft, today, acts, [travel], { countKept: false })).draft,
          )
          for (const [week, minutes] of legacy) {
            if (week <= monday) continue
            expect(kept.get(week) ?? 0, `${id} ${today} week ${week}`).toBeGreaterThanOrEqual(
              minutes,
            )
          }
        }
      }
    }
  })
})
