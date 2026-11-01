// The weekly re-plan chains of the twelve matrix athletes at every method preset [rules P1 to P4,
// task M5 of the sources, methods and evaluation proposal]: the first plan and a re-plan on every
// Monday to the race week, each week run exactly as planned, four ways: with no window, with a rest
// window that opens and closes in the middle of the plan, with a painful niggle, which is a
// persistent hold, and with a mild niggle that opens on a Monday. At every step of every chain:
// - the plan passes the checklist, keeps the race and the day rules of the windows;
// - no week target, no planned week and no peak is above the default plan of the same input [G6];
// - the preset applies exactly as the resolver says: a rest window (transient) leaves it in place,
//   a persistent hold reads the default for as long as it lasts, and a novice who stops being one
//   gets the preset the plan asked for;
// - a re-plan with nothing new returns the plan it replaces (the fixed point of RF1,
//   `sim-athlete.test.ts`), step 0 left out as there.
// Found by M5 (2026-10-31) and fixed by RF2: the weeks after a window planned a small share of the
// plan before it, at the default and at both presets (a part week was the whole baseline of the
// weeks after it, `highestBaseline`), and a re-plan with nothing new did not give its plan back at
// two steps, the collapse seen from the other side. One thing does not hold, not fixed (see the list
// in the file): a second pass of `longer-base` on the 50 km trail athlete moves minutes between the
// sessions of the current week.
//
// The windows are shapes of the rest-window sweep (`rest-window-sweep.ts`): an illness above the
// neck of 7 days and a niggle of 3 days, each starting on the Saturday before the fifth Monday of
// the chain, so the re-plan of that Monday reports the window open and the next one finds it closed,
// and a niggle of 3 days that starts on that Monday itself.
//
// Every preset is grade D, a choice and not a better plan: the chains check that a preset plan is a
// plan inside every limit, never that it is better than the default's.
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it, test } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { dayRuleOn, disruptionPlan, injuryReports } from '../../../shared/engine/disruption.ts'
import { replan } from '../../../shared/engine/index.ts'
import { loadPosition } from '../../../shared/engine/loadSetting.ts'
import { withShape } from '../../../shared/engine/shape.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { DisruptionWindow, EngineInput, PlanDraft } from '../../../shared/engine/types.ts'
import { HARD_OR_STRIDES, RUNNING, windowOf } from './disruption-fixtures.ts'
import { athletes, TODAY } from './matrix-fixtures.ts'
import {
  aboveDefault,
  OFFERED,
  positionOf,
  READING,
  type Offered,
  type Reading,
} from './method-fixtures.ts'
import { replanSteps, type ReplanStep } from './replan-steps.ts'
import { REST_SWEEP_KINDS, REST_SWEEP_LENGTHS } from './rest-window-sweep.ts'
import { withStoredPlan } from './sim-athlete.ts'

// The chains of 12 athletes at three methods and three scenarios, and a re-plan at each of their
// steps, take about a minute: the file is in the `sweep` project (`tests/vitestProjects.ts`), which
// sets the test timeout, far above that.

const all = athletes()

// ---------------------------------------------------------------------------------------------
// The chains
// ---------------------------------------------------------------------------------------------

/** The Monday of the fifth plan of every chain: the first plan, then four re-plans. */
const OPENING = addDays(mondayOf(TODAY), 28)
const START = addDays(OPENING, -2)
const kindOf = (reason: DisruptionWindow['reason'], mode: DisruptionWindow['mode']) =>
  REST_SWEEP_KINDS.find((k) => k.reason === reason && k.mode === mode)!

/** An illness above the neck: rest for 7 days, Saturday to Friday. A rest window is transient. */
const ILLNESS = windowOf({
  ...kindOf('illness-above-neck', 'rest'),
  id: 'chain-illness',
  startDate: START,
  endDate: addDays(START, REST_SWEEP_LENGTHS[2] - 1),
})
/** A niggle reported with pain at the flag score: rest for 3 days, and a persistent hold after it. */
const NIGGLE = windowOf({
  ...kindOf('niggle', 'rest'),
  id: 'chain-niggle',
  startDate: START,
  endDate: addDays(START, REST_SWEEP_LENGTHS[1] - 1),
  pain: P.pain.flagScore.value,
  gaitChange: false,
})

/** A niggle with no pain at the flag score, rest for 3 days from the fifth Monday: a rest window. */
const MONDAY = windowOf({
  ...kindOf('niggle', 'rest'),
  id: 'chain-monday',
  startDate: OPENING,
  endDate: addDays(OPENING, REST_SWEEP_LENGTHS[1] - 1),
  pain: P.pain.flagScore.value - 1,
  gaitChange: false,
})

const SCENARIOS = {
  plain: [] as DisruptionWindow[],
  illness: [ILLNESS],
  niggle: [NIGGLE],
  monday: [MONDAY],
}
type Scenario = keyof typeof SCENARIOS
const SCENARIO_NAMES = Object.keys(SCENARIOS) as Scenario[]

type Method = Offered | 'default'
const METHODS: readonly Method[] = ['default', ...OFFERED]

const chains = new Map<string, ReplanStep[]>()
function chainOf(id: string, scenario: Scenario, method: Method): ReplanStep[] {
  const key = `${method}/${scenario}/${id}`
  let chain = chains.get(key)
  if (chain === undefined) {
    chain = replanSteps(id, {
      ...(method === 'default' ? {} : { method }),
      windows: SCENARIOS[scenario],
    })
    chains.set(key, chain)
  }
  return chain
}

/** A value made on first use, so a chain two tests read is worked out once. */
function lazy<T>(make: () => T): () => T {
  let made: { value: T } | undefined
  return () => (made ??= { value: make() }).value
}

const where = (id: string, scenario: Scenario, k: number, step: ReplanStep): string =>
  `${scenario}: ${id} step ${String(k)} (${step.input.today})`

/**
 * The default plan of the input of a step: the plan G6 holds a preset to, worked out once. The
 * stored plan of a preset's chain carries the `shape-<preset>` flag on its weeks, which tells a
 * re-plan the shape the current week was drawn under (M6, follow-up 27): a re-plan asked for the
 * default would keep that week under the preset's shape and draw the weeks after it from it. The
 * default plan of the same input is the default plan of the same weeks, so the flag is left off the
 * stored weeks here.
 */
const defaults = new WeakMap<EngineInput, PlanDraft>()
function defaultOn(input: EngineInput): PlanDraft {
  let plan = defaults.get(input)
  if (plan === undefined) {
    const stored = input.existing
    plan = replan({
      ...input,
      options: { ...input.options, method: 'default' },
      existing:
        stored === null
          ? null
          : { ...stored, weeks: stored.weeks.map((week) => withShape(week, 'default')) },
    }).draft
    defaults.set(input, plan)
  }
  return plan
}

const targets = (plan: PlanDraft): number[] => plan.weeks.map((w) => w.targetRunMin)

/** A case a list below pins: `id` names it, `detail` is what the failure message prints. */
interface Case {
  id: string
  detail: string
}

// ---------------------------------------------------------------------------------------------
// The weeks after a window
// ---------------------------------------------------------------------------------------------

/**
 * A week in the 28 days after a window closes plans at least this share of the same week in the
 * plan before it, outside recovery and taper weeks: the deepest restart share of J7 (a layoff over
 * 28 days restarts at 50%). A preference of this file, not a rule: J7 sets the return week and the
 * climb after it follows the ramp, so a week can fall under the share of the plan before only where
 * a rule other than the window draws it, and none does in these chains (RF2).
 */
const RETURN_FLOOR = P.j7.restartOver28.value

function returnWeeks(method: Method, scenario: Scenario): Case[] {
  const out: Case[] = []
  for (const a of all) {
    const chain = chainOf(a.id, scenario, method)
    chain.forEach((step, k) => {
      if (k === 0) return
      const windows = step.input.disruptions ?? []
      const low = step.draft.weeks.filter((w) => {
        if (w.isRecovery || w.isTaper) return false
        if (
          !windows.some((x) => x.endDate < w.weekStart && w.weekStart <= addDays(x.endDate, 28))
        ) {
          return false
        }
        const before = chain[k - 1]!.draft.weeks.find((x) => x.weekStart === w.weekStart)
        return (
          before !== undefined &&
          !before.isRecovery &&
          !before.isTaper &&
          before.targetRunMin >= 60 &&
          w.targetRunMin < RETURN_FLOOR * before.targetRunMin
        )
      })
      if (low.length === 0) return
      const first = low[0]!
      const before = chain[k - 1]!.draft.weeks.find((x) => x.weekStart === first.weekStart)!
      out.push({
        id: `${scenario}: ${a.id} step ${String(k)}`,
        detail: `${where(a.id, scenario, k, step)}: ${String(low.length)} weeks under ${String(RETURN_FLOOR * 100)}% of the plan before, the first ${first.weekStart} at ${String(first.targetRunMin)} against ${String(before.targetRunMin)} min`,
      })
    })
  }
  return out
}

// Found by M5 (2026-10-31) and fixed by RF2. At the re-plan that reported the 7-day illness open, every
// week after the window planned 16 to 29 minutes where the plan before had 190 to 330 (`hot-race` at
// the default and at both presets, the half-marathon athlete at `three-run-days`), and at the re-plan
// that reported a 3-day mild niggle open the weeks after it planned 33% to 38% of the plan before
// (`half`, `returning`, `sparse-100-mile`). The week the window left with a few minutes was the only
// baseline of the weeks after it, a recovery week between them having been skipped; now a part week
// counts beside another week and never alone, so those weeks are measured against the last week run
// (J7), bounded by the plan before. The direct cases are in `disruption-integration.test.ts`.
describe.each(METHODS)('the weeks after a window at %s', (method) => {
  const cases = lazy(() => SCENARIO_NAMES.flatMap((s) => returnWeeks(method, s)))

  it('plan at least the deepest J7 share of the plan before', () => {
    expect(cases().map((c) => c.detail)).toEqual([])
  })
})

describe('the half-marathon athlete at three-run-days after the illness', () => {
  it('draws the plan the default method draws from the same input, so the preset does not change the return', () => {
    const step = chainOf('half', 'illness', 'three-run-days')[4]!
    expect(targets(defaultOn(step.input))).toEqual(targets(step.draft))
    // the weeks after the window, against the same Monday of the default chain
    const base = chainOf('half', 'illness', 'default')[4]!
    const after = step.draft.weeks.filter((w) => w.weekStart > ILLNESS.endDate && !w.isRecovery)
    const before = new Map(base.draft.weeks.map((w) => [w.weekStart, w.targetRunMin]))
    expect(after.length).toBeGreaterThan(7)
    for (const w of after.slice(0, 8)) {
      expect(w.targetRunMin, w.weekStart).toBeGreaterThanOrEqual(
        RETURN_FLOOR * before.get(w.weekStart)!,
      )
    }
  })
})

// ---------------------------------------------------------------------------------------------
// What a chain keeps at every step
// ---------------------------------------------------------------------------------------------

describe.each(OFFERED)('the weekly chains at %s', (method) => {
  describe.each(SCENARIO_NAMES)('with %s', (scenario) => {
    const windows = SCENARIOS[scenario]
    const steps = all.flatMap((a) =>
      chainOf(a.id, scenario, method).map((step, k) => ({ a, step, k })),
    )

    it('has a plan at every Monday the default chain has, 249 plans in all', () => {
      for (const a of all) {
        expect(chainOf(a.id, scenario, method), a.id).toHaveLength(
          chainOf(a.id, scenario, 'default').length,
        )
      }
      expect(steps.length).toBe(249)
    })

    it('passes every checklist item at every step but those the default plan fails, and keeps the race', () => {
      for (const { a, step, k } of steps) {
        const failed = step.draft.checklist.filter((c) => !c.ok).map((c) => c.id)
        const inherited = defaultOn(step.input)
          .checklist.filter((c) => !c.ok)
          .map((c) => c.id)
        expect(
          failed.filter((id) => !inherited.includes(id)),
          where(a.id, scenario, k, step),
        ).toEqual([])
        expect(
          step.draft.sessions.filter((s) => s.kind === 'race').map((s) => s.date),
          where(a.id, scenario, k, step),
        ).toEqual([a.input.goal.date])
        expect(
          step.draft.sessions.filter((s) => s.flags.includes('override-required')),
          where(a.id, scenario, k, step),
        ).toEqual([])
      }
    })

    it('keeps the day rules of the windows from today on: rest on a held day, the cap, no quality on a quiet day', () => {
      let checked = 0
      for (const { a, step, k } of steps) {
        // the windows the plan has been told of: a window starts to count at the Monday that reports it
        const rules = disruptionPlan(step.input.disruptions ?? [])
        for (const s of step.draft.sessions) {
          const rule = dayRuleOn(rules, s.date)
          if (rule === null || s.kind === 'race' || s.date < step.input.today) continue
          checked += 1
          const at = `${where(a.id, scenario, k, step)} ${s.date} ${s.kind}`
          if (rule.held) expect(s.kind, at).toBe('rest')
          if (rule.maxRunMin !== null && RUNNING.has(s.kind)) {
            expect(s.durationMin, at).toBeLessThanOrEqual(rule.maxRunMin)
          }
          if (!rule.quality) expect(HARD_OR_STRIDES.has(s.kind), at).toBe(false)
        }
      }
      expect(checked > 0, 'the windows reach the plans').toBe(windows.length > 0)
    })

    it('plans no minute, no week target and no peak above the default plan of the same input [rule G6]', () => {
      for (const { a, step, k } of steps) {
        expect(
          aboveDefault(defaultOn(step.input), step.draft),
          where(a.id, scenario, k, step),
        ).toEqual([])
      }
    })
  })
})

// ---------------------------------------------------------------------------------------------
// Which preset applies, step by step
// ---------------------------------------------------------------------------------------------

describe.each(OFFERED)('the preset along the chains at %s', (method) => {
  /** What the resolver says at a step, in the words of the table. */
  const readingAt = (step: ReplanStep): Reading => {
    const position = positionOf(step.input, step.draft)
    expect(position.requested).toBe(method)
    return position.reason === null ? 'applies' : (position.reason as Reading)
  }

  const reported = (step: ReplanStep): boolean =>
    injuryReports(step.input.disruptions ?? []).some((r) => r.until >= step.input.today)

  /**
   * What the reading should be at a step: a goal the preset does not name reads the default first;
   * then a niggle reported with pain, a persistent hold, for as long as it lasts; then the table's own
   * reading, where a novice who has run enough weeks is no longer one and gets the preset.
   */
  function expected(id: string, step: ReplanStep): Reading {
    const table = READING[method][id]!
    if (table === 'not-applicable') return table
    if (reported(step)) return 'held:recent-injury'
    if (table === 'novice' && estimateState(step.input).experience !== 'novice') return 'applies'
    return table
  }

  describe.each(SCENARIO_NAMES)('with %s', (scenario) => {
    it('reads the preset as the rules say at every step: a rest window leaves it, a reported niggle holds it, a novice who stops being one gets it', () => {
      for (const a of all) {
        chainOf(a.id, scenario, method).forEach((step, k) => {
          expect(readingAt(step), where(a.id, scenario, k, step)).toBe(expected(a.id, step))
        })
      }
    })
  })

  it('gives the novice the preset in the middle of the plan, where the run days stay at the novice days', () => {
    if (method !== 'three-run-days') return
    const chain = chainOf('novice-5k', 'plain', method)
    const sequence = chain.map((step) => readingAt(step))
    expect(sequence.slice(0, 4)).toEqual(['novice', 'novice', 'novice', 'novice'])
    expect(sequence.slice(4)).toEqual(Array<Reading>(chain.length - 4).fill('applies'))
    // the cap and the novice days are both three, so no week changes its run days at the switch
    for (const step of chain) {
      const ahead = step.draft.weeks.filter((w) => w.weekStart >= mondayOf(step.input.today))
      expect(Math.max(...ahead.map((w) => w.runDays))).toBeLessThanOrEqual(3)
    }
  })

  it('leaves the preset in place while a rest window holds the load setting, and the persistent hold takes it away', () => {
    const asks = all.filter((a) => READING[method][a.id] === 'applies')
    expect(asks.length).toBeGreaterThanOrEqual(3)
    for (const a of asks) {
      const rest = chainOf(a.id, 'illness', method)[4]!
      // the window is open at the fifth Monday and the load setting holds, as a rest window
      expect(
        ILLNESS.startDate <= rest.input.today && rest.input.today <= ILLNESS.endDate,
        a.id,
      ).toBe(true)
      const standard = {
        ...rest.input,
        options: { ...rest.input.options, loadAppetite: 'standard' as const },
      }
      expect(loadPosition(standard, estimateState(rest.input)).held, a.id).toBe('rest-window')
      expect(positionOf(rest.input, rest.draft), a.id).toMatchObject({
        effective: method,
        reason: null,
      })
      // the same Monday with a painful niggle: the hold is persistent and the preset reads the default
      const niggle = chainOf(a.id, 'niggle', method)[4]!
      expect(positionOf(niggle.input, niggle.draft), a.id).toEqual({
        requested: method,
        effective: 'default',
        reason: 'held:recent-injury',
      })
    }
  })

  it('reads the default for as long as the niggle is reported and the preset again after it', () => {
    // the reading flips back and forth in the middle of a plan: the guard of M6 (follow-up 27)
    const flips = (id: string): string =>
      chainOf(id, 'niggle', method)
        .map((step) => (positionOf(step.input, step.draft).effective === method ? 'P' : 'D'))
        .join('')
        .replace(/(.)\1+/g, '$1')
    for (const a of all.filter((x) => READING[method][x.id] === 'applies')) {
      expect(flips(a.id), a.id).toBe('PDP')
    }
    // a plan the preset reads as the default for the whole chain never flips
    for (const a of all.filter((x) => READING[method][x.id] === 'not-applicable')) {
      expect(flips(a.id), a.id).toBe('D')
    }
  })

  it('plans the days of the default for the weeks ahead while the niggle is reported, and the cap again after it (three-run-days)', () => {
    if (method !== 'three-run-days') return
    // the run days switch with the reading, twice. A hold that starts applies at once. The re-plan
    // on which it ends (step 11) keeps the week it is in under the shape that week was drawn under,
    // the plan's own (M6's guard, follow-up 27), so the cap is back with the week after it.
    const runDays = (step: ReplanStep, from: string) =>
      Math.max(...step.draft.weeks.filter((w) => w.weekStart >= from).map((w) => w.runDays))
    const ahead = (step: ReplanStep) => runDays(step, mondayOf(step.input.today))
    for (const id of ['half', 'returning']) {
      const chain = chainOf(id, 'niggle', method)
      const days = chain.map(ahead)
      expect(
        days.slice(0, 4).every((d) => d <= 3),
        `${id} before the report`,
      ).toBe(true)
      expect(
        days.slice(4, 11).some((d) => d > 3),
        `${id} while it is reported`,
      ).toBe(true)
      // the week the hold ends in is held, and no other week is, before it or after it
      const held = chain.map((step) => replan(step.input).heldWeek)
      expect(held.indexOf(mondayOf(chain[11]!.input.today)), `${id} held week`).toBe(11)
      expect(
        held.filter((week) => week !== null),
        `${id} held weeks`,
      ).toHaveLength(1)
      expect(
        chain.slice(11).every((step) => runDays(step, addDays(mondayOf(step.input.today), 7)) <= 3),
        `${id} after it`,
      ).toBe(true)
      expect(
        days.slice(12).every((d) => d <= 3),
        `${id} the weeks after it`,
      ).toBe(true)
    }
  })
})

// ---------------------------------------------------------------------------------------------
// A re-plan with nothing new returns the plan it replaces
// ---------------------------------------------------------------------------------------------

/** The plan of a step, stored as it came out and re-planned with nothing new [RF1]. */
function givesBack(step: ReplanStep): PlanDraft {
  return replan(withStoredPlan({ settled: step.input, draft: step.draft })).draft
}

/** What differs between two drafts of one Monday, in a line. */
function difference(a: PlanDraft, b: PlanDraft): string {
  const weeks = b.weeks.filter((w, i) => !isDeepStrictEqual(w, a.weeks[i])).map((w) => w.weekStart)
  const sessions = b.sessions.filter((s, i) => !isDeepStrictEqual(s, a.sessions[i]))
  return `weeks ${weeks.slice(0, 3).join(',') || 'none'}, ${String(sessions.length)} sessions (${sessions
    .slice(0, 2)
    .map((s) => `${s.date} ${s.kind} ${String(s.durationMin)}`)
    .join('; ')})`
}

const drifts = new Map<Method, () => { cases: Case[]; steps: number }>(
  METHODS.map((method) => [
    method,
    lazy(() => {
      const cases: Case[] = []
      let steps = 0
      for (const scenario of SCENARIO_NAMES) {
        for (const a of all) {
          chainOf(a.id, scenario, method).forEach((step, k) => {
            if (k === 0) return
            steps += 1
            const back = givesBack(step)
            if (!isDeepStrictEqual(back, step.draft)) {
              cases.push({
                id: `${scenario}: ${a.id} step ${String(k)}`,
                detail: `${where(a.id, scenario, k, step)}: ${difference(step.draft, back)}`,
              })
            }
          })
        }
      }
      return { cases, steps }
    }),
  ]),
)

/**
 * The cases where a re-plan with nothing new does not return the plan it replaces, over the steps of
 * the four chains of every athlete at each method (step 0 left out, as in RF1). Found by M5
 * (2026-10-31). The first was the collapse above seen from the other side, `three-run-days` on the
 * half-marathon athlete: the plan the step stored was the one that was wrong, and the second pass
 * drew the weeks again from the minutes it found; RF2 fixed it with the collapse. The second is
 * small and stays: at the re-plan that reports a mild niggle open from that Monday, a second pass of
 * `longer-base` on the 50 km trail athlete moves 2 to 7 minutes between the sessions of the current
 * week (the easy runs 27 to 25, the long run 162 to 169, the strides run 27 to 24) where the default
 * gives its week back. Traced by RF2: it is not the return from a window and shares no cause with
 * the collapse. The week's minutes are the same at both passes (243); what moves is how they are
 * shared. The window's own cap (`holdWeek`) keeps the long run and leaves the preset's week at 252
 * minutes where the default's is 243; the cap that holds a preset to the default plan [rule G6]
 * (`capWeek(planWeek, limit.target)`) then takes the 9 minutes off every session by the same share,
 * the long run included (169 to 162). At the second pass the week is already at 243, the cap has
 * nothing to take and the long run keeps its 169. Capping a week a window touched with `holdWeek`
 * as the window does would give the one answer at both passes, and moves every preset plan that a
 * window reaches: a task of its own, so the case stays.
 */
const DRIFTS: Record<Method, string[]> = {
  default: [],
  'three-run-days': [],
  'longer-base': ['monday: trail-50k step 4'],
}

describe.each(METHODS)('a re-plan with nothing new, at %s [RF1 relation]', (method) => {
  const result = drifts.get(method)!

  it('gives the plan back at every step of every chain, but the listed cases', () => {
    // 4 chains of the 249 plans of the twelve athletes, the first plan of each left out
    expect(result().steps).toBe(4 * (249 - 12))
    expect(result().cases.map((c) => c.id)).toEqual(DRIFTS[method])
  })

  if (DRIFTS[method].length > 0) {
    test.fails('gives the plan back at every step of every chain', () => {
      expect(result().cases.map((c) => c.detail)).toEqual([])
    })
  }
})
