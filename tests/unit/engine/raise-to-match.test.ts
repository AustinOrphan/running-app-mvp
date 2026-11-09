// The offer to raise the plan to match recent weeks [rule E7]: the condition at its edges, and a
// re-plan that carries the runner's yes. Synthetic runners from the plan matrix; no personal data.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { replan } from '../../../shared/engine/index.ts'
import { plannedMinOf } from '../../../shared/engine/limits.ts'
import { P } from '../../../shared/engine/params/index.ts'
import {
  firstRise,
  isAbovePlan,
  raiseToMatchCheck,
  raiseWeeksOf,
} from '../../../shared/engine/raise.ts'
import type { AthleteState, EngineInput, WeekDraft } from '../../../shared/engine/types.ts'
import type { WeeklyReview } from '../../../shared/types.ts'
import { wellnessDay } from './e8-fixtures.ts'
import { replanSteps } from './replan-steps.ts'

/** The input of the sixth Monday re-plan of a marathon runner who ran every week as planned. */
function baseInput(): EngineInput {
  const steps = replanSteps('marathon', { maxSteps: 6 })
  return steps[steps.length - 1]!.input
}

/**
 * The input with each of the four weeks read stored at `planned` minutes (a plain loading week) and
 * the state with `ran[i]` minutes run in it, so the edges are exact whatever the matrix plan holds.
 */
function scenario(
  ran: readonly number[],
  planned = 300,
  tweak: (input: EngineInput) => EngineInput = (input) => input,
): { input: EngineInput; state: AthleteState } {
  const base = baseInput()
  const weeks = raiseWeeksOf(base.today)
  const edited: EngineInput = {
    ...base,
    existing: {
      ...base.existing!,
      weeks: base.existing!.weeks.map((w) =>
        weeks.includes(w.weekStart)
          ? { ...w, targetRunMin: planned, flags: [], isRecovery: false, isTaper: false }
          : w,
      ),
    },
  }
  const input = tweak(edited)
  const state = estimateState(input)
  return {
    input,
    state: {
      ...state,
      weeks: state.weeks.map((w) => {
        const at = weeks.indexOf(w.weekStart)
        return at === -1 ? w : { ...w, runMin: ran[at]! }
      }),
    },
  }
}

describe('the weeks the offer reads', () => {
  it('are the last four complete weeks, oldest first', () => {
    const today = '2026-12-09'
    expect(raiseWeeksOf(today)).toEqual(['2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30'])
    expect(P.e7.raiseWeeksLooked.value).toBe(4)
    expect(P.e7.raiseWeeksAbove.value).toBe(3)
    expect(P.e7.raiseAbovePlanPct.value).toBe(10)
  })

  it('count a week above plan only when more than 10% over it', () => {
    expect(isAbovePlan(110, 100)).toBe(false)
    expect(isAbovePlan(111, 100)).toBe(true)
    expect(isAbovePlan(100, 0)).toBe(false)
  })
})

describe('the condition', () => {
  it('holds when all four weeks ran above plan', () => {
    const { input, state } = scenario([360, 360, 360, 360])
    const check = raiseToMatchCheck(input, state)
    expect(check).toMatchObject({ met: true, block: null })
    expect(check.aboveWeeks).toHaveLength(4)
  })

  it('holds with 3 of 4 weeks above plan', () => {
    const { input, state } = scenario([360, 300, 360, 360])
    expect(raiseToMatchCheck(input, state)).toMatchObject({ met: true })
  })

  it('does not hold with 2 of 4 weeks above plan', () => {
    const { input, state } = scenario([360, 300, 300, 360])
    const check = raiseToMatchCheck(input, state)
    expect(check).toMatchObject({ met: false, block: 'not-above' })
    expect(check.aboveWeeks).toHaveLength(2)
  })

  it('does not count a week run exactly 10% over, and counts one minute more', () => {
    expect(raiseToMatchCheck(...pair(scenario([330, 330, 330, 330]))).met).toBe(false)
    expect(raiseToMatchCheck(...pair(scenario([331, 331, 331, 300]))).met).toBe(true)
  })

  it('takes a week the plan took as run at the minutes it was planned at', () => {
    const { input, state } = scenario([360, 360, 360, 360], 300, (i) => ({
      ...i,
      existing: {
        ...i.existing!,
        weeks: i.existing!.weeks.map((w) =>
          raiseWeeksOf(i.today).includes(w.weekStart)
            ? { ...w, targetRunMin: 360, flags: ['overshoot', 'planned-300'] }
            : w,
        ),
      },
    }))
    expect(plannedMinOf({ targetRunMin: 360, flags: ['overshoot', 'planned-300'] })).toBe(300)
    expect(raiseToMatchCheck(input, state).met).toBe(true)
  })

  it('does not hold after a week with pain reported', () => {
    const week = raiseWeeksOf(baseInput().today)[1]!
    const { input, state } = scenario([360, 360, 360, 360], 300, (i) => ({
      ...i,
      wellness: [wellnessDay(addDays(week, 2), { painScore: 2 })],
    }))
    expect(raiseToMatchCheck(input, state)).toMatchObject({ met: false, block: 'pain' })
  })

  it('does not hold with a fatigue flag in the weeks (review, or poor check-in days)', () => {
    const week = raiseWeeksOf(baseInput().today)[2]!
    const review = {
      weekStart: week,
      fatigue: P.j5.reviewFatigueDecline.value,
      symptoms: null,
    } as WeeklyReview
    const { input, state } = scenario([360, 360, 360, 360], 300, (i) => ({
      ...i,
      reviews: [review],
    }))
    expect(raiseToMatchCheck(input, state)).toMatchObject({ met: false, block: 'fatigue' })
    const ill = scenario([360, 360, 360, 360], 300, (i) => ({
      ...i,
      wellness: [wellnessDay(addDays(week, 1), { illness: true })],
    }))
    expect(raiseToMatchCheck(ill.input, ill.state)).toMatchObject({ block: 'fatigue' })
  })

  it('does not hold under an active hold (focal bone pain, energy screening)', () => {
    const day = addDays(baseInput().today, -1)
    const bone = scenario([360, 360, 360, 360], 300, (i) => ({
      ...i,
      wellness: [wellnessDay(day, { painFocalBone: true })],
    }))
    expect(raiseToMatchCheck(bone.input, bone.state)).toMatchObject({ met: false, block: 'hold' })
    const reds = scenario([360, 360, 360, 360], 300, (i) => ({
      ...i,
      screeningFlags: P.j5.redsHoldFlags.value,
    }))
    expect(raiseToMatchCheck(reds.input, reds.state)).toMatchObject({ block: 'hold' })
  })

  it('does not hold with a rest window in or after those weeks', () => {
    const start = raiseWeeksOf(baseInput().today)[1]!
    const { input, state } = scenario([360, 360, 360, 360], 300, (i) => ({
      ...i,
      disruptions: [
        {
          id: 'd1',
          reason: 'travel',
          mode: 'rest',
          startDate: start,
          endDate: addDays(start, 2),
          maxRunMin: null,
          pain: null,
          gaitChange: false,
        },
      ],
    }))
    expect(raiseToMatchCheck(input, state)).toMatchObject({ met: false, block: 'disruption' })
  })

  it('does not hold in a taper or the race week', () => {
    const monday = mondayOf(baseInput().today)
    for (const patch of [{ isTaper: true }, { phase: 'race' as const }]) {
      for (const at of [monday, addDays(monday, 7)]) {
        const { input, state } = scenario([360, 360, 360, 360], 300, (i) => ({
          ...i,
          existing: {
            ...i.existing!,
            weeks: i.existing!.weeks.map((w) => (w.weekStart === at ? { ...w, ...patch } : w)),
          },
        }))
        expect(raiseToMatchCheck(input, state), `${JSON.stringify(patch)} ${at}`).toMatchObject({
          met: false,
          block: 'taper',
        })
      }
    }
  })

  it('does not hold without a stored plan', () => {
    const { input, state } = scenario([360, 360, 360, 360], 300, (i) => ({ ...i, existing: null }))
    expect(raiseToMatchCheck(input, state)).toMatchObject({ met: false, block: 'no-plan' })
  })
})

/** A scenario as the two arguments of the check. */
function pair(s: { input: EngineInput; state: AthleteState }): [EngineInput, AthleteState] {
  return [s.input, s.state]
}

describe('a re-plan with the runner’s yes', () => {
  /** A marathon runner who ran 40% above the plan every week for six weeks. */
  function above(): EngineInput {
    const steps = replanSteps('marathon', { scale: 1.4, maxSteps: 6 })
    return steps[steps.length - 1]!.input
  }

  it('leaves a re-plan without the yes exactly as it was', () => {
    const input = above()
    const plain = replan(input).draft
    expect(replan({ ...input, raiseToLevel: false }).draft).toEqual(plain)
  })

  it('lifts the weeks ahead toward the level the recent weeks show, by steps, never lowering one', () => {
    const input = above()
    const before = replan(input).draft
    const raised = replan({ ...input, raiseToLevel: true }).draft
    const level = estimateState(input)
    const monday = mondayOf(input.today)
    const weeksOf = (weeks: WeekDraft[]) => weeks.filter((w) => w.weekStart >= monday)
    const was = new Map(weeksOf(before.weeks).map((w) => [w.weekStart, w.targetRunMin]))
    const lifted = weeksOf(raised.weeks).filter((w) => w.targetRunMin > (was.get(w.weekStart) ?? 0))
    expect(lifted.length).toBeGreaterThan(0)
    for (const w of weeksOf(raised.weeks)) {
      expect(w.targetRunMin).toBeGreaterThanOrEqual(was.get(w.weekStart) ?? 0)
      // the level a new plan reads from these weeks is the most a loading week is lifted to
      if (!w.isTaper && w.phase !== 'race') {
        expect(w.targetRunMin).toBeLessThanOrEqual(
          Math.max(P.peakWeeklyMin.marathon.value, level.typicalWeekMin, level.recentWeekMin),
        )
      }
    }
    // the draft passes every item of the quality checklist, the progression limits included
    expect(raised.checklist.filter((item) => !item.ok)).toEqual([])
    const rise = firstRise(input.existing!.weeks, raised.weeks, input.today)
    expect(rise).not.toBeNull()
    expect(rise!.toMin).toBeGreaterThan(rise!.fromMin)
  })

  it('does not step a week past the soft step above the week before it', () => {
    const input = above()
    const raised = replan({ ...input, raiseToLevel: true }).draft
    const loading = raised.weeks.filter((w) => !w.isRecovery && !w.isTaper && w.phase !== 'race')
    for (let i = 1; i < loading.length; i += 1) {
      const prev = loading[i - 1]!
      if (prev.weekStart < mondayOf(input.today)) continue
      expect(loading[i]!.targetRunMin).toBeLessThanOrEqual(
        Math.floor(prev.targetRunMin * (1 + P.g2.rampSoft.value) + 1),
      )
    }
  })

  it('lifts nothing under a hold', () => {
    const input = above()
    const held: EngineInput = {
      ...input,
      wellness: [wellnessDay(addDays(input.today, -1), { painFocalBone: true })],
    }
    expect(replan({ ...held, raiseToLevel: true }).draft.weeks).toEqual(replan(held).draft.weeks)
  })

  it('finds no rise when the plan already holds the level', () => {
    const input = above()
    const raised = replan({ ...input, raiseToLevel: true }).draft
    expect(firstRise(raised.weeks, raised.weeks, input.today)).toBeNull()
  })
})
