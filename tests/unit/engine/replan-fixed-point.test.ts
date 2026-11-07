// A re-plan with nothing new returns the plan it replaces: the direct cases behind the metamorphic
// relations of `sim-athlete.test.ts` (task RF1). Each case is a small input worked by hand, not a
// season: the race week of one athlete, one held week, and so on. The relations run the same
// questions over twelve athletes and three levels.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { HOLD_TRIM_RULE, isTrimmed, TRIM_RULE } from '../../../shared/domain/sessionStatus.ts'
import { buildPlan, keptByReplan, replan } from '../../../shared/engine/index.ts'
import type { EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { wellnessDay } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { replanChain, replanSteps } from './replan-steps.ts'
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
  // The race week held a run on the day of the race, which the race replaces, and each re-plan shed
  // another share of the week (RF1). Since RF2 it places its runs before the race, and a second pass
  // must still give the same week.
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

describe('a taper under way, stored and re-planned with nothing new [rules K2, G-6]', () => {
  // The taper under way was drawn again at each re-plan from the level the runner starts from, the
  // median of the last weeks with a run, which moves with every week run. The race week of a marathon
  // went from 115 to 132 minutes at the re-plan of the week before it (found by the review of RF3 and
  // recorded as older than it), 106 minutes to run against 119, with nothing new; a first 100-mile's
  // post-race weeks went from 72, 162 and 180 to 171, 321 and 368 at the re-plan of its race week
  // (RF4). A re-plan of a taper under way keeps the taper, race and post-race weeks the plan being
  // replaced holds, and a second, a third and a fourth pass give the plan back.
  const NOT_RUNS = ['strength', 'mobility', 'rest', 'race', 'hike', 'cross']
  const toCome = (draft: PlanDraft, monday: string, from: string): number =>
    draft.sessions
      .filter((s) => mondayOf(s.date) === monday && s.date >= from && !NOT_RUNS.includes(s.kind))
      .reduce((sum, s) => sum + s.durationMin, 0)

  it.each(['marathon', 'masters', 'hot-race', 'first-100-mile'])(
    'plans no more of %s than the plan before at each Monday re-plan of the taper',
    (id) => {
      const steps = replanSteps(id)
      const taperStart = steps[0]!.draft.weeks.find((w) => w.isTaper)!.weekStart
      let compared = 0
      steps.forEach((step, k) => {
        if (k === 0 || mondayOf(step.input.today) < taperStart) return
        const before = steps[k - 1]!
        for (const week of step.draft.weeks) {
          if (week.weekStart < mondayOf(step.input.today)) continue
          if (!(week.isTaper || week.phase === 'race' || week.flags.includes('post-race'))) continue
          const was = before.draft.weeks.find((w) => w.weekStart === week.weekStart)
          if (was === undefined) continue
          const label = `${id}, re-plan of ${step.input.today}, week of ${week.weekStart}`
          compared += 1
          expect(week.targetRunMin, label).toBeLessThanOrEqual(was.targetRunMin)
          expect(toCome(step.draft, week.weekStart, step.input.today), label).toBeLessThanOrEqual(
            toCome(before.draft, week.weekStart, step.input.today),
          )
        }
      })
      expect(compared).toBeGreaterThan(3)
    },
  )

  it.each(['marathon', 'masters', 'hot-race'])(
    'gives the plan of %s back on the Monday of the last taper week before the race week, pass after pass',
    (id) => {
      const steps = replanSteps(id)
      const raceMonday = mondayOf(steps[0]!.input.goal.date)
      const step = steps.find((s) => mondayOf(s.input.today) === addDays(raceMonday, -7))!
      expect(step).toBeDefined()
      let { input, draft } = { input: step.input, draft: step.draft }
      for (let pass = 2; pass <= 4; pass += 1) {
        const next = again(input, draft)
        expect(next.draft, `pass ${String(pass)}`).toEqual(step.draft)
        ;({ input, draft } = next)
      }
    },
  )
})

describe('a kept taper under way gives way to a new race day and to a layoff [rules K2, K3, G-6, J7]', () => {
  // Found by the review of RF4. The rows of a taper under way are kept from the plan being replaced
  // for the same race, and a race moved to another day of its week is not: the race week was sized for
  // the old day (its run days and its minutes). The marathon athlete's race on Tuesday 2027-03-09,
  // moved to Sunday 03-14 at the re-plan of 03-01, planned a race week of 28 minutes where a race on
  // that Sunday has 132; the reverse move kept 115 minutes on one run day. A layoff of 7 days or more
  // found during the taper sizes the level by the J7 restart (`afterBreak`), which a kept row would
  // bypass: 29 days without a run left the week in progress at 181 minutes and the race week at 115.
  const marathon = athletes().find((a) => a.id === 'marathon')!
  const at = '2027-03-01'
  const moved = (from: string, to: string) => {
    const input: EngineInput = { ...marathon.input, goal: { ...marathon.input.goal, date: from } }
    const chain = replanChain(input, { moveGoal: { at, date: to } })
    const k = chain.findIndex((s) => s.input.today === at)
    return { before: chain[k - 1]!, step: chain[k]! }
  }
  const raceWeek = (draft: PlanDraft) => draft.weeks.find((w) => w.weekStart === '2027-03-08')!

  it.each([
    ['2027-03-09', '2027-03-14', 132, 4],
    ['2027-03-14', '2027-03-12', 132, 4],
    ['2027-03-14', '2027-03-09', 33, 1],
  ])(
    'draws the race week of a race moved from %s to %s again, then keeps it pass after pass',
    (from, to, minutes, runDays) => {
      const { step } = moved(from, to)
      expect(step.input.goal.date).toBe(to)
      expect(raceWeek(step.draft)).toMatchObject({ targetRunMin: minutes, runDays })
      // the weeks from the race week on, and their sessions, are the same on every pass (the week in
      // progress is bounded by the minutes the plan before still has, which the move changes)
      const fromRaceWeek = (d: PlanDraft) => ({
        weeks: d.weeks.filter((w) => w.weekStart >= '2027-03-08'),
        sessions: d.sessions.filter((x) => x.date >= '2027-03-08'),
      })
      let { input, draft } = { input: step.input, draft: step.draft }
      for (let pass = 2; pass <= 4; pass += 1) {
        const next = again(input, draft)
        expect(fromRaceWeek(next.draft), `pass ${String(pass)}`).toEqual(fromRaceWeek(step.draft))
        ;({ input, draft } = next)
      }
    },
  )

  it('sizes the taper by the J7 restart after 29 days without a run, not by the rows kept', () => {
    const step = replanChain(marathon.input).find((s) => s.input.today === at)!
    const stored = raceWeek(step.draft).targetRunMin
    expect(stored).toBe(115)
    const idle: EngineInput = {
      ...step.input,
      activities: step.input.activities.filter((a) => a.date <= addDays(at, -29)),
    }
    const draft = replan(idle).draft
    const week = (start: string) => draft.weeks.find((w) => w.weekStart === start)!
    expect(week(at).targetRunMin).toBeLessThan(
      step.draft.weeks.find((w) => w.weekStart === at)!.targetRunMin,
    )
    expect(raceWeek(draft).targetRunMin).toBeLessThan(stored)
    let { input, draft: last } = { input: idle, draft }
    for (let pass = 2; pass <= 4; pass += 1) {
      const next = again(input, last)
      expect(next.draft, `pass ${String(pass)}`).toEqual(draft)
      ;({ input, draft: last } = next)
    }
  })
})

describe('the race week re-planned on a day of it, stored and re-planned again [rules g-6, K2, K6]', () => {
  // A long race's day before is cut to a shake-out from its share of the week. The week in progress
  // is bounded by the minutes its replaced plan still has, so the run must count at its share, or each
  // pass cuts it again and sheds a share of the runs that nothing changed (the review of RF3). The
  // chain re-plans every week on the same day of the week, each week run as planned.
  it.each([
    ['half', 1],
    ['half', 3],
    ['half', 5],
    ['first-100-mile', 1],
    ['first-100-mile', 3],
    ['first-100-mile', 4],
  ] as const)('gives the plan of %s back on day %i of the week, pass after pass', (id, day) => {
    const last = replanSteps(id, { weekday: day }).at(-1)!
    const monday = mondayOf(last.input.goal.date)
    expect(last.input.today).toBe(addDays(monday, day))
    let { input, draft } = { input: last.input, draft: last.draft }
    for (let pass = 2; pass <= 4; pass += 1) {
      const next = again(input, draft)
      expect(weekMin(next.draft, monday), `pass ${String(pass)}`).toBe(weekMin(last.draft, monday))
      expect(next.draft, `pass ${String(pass)}`).toEqual(last.draft)
      ;({ input, draft } = next)
    }
  })
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

describe('a reduced week, stored and re-planned with nothing new [rules J5, E3, G-6]', () => {
  // A reduce makes the week a recovery week. No level of the simulator sets wellness, so the decision
  // is forced here: a runner who ran every session as planned reports an illness on the Thursday of
  // the week before each Monday (a direct signal of rule J5).
  const half = athletes().find((a) => a.id === 'half')!
  const chain = simulateChain(new SimAthlete(1, 'compliant', EXACT_RATES), half.input, {
    maxSteps: 9,
  })
  const steps = chain.steps.slice(1)
  const reduced = (step: SimStep): SimStep => {
    const monday = mondayOf(step.settled.today)
    const settled: EngineInput = {
      ...step.settled,
      wellness: [...step.settled.wellness, wellnessDay(addDays(monday, -4), { illness: true })],
    }
    const first = replanMonday(settled)
    return {
      ...step,
      settled,
      input: first.input,
      decisions: first.decisions,
      decision: first.decision,
      draft: first.draft,
    }
  }

  it.each(steps.map((_, i) => i + 1))('gives the plan back at step %i, pass after pass', (k) => {
    const step = reduced(chain.steps[k]!)
    expect(step.decision?.decision).toBe('reduce')
    const monday = mondayOf(step.settled.today)
    expect(step.draft.weeks.find((w) => w.weekStart === monday)!.isRecovery).toBe(true)
    let current: SimStep = step
    for (let pass = 2; pass <= 3; pass += 1) {
      const next = replanMonday(withStoredPlan(current))
      expect(next.draft, `pass ${String(pass)}`).toEqual(step.draft)
      expect(
        replan(next.input, { decisions: next.decisions }).changes,
        `pass ${String(pass)}`,
      ).toEqual([])
      current = { ...current, settled: withStoredPlan(current), draft: next.draft }
    }
  })

  it('inserts the recovery week: the loading sequence resumes at the week the reduce displaced', () => {
    // the reduce inserts a recovery week (rule J5): the loading week it displaces follows it, as it
    // does from a stored recovery week, where the sequence pauses at the work week before
    let compared = 0
    for (const plain of steps) {
      const monday = mondayOf(plain.settled.today)
      const week = plain.draft.weeks.find((w) => w.weekStart === monday)!
      if (week.isRecovery) continue
      const after = reduced(plain).draft.weeks.find(
        (w) => w.weekStart > monday && !w.isRecovery && !w.isTaper && w.phase !== 'race',
      )!
      expect(after.targetRunMin, monday).toBe(week.targetRunMin)
      compared += 1
    }
    expect(compared).toBeGreaterThan(4)
  })
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
