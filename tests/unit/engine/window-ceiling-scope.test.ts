import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { planMinutes } from './disruption-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { SimAthlete, replanMonday, simulateChain } from './sim-athlete.ts'

// Rule J9 addendum (task WC1): a week is a ceiling, one a window or the ramp back from one holds
// under its drawn target, only when a window touches it, when it is a J7 return week or when it is
// one of the `g2.ceilingLookbackWeeks` weeks after the full week of a hold sent back at a fraction
// under 1. A week after those is drawn and placed as the plan without the window.

// `ceiling-scope-input.json`: the settled input (`SimAthlete` output, synthetic) of a sparse 100-mile
// build re-planned on 2027-01-11, with one illness window of 2026-11-05..2026-11-09. A chain of the
// matrix athlete `sparse-100-mile` does not reach this state on its own (its earlier re-plans drew
// the weeks after the window as a ceiling did not), so the input is kept as data.
const input = JSON.parse(
  readFileSync(new URL('./fixtures/ceiling-scope-input.json', import.meta.url), 'utf8'),
) as EngineInput

const weeksFrom = (draft: PlanDraft, from: string) => {
  const placed = planMinutes(draft)
  return draft.weeks
    .filter((w) => w.weekStart >= from)
    .map((w) => [w.weekStart, w.targetRunMin, placed.get(w.weekStart) ?? 0] as const)
}

describe('the scope of a ceiling week', () => {
  it('draws the weeks past the ramp back from an old illness as the plan without it', () => {
    expect(input.disruptions).toHaveLength(1)
    const withWindow = replanMonday(input).draft
    const without = replanMonday({ ...input, disruptions: [] }).draft
    // The window ended 2026-11-09; its ramp back and the G-2 look back are over by 2027-01-18.
    const from = '2027-01-18'
    const a = weeksFrom(withWindow, from)
    expect(a.length).toBeGreaterThan(10)
    expect(a).toEqual(weeksFrom(without, from))
  })
})

const SEED = 20_261_031
const OLD_DAYS = 45

describe('a window long over leaves the plan from today on', () => {
  it('holds for every chain step whose window ended 45 or more days before', () => {
    let checks = 0
    const diffs: string[] = []
    for (const level of ['ragged', 'compliant'] as const) {
      athletes().forEach((athlete, index) => {
        const chain = simulateChain(new SimAthlete(SEED + index, level), athlete.input, {})
        for (const [k, step] of chain.steps.entries()) {
          const windows = step.settled.disruptions ?? []
          const cut = addDays(step.settled.today, -OLD_DAYS)
          const kept = windows.filter((w) => w.endDate >= cut)
          if (kept.length === windows.length) continue
          checks += 1
          const a = replanMonday(step.settled).draft
          const b = replanMonday({ ...step.settled, disruptions: kept }).draft
          const from = step.settled.today
          if (JSON.stringify(weeksFrom(a, from)) !== JSON.stringify(weeksFrom(b, from)))
            diffs.push(`${level} ${athlete.id} step ${String(k)}`)
        }
      })
    }
    expect(checks).toBeGreaterThan(0)
    expect(diffs).toEqual([])
  })
})
