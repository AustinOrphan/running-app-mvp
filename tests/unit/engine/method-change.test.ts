// The shape of a plan week across re-plans [rules P1 to P4, follow-up 27, methods proposal 4.5 and
// decision 8]: a week is drawn under one shape and keeps it; a change of the shape in effect between
// two re-plans (the runner's change of method, a persistent hold ending, a novice's start days) reaches
// the weeks after the current one, and the current week is drawn again under the shape it has. A hold
// that starts is a condition of the runner and applies at once, which the chain below shows too.
// Season chains: a Monday re-plan every week to the race, each week run exactly as planned.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { resolveMethod } from '../../../shared/engine/methods.ts'
import { shapeFlag, shapeOfFlags, withShape } from '../../../shared/engine/shape.ts'
import type { EngineInput, PlanDraft, PresetId, SessionKind } from '../../../shared/engine/types.ts'
import { activity, wellnessDay } from './e8-fixtures.ts'
import { athletes } from './matrix-fixtures.ts'
import { aboveDefault } from './method-fixtures.ts'

const NOT_RUNS: ReadonlySet<SessionKind> = new Set<SessionKind>([
  'strength',
  'race',
  'mobility',
  'rest',
  'cross',
  'hike',
])

/** The activities of the sessions of `draft` dated from `from` up to, not including, `to`. */
function ran(draft: PlanDraft, from: string, to: string) {
  return draft.sessions
    .filter((s) => s.date >= from && s.date < to && !NOT_RUNS.has(s.kind))
    .map((s) =>
      activity(s.date, {
        id: `done-${s.date}-${String(s.order)}`,
        durationSec: s.durationMin * 60,
        distanceM: s.distanceM ?? s.durationMin * 170,
      }),
    )
}

/** The stored plan of a draft on `today`: what is dated before it was run, the rest is planned. */
function stored(draft: PlanDraft, today: string): NonNullable<EngineInput['existing']> {
  return {
    weeks: draft.weeks,
    sessions: draft.sessions.map((s, i) => ({
      ...s,
      id: `s${String(i)}`,
      status: s.date < today ? 'completed' : 'planned',
      activityId: null,
    })),
  }
}

interface Step {
  monday: string
  input: EngineInput
  draft: PlanDraft
  heldWeek: string | null
}

interface Season {
  options?: (step: number) => EngineInput['options']
  /** Check-ins added to the athlete's own, by step. */
  wellness?: (step: number, monday: string) => EngineInput['wellness']
  /** Stop after this many re-plans (default: the race week). */
  until?: number
}

/** Where a chain stands between two Mondays: the plan in force, what was run and the next Monday. */
interface Resume {
  draft: PlanDraft
  activities: EngineInput['activities']
  wellness: EngineInput['wellness']
  next: string
}

const half = athletes().find((a) => a.id === 'half')!

/**
 * A Monday re-plan every week from `from` (the first plan of `first` when absent) to the race week,
 * each week run exactly as planned. `step` counts from 1 at the first Monday of the chain.
 */
function season(
  first: EngineInput,
  rules: Season = {},
  from?: Resume,
): { plan: PlanDraft; steps: Step[] } {
  const plan = from?.draft ?? buildPlan(first)
  let draft = plan
  let activities = from?.activities ?? first.activities
  let wellness = from?.wellness ?? first.wellness
  const steps: Step[] = []
  const race = mondayOf(first.goal.date)
  let step = 1
  for (
    let monday = from?.next ?? addDays(mondayOf(first.today), 7);
    monday <= race && step <= (rules.until ?? Infinity);
    monday = addDays(monday, 7)
  ) {
    activities = [...activities, ...ran(draft, addDays(monday, -7), monday)]
    wellness = [...wellness, ...(rules.wellness?.(step, monday) ?? [])]
    const input: EngineInput = {
      ...first,
      options: rules.options?.(step) ?? first.options,
      today: monday,
      activities,
      wellness,
      existing: stored(draft, monday),
    }
    const out = replan(input)
    draft = out.draft
    steps.push({ monday, input, draft, heldWeek: out.heldWeek })
    step += 1
  }
  return { plan, steps }
}

const withMethod = (input: EngineInput, method: PresetId | undefined): EngineInput => ({
  ...input,
  options: { ...input.options, ...(method === undefined ? {} : { method }) },
})

const runDaysOf = (draft: PlanDraft, monday: string): number =>
  new Set(
    draft.sessions
      .filter((s) => s.date >= monday && s.date < addDays(monday, 7) && !NOT_RUNS.has(s.kind))
      .map((s) => s.date),
  ).size

const shapeOf = (draft: PlanDraft, monday: string): PresetId =>
  shapeOfFlags(draft.weeks.find((w) => w.weekStart === monday)!.flags)

const failed = (draft: PlanDraft): string[] => draft.checklist.filter((c) => !c.ok).map((c) => c.id)

const ISO = /\d{4}-\d{2}-\d{2}/g
const AGGREGATE = /^\d+ week\(s\), from the week of /

/** The warnings of a draft about the week of `monday`: their message names a day of it as a date. */
const weekWarnings = (draft: PlanDraft, monday: string): string[] =>
  draft.warnings
    .filter(
      (w) =>
        !AGGREGATE.test(w.message) &&
        (w.message.match(ISO) ?? []).some((d) => d >= monday && d <= addDays(monday, 6)),
    )
    .map((w) => `${w.code}|${w.message}`)

/**
 * The default plan of the input of a step, the plan G6 holds every re-plan to. The stored weeks of a
 * preset's chain carry the shape flag, which a re-plan reads as the shape the current week was drawn
 * under; the default plan of the same weeks is drawn without it.
 */
function defaultOn(input: EngineInput): PlanDraft {
  const stored = input.existing
  return replan({
    ...input,
    options: { ...input.options, method: 'default' },
    existing:
      stored === null
        ? null
        : { ...stored, weeks: stored.weeks.map((week) => withShape(week, 'default')) },
  }).draft
}

describe('the shape flag of a week', () => {
  it('is written for a preset, never for the plan’s own shape, and read back', () => {
    expect(shapeFlag('default')).toBeNull()
    expect(shapeFlag('three-run-days')).toBe('shape-three-run-days')
    expect(shapeOfFlags(['peak', 'shape-longer-base'])).toBe('longer-base')
    expect(shapeOfFlags(['peak'])).toBe('default')
    // a flag that names no preset, or the default itself, is no shape
    expect(shapeOfFlags(['shape-shorter-long-run', 'shape-default', 'shape-'])).toBe('default')
  })

  it('replaces another shape flag, and leaves a week with none as it is', () => {
    const week = { flags: ['recovery', 'shape-three-run-days'] }
    expect(withShape(week, 'longer-base').flags).toEqual(['recovery', 'shape-longer-base'])
    expect(withShape(week, 'default').flags).toEqual(['recovery'])
    const own = { flags: ['peak'] }
    expect(withShape(own, 'default')).toBe(own)
  })

  it('is on every week a preset draws but a start programme’s, and on none of the default plan', () => {
    const preset = buildPlan(withMethod(half.input, 'three-run-days'))
    expect(preset.weeks.every((w) => shapeOfFlags(w.flags) === 'three-run-days')).toBe(true)
    const own = buildPlan(half.input)
    expect(own.weeks.every((w) => !w.flags.some((f) => f.startsWith('shape-')))).toBe(true)
    // the athlete with a start path keeps the programme's weeks untouched
    const ladder = athletes().find((a) => a.id === 'post-marathon-short-run')!
    const plan = buildPlan(withMethod(ladder.input, 'longer-base'))
    const programme = plan.weeks.filter((w) => w.flags.some((f) => /^ladder-/.test(f)))
    expect(programme.length).toBeGreaterThan(0)
    expect(programme.every((w) => shapeOfFlags(w.flags) === 'default')).toBe(true)
  })

  it('does not change the default plan: a re-plan of it never holds a week', () => {
    const { steps } = season(half.input)
    expect(steps.length).toBeGreaterThan(10)
    expect(steps.every((s) => s.heldWeek === null)).toBe(true)
    expect(steps.every((s) => failed(s.draft).length === 0)).toBe(true)
  })
})

describe('a persistent hold that starts and ends between weekly re-plans [follow-up 27]', () => {
  // A check-in at the end of week 5 reports focal bone pain (a persistent hold: the preset reads as
  // the plan's own shape, and progression holds); one at the end of week 9 reports none. The
  // athlete asked for three run days from the first plan.
  const first = withMethod(half.input, 'three-run-days')
  const { steps } = season(first, {
    wellness: (step, monday) => {
      if (step === 6) {
        return [wellnessDay(addDays(monday, -3), { painFocalBone: true, painScore: 4 })]
      }
      if (step === 10) {
        return [wellnessDay(addDays(monday, -2), { painFocalBone: false, painScore: 0 })]
      }
      return []
    },
  })
  const at = (step: number): Step => steps[step - 1]!

  it('draws every week under three run days until the hold starts', () => {
    for (let step = 1; step <= 5; step += 1) {
      const { draft, monday } = at(step)
      expect(at(step).heldWeek, `step ${String(step)}`).toBeNull()
      for (const week of draft.weeks.filter((w) => w.weekStart >= monday)) {
        expect(shapeOf(draft, week.weekStart), `${String(step)} ${week.weekStart}`).toBe(
          'three-run-days',
        )
        expect(runDaysOf(draft, week.weekStart)).toBeLessThanOrEqual(3)
      }
    }
  })

  it('applies a hold that starts at once: the week it starts in is drawn under the plan’s own shape', () => {
    const { input, draft, monday, heldWeek } = at(6)
    const state = estimateState(input)
    expect(resolveMethod(input, state)).toMatchObject({
      requested: 'three-run-days',
      effective: 'default',
      reason: 'held:bone-pain',
    })
    // the shape the stored week had cannot be drawn again under the hold, so nothing is held
    expect(heldWeek).toBeNull()
    expect(shapeOf(draft, monday)).toBe('default')
    expect(runDaysOf(draft, monday)).toBeGreaterThan(3)
  })

  it('keeps the plan’s own shape while the hold lasts, week after week', () => {
    for (let step = 7; step <= 9; step += 1) {
      const { draft, monday, heldWeek } = at(step)
      expect(heldWeek, `step ${String(step)}`).toBeNull()
      for (const week of draft.weeks.filter((w) => w.weekStart >= monday)) {
        expect(shapeOf(draft, week.weekStart)).toBe('default')
      }
    }
  })

  it('holds the current week under the plan’s own shape on the re-plan where the hold ends', () => {
    const { draft, monday, heldWeek, input } = at(10)
    expect(resolveMethod(input, estimateState(input))).toMatchObject({
      effective: 'three-run-days',
      reason: null,
    })
    expect(heldWeek).toBe(monday)
    // the week stays as it was drawn; three run days begin with the week after it
    expect(shapeOf(draft, monday)).toBe('default')
    expect(runDaysOf(draft, monday)).toBe(runDaysOf(at(9).draft, monday))
    const next = addDays(monday, 7)
    expect(shapeOf(draft, next)).toBe('three-run-days')
    expect(runDaysOf(draft, next)).toBeLessThanOrEqual(3)
  })

  it('holds that week once only: the next Monday’s re-plan has no week to hold', () => {
    expect(at(11).heldWeek).toBeNull()
    for (let step = 11; step <= steps.length; step += 1) {
      const { draft, monday } = at(step)
      expect(at(step).heldWeek).toBeNull()
      for (const week of draft.weeks.filter((w) => w.weekStart >= monday)) {
        expect(shapeOf(draft, week.weekStart)).toBe('three-run-days')
        expect(runDaysOf(draft, week.weekStart)).toBeLessThanOrEqual(3)
      }
    }
  })

  it('passes the plan checks at every re-plan, the held week’s included', () => {
    for (const { monday, draft } of steps) expect(failed(draft), monday).toEqual([])
  })

  it('plans no minute, no week target and no peak above the default plan at any re-plan, the held one included [rule G6]', () => {
    for (const { monday, input, draft } of steps) {
      expect(aboveDefault(defaultOn(input), draft), monday).toEqual([])
    }
  })

  it('draws the held week as the re-plan without the guard draws it: nothing but its shape is kept', () => {
    // without the stored shape the same re-plan reads three run days for the week
    const { input, draft, monday } = at(10)
    const stripped: EngineInput = {
      ...input,
      existing: {
        ...input.existing!,
        weeks: input.existing!.weeks.map((w) =>
          w.weekStart === monday ? { ...w, flags: [...w.flags, 'shape-three-run-days'] } : w,
        ),
      },
    }
    const unguarded = replan(stripped)
    expect(unguarded.heldWeek).toBeNull()
    expect(shapeOf(unguarded.draft, monday)).toBe('three-run-days')
    expect(runDaysOf(draft, monday)).toBeGreaterThan(runDaysOf(unguarded.draft, monday))
  })
})

describe('a change of method in the middle of a plan [decision 8, follow-up 27]', () => {
  // The plan is the default's. On the Thursday of the seventh week after the first plan the runner asks
  // for three run days: the runs of Monday to Wednesday are done, the rest of the week is planned. The
  // week keeps the shape it was drawn under, the weeks after it are three run days, and the weekly
  // re-plans that follow keep the plan inside the checks, each a fixed point of its own input.
  const lead = season(half.input, { until: 7 })
  const { monday, draft } = lead.steps.at(-1)!
  const today = addDays(monday, 3)
  const activities = [...lead.steps.at(-1)!.input.activities, ...ran(draft, monday, today)]
  const asked = (method: PresetId | undefined): EngineInput => ({
    ...half.input,
    options: { ...half.input.options, ...(method === undefined ? {} : { method }) },
    today,
    activities,
    existing: stored(draft, today),
  })
  const plain = replan(asked(undefined))
  const changed = replan(asked('three-run-days'))
  const sessionsOf = (d: PlanDraft, from: string, to: string) =>
    JSON.stringify(d.sessions.filter((s) => s.date >= from && s.date < to))

  it('holds the current week and draws the weeks after it again', () => {
    expect(plain.heldWeek).toBeNull()
    expect(changed.heldWeek).toBe(monday)
    expect(sessionsOf(changed.draft, monday, addDays(monday, 7))).toBe(
      sessionsOf(plain.draft, monday, addDays(monday, 7)),
    )
    expect(changed.draft.weeks.find((w) => w.weekStart === monday)).toEqual(
      plain.draft.weeks.find((w) => w.weekStart === monday),
    )
    expect(shapeOf(changed.draft, monday)).toBe('default')
    // and says of it what the plain re-plan says
    expect(weekWarnings(changed.draft, monday)).toEqual(weekWarnings(plain.draft, monday))
    const after = changed.draft.weeks.filter((w) => w.weekStart > monday)
    expect(after.length).toBeGreaterThan(8)
    for (const week of after) {
      expect(shapeOf(changed.draft, week.weekStart), week.weekStart).toBe('three-run-days')
      expect(runDaysOf(changed.draft, week.weekStart), week.weekStart).toBeLessThanOrEqual(3)
    }
    // the sessions the plain re-plan draws for those weeks use more days
    expect(Math.max(...after.map((w) => runDaysOf(plain.draft, w.weekStart)))).toBeGreaterThan(3)
  })

  it('adds no load to any week, as the plan’s own shape would not [rule G6]', () => {
    for (const week of changed.draft.weeks) {
      const own = plain.draft.weeks.find((w) => w.weekStart === week.weekStart)!
      expect(week.targetRunMin, week.weekStart).toBeLessThanOrEqual(own.targetRunMin)
    }
    // nor a planned minute in a week, nor the peak
    expect(aboveDefault(plain.draft, changed.draft)).toEqual([])
  })

  it('passes the plan checks', () => {
    expect(failed(changed.draft)).toEqual([])
    expect(failed(plain.draft)).toEqual([])
  })

  it('reads the same again from the plan it stored: a fixed point of the same input', () => {
    let again = changed
    for (let pass = 2; pass <= 3; pass += 1) {
      again = replan({ ...asked('three-run-days'), existing: stored(again.draft, today) })
      expect(again.heldWeek, `pass ${String(pass)}`).toBe(monday)
      expect(again.draft, `pass ${String(pass)}`).toEqual(changed.draft)
    }
  })

  describe('and the weekly re-plans after it', () => {
    const resume: Resume = {
      draft: changed.draft,
      activities: [...activities, ...ran(changed.draft, today, addDays(monday, 7))],
      wellness: half.input.wellness,
      next: addDays(monday, 7),
    }
    const { steps } = season(asked('three-run-days'), {}, resume)

    it('hold no week, as the week the change held is over', () => {
      expect(steps.length).toBeGreaterThan(8)
      expect(steps.every((s) => s.heldWeek === null)).toBe(true)
    })

    it('draw every week under three run days and pass the plan checks', () => {
      for (const { monday: m, draft: d } of steps) {
        expect(failed(d), m).toEqual([])
        for (const week of d.weeks.filter((w) => w.weekStart >= m)) {
          expect(shapeOf(d, week.weekStart), `${m} ${week.weekStart}`).toBe('three-run-days')
          expect(runDaysOf(d, week.weekStart), `${m} ${week.weekStart}`).toBeLessThanOrEqual(3)
        }
      }
    })

    it('plan no minute, no week target and no peak above the default plan of their own input [rule G6]', () => {
      for (const { monday: m, input, draft: d } of steps) {
        expect(aboveDefault(defaultOn(input), d), m).toEqual([])
      }
    })

    it('are a fixed point of their own input at every Monday', () => {
      for (const { monday: m, input, draft: d } of steps) {
        const again = replan({ ...input, existing: stored(d, m) })
        expect(again.heldWeek, m).toBeNull()
        expect(again.draft, m).toEqual(d)
      }
    })

    it('end in the race week of the goal, no week above the plan’s own peak', () => {
      const last = steps.at(-1)!.draft
      expect(steps.at(-1)!.monday).toBe(mondayOf(half.input.goal.date))
      const peak = (d: PlanDraft) =>
        Math.max(
          ...d.weeks.filter((w) => !w.isTaper && w.phase !== 'race').map((w) => w.targetRunMin),
        )
      expect(peak(last)).toBeLessThanOrEqual(peak(plain.draft))
    })
  })
})

describe('a change of method on every matrix athlete [decision 8]', () => {
  // On the Thursday of the third week after the first plan, each athlete asks for each shape. Where
  // the shape applies the current week is held and the weeks after it carry it; where it reads as the
  // plan's own (a goal it is not for, a novice's days) nothing is held and nothing changes.
  const cases = athletes().flatMap((a) =>
    (['three-run-days', 'longer-base'] as const).map((method) => [a.id, method] as const),
  )

  it.each(cases)('%s asks for %s', (id, method) => {
    const athlete = athletes().find((a) => a.id === id)!
    const lead = season(athlete.input, { until: 3 })
    if (lead.steps.length < 3) return
    const { monday, draft, input: step } = lead.steps.at(-1)!
    const today = addDays(monday, 3)
    const base: EngineInput = {
      ...athlete.input,
      today,
      activities: [...step.activities, ...ran(draft, monday, today)],
      existing: stored(draft, today),
    }
    const plain = replan(base)
    const asked = withMethod(base, method)
    const changed = replan(asked)
    const position = resolveMethod(asked, estimateState(asked), changed.draft.weeks)
    // no check fails that the plan without the change passes
    expect(failed(changed.draft)).toEqual(failed(plain.draft))
    // no week target, no planned week and no peak above the plan's own [rule G6]
    expect(aboveDefault(plain.draft, changed.draft)).toEqual([])
    if (position.effective === 'default') {
      expect(changed.heldWeek).toBeNull()
      expect(changed.draft.weeks.some((w) => shapeOfFlags(w.flags) !== 'default')).toBe(false)
      return
    }
    const sessions = (d: PlanDraft) =>
      JSON.stringify(d.sessions.filter((s) => s.date >= monday && s.date < addDays(monday, 7)))
    const programme = (w: { flags: string[] }) =>
      w.flags.some((f) => /^ladder-|^restart-floor$|^injury-return$/.test(f))
    // a week a start programme sets is the programme's whatever the shape: there is nothing to hold
    const held = !programme(changed.draft.weeks.find((w) => w.weekStart === monday)!)
    expect(changed.heldWeek).toBe(held ? monday : null)
    expect(sessions(changed.draft)).toBe(sessions(plain.draft))
    if (held) expect(shapeOf(changed.draft, monday)).toBe('default')
    for (const week of changed.draft.weeks.filter((w) => w.weekStart > monday)) {
      if (!programme(week)) expect(shapeOf(changed.draft, week.weekStart)).toBe(position.effective)
    }
    // the same input and the plan it stored give the plan back
    const again = replan({ ...asked, existing: stored(changed.draft, today) })
    expect(again.draft).toEqual(changed.draft)
    expect(again.heldWeek).toBe(changed.heldWeek)
  })
})

describe('the warnings of a held week [rules g-1, g-2, g-6]', () => {
  // The held pass places nothing in the week and takes its sessions as fixed, so it says nothing of
  // them. The re-plan keeps the warnings the pass that drew the week gave it: a week run past its
  // plan (`overshoot-week`) and a run with no reference run to bound it (`spike-no-reference`).
  it('keeps each warning the plain re-plan gives the week, on every matrix athlete', () => {
    let checked = 0
    for (const athlete of athletes()) {
      const lead = season(athlete.input, { until: 4 })
      if (lead.steps.length < 4) continue
      for (const step of lead.steps.slice(1)) {
        const { monday, draft, input: before } = step
        for (const day of [0, 3]) {
          const today = addDays(monday, day)
          const base: EngineInput = {
            ...athlete.input,
            today,
            activities: [...before.activities, ...ran(draft, monday, today)],
            existing: stored(draft, today),
          }
          const plain = replan(base)
          for (const method of ['three-run-days', 'longer-base'] as const) {
            const changed = replan(withMethod(base, method))
            if (changed.heldWeek === null) continue
            const said = new Set(changed.draft.warnings.map((w) => `${w.code}|${w.message}`))
            for (const warning of weekWarnings(plain.draft, monday)) {
              checked += 1
              expect(said.has(warning), `${athlete.id} ${today} ${method}: ${warning}`).toBe(true)
            }
          }
        }
      }
    }
    // the check is not vacuous: the plain re-plans do warn of weeks that a change holds
    expect(checked).toBeGreaterThan(0)
  }, 60_000)

  it('keeps the warning of a week run past its plan', () => {
    const lead = season(half.input, { until: 3 })
    const { monday, draft, input: before } = lead.steps.at(-1)!
    const today = addDays(monday, 3)
    // a long run on Monday, far above what the week holds: the week stands as run
    const extra = activity(monday, {
      id: 'run-past-plan',
      durationSec: 400 * 60,
      distanceM: 400 * 170,
    })
    const base: EngineInput = {
      ...half.input,
      today,
      activities: [...before.activities, ...ran(draft, monday, today), extra],
      existing: stored(draft, today),
    }
    const plain = replan(base)
    expect(plain.draft.warnings.map((w) => w.code)).toContain('overshoot-week')
    for (const method of ['three-run-days', 'longer-base'] as const) {
      const changed = replan(withMethod(base, method))
      expect(changed.heldWeek, method).toBe(monday)
      expect(
        changed.draft.warnings.filter((w) => w.code === 'overshoot-week'),
        method,
      ).toEqual(plain.draft.warnings.filter((w) => w.code === 'overshoot-week'))
    }
  })
})
