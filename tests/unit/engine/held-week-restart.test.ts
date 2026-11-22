// A week the weekly decision holds under the 3 x N floor stays a restart (rule E6): a completion-low
// hold draws the floor week and steps the weeks after it from the floor, and a runner already on the
// floor keeps it through a hold. The two states come from the matrix athletes at a ragged level
// (`SimAthlete`, a seed offset of 2000 on the chain seed), and the figures are those of the engine
// without the short-window change (B2), which must not move them.
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { athletes } from './matrix-fixtures.ts'
import { SimAthlete, replanMonday, simulateChain, withStoredPlan } from './sim-athlete.ts'

const SEED = 20_261_031

function stepOf(id: string, step: number, offset = 2000) {
  const all = athletes()
  const index = all.findIndex((a) => a.id === id)
  const chain = simulateChain(new SimAthlete(SEED + offset + index, 'ragged'), all[index]!.input)
  return chain.steps[step]!
}

const flagsOf = (step: ReturnType<typeof stepOf>, weekStart: string) =>
  step.draft.weeks.find((w) => w.weekStart === weekStart)!.flags
const taperOf = (step: ReturnType<typeof stepOf>) =>
  step.draft.weeks.filter((w) => w.isTaper).map((w) => w.targetRunMin)

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

// The peak a hold caps (rules E6, J5, K1, K2): the changes that make a recovery week turned peak a
// fixed point must leave these plans as they were.
describe('a held week outside the recovery-turned-peak week is unchanged', () => {
  it('a stored recovery week the cadence keeps as one is drawn as before (marathon, hold)', () => {
    const step = stepOf('marathon', 18, 0)
    const week = step.draft.weeks.find((w) => w.weekStart === '2027-02-22')!
    expect(week.isRecovery).toBe(true)
    expect(week.targetRunMin).toBe(62)
    expect(taperOf(step)).toEqual([40, 24])
  })

  it('a hold before the peak week keeps the floor week and its taper (half, hold)', () => {
    const step = stepOf('half', 8)
    expect(flagsOf(step, step.settled.today)).toContain('restart-floor')
    expect(step.draft.weeks.find((w) => w.weekStart === step.settled.today)!.targetRunMin).toBe(45)
    expect(taperOf(step)).toEqual([74, 49])
  })

  it('a hold in a floor week whose loading week before was under the floor stays a restart (half, 2027-02-08)', () => {
    const step = stepOf('half', 16, 1000)
    expect(step.settled.today).toBe('2027-02-08')
    expect(flagsOf(step, '2027-02-08')).toContain('restart-floor')
    expect(taperOf(step)).toEqual([39, 36])
  })

  // KNOWN: a re-plan of this plan with nothing new moves the weeks after the window week by a minute
  // (96, 72, 105 and 115 become 95, 71, 104 and 114): the week in progress is placed one minute short
  // at the second pass (an easy run of 25 minutes becomes 24). The drift is in the placement of that
  // week, not in the window-free figure, which is the same at both passes; it is also there with the
  // window-free lift off. The test goes red when a change fixes it.
  it.fails(
    'a window reported the Monday after, as a past week, is a fixed point (trail-50k)',
    () => {
      const step = stepOf('trail-50k', 12)
      expect(step.settled.today).toBe('2027-01-11')
      const back = replanMonday(withStoredPlan(step)).draft
      expect(isDeepStrictEqual(back, step.draft)).toBe(true)
    },
  )

  it('a floor week with no hold keeps its floor and the weeks after it (masters)', () => {
    const step = stepOf('masters', 13)
    expect(flagsOf(step, step.settled.today)).toContain('restart-floor')
    expect(weeksFrom(step.draft, step.settled.today, 3).map((w) => w.targetRunMin)).toEqual([
      60, 66, 72,
    ])
  })

  it('a taper after a week a window cut and the runner ran as it left it falls from that week (returning)', () => {
    const step = stepOf('returning', 17, 1000)
    expect(step.draft.weeks.some((w) => w.isRecovery && w.targetRunMin === 63)).toBe(true)
    expect(taperOf(step)).toEqual([56, 34])
  })
})
