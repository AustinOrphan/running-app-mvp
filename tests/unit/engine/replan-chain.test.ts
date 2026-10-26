// A Monday re-plan every week up to the race, each week run exactly as planned: the plan of record
// keeps its progression, its peak and its race-specific weeks [rules E2, g-2].
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { afterBreak, buildPlan, replan } from '../../../shared/engine/index.ts'
import { startPath } from '../../../shared/engine/macro.ts'
import type { DisruptionWindow, EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import type { PlanWeek as PlanWeekRow } from '../../../server/db.ts'
import { raisedTargetLimits, planWeekWrites } from '../../../server/services/replan.ts'
import { weekRow } from '../../../server/services/planEngine.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { at, h1, h10, scenario, summer, weeks as runWeeks } from './history-fixtures.ts'
import { replanChain, replanSteps, type ReplanStep } from './replan-steps.ts'

type Existing = NonNullable<EngineInput['existing']>

const asExisting = (plan: PlanDraft, today: string): Existing => ({
  weeks: plan.weeks,
  sessions: plan.sessions.map((s, i) => ({
    ...s,
    id: `s${i}`,
    status: s.date < today ? 'completed' : 'planned',
    activityId: null,
  })),
})

/** Re-plans on every Monday after the first plan until the race week, running each week as planned. */
function chain(id: string): {
  first: PlanDraft
  last: PlanDraft
  replans: number
  ranMinutes: number
} {
  const a = athletes().find((x) => x.id === id)!
  const first = buildPlan(a.input)
  let plan = first
  let activities = a.input.activities
  let monday = addDays(mondayOf(a.input.today), 7)
  let replans = 0
  let ranMinutes = 0
  const raceMonday = mondayOf(a.input.goal.date)
  while (monday <= raceMonday) {
    const ran = plan.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => s.kind !== 'strength' && s.kind !== 'race' && s.kind !== 'mobility')
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    ranMinutes += ran.reduce((n, r) => n + r.durationSec / 60, 0)
    activities = [...activities, ...ran]
    const out = replan({
      ...a.input,
      today: monday,
      activities,
      existing: asExisting(plan, monday),
    })
    plan = out.draft
    replans += 1
    monday = addDays(monday, 7)
  }
  return { first, last: plan, replans, ranMinutes }
}

const preTaper = (plan: PlanDraft) => plan.weeks.filter((w) => !w.isTaper && w.phase !== 'race')
const peak = (plan: PlanDraft, field: 'targetRunMin' | 'longRunMin') =>
  Math.max(...preTaper(plan).map((w) => w[field]))

describe.each(['half', 'first-100-mile', 'marathon'])('weekly re-plans of %s', (id) => {
  const { first, last, replans } = chain(id)

  it('re-plans more than a few times', () => {
    expect(replans).toBeGreaterThan(8)
  })

  it('keeps the peak week and the peak long run of the first plan', () => {
    expect(peak(last, 'targetRunMin')).toBeGreaterThanOrEqual(peak(first, 'targetRunMin') * 0.9)
    expect(peak(last, 'longRunMin')).toBeGreaterThanOrEqual(peak(first, 'longRunMin') * 0.9)
  })

  it('keeps the race-specific phase until the taper', () => {
    const firstSpecific = first.weeks.find((w) => w.phase === 'specific')!.weekStart
    const late = last.weeks.filter((w) => w.weekStart >= firstSpecific && !w.isTaper)
    expect(late.filter((w) => w.phase !== 'race' && w.phase !== 'specific')).toEqual([])
  })
})

/**
 * The same chain with a rest window that every re-plan is given, as the server gives all active
 * windows: the days it holds carry no run, and the chain's activities are the planned runs.
 */
function chainWithWindow(id: string, window: DisruptionWindow) {
  const a = athletes().find((x) => x.id === id)!
  const input = { ...a.input, disruptions: [window] }
  let plan = buildPlan(input)
  let activities = a.input.activities
  let monday = addDays(mondayOf(a.input.today), 7)
  const raceMonday = mondayOf(a.input.goal.date)
  const steps: PlanDraft[] = []
  let ranMinutes = 0
  while (monday <= raceMonday) {
    const ran = plan.sessions
      .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
      .filter((s) => !['strength', 'race', 'mobility', 'rest'].includes(s.kind))
      .map((s) =>
        activity(s.date, {
          id: `done-${s.date}-${s.order}`,
          durationSec: s.durationMin * 60,
          distanceM: s.distanceM ?? s.durationMin * 170,
        }),
      )
    ranMinutes += ran.reduce((n, r) => n + r.durationSec / 60, 0)
    activities = [...activities, ...ran]
    const out = replan({
      ...input,
      today: monday,
      activities,
      existing: asExisting(plan, monday),
    })
    plan = out.draft
    steps.push(plan)
    monday = addDays(monday, 7)
  }
  return { steps, ranMinutes, window }
}

describe.each(['half', 'first-100-mile', 'marathon'])(
  'weekly re-plans of %s with a rest window ahead',
  (id) => {
    // ill for ten days from the Monday two weeks on: the week before it is the last one run
    const a = athletes().find((x) => x.id === id)!
    const start = addDays(mondayOf(a.input.today), 14)
    const window: DisruptionWindow = {
      id: 'w1',
      reason: 'illness-below-neck',
      mode: 'rest',
      startDate: start,
      endDate: addDays(start, 9),
      maxRunMin: null,
      pain: null,
      gaitChange: false,
    }
    const plain = chain(id)
    const windowed = chainWithWindow(id, window)

    it('passes the checklist at every re-plan, the window item included', () => {
      expect(windowed.steps.length).toBeGreaterThan(8)
      for (const [n, step] of windowed.steps.entries()) {
        expect(
          step.checklist.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`),
          `step ${n}`,
        ).toEqual([])
      }
      // the item is there while the window still matters to the plan
      expect(windowed.steps[0]!.checklist.map((c) => c.id)).toContain('disruption-window')
    })

    it('runs nothing on a held day and adds no running to the chain', () => {
      const held = new Set<string>()
      for (let d = start; d <= addDays(start, 10); d = addDays(d, 1)) held.add(d)
      for (const step of windowed.steps) {
        const runs = step.sessions.filter(
          (s) => held.has(s.date) && s.kind !== 'rest' && s.kind !== 'race',
        )
        expect(runs.map((s) => `${s.date} ${s.kind}`)).toEqual([])
      }
      expect(windowed.ranMinutes).toBeLessThan(plain.ranMinutes)
    })

    it('goes back to the plan without the window once the way back is over', () => {
      // the plan of record keeps its race-specific weeks and its race week
      const last = windowed.steps.at(-1)!
      const raceWeek = mondayOf(a.input.goal.date)
      expect(last.sessions.some((s) => s.kind === 'race' && mondayOf(s.date) === raceWeek)).toBe(
        true,
      )
      const firstSpecific = plain.first.weeks.find((w) => w.phase === 'specific')!.weekStart
      const late = last.weeks.filter((w) => w.weekStart >= firstSpecific && !w.isTaper)
      expect(late.filter((w) => w.phase !== 'race' && w.phase !== 'specific')).toEqual([])
    })
  },
)

/**
 * The stored rows of a draft's weeks from the current Monday, each an override at the plan's own
 * target except the weeks in `raised`, which hold the number given.
 */
function overrideRows(draft: PlanDraft, today: string, raised: Record<string, number> = {}) {
  return draft.weeks
    .filter((w) => w.weekStart >= mondayOf(today))
    .map((week, i): PlanWeekRow => {
      const row = {
        ...weekRow(week),
        id: `w${String(i)}`,
        planId: 'plan',
        updatedAt: new Date(0),
      } as PlanWeekRow
      return {
        ...row,
        targetRunMin: raised[week.weekStart] ?? row.baselineRunMin,
        targetSource: 'override',
        overrideNote: 'Synthetic note.',
      }
    })
}

/** What a re-plan makes of the rows: the limits it reads and the write it plans. */
function plan(step: ReplanStep, rows: PlanWeekRow[]) {
  const limits = raisedTargetLimits({
    rows,
    draft: step.draft,
    input: step.input,
    state: estimateState(step.input),
    decidedWeek: null,
  })
  const planned = planWeekWrites(rows, {
    today: step.input.today,
    weeks: step.draft.weeks,
    limits,
  })
  return { limits, planned }
}

describe.each(['half', 'first-100-mile', 'marathon'])(
  'a week target raised by hand along the weekly re-plans of %s',
  (id) => {
    // every fourth Monday of the season: each re-plan reads every week ahead, so all of them are slow
    const steps = replanSteps(id).filter((_, i) => i % 4 === 0)
    const futureWeeks = (step: ReplanStep) =>
      step.draft.weeks.filter(
        (w) => w.weekStart >= mondayOf(step.input.today) && w.targetRunMin > 0,
      )

    it('is lowered to the limit of its week, never under the plan’s own', () => {
      let clipped = 0
      let released = 0
      for (const step of steps) {
        for (const week of futureWeeks(step)) {
          const rows = overrideRows(step.draft, step.input.today, {
            [week.weekStart]: week.targetRunMin * 10 + 1000,
          })
          const { limits, planned } = plan(step, rows)
          const limit = limits.get(week.weekStart)!
          const at = `${week.weekStart} of the plan of ${step.input.today}`
          // The limit of the ramp is the runner's figure; a rule that draws the week gives it back
          // to the plan, whose own figure the week then holds.
          const ownsLimit = limit.kind === 'ceiling' || limit.kind === 'profile'
          expect(limit.max, at).toBeGreaterThanOrEqual(week.targetRunMin)
          expect(planned.targets, at).toEqual([
            {
              weekStart: week.weekStart,
              outcome: 'clipped',
              askedMin: week.targetRunMin * 10 + 1000,
              keptMin: ownsLimit ? limit.max : week.targetRunMin,
              engineMin: week.targetRunMin,
              limit: limit.kind,
              bound: ownsLimit ? limit.bound : 'plan',
              ramp: limit.ramp,
            },
          ])
          const written = planned.updated.find((u) => u.before.weekStart === week.weekStart)
          if (ownsLimit) {
            // the row is written at the limit, with its note and its source
            if (limit.max > week.targetRunMin) {
              expect(written?.data, at).toMatchObject({
                targetRunMin: limit.max,
                targetSource: 'override',
                overrideNote: 'Synthetic note.',
              })
            }
          } else {
            // the row is the plan's own again, as if never raised
            expect(written?.data, at).toMatchObject({
              targetRunMin: week.targetRunMin,
              targetSource: 'baseline',
              overrideNote: null,
            })
            released += 1
          }
          clipped += 1
        }
      }
      expect(clipped).toBeGreaterThan(15)
      expect(released).toBeGreaterThan(0)
    })

    it('is kept as set at the limit and lowered one minute above it', () => {
      let kept = 0
      for (const step of steps) {
        for (const week of futureWeeks(step)) {
          const probe = plan(
            step,
            overrideRows(step.draft, step.input.today, {
              [week.weekStart]: week.targetRunMin * 10 + 1000,
            }),
          ).limits.get(week.weekStart)!
          const at = `${week.weekStart} of the plan of ${step.input.today}`
          const atLimit = plan(
            step,
            overrideRows(step.draft, step.input.today, { [week.weekStart]: probe.max }),
          )
          const over = plan(
            step,
            overrideRows(step.draft, step.input.today, { [week.weekStart]: probe.max + 1 }),
          )
          expect(over.planned.targets, at).toEqual([
            expect.objectContaining({
              outcome: 'clipped',
              askedMin: probe.max + 1,
              keptMin: probe.max,
            }),
          ])
          if (probe.max > week.targetRunMin) {
            // a raised target at the limit is kept, and the row stays as it is
            expect(atLimit.planned.targets, at).toEqual([
              expect.objectContaining({ outcome: 'kept', askedMin: probe.max, keptMin: probe.max }),
            ])
            expect(atLimit.planned.updated, at).toEqual([])
            kept += 1
          } else {
            // a week whose limit is the plan's own figure keeps nothing above it
            expect(atLimit.planned.targets, at).toEqual([])
          }
        }
      }
      expect(kept).toBeGreaterThan(8)
    })

    it('lifts the limit of a later raised week by the minutes it keeps, as run weeks would', () => {
      let lifted = 0
      for (const step of steps) {
        const weeks = futureWeeks(step)
        for (const first of weeks) {
          const second = weeks.find((w) => w.weekStart === addDays(first.weekStart, 14))
          if (second === undefined) continue
          const limitOf = (raised: Record<string, number>) =>
            plan(step, overrideRows(step.draft, step.input.today, raised)).limits
          const alone = limitOf({ [second.weekStart]: second.targetRunMin * 10 + 1000 })
          const firstLimit = limitOf({ [first.weekStart]: first.targetRunMin * 10 + 1000 }).get(
            first.weekStart,
          )!
          const both = limitOf({
            [first.weekStart]: firstLimit.max,
            [second.weekStart]: second.targetRunMin * 10 + 1000,
          })
          expect(both.get(second.weekStart)!.max).toBeGreaterThanOrEqual(
            alone.get(second.weekStart)!.max,
          )
          if (both.get(second.weekStart)!.max > alone.get(second.weekStart)!.max) lifted += 1
        }
      }
      expect(lifted).toBeGreaterThan(0)
    })

    it('is replaced by the plan’s own week when the limits are unknown, as a review’s target is', () => {
      const { draft, input } = steps[1]!
      const raised = Object.fromEntries(draft.weeks.map((w) => [w.weekStart, w.targetRunMin + 50]))
      const rows = overrideRows(draft, input.today, raised)
      const planned = planWeekWrites(rows, { today: input.today, weeks: draft.weeks })
      expect(planned.targets).toEqual([])
      const review = rows.map((row) => ({ ...row, targetSource: 'review' }))
      const limits = raisedTargetLimits({
        rows: review,
        draft,
        input,
        state: estimateState(input),
        decidedWeek: null,
      })
      expect(limits.size).toBe(0)
      const replaced = planWeekWrites(review, { today: input.today, weeks: draft.weeks, limits })
      expect(replaced.targets).toEqual([])
      for (const { before, data } of replaced.updated) {
        expect(data.targetRunMin).toBe(before.baselineRunMin)
        expect(data.targetSource).toBe('baseline')
      }
    })
  },
)

describe('the re-plan on which the low-frequency flag changes the recovery cycle [rules E3, A5]', () => {
  const runningMin = (draft: PlanDraft, weekStart: string): number =>
    draft.sessions
      .filter((s) => s.date >= weekStart && s.date < addDays(weekStart, 7))
      .filter((s) => !['strength', 'race', 'mobility', 'rest'].includes(s.kind))
      .reduce((sum, s) => sum + s.durationMin, 0)

  // `step` is the re-plan on which the flag changes, `flagged` the flag before it and on it
  const cases = [
    {
      name: 'the flag ends: H10 at steady, run as planned',
      first: at(h10(), 'steady'),
      options: { maxSteps: 4 },
      step: 3,
      flagged: [true, false],
    },
    {
      name: 'the flag arms: H3 at standard, every week run 1.6 times its plan',
      first: at(h1(), 'standard'),
      options: { scale: 1.6, maxSteps: 4 },
      step: 2,
      flagged: [false, true],
    },
  ]

  describe.each(cases)('$name', ({ first, options, step, flagged }) => {
    const steps = replanChain(first, options)
    const changed = steps[step]!
    const monday = mondayOf(changed.input.today)
    // the weeks of the plan before the taper: the weeks after the race are recovery weeks of their own
    const weeks = changed.draft.weeks.filter(
      (w) =>
        w.weekStart >= monday && !w.isTaper && w.phase !== 'race' && !w.flags.includes('post-race'),
    )

    it('is the re-plan on which the flag changes, with a recovery week stored on its first Monday', () => {
      expect(
        steps.slice(step - 1, step + 1).map((s) => estimateState(s.input).lowFrequency),
      ).toEqual(flagged)
      const stored = changed.input.existing!.weeks.find((w) => w.weekStart === monday)
      expect(stored?.isRecovery).toBe(true)
    })

    // The cycle changes between 2:1 and 3:1 with the flag, so the recovery weeks `planPhases`
    // counts back from the peak no longer fall on the recovery week the replaced plan stored on the
    // first Monday (task F25a). A re-plan keeps that week a recovery week: it had become a loading
    // week drawn a step above the sequence with the recovery week's sessions, one more loading week
    // for `keepCadenceAcrossReplan` and a forced recovery week after it, and the ramp of the week
    // after that stepped from the minutes of those sessions.
    it('keeps the recovery week the replaced plan stored on its first Monday', () => {
      expect(weeks[0]!.isRecovery).toBe(true)
    })

    it('plans its first week at the minutes it places in it', () => {
      expect(runningMin(changed.draft, monday)).toBe(weeks[0]!.targetRunMin)
    })

    it('plans every loading week after a recovery week above that recovery week', () => {
      let checked = 0
      for (const [i, week] of weeks.entries()) {
        const before = weeks[i - 1]
        if (before?.isRecovery !== true || week.isRecovery) continue
        expect(week.targetRunMin, week.weekStart).toBeGreaterThan(before.targetRunMin)
        checked += 1
      }
      expect(checked).toBeGreaterThan(4)
    })
  })
})

describe('a stored recovery week on the Monday a start path claims [rules E3, E6]', () => {
  // A 2:1 plan made for a runner on 45 minute runs (a 3 x 20 floor start), then three weeks with
  // no run, then a re-plan at 3:1: the count of the new cycle misses the recovery week the plan
  // stored on that Monday, and the runner is after a gap, on the floor.
  const base = scenario([...summer(), ...runWeeks(7, 1, [45])])
  const stored = buildPlan({ ...base, options: { ...base.options, recoveryCycle: '2:1' } })
  const monday = addDays(mondayOf(base.today), 21)
  const input: EngineInput = {
    ...base,
    today: monday,
    options: { ...base.options, recoveryCycle: '3:1' },
    existing: {
      weeks: stored.weeks,
      sessions: stored.sessions.map((s, i) => ({
        ...s,
        id: `s${i}`,
        status: s.date < monday ? 'skipped' : 'planned',
        activityId: null,
      })),
    },
  }

  it('is a floor start on the Monday of a stored recovery week', () => {
    expect(stored.weeks.find((w) => w.weekStart === monday)?.isRecovery).toBe(true)
    expect(startPath(input, afterBreak(estimateState(input)))?.kind).toBe('floor')
  })

  it('opens on the floor week, not on the stored recovery week', () => {
    const opening = replan(input).draft.weeks.find((w) => w.weekStart === monday)
    expect(opening?.flags).toContain('restart-floor')
    expect(opening?.isRecovery).toBe(false)
  })
})
