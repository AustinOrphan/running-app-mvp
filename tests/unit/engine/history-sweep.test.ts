// A seeded sweep of the rebuild zone over synthetic runners [rules g-8, proposal section 5.3]: a
// block of steady weeks of random size and age, sparse weeks since, a goal of random kind and
// distance, at steady, standard and upper. Every plan must pass its checklist, hold the ceiling of
// G-2 and the session guard of G-1, step by no more than the position allows, and never plan fewer
// minutes than steady up to the week the rebuild ceiling is reached. The long run never comes
// sooner than with weekly time not limiting (S4), and the older credit window and its taper are
// checked on the block itself.
//
// A second part of the sweep runs weekly re-plan chains of the same runners at standard and upper,
// each week run above its plan by a seeded factor, for the response to weeks run above plan [rule
// g-8]: every plan of the chain must pass the same checks, and the response may add minutes where
// the mean of the weeks run passes the planned baseline and must change nothing elsewhere.
//
// The seed picks a sample; a failure names the runner by its index to replay it.
import { describe, expect, it } from 'vitest'
import { addDays, mondayOf } from '../../../shared/dates.ts'
import { estimateState, historyBlock } from '../../../shared/engine/athlete.ts'
import { buildPlan, replan } from '../../../shared/engine/index.ts'
import { P } from '../../../shared/engine/params/index.ts'
import type { PlanDraft } from '../../../shared/engine/types.ts'
import { aggregateWeeks } from '../../../shared/domain/weeks.ts'
import { mulberry32 } from './disruption-fixtures.ts'
import {
  at,
  HISTORY_MONDAY,
  NO_RESPONSE,
  scenario,
  weeks as repeatWeeks,
  withResponseWeeks,
} from './history-fixtures.ts'
import {
  ceilingProblems,
  cumulative,
  expectedResponse,
  expectedZone,
  planProblems,
  POSITIONS,
  weeksToLong,
  zoneReport,
  type Position,
} from './history-properties.ts'
import { sweepCases } from './history-sweep.ts'
import { replanChain } from './replan-steps.ts'

const SEED = 20_261_025
const COUNT = 150
// The budget of the phase 3a design: the sweep runs in under 60 s. The test timeout is twice that,
// so a slow machine fails the assertion with the elapsed time instead of a bare timeout.
const BUDGET_MS = 60_000
/** The runners and the re-plans of the response part of the sweep. */
const RESPONSE_COUNT = 12
const RESPONSE_STEPS = 5

const started = Date.now()
const cases = sweepCases(SEED, COUNT)

/** The plan of every case at every position, built once. */
const plans = new Map<string, Record<Position, PlanDraft>>()
for (const c of cases) {
  plans.set(c.name, {
    steady: buildPlan(at(c.input, 'steady')),
    standard: buildPlan(at(c.input, 'standard')),
    upper: buildPlan(at(c.input, 'upper')),
  })
}
const planOf = (name: string, position: Position): PlanDraft => plans.get(name)![position]

describe('the rebuild zone over a seeded sweep of synthetic runners', () => {
  it('draws runners of every kind, with the zone in use for many of them', () => {
    expect(cases).toHaveLength(COUNT)
    expect(new Set(cases.map((c) => c.name)).size).toBe(COUNT)
    let usingZone = 0
    let withBlock = 0
    for (const c of cases) {
      if (estimateState(c.input).history !== null) withBlock += 1
      const used = (['standard', 'upper'] as const).some(
        (position) => zoneReport(at(c.input, position), planOf(c.name, position)).zoneWeeks > 0,
      )
      if (used) usingZone += 1
    }
    // a sweep that never enters the zone would pass every property below for nothing
    expect(withBlock).toBeGreaterThan(COUNT / 2)
    expect(usingZone).toBeGreaterThan(COUNT / 5)
  })

  it.each(POSITIONS)(
    '%s: the load items of the checklist pass and no run is flagged for a spike',
    (position) => {
      const bad: string[] = []
      for (const c of cases) {
        for (const problem of planProblems(planOf(c.name, position), planOf(c.name, 'steady'))) {
          bad.push(`${c.name}: ${problem}`)
        }
      }
      expect(bad).toEqual([])
    },
  )

  it.each(POSITIONS)('%s: no week passes the 30% ceiling over two weeks', (position) => {
    const bad: string[] = []
    for (const c of cases) {
      const input = at(c.input, position)
      for (const problem of ceilingProblems(input, planOf(c.name, position))) {
        bad.push(`${c.name}: ${problem}`)
      }
    }
    expect(bad).toEqual([])
  })

  it.each(POSITIONS)(
    '%s: every week steps by no more than the position allows, and the zone step stays under 14.0%',
    (position) => {
      const bad: string[] = []
      for (const c of cases) {
        const report = zoneReport(at(c.input, position), planOf(c.name, position))
        for (const problem of report.problems) bad.push(`${c.name}: ${problem}`)
        // at steady nothing is planned above the usual step
        if (position === 'steady') expect(report.zoneWeeks, c.name).toBe(0)
      }
      expect(bad).toEqual([])
    },
  )

  it('standard and upper plan at least the minutes steady does, up to the week R is reached', () => {
    const bad: string[] = []
    for (const c of cases) {
      const steady = planOf(c.name, 'steady')
      for (const position of ['standard', 'upper'] as const) {
        const plan = planOf(c.name, position)
        const zone = expectedZone(at(c.input, position))
        // up to and including the first week at R; with no zone, or R not reached, the pre-taper plan
        const reached =
          zone === null ? -1 : plan.weeks.findIndex((w) => w.targetRunMin >= zone.ceilingMin)
        const count =
          reached < 0
            ? plan.weeks.filter((w) => !w.isTaper && w.phase !== 'race').length
            : reached + 1
        const mine = cumulative(plan, count)
        const base = cumulative(steady, count)
        if (mine + 1 < base)
          bad.push(`${c.name}: ${position} ${mine} < steady ${base} over ${count} weeks`)
      }
      // upper is never below standard over the same span
      const countAll = steady.weeks.filter((w) => !w.isTaper && w.phase !== 'race').length
      const reachedStd = planOf(c.name, 'standard').weeks.findIndex(
        (w) => (expectedZone(at(c.input, 'standard'))?.ceilingMin ?? Infinity) <= w.targetRunMin,
      )
      const span = reachedStd < 0 ? countAll : reachedStd + 1
      if (
        cumulative(planOf(c.name, 'upper'), span) + 1 <
        cumulative(planOf(c.name, 'standard'), span)
      ) {
        bad.push(`${c.name}: upper below standard over ${span} weeks`)
      }
    }
    expect(bad).toEqual([])
  })

  it('the long run never comes sooner than with weekly time not limiting (S4)', () => {
    // the control: five runs a week of the case's own longest run for eight weeks, three years of
    // running and the same goal; the G-1 floor is the weeks it needs to double or triple that run
    const controls = new Map<string, PlanDraft>()
    const control = (c: (typeof cases)[number]): PlanDraft => {
      const key = `${String(c.longest30)}|${c.input.goal.date}|${c.input.goal.distanceClass}`
      let plan = controls.get(key)
      if (plan === undefined) {
        const runs = repeatWeeks(
          8,
          1,
          Array.from({ length: 5 }, () => c.longest30),
        )
        plan = buildPlan(scenario(runs, { years: 3, goal: c.input.goal }))
        controls.set(key, plan)
      }
      return plan
    }
    const bad: string[] = []
    let compared = 0
    for (const c of cases) {
      const floorPlan = control(c)
      for (const multiple of [2, 3]) {
        const target = Math.round(c.longest30 * multiple)
        const floor = weeksToLong(floorPlan, HISTORY_MONDAY, target)
        if (floor === null) continue
        for (const position of POSITIONS) {
          const weeks = weeksToLong(planOf(c.name, position), HISTORY_MONDAY, target)
          compared += 1
          if (weeks !== null && weeks < floor) {
            bad.push(
              `${c.name}: ${position} reaches ${target} min in week ${weeks}, the control in ${floor}`,
            )
          }
        }
      }
    }
    expect(compared).toBeGreaterThan(COUNT)
    expect(bad).toEqual([])
  })

  it('builds the same plan twice at every position', () => {
    for (const c of cases.slice(0, 12)) {
      for (const position of POSITIONS) {
        expect(buildPlan(structuredClone(at(c.input, position))), `${c.name} ${position}`).toEqual(
          planOf(c.name, position),
        )
      }
    }
  })

  it('the credit of an older block is 1 up to 12 weeks and falls in a line to the floor at 16', () => {
    const rnd = mulberry32(SEED)
    for (let n = 0; n < 40; n += 1) {
      const ended = 1 + Math.floor(rnd() * 16)
      const minutes = 100 + Math.floor(rnd() * 200)
      const runs = repeatWeeks(ended + 3, ended, [minutes / 2, minutes / 2])
      const input = scenario(runs)
      const rows = aggregateWeeks(
        input.activities,
        Array.from({ length: 21 }, (_, i) => addDays(mondayOf(input.today), -7 * (20 - i))),
      )
      const block = historyBlock(rows, 16)
      const floor = P.g8.creditTaperFloor.value
      if (block === null) {
        expect(ended, `ended ${String(ended)}`).toBeGreaterThan(16)
        continue
      }
      const expected =
        ended <= P.g8.creditWindowWeeks.value
          ? 1
          : 1 -
            ((1 - floor) * (ended - P.g8.creditWindowWeeks.value)) /
              (16 - P.g8.creditWindowWeeks.value)
      expect(block.weeksAgo).toBe(ended)
      expect(block.taper, `ended ${String(ended)}`).toBeCloseTo(expected, 10)
      expect(block.blockMin).toBeCloseTo(minutes, 6)
    }
  })

  it(
    'the response over weekly re-plan chains run above plan keeps every limit and adds only where it applies',
    () => {
      const rnd = mulberry32(SEED + 1)
      const bad: string[] = []
      let applied = 0
      let steps = 0
      for (const c of cases.slice(0, RESPONSE_COUNT)) {
        // each week of the chain is run 1.2 to 2.2 times its plan
        const factors = Array.from({ length: RESPONSE_STEPS + 1 }, () => 1.2 + rnd())
        for (const position of ['standard', 'upper'] as const) {
          const chain = replanChain(at(c.input, position), {
            scale: (step) => factors[step]!,
            maxSteps: RESPONSE_STEPS,
          })
          for (const [k, { input, draft }] of chain.entries()) {
            const where = `${c.name} ${position} step ${String(k)}`
            for (const problem of planProblems(draft)) bad.push(`${where}: ${problem}`)
            for (const problem of ceilingProblems(input, draft)) bad.push(`${where}: ${problem}`)
            for (const problem of zoneReport(input, draft).problems)
              bad.push(`${where}: ${problem}`)
            if (k === 0) continue
            steps += 1
            // the zone alone, from the same input: the response adds to it where the mean of the weeks
            // run passes the planned baseline, and leaves it as it is where it does not
            const mean = expectedResponse(input)?.meanMin ?? null
            const zoneOnly = withResponseWeeks(NO_RESPONSE, () => replan(input).draft)
            if (cumulative(draft, 10) + 1 < cumulative(zoneOnly, 10))
              bad.push(`${where}: below the zone alone`)
            if (cumulative(draft, 10) > cumulative(zoneOnly, 10) + 1) {
              applied += 1
              if (mean === null) bad.push(`${where}: lifted with no mean of the weeks run`)
            }
          }
        }
      }
      expect(bad).toEqual([])
      // a sweep in which the response never added a minute would pass the checks above for nothing
      expect(steps).toBeGreaterThan(RESPONSE_COUNT)
      expect(applied).toBeGreaterThan(RESPONSE_COUNT / 4)
    },
    2 * BUDGET_MS,
  )

  it(
    'runs in under 60 seconds',
    () => {
      const elapsed = Date.now() - started
      expect(elapsed).toBeLessThan(BUDGET_MS)
    },
    2 * BUDGET_MS,
  )
})
