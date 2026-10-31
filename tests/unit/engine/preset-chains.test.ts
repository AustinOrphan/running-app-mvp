// The weekly re-plan chains of the twelve matrix athletes at every method preset [rules P1 to P4,
// task M5 of the sources, methods and evaluation proposal]: the first plan and a re-plan on every
// Monday to the race week, each week run exactly as planned, three ways: with no window, with a rest
// window that opens and closes in the middle of the plan, and with a painful niggle, which is a
// persistent hold. At every step of every chain:
// - the plan passes the checklist, keeps the race and the day rules of the windows;
// - no week target, no planned week and no peak is above the default plan of the same input [G6];
// - the preset applies exactly as the resolver says: a rest window (transient) leaves it in place,
//   a persistent hold reads the default for as long as it lasts, and a novice who stops being one
//   gets the preset the plan asked for;
// - a re-plan with nothing new returns the plan it replaces (the fixed point of RF1,
//   `sim-athlete.test.ts`), step 0 left out as there.
// Two things do not hold, found by M5 and not fixed (see the lists in the file): the weeks after a
// window plan a small share of the plan before it for one athlete at the default and for another at
// `three-run-days`, and the second is the one place a re-plan does not give its plan back.
//
// The windows are shapes of the rest-window sweep (`rest-window-sweep.ts`): an illness above the
// neck of 7 days and a niggle of 3 days, each starting on the Saturday before the fifth Monday of
// the chain, so the re-plan of that Monday reports the window open and the next one finds it closed.
//
// Every preset is grade D, a choice and not a better plan: the chains check that a preset plan is a
// plan inside every limit, never that it is better than the default's.
import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it, test, vi } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState } from '../../../shared/engine/athlete.ts'
import { dayRuleOn, disruptionPlan, injuryReports } from '../../../shared/engine/disruption.ts'
import { replan } from '../../../shared/engine/index.ts'
import { loadPosition } from '../../../shared/engine/loadSetting.ts'
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
// steps, take about a minute: the timeout is that, twice, so a slow machine fails the assertion with
// a message and not a bare timeout.
vi.setConfig({ testTimeout: 120_000 })

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

const SCENARIOS = {
  plain: [] as DisruptionWindow[],
  illness: [ILLNESS],
  niggle: [NIGGLE],
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

/** The default plan of the input of a step: the plan G6 holds a preset to, worked out once. */
const defaults = new WeakMap<EngineInput, PlanDraft>()
function defaultOn(input: EngineInput): PlanDraft {
  let plan = defaults.get(input)
  if (plan === undefined) {
    plan = replan({ ...input, options: { ...input.options, method: 'default' } }).draft
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
 * climb after it follows the ramp, and the cases that fall far under it are listed below.
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

/**
 * The cases of the weeks after a window that plan under the share above, found by M5 (2026-10-31)
 * and not fixed here. At the re-plan that reports the 7-day illness open, every week after the
 * window plans 16 to 29 minutes where the plan before had 190 to 330: `hot-race` at the default, and
 * with it at both presets (`three-run-days` does not name its marathon goal, and `longer-base`
 * reads the same weeks), and the half-marathon athlete at `three-run-days` alone. The checklist
 * passes, as no item reads a week against the plan before it, and the next re-plan draws the weeks
 * again, so the plan is back one step later. The default method on the same input plans the same
 * weeks as the preset (a test below), so the defect is in the return from a window, not in a preset.
 */
const RETURN_COLLAPSES: Record<Method, string[]> = {
  default: ['illness: hot-race step 4'],
  'three-run-days': ['illness: half step 4', 'illness: hot-race step 4'],
  'longer-base': ['illness: hot-race step 4'],
}

describe.each(METHODS)('the weeks after a window at %s', (method) => {
  const cases = lazy(() => SCENARIO_NAMES.flatMap((s) => returnWeeks(method, s)))

  it('plan at least the deepest J7 share of the plan before, but the listed cases', () => {
    expect(cases().map((c) => c.id)).toEqual(RETURN_COLLAPSES[method])
  })

  if (RETURN_COLLAPSES[method].length > 0) {
    test.fails('plan at least the deepest J7 share of the plan before', () => {
      expect(cases().map((c) => c.detail)).toEqual([])
    })
  }
})

describe('the collapse of the half-marathon athlete at three-run-days', () => {
  it('is the plan the default method draws from the same input, so it is not the preset that collapses it', () => {
    const step = chainOf('half', 'illness', 'three-run-days')[4]!
    expect(targets(defaultOn(step.input))).toEqual(targets(step.draft))
    // the weeks after the window, against the same Monday of the default chain
    const base = chainOf('half', 'illness', 'default')[4]!
    const after = step.draft.weeks.filter((w) => w.weekStart > ILLNESS.endDate)
    const before = new Map(base.draft.weeks.map((w) => [w.weekStart, w.targetRunMin]))
    expect(Math.max(...after.slice(1, 8).map((w) => w.targetRunMin))).toBeLessThan(40)
    expect(Math.min(...after.slice(1, 8).map((w) => before.get(w.weekStart)!))).toBeGreaterThan(150)
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
    // the run days switch with the reading, twice: pinned as a fact for M6's guard
    const ahead = (step: ReplanStep) =>
      Math.max(
        ...step.draft.weeks
          .filter((w) => w.weekStart >= mondayOf(step.input.today))
          .map((w) => w.runDays),
      )
    for (const id of ['half', 'returning']) {
      const days = chainOf(id, 'niggle', method).map(ahead)
      expect(
        days.slice(0, 4).every((d) => d <= 3),
        `${id} before the report`,
      ).toBe(true)
      expect(
        days.slice(4, 11).some((d) => d > 3),
        `${id} while it is reported`,
      ).toBe(true)
      expect(
        days.slice(11).every((d) => d <= 3),
        `${id} after it`,
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
 * the three chains of every athlete at each method (step 0 left out, as in RF1). Found by M5
 * (2026-10-31) and not fixed here. It is the collapse above seen from the other side: the plan the
 * step stored is the one that is wrong, and the second pass draws the weeks again from the minutes
 * it finds. `hot-race` collapses at every method and gives its plan back, since the weeks it stored
 * are the weeks it draws again.
 */
const DRIFTS: Record<Method, string[]> = {
  default: [],
  'three-run-days': ['illness: half step 4'],
  'longer-base': [],
}

describe.each(METHODS)('a re-plan with nothing new, at %s [RF1 relation]', (method) => {
  const result = drifts.get(method)!

  it('gives the plan back at every step of every chain, but the listed cases', () => {
    // 3 chains of the 249 plans of the twelve athletes, the first plan of each left out
    expect(result().steps).toBe(3 * (249 - 12))
    expect(result().cases.map((c) => c.id)).toEqual(DRIFTS[method])
  })

  if (DRIFTS[method].length > 0) {
    test.fails('gives the plan back at every step of every chain', () => {
      expect(result().cases.map((c) => c.detail)).toEqual([])
    })
  }
})
