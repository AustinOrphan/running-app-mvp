// A week the weekly decision holds under the 3 x N floor stays a restart (rule E6): a completion-low
// hold draws the floor week and steps the weeks after it from the floor, and a runner already on the
// floor keeps it through a hold. The two states come from the matrix athletes at a ragged level
// (`SimAthlete`, a seed offset of 2000 on the chain seed), and the figures are those of the engine
// without the short-window change (B2), which must not move them.
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { athletes } from './matrix-fixtures.ts'
import { SimAthlete, replanMonday, simulateChain, withStoredPlan } from './sim-athlete.ts'

const SEED = 20_261_031 + 2000

function stepOf(id: string, step: number) {
  const all = athletes()
  const index = all.findIndex((a) => a.id === id)
  const chain = simulateChain(new SimAthlete(SEED + index, 'ragged'), all[index]!.input)
  return chain.steps[step]!
}

const weeksFrom = (
  draft: { weeks: Array<{ weekStart: string; targetRunMin: number }> },
  from: string,
  n: number,
) => draft.weeks.filter((w) => w.weekStart >= from).slice(0, n)

describe('a held week under the floor is a restart', () => {
  it('a completion-low hold draws the floor week and the weeks after it step from it (marathon, 2026-12-21)', () => {
    const step = stepOf('marathon', 9)
    expect(step.settled.today).toBe('2026-12-21')
    const weeks = weeksFrom(step.draft, '2026-12-21', 5)
    expect(weeks.map((w) => w.targetRunMin)).toEqual([41, 30, 45, 49, 53])
    expect(step.draft.weeks.find((w) => w.weekStart === '2026-12-21')!.flags).toContain(
      'restart-floor',
    )
  })

  it('a runner on the floor keeps it through a hold in a window week, and the plan is a fixed point (returning, 2027-02-08)', () => {
    const step = stepOf('returning', 16)
    expect(step.settled.today).toBe('2027-02-08')
    const week = step.draft.weeks.find((w) => w.weekStart === '2027-02-08')!
    expect(week.flags).toContain('restart-floor')
    expect(weeksFrom(step.draft, '2027-02-08', 4).map((w) => w.targetRunMin)).toEqual([
      25, 27, 26, 25,
    ])
    const back = replanMonday(withStoredPlan(step)).draft
    expect(isDeepStrictEqual(back, step.draft)).toBe(true)
  })
})
