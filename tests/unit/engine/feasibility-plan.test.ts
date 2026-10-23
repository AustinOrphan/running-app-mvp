// The feasibility label against the plan the generator builds for the same athlete [rules D3, D4].
// The label counts weeks of growth to the long run and the weekly floor; the generator draws the
// weeks. A drift between the two (an input of the label that the generator no longer follows, or the
// other way round) fails here, for the athletes of the plan matrix [design section 9].
//
// The plan is built with a race far enough away that the race date never limits it; the label does
// not depend on the date. A plan week is counted from 0 (the current, part week), the way the label
// counts the full weeks ahead.
import { describe, expect, it } from 'vitest'
import { addDays } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { feasibility, longRunFloor, trainingPace } from '../../../shared/engine/goal.ts'
import { afterBreak, buildPlan } from '../../../shared/engine/index.ts'
import { startWeekMin } from '../../../shared/engine/limits.ts'
import { startPath } from '../../../shared/engine/macro.ts'
import { P } from '../../../shared/engine/params/index.ts'
import { rungCount } from '../../../shared/engine/startWeeks.ts'
import type { GoalModel, PlanDraft } from '../../../shared/engine/types.ts'
import { athletes, type MatrixAthlete } from './matrix-fixtures.ts'

const FAR_WEEKS = 30
const TOLERANCE_WEEKS = 2

const taperWeeks = (cls: GoalModel['distanceClass']): number => {
  const days = { '5k': 7, '10k': 10, half: 14, marathon: 21 }[
    cls as '5k' | '10k' | 'half' | 'marathon'
  ]
  return Math.ceil(days / 7)
}

/** What the generator sees: the state after a break and the start path of the plan. */
function context(a: MatrixAthlete) {
  const state = afterBreak(estimateState(a.input))
  return { state, start: startPath(a.input, state) }
}

/** The plan for the athlete with the race moved far out, so its date limits nothing. */
function farPlan(a: MatrixAthlete): PlanDraft {
  const goal = { ...a.input.goal, date: addDays(a.input.goal.date, 7 * FAR_WEEKS) }
  return buildPlan({ ...a.input, goal })
}

/** The label as the plan carries it, for the race on its own date. */
const labelOf = (a: MatrixAthlete) => buildPlan(a.input).feasibility

/** The first week (0-based) in which the plan holds the long run and the weekly floor of the label. */
function reachedAt(a: MatrixAthlete, plan: PlanDraft): number {
  const { state, start } = context(a)
  const goal = a.input.goal
  const pace = trainingPace(state, goal)
  const targetM =
    longRunFloor(goal, state, start)?.targetM ??
    Math.min(goal.distanceM, P.d3.typicalSessionKm.value * 1000)
  const floorKm =
    goal.goalType !== 'time'
      ? null
      : goal.distanceClass === 'half'
        ? P.d3.halfMinWeeklyKm.value
        : goal.distanceClass === 'marathon'
          ? P.d3.marathonMinWeeklyKm.value
          : null
  const week = plan.weeks.findIndex(
    (w) =>
      (w.longRunMin * 60 * 1000) / pace >= targetM - 1e-6 &&
      (floorKm === null || (w.targetRunMin * 60) / pace >= floorKm - 1e-6),
  )
  expect(week).toBeGreaterThanOrEqual(0)
  return week
}

const nonUltra = athletes().filter((a) => !a.isUltra)
const byId = (id: string) => nonUltra.find((a) => a.id === id)!

describe('feasibility and the generated plan: the athletes of the matrix', () => {
  // The athletes whose long run and weekly volume the label models: the default ramp and cadence,
  // a long run that is the long-run share of the week, and no ladder.
  it.each(['half', 'marathon', 'masters', 'returning'])(
    'counts about as many weeks as the plan takes to reach its long run and weekly floor: %s',
    (id) => {
      const a = byId(id)
      const label = labelOf(a)
      const growth = label.weeksNeeded - taperWeeks(a.input.goal.distanceClass)
      const reached = reachedAt(a, farPlan(a))
      expect(Math.abs(reached - growth)).toBeLessThanOrEqual(TOLERANCE_WEEKS)
    },
  )

  it('is the same label for a race far out and a race on its date: the date moves no input', () => {
    for (const a of nonUltra) {
      const near = labelOf(a)
      const far = farPlan(a).feasibility
      expect(far.weeksNeeded).toBe(near.weeksNeeded)
    }
  })

  it('counts the nine weeks of the ladder of a novice before any growth of the long run', () => {
    const a = byId('novice-5k')
    const { start } = context(a)
    expect(start).toEqual({ kind: 'ladder', rung: 1, bmiHold: false })
    // the plan runs the nine rungs of the ladder, one a week, before any plain week
    const ladderWeeks = farPlan(a).weeks.filter((w) => w.flags.includes('run-walk'))
    expect(ladderWeeks).toHaveLength(rungCount())
    // the label counts those weeks, the growth from the 30 minutes of the last rung and the taper;
    // it was 35 weeks from the minimum step of 500 m
    const label = labelOf(a)
    expect(label.weeksNeeded).toBeGreaterThanOrEqual(rungCount() + taperWeeks('5k'))
    expect(label.weeksNeeded).toBeLessThan(20)
  })

  it('works toward the long run that the plan builds when the D3 floor is out of reach', () => {
    for (const id of ['half', 'marathon', 'masters', 'returning', 'hot-race']) {
      const a = byId(id)
      const { state, start } = context(a)
      const floor = longRunFloor(a.input.goal, state, start)!
      expect(floor.reached).toBe(false)
      const plan = farPlan(a)
      // the longest long run of the plan is the one the label counts the weeks to
      expect(Math.max(...plan.weeks.map((w) => w.longRunMin))).toBe(floor.plannedMin)
      expect(plan.feasibility.notes.map((n) => n.code)).toContain('long-run-floor')
    }
  })

  it('opens a runner back from a break at the restart volume, as the label counts it', () => {
    const a = byId('returning')
    const { state, start } = context(a)
    expect(start).toBeNull()
    expect(state.longest30d.durationSec).toBe(0)
    const plan = farPlan(a)
    const opening = startWeekMin(state, start)
    // the first week and its long run are the restart volume and its long-run share
    expect(plan.weeks[0]!.targetRunMin).toBe(opening)
    expect(plan.weeks[0]!.longRunMin).toBe(
      Math.floor(P.macroDesign.longRunShareOfWeek.value * opening + 1e-9),
    )
    // the label counts from there: not the 61 weeks that the minimum step gave
    const label = feasibility(a.input.goal, state, a.input.today, start)
    expect(label.weeksNeeded).toBeLessThan(25)
    expect(label.label).not.toBe('not-reachable')
  })
})
