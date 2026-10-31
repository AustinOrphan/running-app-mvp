// A re-plan with nothing new returns the plan it replaces: the direct cases behind the metamorphic
// relations of `sim-athlete.test.ts` (task RF1). Each case is a small input worked by hand, not a
// season: the race week of one athlete, one held week, and so on. The relations run the same
// questions over twelve athletes and three levels.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { HOLD_TRIM_RULE, isTrimmed, TRIM_RULE } from '../../../shared/domain/sessionStatus.ts'
import { buildPlan, keptByReplan, replan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanSteps } from './replan-steps.ts'
import {
  EXACT_RATES,
  replanMonday,
  SimAthlete,
  simulateChain,
  withStoredPlan,
  type SimStep,
} from './sim-athlete.ts'

/** The running minutes of a draft in the week of `monday`, a race and a lift left out. */
function weekMin(draft: PlanDraft, monday: string): number {
  return draft.sessions
    .filter((s) => s.date >= monday && s.date < addDays(monday, 7))
    .filter((s) => !['strength', 'race', 'rest', 'mobility', 'hike'].includes(s.kind))
    .reduce((sum, s) => sum + s.durationMin, 0)
}

/** The same Monday again with the draft stored as the plan, and nothing new. */
function again(input: EngineInput, draft: PlanDraft): { input: EngineInput; draft: PlanDraft } {
  const stored = withStoredPlan({ settled: input, draft })
  return { input: stored, draft: replan(stored).draft }
}

describe('the race week, stored and re-planned with nothing new [rules g-6, K2]', () => {
  // The race week holds a run on the day of the race, which the race replaces. The plan sheds that
  // run once; it must not shed another run, or another share of the week, at every re-plan.
  it.each(['half', 'marathon', 'first-100-mile'])(
    'gives the plan of %s back, pass after pass',
    (id) => {
      const last = replanSteps(id).at(-1)!
      const monday = mondayOf(last.input.today)
      expect(monday).toBe(mondayOf(last.input.goal.date))
      let { input, draft } = { input: last.input, draft: last.draft }
      for (let pass = 2; pass <= 4; pass += 1) {
        const next = again(input, draft)
        expect(weekMin(next.draft, monday), `pass ${String(pass)}`).toBe(
          weekMin(last.draft, monday),
        )
        expect(next.draft, `pass ${String(pass)}`).toEqual(last.draft)
        ;({ input, draft } = next)
      }
    },
  )
})

describe('a held week, stored and re-planned with nothing new [rules J5, G-6]', () => {
  // A runner who runs 75% of every session: every Monday re-plan holds (completion under
  // `j5.completionHoldShare`), caps the week at the minutes run and a step, and trims the next
  // quality session. Of the three Mondays tested (steps 2, 3 and 4 of the chain) the first carries
  // no trim and the other two do.
  const half = athletes().find((a) => a.id === 'half')!
  const runner = new SimAthlete(1, 'compliant', { ...EXACT_RATES, asPlanned: [0.75, 0.75] })
  const chain = simulateChain(runner, half.input, { maxSteps: 4 })
  const held = [2, 3, 4].map((k) => chain.steps[k]!)
  const mondayOf_ = (step: SimStep) => mondayOf(step.settled.today)

  /** The weeks of a draft from the held Monday on. */
  const weeksFrom = (draft: PlanDraft, monday: string) =>
    draft.weeks.filter((w) => w.weekStart >= monday)

  it('holds each week, caps it under the plan it replaces and trims a quality session in two', () => {
    const trims = held.map((step) => {
      const monday = mondayOf_(step)
      expect(step.decision?.decision).toBe('hold')
      const before = step.settled.existing!.weeks.find((w) => w.weekStart === monday)!
      const after = step.draft.weeks.find((w) => w.weekStart === monday)!
      expect(after.targetRunMin).toBe(step.decision!.nextWeekTargetMin)
      expect(after.targetRunMin).toBeLessThan(before.targetRunMin)
      return step.draft.sessions.filter((s) => mondayOf(s.date) === monday && isTrimmed(s.rules))
    })
    expect(trims.map((t) => t.length)).toEqual([0, 1, 1])
    // the trim cites the weekly decision beside the trim rule
    expect(trims[1]![0]!.rules).toEqual(expect.arrayContaining([TRIM_RULE, HOLD_TRIM_RULE]))
  })

  it.each([0, 1, 2])('gives the plan back of held step %i, pass after pass', (i) => {
    // the weeks ahead are drawn from the cap the first pass set, not from the plan before it
    const step = held[i]!
    const monday = mondayOf_(step)
    let current: SimStep = step
    for (let pass = 2; pass <= 4; pass += 1) {
      const next = replanMonday(withStoredPlan(current)).draft
      expect(weeksFrom(next, monday), `pass ${String(pass)}`).toEqual(weeksFrom(step.draft, monday))
      expect(next, `pass ${String(pass)}`).toEqual(step.draft)
      current = { ...current, settled: withStoredPlan(current), draft: next }
    }
  })

  it.each([0, 1, 2])('reports no change on the second pass of held step %i', (i) => {
    // the plan is the same, so the list of changes the revision words is empty: the trim the second
    // pass draws again is not a change of planned minutes against the trim stored
    const second = replanMonday(withStoredPlan(held[i]!))
    expect(replan(second.input, { decisions: second.decisions }).changes).toEqual([])
  })

  it('gives the plan back when the trimmed session is stored as planned too', () => {
    // `sessionRow` stores the decision's trim as downgraded, which the harness does as well; the
    // plan comes back with the session stored as planned
    const step = held[1]!
    const stored = withStoredPlan(step)
    const asPlanned: EngineInput = {
      ...stored,
      existing: {
        ...stored.existing!,
        sessions: stored.existing!.sessions.map((s) =>
          s.status === 'downgraded' ? { ...s, status: 'planned' } : s,
        ),
      },
    }
    expect(stored.existing!.sessions.some((s) => s.status === 'downgraded')).toBe(true)
    expect(replanMonday(asPlanned).draft).toEqual(step.draft)
  })

  it.each([0, 1, 2])(
    'draws the weeks ahead of held step %i the same whether the replaced plan carries the cap',
    (i) => {
      const step = held[i]!
      const monday = mondayOf_(step)
      const cap = { [monday]: step.decision!.nextWeekTargetMin }
      const decisions = { [monday]: 'hold' as const }
      const carried = withStoredPlan(step)
      expect(carried.existing!.weeks.find((w) => w.weekStart === monday)!.targetRunMin).toBe(
        cap[monday],
      )
      const first = replan({ ...step.settled, weekCaps: cap }, { decisions }).draft
      const second = replan({ ...carried, weekCaps: cap }, { decisions }).draft
      expect(weeksFrom(second, monday)).toEqual(weeksFrom(first, monday))
    },
  )
})

describe('keptByReplan and the trim of the weekly decision [rules J5, design 4.3]', () => {
  const today = '2026-10-26'
  const row = (status: string, rules: string[], date = '2026-10-28') => ({ date, status, rules })

  it('draws the decision’s own trim again, and keeps a trim from an assessed session', () => {
    // a trim of the weekly decision cites the rule of the decision; the next re-plan trims again
    // from the decision, so no copy of it is kept
    expect(keptByReplan(row('downgraded', ['C5', TRIM_RULE, HOLD_TRIM_RULE]), today)).toBe(false)
    // an assessed session's trim is the runner's record
    expect(keptByReplan(row('downgraded', ['C5', TRIM_RULE]), today)).toBe(true)
  })

  it('keeps a trim of the decision that was run, or lies in the past', () => {
    const rules = ['C5', TRIM_RULE, HOLD_TRIM_RULE]
    expect(keptByReplan(row('completed', rules), today)).toBe(true)
    expect(keptByReplan(row('downgraded', rules, '2026-10-25'), today)).toBe(true)
  })
})

describe('a day closed to running never raises a week [rule G-6, relation 5.3]', () => {
  // A week the replaced plan has not started is held to its figure; the week a window touches is held
  // to the minutes the plan placed. Where the plan placed more than its figure (a session under the
  // shortest run is raised to it), closing one day moved the bound of the week from the figure to the
  // minutes, and the week rose: a closed day gave the runner more running.
  const half = athletes().find((a) => a.id === 'half')!
  const plan = buildPlan(half.input)
  const monday = addDays(mondayOf(half.input.today), 7)
  const placed = plan.sessions
    .filter((s) => mondayOf(s.date) === monday && !['strength', 'race', 'rest'].includes(s.kind))
    .reduce((sum, s) => sum + s.durationMin, 0)
  const existing: NonNullable<EngineInput['existing']> = {
    weeks: plan.weeks.map((w) =>
      w.weekStart === monday ? { ...w, targetRunMin: Math.round(placed * 0.6) } : w,
    ),
    sessions: plan.sessions.map((s, i) => ({
      ...s,
      id: `s${String(i)}`,
      status: s.date < monday ? 'completed' : 'planned',
      activityId: null,
    })),
  }
  const input: EngineInput = { ...half.input, today: monday, existing }
  const minutes = (draft: PlanDraft, week: string) =>
    draft.sessions
      .filter((s) => mondayOf(s.date) === week && !['strength', 'race', 'rest'].includes(s.kind))
      .reduce((sum, s) => sum + s.durationMin, 0)

  it('holds the week to its figure, under the minutes the plan placed', () => {
    const base = replan(input).draft
    expect(minutes(base, monday)).toBeLessThanOrEqual(
      existing.weeks.find((w) => w.weekStart === monday)!.targetRunMin,
    )
    expect(placed).toBeGreaterThan(existing.weeks.find((w) => w.weekStart === monday)!.targetRunMin)
  })

  it.each([1, 3, 5])('raises no week when day %i of it is closed to running', (day) => {
    const base = replan(input).draft
    const date = addDays(monday, day)
    const variant = replan({
      ...input,
      disruptions: [
        {
          id: 'closed',
          reason: 'travel',
          mode: 'rest',
          startDate: date,
          endDate: date,
          maxRunMin: null,
          pain: null,
          gaitChange: false,
        },
      ],
    }).draft
    for (const week of variant.weeks) {
      const before = base.weeks.find((w) => w.weekStart === week.weekStart)
      if (before === undefined) continue
      expect(week.targetRunMin, `target ${week.weekStart}`).toBeLessThanOrEqual(before.targetRunMin)
      expect(minutes(variant, week.weekStart), `minutes ${week.weekStart}`).toBeLessThanOrEqual(
        minutes(base, week.weekStart),
      )
    }
  })
})
