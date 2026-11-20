// A loading week run far under its target counts as the cycle's recovery week; the week after it
// repeats the loading week and the cycle shifts [rules E3, G-6, J7; owner decision 2026-11-15].
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lintText } from '../../../shared/copy/lint.ts'
import { BREAK_REPEAT_FOCUS, BREAK_SIGNAL_DETAIL } from '../../../shared/copy/breakWeek.ts'
import { breakRepeatSummary } from '../../../shared/copy/revision.ts'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { hasHeatHold, isHeatOnlyHold, weeklyDecision } from '../../../shared/engine/adapt.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { BREAK_REPEAT_FLAG, breakPartWeeks, breakWeekOf } from '../../../shared/engine/breakWeek.ts'
import { buildPlan, replan, weeklyRamp } from '../../../shared/engine/index.ts'
import { runningMinutes } from '../../../shared/engine/limits.ts'
import { rebuildZone } from '../../../shared/engine/loadSetting.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type {
  DisruptionWindow,
  EngineInput,
  PlanDraft,
  WeekDraft,
  WeeklyDecision,
} from '../../../shared/engine/types.ts'
import { activity } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'

const half = athletes().find((a) => a.id === 'half')!
const plan: PlanDraft = buildPlan(half.input)
const NOT_RUNS = new Set(['strength', 'mobility', 'rest', 'cross', 'race'])

/** The first recovery week that has a loading week, run from the plan's start, before it. */
const recovery = plan.weeks.find((w, i) => i >= 1 && w.isRecovery && !w.isTaper)!
const MONDAY = recovery.weekStart
const LAST = addDays(MONDAY, -7)
const lastWeek = plan.weeks.find((w) => w.weekStart === LAST)!

/**
 * The input of the Monday re-plan: every week of the plan before `LAST` run as planned, `LAST` run
 * at `share` of its target (a part of each session), and the plan stored as it stands.
 */
function scenario(
  share: number,
  over: Partial<EngineInput> = {},
  weeks: WeekDraft[] = plan.weeks,
): EngineInput {
  const runs = plan.sessions
    .filter((s) => !NOT_RUNS.has(s.kind) && s.durationMin > 0 && s.date < MONDAY)
    .map((s, i) => {
      const part = mondayOf(s.date) === LAST ? share : 1
      return activity(s.date, {
        id: `run-${String(i)}`,
        durationSec: Math.round(s.durationMin * 60 * part),
        tempC: 12,
      })
    })
  return {
    ...half.input,
    today: MONDAY,
    activities: [...half.input.activities, ...runs],
    existing: {
      weeks,
      sessions: plan.sessions.map((s, i) => ({
        ...s,
        id: `s${String(i)}`,
        status: s.date < MONDAY ? 'completed' : 'planned',
        activityId: null,
      })),
    },
    ...over,
  }
}

function decide(input: EngineInput): WeeklyDecision {
  const state = estimateState(input)
  return weeklyDecision(input, LAST, {
    ramp: weeklyRamp(state),
    rebuild: rebuildZone(input, state),
  })
}

/** The Monday re-plan as the service runs it: the decision caps the week and carries the repeat. */
function weeklyReplan(input: EngineInput) {
  const d = decide(input)
  const caps =
    d.decision === 'progress' && d.breakRepeat === undefined
      ? {}
      : { [MONDAY]: d.nextWeekTargetMin }
  const out = replan(
    {
      ...input,
      weekCaps: caps,
      ...(d.breakRepeat === undefined ? {} : { breakWeek: d.breakRepeat }),
    },
    { decisions: d.decision === 'progress' ? {} : { [MONDAY]: d.decision } },
  )
  return { d, ...out }
}

const weekOf = (draft: PlanDraft, weekStart: string) =>
  draft.weeks.find((w) => w.weekStart === weekStart)!
const recoveryWeeks = (draft: PlanDraft, from: string) =>
  draft.weeks
    .filter((w) => w.weekStart >= from && w.isRecovery && !w.isTaper)
    .map((w) => w.weekStart)

describe('the plan used here', () => {
  it('has a loading week before a scheduled recovery week, and weeks after it', () => {
    expect(lastWeek.isRecovery).toBe(false)
    expect(lastWeek.targetRunMin).toBeGreaterThan(0)
    expect(plan.weeks.some((w) => w.weekStart > MONDAY && w.isTaper)).toBe(true)
  })
})

describe('the decision of a week run far under its target', () => {
  it('counts a loading week run at 28% as the recovery week, with the J7 cap of the planned week', () => {
    const d = decide(scenario(0.28))
    expect(d.breakRepeat).toMatchObject({ weekStart: LAST, plannedMin: lastWeek.targetRunMin })
    // under 7 days since the last run: 100% of the planned week, not 1.1 times the minutes run
    expect(d.nextWeekTargetMin).toBe(lastWeek.targetRunMin)
    expect(d.signals.map((s) => s.code)).toContain('break-recovery')
    expect(d.signals.map((s) => s.code)).not.toContain('completion-low')
    expect(d.decision).toBe('progress')
  })

  it('reads a week at 85% as before: no repeat, the completion rules untouched', () => {
    const d = decide(scenario(0.85))
    expect(d.breakRepeat).toBeUndefined()
    expect(d.signals.map((s) => s.code)).not.toContain('break-recovery')
  })

  it('keeps the hold and the step of G-6 for a week between the share and 80%', () => {
    const d = decide(scenario(0.6))
    expect(d.breakRepeat).toBeUndefined()
    expect(d.decision).toBe('hold')
    expect(d.signals.map((s) => s.code)).toEqual(['completion-low'])
    const ran = Math.round(lastWeek.targetRunMin * 0.6)
    expect(d.nextWeekTargetMin).toBeLessThanOrEqual(Math.ceil(ran * 1.15))
  })

  it('counts a week at the share and not one minute over it', () => {
    const input = scenario(1)
    const week = input.existing!.weeks.find((w) => w.weekStart === LAST)!
    const limit = week.targetRunMin * P.e3.breakWeekMaxShare.value
    expect(breakWeekOf(input, LAST, limit, 3)).not.toBeNull()
    expect(breakWeekOf(input, LAST, limit + 1, 3)).toBeNull()
  })

  it('leaves a week with no running to RF1', () => {
    const d = decide(scenario(0))
    expect(d.breakRepeat).toBeUndefined()
    expect(d.signals.map((s) => s.code)).toContain('completion-low')
    expect(d.nextWeekTargetMin).toBeGreaterThan(0)
  })

  it('leaves a week with a rest window to J9 and J7', () => {
    const window: DisruptionWindow = {
      id: 'w1',
      reason: 'travel',
      mode: 'limited',
      startDate: addDays(LAST, 2),
      endDate: addDays(LAST, 4),
      maxRunMin: 20,
      pain: null,
      gaitChange: false,
    }
    const d = decide(scenario(0.28, { disruptions: [window] }))
    expect(d.breakRepeat).toBeUndefined()
    expect(d.signals.map((s) => s.code)).toEqual(['disruption'])
  })

  it('leaves illness and pain at the flag score to the rules that read them', () => {
    const checkin = (over: object) => ({
      date: addDays(LAST, 2),
      fatigue: null,
      soreness: null,
      sleepQuality: null,
      mood: null,
      stress: null,
      illness: false,
      painScore: null,
      painArea: null,
      painFocalBone: false,
      ...over,
    })
    const ill = decide(scenario(0.28, { wellness: [checkin({ illness: true })] as never }))
    expect(ill.breakRepeat).toBeUndefined()
    expect(ill.signals.map((s) => s.code)).toContain('illness')
    const pain = decide(
      scenario(0.28, { wellness: [checkin({ painScore: P.pain.flagScore.value })] as never }),
    )
    expect(pain.breakRepeat).toBeUndefined()
    expect(pain.signals.map((s) => s.code)).toContain('pain')
    // a mild pain keeps its own hold beside the repeat
    const mild = decide(scenario(0.28, { wellness: [checkin({ painScore: 1 })] as never }))
    expect(mild.breakRepeat).toBeDefined()
    expect(mild.decision).toBe('hold')
    expect(mild.signals.map((s) => s.code)).toEqual(['break-recovery', 'pain-mild'])
  })

  it('does not count the week that was itself a repeat, nor a recovery or a taper week', () => {
    const flagged = plan.weeks.map((w) =>
      w.weekStart === LAST ? { ...w, flags: [...w.flags, BREAK_REPEAT_FLAG] } : w,
    )
    expect(decide(scenario(0.28, {}, flagged)).breakRepeat).toBeUndefined()
    const asRecovery = plan.weeks.map((w) =>
      w.weekStart === LAST ? { ...w, isRecovery: true } : w,
    )
    expect(decide(scenario(0.28, {}, asRecovery)).breakRepeat).toBeUndefined()
  })

  it('words the signal and the summary without a G5 hit', () => {
    expect(lintText(BREAK_SIGNAL_DETAIL)).toEqual([])
    expect(lintText(BREAK_REPEAT_FOCUS)).toEqual([])
    const summary = breakRepeatSummary(132)
    expect(lintText(summary)).toEqual([])
    expect(summary).toBe(
      'Last week counts as the recovery week; this week repeats the loading week, up to 2.2 h.',
    )
  })
})

describe('the re-plan after a week that counts as the recovery week', () => {
  const owner = weeklyReplan(scenario(0.28))
  const normal = replan(scenario(1))
  const repeat = weekOf(owner.draft, MONDAY)
  // a plan with no break, re-planned the same Monday: the scheduled recovery week stands
  const recoveryTarget = weekOf(normal.draft, MONDAY)

  it('is the loading week the plan had, no longer a recovery week', () => {
    expect(recoveryTarget.isRecovery).toBe(true)
    expect(repeat.isRecovery).toBe(false)
    expect(repeat.flags).toContain(BREAK_REPEAT_FLAG)
    expect(repeat.flags).not.toContain('recovery')
    expect(repeat.focus).toBe(BREAK_REPEAT_FOCUS)
    expect(repeat.targetRunMin).toBe(lastWeek.targetRunMin)
    // the long run is the week's own, held by G-1 to the 30-day reference, which the short week
    // did not extend: never above the long run the loading week was planned with
    expect(repeat.longRunMin).toBeGreaterThan(0)
    expect(repeat.longRunMin).toBeLessThanOrEqual(lastWeek.longRunMin)
    // its sessions are placed as a loading week's
    const sessions = owner.draft.sessions.filter(
      (s) => mondayOf(s.date) === MONDAY && !NOT_RUNS.has(s.kind),
    )
    const placed = sessions.reduce((n, s) => n + s.durationMin, 0)
    expect(placed).toBeGreaterThan(recoveryTarget.targetRunMin)
    expect(placed).toBeLessThanOrEqual(repeat.targetRunMin)
  })

  it('steps up from the repeat and puts the next recovery week after three loading weeks', () => {
    const next = weekOf(owner.draft, addDays(MONDAY, 7))
    expect(next.targetRunMin).toBeGreaterThan(repeat.targetRunMin)
    expect(next.isRecovery).toBe(false)
    const first = recoveryWeeks(owner.draft, MONDAY)[0]
    expect(first).toBe(addDays(MONDAY, 21))
    // the plan the Monday would have had put its next recovery week four weeks after the first
    expect(recoveryWeeks(normal.draft, addDays(MONDAY, 7))[0]).toBe(addDays(MONDAY, 28))
    const ofPlan = (x: WeekDraft) =>
      x.weekStart >= MONDAY &&
      x.isRecovery &&
      !x.isTaper &&
      x.phase !== 'race' &&
      !x.flags.includes('post-race')
    for (const w of owner.draft.weeks.filter(ofPlan)) {
      const before = owner.draft.weeks.find((x) => x.weekStart === addDays(w.weekStart, -7))!
      expect(w.targetRunMin).toBeLessThanOrEqual(before.targetRunMin)
    }
  })

  it('never moves the race or the taper, and keeps the peak a work week', () => {
    const tapers = (draft: PlanDraft) =>
      draft.weeks
        .filter((w) => w.isTaper || w.phase === 'race')
        .map((w) => `${w.weekStart}:${w.phase}`)
    expect(tapers(owner.draft)).toEqual(tapers(normal.draft))
    const peak = [...owner.draft.weeks].filter((w) => !w.isTaper && w.phase !== 'race').at(-1)!
    expect(peak.isRecovery).toBe(false)
    expect(peak.flags).toContain('peak')
    // the race week keeps its own row
    expect(owner.draft.sessions.filter((s) => s.kind === 'race').map((s) => s.date)).toEqual(
      normal.draft.sessions.filter((s) => s.kind === 'race').map((s) => s.date),
    )
  })

  it('stays inside the limits: the checklist passes and no loading run exceeds G-1', () => {
    expect(owner.draft.checklist.filter((c) => !c.ok)).toEqual([])
    expect(owner.draft.warnings.map((w) => w.code)).not.toContain('spike-run-dropped')
  })

  it('shifts the cycle again at the next re-plan, counting from the stored repeat', () => {
    const stored = owner.draft.weeks
    const later = addDays(MONDAY, 7)
    const input = scenario(1, { today: later }, stored)
    // the repeat week is run as planned, the week after it is the one now in progress
    const again = replan({
      ...input,
      activities: [
        ...input.activities,
        ...owner.draft.sessions
          .filter((s) => mondayOf(s.date) === MONDAY && !NOT_RUNS.has(s.kind))
          .map((s, i) =>
            activity(s.date, { id: `rep-${String(i)}`, durationSec: s.durationMin * 60 }),
          ),
      ],
    })
    expect(recoveryWeeks(again.draft, later)[0]).toBe(addDays(MONDAY, 21))
  })

  it('reads a scheduled loading week after the short one the same way', () => {
    // the short week sits one week earlier: the week after it is a loading week of the plan
    const earlier = plan.weeks.find(
      (w, i) => i >= 3 && !w.isRecovery && !w.isTaper && plan.weeks[i + 1]?.isRecovery === false,
    )!
    const monday = addDays(earlier.weekStart, 7)
    const input = scenario(1)
    const runs = plan.sessions
      .filter((s) => !NOT_RUNS.has(s.kind) && s.date < monday)
      .map((s, i) =>
        activity(s.date, {
          id: `r-${String(i)}`,
          durationSec: Math.round(
            s.durationMin * 60 * (mondayOf(s.date) === earlier.weekStart ? 0.3 : 1),
          ),
        }),
      )
    const base: EngineInput = {
      ...input,
      today: monday,
      activities: [...half.input.activities, ...runs],
    }
    const state = estimateState(base)
    const d = weeklyDecision(base, earlier.weekStart, {
      ramp: weeklyRamp(state),
      rebuild: rebuildZone(base, state),
    })
    expect(d.breakRepeat?.plannedMin).toBe(earlier.targetRunMin)
    const out = replan(
      { ...base, weekCaps: { [monday]: d.nextWeekTargetMin }, breakWeek: d.breakRepeat! },
      { decisions: {} },
    )
    const week = weekOf(out.draft, monday)
    expect(week.flags).toContain(BREAK_REPEAT_FLAG)
    expect(week.targetRunMin).toBeLessThanOrEqual(earlier.targetRunMin)
    expect(week.targetRunMin).toBeGreaterThan(0)
    expect(out.draft.checklist.filter((c) => !c.ok)).toEqual([])
  })
})

describe('the guards of the repeat', () => {
  it('leaves the first hot days to their own hold: no repeat beside the heat', () => {
    const state = estimateState(scenario(0.28))
    const d = weeklyDecision(scenario(0.28), LAST, {
      ramp: weeklyRamp(state),
      rebuild: rebuildZone(scenario(0.28), state),
      heatFirstDays: true,
    })
    expect(d.breakRepeat).toBeUndefined()
    expect(d.signals.map((s) => s.code)).toContain('heat')
  })

  it('does not announce a repeat when the next week is the taper, a race week or none', () => {
    const asTaper = plan.weeks.map((w) =>
      w.weekStart === MONDAY ? { ...w, isTaper: true, phase: 'taper' as const } : w,
    )
    expect(decide(scenario(0.28, {}, asTaper)).breakRepeat).toBeUndefined()
    const asRace = plan.weeks.map((w) =>
      w.weekStart === MONDAY ? { ...w, phase: 'race' as const } : w,
    )
    expect(decide(scenario(0.28, {}, asRace)).breakRepeat).toBeUndefined()
    expect(
      decide(
        scenario(
          0.28,
          {},
          plan.weeks.filter((w) => w.weekStart !== MONDAY),
        ),
      ).breakRepeat,
    ).toBeUndefined()
  })

  it('reads heat-only holds past the break signal', () => {
    const signal = (code: string) => ({ code, detail: '', rules: [] })
    expect(
      isHeatOnlyHold({ decision: 'hold', signals: [signal('break-recovery'), signal('heat')] }),
    ).toBe(true)
    expect(isHeatOnlyHold({ decision: 'hold', signals: [signal('break-recovery')] })).toBe(false)
  })
})

describe('a week at 85% of its target re-plans as before', () => {
  it('draws the same plan with and without the decision', () => {
    const input = scenario(0.85)
    const withDecision = weeklyReplan(input)
    expect(withDecision.d.breakRepeat).toBeUndefined()
    expect(weekOf(withDecision.draft, MONDAY).flags).not.toContain(BREAK_REPEAT_FLAG)
    expect(weekOf(withDecision.draft, MONDAY).isRecovery).toBe(true)
  })
})

describe('breakPartWeeks', () => {
  const short = '2026-03-02'
  const repeat = addDays(short, 7)
  const week = (weekStart: string, flags: string[]): WeekDraft => ({
    ...lastWeek,
    weekStart,
    flags,
  })
  const stored = (...weeks: WeekDraft[]): Pick<EngineInput, 'breakWeek' | 'existing'> => ({
    existing: { weeks, sessions: [] },
  })
  const breakWeek = { weekStart: short, plannedMin: 400, ranMin: 100, capMin: 400 }

  it('holds the short week the input names while it lies before the Monday', () => {
    expect(breakPartWeeks({ breakWeek, existing: null }, repeat)).toEqual([short])
    expect(breakPartWeeks({ breakWeek, existing: null }, short)).toEqual([])
  })

  it('holds the week before a stored break-repeat week, whatever the input says', () => {
    const input = stored(week(short, []), week(repeat, [BREAK_REPEAT_FLAG]))
    expect(breakPartWeeks(input, addDays(repeat, 7))).toEqual([short])
    expect(breakPartWeeks(input, repeat)).toEqual([short])
  })

  it('lists the short week once when the input and the stored flag agree', () => {
    const input = { breakWeek, ...stored(week(repeat, [BREAK_REPEAT_FLAG])) }
    expect(breakPartWeeks(input, addDays(repeat, 7))).toEqual([short])
  })

  it('leaves out a flagged week after the Monday', () => {
    expect(breakPartWeeks(stored(week(repeat, [BREAK_REPEAT_FLAG])), short)).toEqual([])
  })

  it('is empty with no flag and no break week', () => {
    expect(breakPartWeeks(stored(week(short, []), week(repeat, [])), repeat)).toEqual([])
    expect(breakPartWeeks({ existing: null }, repeat)).toEqual([])
  })
})

describe('the engine sets the break-repeat flag in one place', () => {
  it('has one flag(..., BREAK_REPEAT_FLAG) call, the one breakPartWeeks relies on', () => {
    const dir = join(process.cwd(), 'shared/engine')
    const calls = readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts'))
      .map((f) => [
        f,
        readFileSync(join(dir, f), 'utf8').match(/\bflag\([^)]*BREAK_REPEAT_FLAG\)/g),
      ])
      .filter(([, m]) => m !== null)
      .map(([f, m]) => [f, (m as string[]).length])
    expect(calls).toEqual([['macro.ts', 1]])
  })
})

describe('the week after a repeat, over the weekly chain', () => {
  const mile = athletes().find((a) => a.id === 'first-100-mile')!
  const placedMin = (draft: PlanDraft, w: WeekDraft) =>
    runningMinutes(
      draft.sessions.filter((s) => s.date >= w.weekStart && s.date < addDays(w.weekStart, 7)),
    )

  /**
   * Weekly re-plans as the service runs them: each Monday the week just run is decided, its figure
   * caps the new week and a repeat travels as `breakWeek`. The week before step `shortAt` is run at
   * 30% of its plan, every other week as planned.
   */
  function chain(shortAt: number, steps: number, start: EngineInput = mile.input) {
    let draft = buildPlan(start)
    let activities = start.activities
    const out: { monday: string; draft: PlanDraft }[] = []
    for (let k = 1; k <= steps; k++) {
      const monday = addDays(mondayOf(start.today), 7 * k)
      const factor = k === shortAt ? 0.3 : 1
      const ran = draft.sessions
        .filter((s) => s.date >= addDays(monday, -7) && s.date < monday)
        .filter((s) => !NOT_RUNS.has(s.kind))
        .map((s) =>
          activity(s.date, {
            id: `done-${s.date}-${String(s.order)}`,
            durationSec: Math.round(s.durationMin * factor) * 60,
            distanceM: Math.round((s.distanceM ?? s.durationMin * 170) * factor),
          }),
        )
      activities = [...activities, ...ran]
      const input: EngineInput = {
        ...start,
        today: monday,
        activities,
        existing: {
          weeks: draft.weeks,
          sessions: draft.sessions.map((s, i) => ({
            ...s,
            id: `s${String(i)}`,
            status: s.date < monday ? 'completed' : 'planned',
            activityId: null,
          })),
        },
      }
      const state = estimateState(input)
      const decision = weeklyDecision(input, addDays(monday, -7), {
        executions: [],
        redsFlags: input.screeningFlags,
        ramp: weeklyRamp(state),
        rebuild: rebuildZone(input, state),
      })
      const decided = decision.decision !== 'progress'
      const caps =
        decided || decision.breakRepeat !== undefined
          ? { [monday]: decision.nextWeekTargetMin }
          : {}
      draft = replan(
        {
          ...input,
          weekCaps: caps,
          ...(decision.breakRepeat === undefined ? {} : { breakWeek: decision.breakRepeat }),
        },
        {
          decisions: decided ? { [monday]: decision.decision } : {},
          heatHeld: decided && hasHeatHold(decision) ? [monday] : [],
          heatAlone: decided && isHeatOnlyHold(decision) ? [monday] : [],
        },
      ).draft
      out.push({ monday, draft })
    }
    return out
  }

  const SHORT_AT = 5
  const steps = chain(SHORT_AT, 6)
  const stepBefore = steps[SHORT_AT - 2]!
  const repeatStep = steps[SHORT_AT - 1]!
  const nextStep = steps[SHORT_AT]!

  it('draws the repeat at the Monday after the short week', () => {
    expect(weekOf(repeatStep.draft, repeatStep.monday).flags).toContain(BREAK_REPEAT_FLAG)
  })

  it('places the week after the repeat at 80% or more of its target', () => {
    const after = weekOf(repeatStep.draft, addDays(repeatStep.monday, 7))
    expect(after.targetRunMin).toBeGreaterThan(0)
    expect(placedMin(repeatStep.draft, after)).toBeGreaterThanOrEqual(0.8 * after.targetRunMin)
  })

  it('raises no ramp-ceiling warning on the week after the repeat', () => {
    const after = addDays(repeatStep.monday, 7)
    const ceilings = repeatStep.draft.warnings.filter(
      (w) => w.code === 'ramp-ceiling' && w.message.includes(`week of ${after}`),
    )
    expect(ceilings).toEqual([])
  })

  it('keeps the next four loading weeks at 80% or more of the earlier plan at the next Monday', () => {
    const weeks = nextStep.draft.weeks
      .filter((w) => w.weekStart >= nextStep.monday && !w.isRecovery && !w.isTaper)
      .filter((w) => w.phase !== 'race')
      .slice(0, 4)
    expect(weeks).toHaveLength(4)
    for (const w of weeks) {
      const was = stepBefore.draft.weeks.find((x) => x.weekStart === w.weekStart)!
      expect(w.targetRunMin, w.weekStart).toBeGreaterThanOrEqual(0.8 * was.targetRunMin)
    }
  })

  /** The next four loading weeks of a step 6 draft, placed against their own targets. */
  const placedShort = (step: { monday: string; draft: PlanDraft }) =>
    step.draft.weeks
      .filter(
        (w) => w.weekStart >= step.monday && !w.isRecovery && !w.isTaper && w.phase !== 'race',
      )
      .slice(0, 4)
      .filter((w) => placedMin(step.draft, w) < 0.8 * w.targetRunMin)
      .map(
        (w) => `${w.weekStart}: ${String(placedMin(step.draft, w))} of ${String(w.targetRunMin)}`,
      )

  // `input.breakWeek` is unset from here on: the short week is known from the stored flag alone.
  it('places the next four loading weeks at 80% or more of their targets at the next Monday', () => {
    expect(placedShort(nextStep)).toEqual([])
  })

  it('passes the progression check and the ramp warnings at the next Monday', () => {
    expect(nextStep.draft.checklist.find((c) => c.id === 'progression')?.ok).toBe(true)
    const ramp = nextStep.draft.warnings.filter((w) => w.code.startsWith('ramp'))
    expect(ramp).toEqual([])
  })

  it('places them at 80% or more with a rest window further on, which bounds the weeks again', () => {
    const base = mile.input
    const from = addDays(mondayOf(base.today), 7 * 8 + 1)
    const window: DisruptionWindow = {
      id: 'w1',
      reason: 'travel',
      mode: 'limited',
      startDate: from,
      endDate: addDays(from, 2),
      maxRunMin: 20,
      pain: null,
      gaitChange: false,
    }
    const windowed = chain(SHORT_AT, SHORT_AT + 1, { ...base, disruptions: [window] })
    expect(placedShort(windowed[SHORT_AT]!)).toEqual([])
  })
})
